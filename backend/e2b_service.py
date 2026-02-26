"""
E2B Sandbox Service - WebSocket integration for code execution.

This module provides async integration with a self-hosted E2B terminal
for secure code execution in isolated sandboxes.
"""
import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Optional
import threading

import websockets
from websockets.client import WebSocketClientProtocol

from database import settings


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
    event: asyncio.Event = field(default_factory=asyncio.Event)
    result: Optional[ExecutionResult] = None
    stdout_callback: Optional[Callable[[str], None]] = None
    stderr_callback: Optional[Callable[[str], None]] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


class E2BConnectionError(Exception):
    """Raised when E2B WebSocket connection fails."""
    pass


class SandboxCreationError(Exception):
    """Raised when sandbox creation fails."""
    pass


class ExecutionTimeoutError(Exception):
    """Raised when code execution times out."""
    pass


class E2BService:
    """
    Async service for managing E2B sandbox sessions and code execution.
    
    Features:
    - Thread-safe WebSocket connection pool
    - Automatic reconnection with exponential backoff
    - Sandbox lifecycle management (30 min inactivity timeout)
    - Streaming stdout/stderr via callbacks
    - Concurrent execution support per user
    
    Usage:
        service = E2BService()
        await service.connect()
        
        sandbox_id = await service.create_sandbox(user_id=1)
        result = await service.execute_code(
            sandbox_id, 
            "print('Hello')", 
            "python",
            on_stdout=lambda s: print(f"stdout: {s}"),
            on_stderr=lambda s: print(f"stderr: {s}")
        )
        
        await service.disconnect()
    """
    
    # Configuration constants
    MAX_RECONNECT_RETRIES = 5
    RECONNECT_BASE_DELAY = 1.0  # seconds
    RECONNECT_MAX_DELAY = 30.0  # seconds
    EXECUTION_TIMEOUT = 30.0  # seconds
    SANDBOX_INACTIVITY_TIMEOUT = 30  # minutes
    HEARTBEAT_INTERVAL = 30  # seconds
    CONNECTION_TIMEOUT = 10.0  # seconds
    
    def __init__(self, ws_url: Optional[str] = None):
        """
        Initialize E2B service.
        
        Args:
            ws_url: WebSocket URL for E2B terminal. Defaults to WS_E2B_URL from settings.
        """
        self.ws_url = ws_url or settings.WS_E2B_URL
        self._ws: Optional[WebSocketClientProtocol] = None
        self._lock = asyncio.Lock()
        self._connected = False
        self._connecting = False
        self._reconnect_attempts = 0
        
        # Active sandbox sessions: sandbox_id -> SandboxSession
        self._sandboxes: dict[str, SandboxSession] = {}
        
        # Pending executions waiting for responses: execution_id -> PendingExecution
        self._pending_executions: dict[str, PendingExecution] = {}
        
        # User sandbox mapping: user_id -> set of sandbox_ids
        self._user_sandboxes: dict[int, set[str]] = {}
        
        # Background tasks
        self._receive_task: Optional[asyncio.Task] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        
        # Thread safety for cross-thread access
        self._thread_lock = threading.Lock()
        
        # Shutdown flag
        self._shutdown = False

    @property
    def is_connected(self) -> bool:
        """Check if WebSocket is connected."""
        return self._connected and self._ws is not None and self._ws.open

    async def connect(self) -> None:
        """
        Establish WebSocket connection to E2B terminal.
        
        Raises:
            E2BConnectionError: If connection fails after all retries.
        """
        if self._connected or self._connecting:
            return
            
        async with self._lock:
            if self._connected or self._connecting:
                return
                
            self._connecting = True
            
        try:
            await self._connect_with_retry()
            self._connected = True
            self._reconnect_attempts = 0
            
            # Start background tasks
            self._receive_task = asyncio.create_task(self._receive_loop())
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            
            logger.info(f"Connected to E2B WebSocket at {self.ws_url}")
            
        except Exception as e:
            self._connecting = False
            raise E2BConnectionError(f"Failed to connect to E2B: {e}") from e
        finally:
            self._connecting = False

    async def _connect_with_retry(self) -> None:
        """Connect with exponential backoff retry."""
        last_error: Optional[Exception] = None
        
        for attempt in range(self.MAX_RECONNECT_RETRIES):
            try:
                logger.info(f"Connecting to E2B WebSocket (attempt {attempt + 1}/{self.MAX_RECONNECT_RETRIES})...")
                
                self._ws = await asyncio.wait_for(
                    websockets.connect(
                        self.ws_url,
                        ping_interval=20,
                        ping_timeout=10,
                        close_timeout=5,
                    ),
                    timeout=self.CONNECTION_TIMEOUT
                )
                
                logger.info("E2B WebSocket connection established")
                return
                
            except asyncio.TimeoutError:
                last_error = E2BConnectionError(f"Connection timeout after {self.CONNECTION_TIMEOUT}s")
                logger.warning(f"Connection attempt {attempt + 1} timed out")
            except Exception as e:
                last_error = e
                logger.warning(f"Connection attempt {attempt + 1} failed: {e}")
            
            if attempt < self.MAX_RECONNECT_RETRIES - 1:
                delay = min(
                    self.RECONNECT_BASE_DELAY * (2 ** attempt),
                    self.RECONNECT_MAX_DELAY
                )
                logger.info(f"Retrying in {delay:.1f} seconds...")
                await asyncio.sleep(delay)
        
        raise E2BConnectionError(f"Failed after {self.MAX_RECONNECT_RETRIES} attempts: {last_error}")

    async def disconnect(self) -> None:
        """
        Disconnect from E2B WebSocket and cleanup resources.
        """
        self._shutdown = True
        self._connected = False
        
        # Cancel background tasks
        for task in [self._receive_task, self._cleanup_task, self._heartbeat_task]:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        # Terminate all active sandboxes
        for sandbox_id in list(self._sandboxes.keys()):
            try:
                await self._terminate_sandbox_internal(sandbox_id)
            except Exception as e:
                logger.warning(f"Error terminating sandbox {sandbox_id}: {e}")
        
        # Close WebSocket
        if self._ws and self._ws.open:
            try:
                await self._ws.close()
            except Exception as e:
                logger.warning(f"Error closing WebSocket: {e}")
        
        self._ws = None
        logger.info("Disconnected from E2B WebSocket")

    async def _ensure_connected(self) -> None:
        """Ensure WebSocket is connected, reconnect if necessary."""
        if self._shutdown:
            raise E2BConnectionError("Service is shut down")
            
        if not self.is_connected:
            logger.info("WebSocket not connected, attempting to reconnect...")
            await self.connect()

    async def create_sandbox(self, user_id: int, language: str = "python") -> str:
        """
        Create a new sandbox for a user.
        
        Args:
            user_id: The user ID creating the sandbox.
            language: Default language for the sandbox.
            
        Returns:
            The sandbox ID.
            
        Raises:
            E2BConnectionError: If not connected to E2B.
            SandboxCreationError: If sandbox creation fails.
        """
        await self._ensure_connected()
        
        # Generate a unique sandbox ID
        sandbox_id = f"sandbox-{uuid.uuid4().hex[:12]}"
        
        # Create sandbox session tracking
        session = SandboxSession(
            sandbox_id=sandbox_id,
            user_id=user_id,
            created_at=datetime.utcnow(),
            last_activity=datetime.utcnow(),
            status=SandboxStatus.CREATING,
            language=language,
        )
        
        try:
            # Send create request to E2B
            message = {
                "action": "create_instance",
                "user_id": user_id,
                "sandbox_id": sandbox_id,
                "language": language,
            }
            
            await self._send_message(message)
            
            # Wait for confirmation (with timeout)
            # The actual confirmation will come via the receive loop
            # For now, we'll mark it as active immediately
            # In production, you might want to wait for a confirmation message
            
            session.status = SandboxStatus.ACTIVE
            self._sandboxes[sandbox_id] = session
            
            # Track user's sandboxes
            if user_id not in self._user_sandboxes:
                self._user_sandboxes[user_id] = set()
            self._user_sandboxes[user_id].add(sandbox_id)
            
            logger.info(f"Created sandbox {sandbox_id} for user {user_id}")
            return sandbox_id
            
        except Exception as e:
            session.status = SandboxStatus.ERROR
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
        Execute code in a sandbox.
        
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
            E2BConnectionError: If not connected.
            ExecutionTimeoutError: If execution times out.
            ValueError: If sandbox doesn't exist or is inactive.
        """
        await self._ensure_connected()
        
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
            stdout_callback=on_stdout,
            stderr_callback=on_stderr,
        )
        self._pending_executions[execution_id] = pending
        
        try:
            # Send execution request
            message = {
                "action": "execute",
                "sandbox_id": sandbox_id,
                "execution_id": execution_id,
                "code": code,
                "language": language,
                "input": input_data,
                "timeout": timeout,
            }
            
            start_time = time.time()
            await self._send_message(message)
            
            # Wait for completion with timeout
            try:
                await asyncio.wait_for(
                    pending.event.wait(),
                    timeout=timeout + 5  # Extra buffer for network
                )
            except asyncio.TimeoutError:
                pending.result = ExecutionResult(
                    stdout=pending.result.stdout if pending.result else "",
                    stderr=pending.result.stderr if pending.result else "",
                    timed_out=True,
                    error="Execution timed out",
                )
            
            # Update session activity
            session.last_activity = datetime.utcnow()
            session.execution_count += 1
            
            result = pending.result or ExecutionResult(
                error="No response received from E2B",
            )
            result.execution_time = time.time() - start_time
            
            return result
            
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
        await self._ensure_connected()
        
        message = {
            "action": "send_input",
            "sandbox_id": sandbox_id,
            "execution_id": execution_id,
            "input": input_data,
        }
        
        await self._send_message(message)

    async def terminate_sandbox(self, sandbox_id: str) -> None:
        """
        Terminate a sandbox session.
        
        Args:
            sandbox_id: The sandbox ID to terminate.
        """
        await self._terminate_sandbox_internal(sandbox_id)

    async def _terminate_sandbox_internal(self, sandbox_id: str) -> None:
        """Internal method to terminate a sandbox."""
        if sandbox_id not in self._sandboxes:
            return
        
        session = self._sandboxes[sandbox_id]
        
        try:
            if self.is_connected:
                message = {
                    "action": "terminate_instance",
                    "sandbox_id": sandbox_id,
                }
                await self._send_message(message)
        except Exception as e:
            logger.warning(f"Error sending terminate message for {sandbox_id}: {e}")
        
        # Update session status
        session.status = SandboxStatus.TERMINATED
        
        # Remove from tracking
        del self._sandboxes[sandbox_id]
        
        if session.user_id in self._user_sandboxes:
            self._user_sandboxes[session.user_id].discard(sandbox_id)
            if not self._user_sandboxes[session.user_id]:
                del self._user_sandboxes[session.user_id]
        
        logger.info(f"Terminated sandbox {sandbox_id}")

    async def get_sandbox(self, sandbox_id: str) -> Optional[SandboxSession]:
        """Get sandbox session by ID."""
        return self._sandboxes.get(sandbox_id)

    async def get_user_sandboxes(self, user_id: int) -> list[SandboxSession]:
        """Get all active sandboxes for a user."""
        sandbox_ids = self._user_sandboxes.get(user_id, set())
        return [
            self._sandboxes[sid]
            for sid in sandbox_ids
            if sid in self._sandboxes
        ]

    async def _send_message(self, message: dict[str, Any]) -> None:
        """Send a JSON message to the WebSocket."""
        if not self._ws or not self._ws.open:
            raise E2BConnectionError("WebSocket not connected")
        
        async with self._lock:
            try:
                await self._ws.send(json.dumps(message))
            except Exception as e:
                logger.error(f"Error sending message: {e}")
                self._connected = False
                raise E2BConnectionError(f"Failed to send message: {e}") from e

    async def _receive_loop(self) -> None:
        """Background task to receive and process messages."""
        while not self._shutdown and self._connected:
            try:
                if not self._ws or not self._ws.open:
                    await asyncio.sleep(0.1)
                    continue
                
                try:
                    message = await asyncio.wait_for(
                        self._ws.recv(),
                        timeout=60.0
                    )
                except asyncio.TimeoutError:
                    # No message received, continue loop
                    continue
                
                await self._handle_message(message)
                
            except websockets.ConnectionClosed as e:
                logger.warning(f"WebSocket connection closed: {e}")
                self._connected = False
                
                # Attempt to reconnect
                if not self._shutdown:
                    try:
                        await self._reconnect()
                    except Exception as reconnect_error:
                        logger.error(f"Reconnection failed: {reconnect_error}")
                        await asyncio.sleep(5)
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in receive loop: {e}")
                await asyncio.sleep(0.1)

    async def _handle_message(self, message: str | bytes) -> None:
        """Handle incoming WebSocket message."""
        try:
            data = json.loads(message)
            action = data.get("action", "")
            
            if action == "execution_output":
                await self._handle_execution_output(data)
            elif action == "execution_complete":
                await self._handle_execution_complete(data)
            elif action == "sandbox_created":
                await self._handle_sandbox_created(data)
            elif action == "sandbox_terminated":
                await self._handle_sandbox_terminated(data)
            elif action == "error":
                await self._handle_error(data)
            elif action == "pong":
                # Heartbeat response
                pass
            else:
                logger.debug(f"Unknown message action: {action}")
                
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse message: {e}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")

    async def _handle_execution_output(self, data: dict) -> None:
        """Handle execution output (stdout/stderr streaming)."""
        execution_id = data.get("execution_id")
        stream = data.get("stream", "stdout")  # stdout or stderr
        content = data.get("content", "")
        
        if not execution_id or execution_id not in self._pending_executions:
            return
        
        pending = self._pending_executions[execution_id]
        
        if stream == "stdout":
            pending.result = pending.result or ExecutionResult()
            pending.result.stdout += content
            if pending.stdout_callback:
                try:
                    pending.stdout_callback(content)
                except Exception as e:
                    logger.warning(f"Error in stdout callback: {e}")
        elif stream == "stderr":
            pending.result = pending.result or ExecutionResult()
            pending.result.stderr += content
            if pending.stderr_callback:
                try:
                    pending.stderr_callback(content)
                except Exception as e:
                    logger.warning(f"Error in stderr callback: {e}")

    async def _handle_execution_complete(self, data: dict) -> None:
        """Handle execution completion."""
        execution_id = data.get("execution_id")
        
        if not execution_id or execution_id not in self._pending_executions:
            return
        
        pending = self._pending_executions[execution_id]
        pending.result = pending.result or ExecutionResult()
        
        # Update with final results
        pending.result.exit_code = data.get("exit_code")
        pending.result.stdout += data.get("stdout", "")
        pending.result.stderr += data.get("stderr", "")
        
        if data.get("timed_out"):
            pending.result.timed_out = True
            pending.result.error = "Execution timed out"
        
        # Signal completion
        pending.event.set()

    async def _handle_sandbox_created(self, data: dict) -> None:
        """Handle sandbox creation confirmation."""
        sandbox_id = data.get("sandbox_id")
        if sandbox_id and sandbox_id in self._sandboxes:
            self._sandboxes[sandbox_id].status = SandboxStatus.ACTIVE
            logger.debug(f"Sandbox {sandbox_id} creation confirmed")

    async def _handle_sandbox_terminated(self, data: dict) -> None:
        """Handle sandbox termination notification."""
        sandbox_id = data.get("sandbox_id")
        if sandbox_id and sandbox_id in self._sandboxes:
            await self._terminate_sandbox_internal(sandbox_id)

    async def _handle_error(self, data: dict) -> None:
        """Handle error message from E2B."""
        error_code = data.get("code", "unknown")
        error_message = data.get("message", "Unknown error")
        sandbox_id = data.get("sandbox_id")
        execution_id = data.get("execution_id")
        
        logger.error(f"E2B error [{error_code}]: {error_message}")
        
        # If error is related to a pending execution, fail it
        if execution_id and execution_id in self._pending_executions:
            pending = self._pending_executions[execution_id]
            pending.result = pending.result or ExecutionResult()
            pending.result.error = f"{error_code}: {error_message}"
            pending.event.set()
        
        # If sandbox error, update status
        if sandbox_id and sandbox_id in self._sandboxes:
            self._sandboxes[sandbox_id].status = SandboxStatus.ERROR

    async def _reconnect(self) -> None:
        """Attempt to reconnect to E2B WebSocket."""
        logger.info("Attempting to reconnect to E2B WebSocket...")
        
        async with self._lock:
            if self._connecting:
                return
            self._connecting = True
        
        try:
            # Close old connection if any
            if self._ws and self._ws.open:
                try:
                    await self._ws.close()
                except Exception:
                    pass
            
            # Reconnect with retry
            await self._connect_with_retry()
            self._connected = True
            self._reconnect_attempts = 0
            
            logger.info("Successfully reconnected to E2B WebSocket")
            
        finally:
            self._connecting = False

    async def _cleanup_loop(self) -> None:
        """Background task to cleanup expired sandboxes."""
        while not self._shutdown:
            try:
                await asyncio.sleep(60)  # Check every minute
                
                expired = [
                    sid for sid, session in self._sandboxes.items()
                    if session.is_expired(self.SANDBOX_INACTIVITY_TIMEOUT)
                ]
                
                for sandbox_id in expired:
                    logger.info(f"Terminating expired sandbox {sandbox_id}")
                    await self._terminate_sandbox_internal(sandbox_id)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")

    async def _heartbeat_loop(self) -> None:
        """Background task to send heartbeats."""
        while not self._shutdown:
            try:
                await asyncio.sleep(self.HEARTBEAT_INTERVAL)
                
                if self.is_connected:
                    await self._send_message({"action": "ping"})
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Error sending heartbeat: {e}")


# Global service instance (singleton pattern)
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
    Initialize and connect the global E2B service.
    
    Returns:
        The connected E2BService instance.
    """
    service = get_e2b_service()
    await service.connect()
    return service


async def shutdown_e2b_service() -> None:
    """Shutdown the global E2B service."""
    global _e2b_service
    
    with _e2b_lock:
        if _e2b_service is not None:
            await _e2b_service.disconnect()
            _e2b_service = None
