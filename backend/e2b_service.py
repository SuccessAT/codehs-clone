"""
E2B Sandbox Service - Official SDK integration for code execution.

This module provides async integration with the official E2B SDK
for secure code execution in isolated sandboxes.
"""

import asyncio
import logging
import os
import time
import uuid
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, Optional, Set

from e2b import Sandbox

# Configure logging
logger = logging.getLogger(__name__)


class SandboxStatus(str, Enum):
    """Sandbox status values."""
    CREATING = "creating"
    ACTIVE = "active"
    TERMINATED = "terminated"
    ERROR = "error"
    TIMEOUT = "timeout"


@dataclass
class ExecutionResult:
    """Result of a code execution."""
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    execution_time: float = 0.0
    error: Optional[str] = None
    timed_out: bool = False


@dataclass
class SandboxSession:
    """Represents an active sandbox session."""
    sandbox_id: str
    user_id: int
    created_at: datetime
    last_activity: datetime
    status: SandboxStatus = SandboxStatus.ACTIVE
    language: str = "python"
    execution_count: int = 0

    def is_expired(self, timeout_minutes: int = 30) -> bool:
        """Check if sandbox has been inactive for too long."""
        return datetime.utcnow() - self.last_activity > timedelta(minutes=timeout_minutes)


@dataclass
class PendingExecution:
    """Tracks a pending execution waiting for response."""
    execution_id: str
    event: asyncio.Event
    result: Optional[ExecutionResult] = None
    stdout_callback: Optional[Callable[[str], None]] = None
    stderr_callback: Optional[Callable[[str], None]] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


class E2BConnectionError(Exception):
    """Raised when E2B service is not properly configured."""
    pass


class SandboxCreationError(Exception):
    """Raised when sandbox creation fails."""
    pass


class ExecutionTimeoutError(Exception):
    """Raised when code execution times out."""
    pass


class E2BService:
    """
    Async service for managing E2B sandbox sessions and code execution using the official SDK.
    
    Features:
    - Official E2B SDK integration
    - Sandbox lifecycle management (30 min inactivity timeout)
    - Streaming stdout/stderr via callbacks
    - Concurrent execution support per user
    """
    
    # Configuration constants
    SANDBOX_INACTIVITY_TIMEOUT = 30  # minutes
    EXECUTION_TIMEOUT = 30.0  # seconds

    def __init__(self):
        """Initialize E2B service with official SDK."""
        self.api_key = os.getenv("E2B_API_KEY")
        if not self.api_key:
            logger.warning("E2B_API_KEY not set - E2B service will be unavailable")
        
        # Active sandbox sessions: sandbox_id -> SandboxSession
        self._sandboxes: dict[str, SandboxSession] = {}
        
        # Pending executions waiting for responses: execution_id -> PendingExecution
        self._pending_executions: dict[str, PendingExecution] = {}
        
        # User sandbox mapping: user_id -> set of sandbox_ids
        self._user_sandboxes: dict[int, set[str]] = {}
        
        # Thread safety for cross-thread access
        self._thread_lock = threading.Lock()
        # Async lock for async operations
        self._async_lock = asyncio.Lock()
        
        # Shutdown flag
        self._shutdown = False

    @property
    def is_available(self) -> bool:
        """Check if E2B service is available (has API key)."""
        return bool(self.api_key)

    async def create_sandbox(self, user_id: int, language: str = "python") -> str:
        """
        Create a new sandbox for a user using the official E2B SDK.
        
        Args:
            user_id: The user ID creating the sandbox.
            language: Default language for the sandbox.
            
        Returns:
            The sandbox ID.
            
        Raises:
            E2BConnectionError: If E2B service is not available.
            SandboxCreationError: If sandbox creation fails.
        """
        if not self.is_available:
            raise E2BConnectionError("E2B service is not available. Please set E2B_API_KEY environment variable.")
        
        # Use lock to prevent race conditions when creating sandboxes for the same user
        async with self._async_lock:
            try:
                # Create sandbox using official E2B SDK
                sandbox = await Sandbox.create(
                    api_key=self.api_key,
                    template=language
                )
                
                sandbox_id = sandbox.sandbox_id
                
                # Create sandbox session tracking
                session = SandboxSession(
                    sandbox_id=sandbox_id,
                    user_id=user_id,
                    created_at=datetime.utcnow(),
                    last_activity=datetime.utcnow(),
                    status=SandboxStatus.ACTIVE,
                    language=language,
                )
                
                # Store sandbox session
                self._sandboxes[sandbox_id] = session
                
                # Track user's sandboxes
                if user_id not in self._user_sandboxes:
                    self._user_sandboxes[user_id] = set()
                self._user_sandboxes[user_id].add(sandbox_id)
                
                logger.info(f"Created sandbox {sandbox_id} for user {user_id} with language {language}")
                return sandbox_id
                
            except Exception as e:
                logger.error(f"Failed to create sandbox for user {user_id}: {e}")
                raise SandboxCreationError(f"Failed to create sandbox: {e}") from e

    async def execute_code(
        self,
        sandbox_id: str,
        code: str,
        language: str = "python",
        input_data: Optional[str] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
        timeout: Optional[float] = None,
    ) -> ExecutionResult:
        """
        Execute code in a sandbox using the official E2B SDK.
        
        Args:
            sandbox_id: The sandbox ID to execute in.
            code: The code to execute.
            language: The programming language.
            input_data: Optional input for the program.
            on_stdout: Callback for stdout chunks (streaming).
            on_stderr: Callback for stderr chunks (streaming).
            timeout: Execution timeout in seconds (default: 30).
            
        Returns:
            ExecutionResult with stdout, stderr, exit_code.
            
        Raises:
            E2BConnectionError: If E2B service is not available.
            ExecutionTimeoutError: If execution times out.
            ValueError: If sandbox doesn't exist or is inactive.
        """
        if not self.is_available:
            raise E2BConnectionError("E2B service is not available. Please set E2B_API_KEY environment variable.")
        
        # Validate sandbox
        if sandbox_id not in self._sandboxes:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        
        session = self._sandboxes[sandbox_id]
        if session.status != SandboxStatus.ACTIVE:
            raise ValueError(f"Sandbox {sandbox_id} is not active (status: {session.status})")
        
        # Check if sandbox is expired
        if session.is_expired(self.SANDBOX_INACTIVITY_TIMEOUT):
            await self._terminate_sandbox_internal(sandbox_id)
            raise ValueError(f"Sandbox {sandbox_id} has expired due to inactivity")
        
        timeout = timeout or self.EXECUTION_TIMEOUT
        execution_id = f"exec-{uuid.uuid4().hex[:8]}"
        
        # Create pending execution tracker
        pending = PendingExecution(
            execution_id=execution_id,
            event=asyncio.Event(),
            stdout_callback=on_stdout,
            stderr_callback=on_stderr,
        )
        self._pending_executions[execution_id] = pending
        
        try:
            # Get the sandbox instance
            sandbox = self._sandboxes[sandbox_id]
            
            # Prepare execution parameters
            execute_kwargs = {
                "code": code,
                "language": language,
                "timeout": timeout,
            }
            
            if input_data:
                execute_kwargs["input"] = input_data
            
            # Add callbacks if provided
            if on_stdout:
                execute_kwargs["on_stdout"] = on_stdout
            if on_stderr:
                execute_kwargs["on_stderr"] = on_stderr
            
            # Execute code
            start_time = time.time()
            execution = await sandbox.run_code(**execute_kwargs)
            
            # Update session activity
            session.last_activity = datetime.utcnow()
            session.execution_count += 1
            
            # Create result
            result = ExecutionResult(
                stdout=execution.stdout,
                stderr=execution.stderr,
                exit_code=execution.exit_code,
                execution_time=time.time() - start_time,
                error=execution.error,
                timed_out=execution.timed_out
            )
            
            return result
            
        except asyncio.TimeoutError:
            raise ExecutionTimeoutError(f"Execution timed out after {timeout} seconds")
        except Exception as e:
            logger.error(f"Error executing code in sandbox {sandbox_id}: {e}")
            raise
        finally:
            # Cleanup pending execution
            self._pending_executions.pop(execution_id, None)

    async def send_input(
        self,
        sandbox_id: str,
        execution_id: str,
        input_data: str,
    ) -> None:
        """
        Send input to a running interactive program.
        
        Args:
            sandbox_id: The sandbox ID.
            execution_id: The current execution ID.
            input_data: The input to send.
        """
        if not self.is_available:
            raise E2BConnectionError("E2B service is not available. Please set E2B_API_KEY environment variable.")
        
        # Validate sandbox
        if sandbox_id not in self._sandboxes:
            raise ValueError(f"Sandbox {sandbox_id} not found")
        
        session = self._sandboxes[sandbox_id]
        if session.status != SandboxStatus.ACTIVE:
            raise ValueError(f"Sandbox {sandbox_id} is not active (status: {session.status})")
        
        try:
            # Get the sandbox instance
            sandbox = self._sandboxes[sandbox_id]
            
            # Send input
            await sandbox.send_input(input_data)
            
            # Update session activity
            session.last_activity = datetime.utcnow()
            
        except Exception as e:
            logger.error(f"Error sending input to sandbox {sandbox_id}: {e}")
            raise

    async def terminate_sandbox(self, sandbox_id: str) -> None:
        """
        Terminate a sandbox session.
        
        Args:
            sandbox_id: The sandbox ID to terminate.
        """
        if not self.is_available:
            raise E2BConnectionError("E2B service is not available. Please set E2B_API_KEY environment variable.")
        
        await self._terminate_sandbox_internal(sandbox_id)

    async def _terminate_sandbox_internal(self, sandbox_id: str) -> None:
        """Internal method to terminate a sandbox."""
        if sandbox_id not in self._sandboxes:
            return
        
        try:
            # Get the sandbox instance
            sandbox = self._sandboxes[sandbox_id]
            
            # Terminate sandbox
            await sandbox.kill()
            
            # Update session status
            if sandbox_id in self._sandboxes:
                self._sandboxes[sandbox_id].status = SandboxStatus.TERMINATED
            
            # Remove from tracking
            del self._sandboxes[sandbox_id]
            
            # Update user sandbox mapping
            session = self._sandboxes.get(sandbox_id)
            if session and session.user_id in self._user_sandboxes:
                self._user_sandboxes[session.user_id].discard(sandbox_id)
                if not self._user_sandboxes[session.user_id]:
                    del self._user_sandboxes[session.user_id]
            
            logger.info(f"Terminated sandbox {sandbox_id}")
            
        except Exception as e:
            logger.warning(f"Error terminating sandbox {sandbox_id}: {e}")
            # Still remove from tracking even if termination failed
            if sandbox_id in self._sandboxes:
                del self._sandboxes[sandbox_id]
            
            # Update user sandbox mapping
            session = self._sandboxes.get(sandbox_id)
            if session and session.user_id in self._user_sandboxes:
                self._user_sandboxes[session.user_id].discard(sandbox_id)
                if not self._user_sandboxes[session.user_id]:
                    del self._user_sandboxes[session.user_id]

    def get_user_sandboxes(self, user_id: int) -> list[str]:
        """
        Get all sandbox IDs for a user.
        
        Args:
            user_id: The user ID.
            
        Returns:
            List of sandbox IDs.
        """
        return list(self._user_sandboxes.get(user_id, set()))

    def get_sandbox_info(self, sandbox_id: str) -> Optional[SandboxSession]:
        """
        Get sandbox session information.
        
        Args:
            sandbox_id: The sandbox ID.
            
        Returns:
            SandboxSession if found, None otherwise.
        """
        return self._sandboxes.get(sandbox_id)

    async def cleanup_expired_sandboxes(self) -> int:
        """
        Clean up expired sandboxes.
        
        Returns:
            Number of sandboxes cleaned up.
        """
        if not self.is_available:
            return 0
        
        expired_sandboxes = []
        for sandbox_id, session in self._sandboxes.items():
            if session.is_expired(self.SANDBOX_INACTIVITY_TIMEOUT):
                expired_sandboxes.append(sandbox_id)
        
        count = 0
        for sandbox_id in expired_sandboxes:
            try:
                await self._terminate_sandbox_internal(sandbox_id)
                count += 1
            except Exception as e:
                logger.warning(f"Error cleaning up expired sandbox {sandbox_id}: {e}")
        
        if count > 0:
            logger.info(f"Cleaned up {count} expired sandboxes")
        
        return count


# Global E2B service instance
_e2b_service: Optional[E2BService] = None
_e2b_lock = threading.Lock()


def get_e2b_service() -> E2BService:
    """
    Get the global E2B service instance.
    
    Returns:
        The singleton E2BService instance.
    """
    global _e2b_service
    with _e2b_lock:
        if _e2b_service is None:
            _e2b_service = E2BService()
        return _e2b_service


async def init_e2b_service() -> E2BService:
    """
    Initialize and return the global E2B service.
    
    Returns:
        The initialized E2BService instance.
    """
    service = get_e2b_service()
    # Note: The E2B service doesn't require explicit connection initialization
    # with the official SDK - it's ready to use once the API key is set
    logger.info(f"E2B service initialized. Available: {service.is_available}")
    return service


async def shutdown_e2b_service() -> None:
    """Shutdown the global E2B service."""
    global _e2b_service
    with _e2b_lock:
        if _e2b_service is not None:
            # Clean up any remaining sandboxes
            try:
                # Note: With the official SDK, sandboxes are managed remotely
                # and will be cleaned up automatically based on timeout
                # We just clear our local tracking
                _e2b_service._sandboxes.clear()
                _e2b_service._user_sandboxes.clear()
                _e2b_service._pending_executions.clear()
                logger.info("E2B service shutdown completed")
            except Exception as e:
                logger.warning(f"Error during E2B service shutdown: {e}")
            finally:
                _e2b_service = None
