"""
WebSocket manager for real-time code execution.

This module provides:
- WebSocket connection management
- Real-time code execution streaming
- Input handling for interactive programs
- Autograding with exact match and regex support
"""
import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional

from fastapi import WebSocket, WebSocketDisconnect

from e2b_service import E2BService, ExecutionResult, get_e2b_service
from local_executor import get_local_executor
from models import Exercise

# Configure logging
logger = logging.getLogger(__name__)


class WSMessageType(str, Enum):
    """WebSocket message types."""
    # Client -> Server
    RUN = "run"
    INPUT = "input"
    CANCEL = "cancel"
    PING = "ping"
    
    # Server -> Client
    STDOUT = "stdout"
    STDERR = "stderr"
    ERROR = "error"
    COMPLETE = "complete"
    GRADING = "grading"
    GRADING_RESULT = "grading_result"
    PONG = "pong"
    SANDBOX_READY = "sandbox_ready"


@dataclass
class WSMessage:
    """WebSocket message structure."""
    type: WSMessageType
    data: Any = None
    timestamp: datetime = field(default_factory=datetime.utcnow)
    
    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps({
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
        })


@dataclass
class ActiveExecution:
    """Tracks an active code execution."""
    execution_id: str
    exercise_id: int
    code: str
    language: str
    start_time: float
    stdout: str = ""
    stderr: str = ""
    cancelled: bool = False
    completed: bool = False


@dataclass
class GradingResult:
    """Result of autograding."""
    passed: bool
    total_tests: int
    passed_tests: int
    test_results: list[dict]
    score: int
    feedback: str


class Autograder:
    """
    Autograder for comparing code output with test cases.
    
    Supports:
    - Exact match
    - Regex match
    - Normalized whitespace comparison
    """
    
    @staticmethod
    def normalize_output(output: str) -> str:
        """Normalize output for comparison."""
        # Strip trailing whitespace from each line
        lines = [line.rstrip() for line in output.split('\n')]
        # Remove empty lines at the end
        while lines and not lines[-1]:
            lines.pop()
        return '\n'.join(lines)
    
    @staticmethod
    def compare_exact(actual: str, expected: str) -> bool:
        """Compare outputs exactly."""
        return Autograder.normalize_output(actual) == Autograder.normalize_output(expected)
    
    @staticmethod
    def compare_regex(actual: str, pattern: str) -> bool:
        """Compare output against regex pattern."""
        try:
            normalized = Autograder.normalize_output(actual)
            return bool(re.fullmatch(pattern, normalized, re.DOTALL))
        except re.error:
            return False
    
    @staticmethod
    def compare_contains(actual: str, expected: str) -> bool:
        """Check if expected is contained in actual."""
        return expected in actual
    
    @classmethod
    def grade(
        cls,
        output: str,
        test_cases: list[dict],
        partial_credit: bool = False,
    ) -> GradingResult:
        """
        Grade code output against test cases.
        
        Args:
            output: The code output to grade.
            test_cases: List of test case dictionaries.
            partial_credit: Whether to award partial credit.
            
        Returns:
            GradingResult with pass/fail details.
        """
        total_tests = len(test_cases)
        passed_tests = 0
        test_results = []
        
        for i, test_case in enumerate(test_cases):
            expected = test_case.get("expected_output", "")
            match_type = test_case.get("match_type", "exact")
            is_hidden = test_case.get("is_hidden", False)
            test_input = test_case.get("input", "")
            
            # Determine comparison method
            if match_type == "regex":
                passed = cls.compare_regex(output, expected)
            elif match_type == "contains":
                passed = cls.compare_contains(output, expected)
            else:  # exact
                passed = cls.compare_exact(output, expected)
            
            if passed:
                passed_tests += 1
            
            test_results.append({
                "test_number": i + 1,
                "passed": passed,
                "is_hidden": is_hidden,
                "input": test_input if not is_hidden else None,
                "expected": expected if not is_hidden else None,
                "match_type": match_type,
            })
        
        # Calculate score
        if partial_credit:
            score = int((passed_tests / total_tests) * 100) if total_tests > 0 else 0
        else:
            score = 100 if passed_tests == total_tests else 0
        
        # Generate feedback
        if passed_tests == total_tests:
            feedback = "All tests passed! 🎉"
        elif passed_tests == 0:
            feedback = "No tests passed. Check your code and try again."
        else:
            feedback = f"Passed {passed_tests}/{total_tests} tests. Keep working!"
        
        return GradingResult(
            passed=passed_tests == total_tests,
            total_tests=total_tests,
            passed_tests=passed_tests,
            test_results=test_results,
            score=score,
            feedback=feedback,
        )


class WebSocketManager:
    """
    Manages WebSocket connections for real-time code execution.
    
    Features:
    - Connection lifecycle management
    - Sandbox creation per user
    - Streaming stdout/stderr
    - Input handling for interactive programs
    - Execution timeout and cancellation
    - Autograding integration
    """
    
    # Configuration
    EXECUTION_TIMEOUT = 30.0  # seconds
    MAX_MESSAGE_SIZE = 1024 * 1024  # 1MB
    
    def __init__(self):
        self._connections: dict[str, WebSocket] = {}
        self._executions: dict[str, ActiveExecution] = {}
        self._user_sandboxes: dict[int, str] = {}  # user_id -> sandbox_id
        self._autograder = Autograder()
    
    async def connect(
        self,
        websocket: WebSocket,
        user_id: int,
    ) -> str:
        """
        Accept a WebSocket connection and create sandbox.
        
        Args:
            websocket: The WebSocket connection.
            user_id: The authenticated user ID.
            
        Returns:
            Connection ID.
        """
        await websocket.accept()
        
        connection_id = str(uuid.uuid4())
        self._connections[connection_id] = websocket
        
        # Create or get sandbox — use E2B if connected, otherwise fall back to local executor
        e2b = get_e2b_service()
        executor = e2b if e2b.is_connected else get_local_executor()

        try:
            # Check for existing sandbox
            if user_id in self._user_sandboxes:
                sandbox_id = self._user_sandboxes[user_id]
                sandbox = await executor.get_sandbox(sandbox_id)
                if sandbox and not sandbox.is_expired(30):
                    await self._send_message(
                        websocket,
                        WSMessage(WSMessageType.SANDBOX_READY, {"sandbox_id": sandbox_id})
                    )
                    return connection_id

            # Create new sandbox
            sandbox_id = await executor.create_sandbox(user_id=user_id)
            self._user_sandboxes[user_id] = sandbox_id

            await self._send_message(
                websocket,
                WSMessage(WSMessageType.SANDBOX_READY, {"sandbox_id": sandbox_id})
            )

            logger.info(f"Created sandbox {sandbox_id} for user {user_id} (executor={executor.__class__.__name__})")

        except Exception as e:
            logger.error(f"Failed to create sandbox: {e}")
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.ERROR, {"message": f"Failed to create sandbox: {str(e)}"})
            )

        return connection_id
    
    async def disconnect(self, connection_id: str) -> None:
        """Handle WebSocket disconnection."""
        self._connections.pop(connection_id, None)
        
        # Cancel any active execution
        if connection_id in self._executions:
            execution = self._executions[connection_id]
            execution.cancelled = True
            del self._executions[connection_id]
        
        logger.info(f"WebSocket disconnected: {connection_id}")
    
    async def handle_message(
        self,
        websocket: WebSocket,
        connection_id: str,
        user_id: int,
        message: dict,
        exercise_getter: Optional[Callable[[int], Exercise]] = None,
    ) -> None:
        """
        Handle incoming WebSocket message.
        
        Args:
            websocket: The WebSocket connection.
            connection_id: The connection ID.
            user_id: The authenticated user ID.
            message: The parsed message dictionary.
            exercise_getter: Optional async function to get exercise by ID.
        """
        msg_type = message.get("type", "")
        
        if msg_type == WSMessageType.RUN.value:
            await self._handle_run(
                websocket, connection_id, user_id, message, exercise_getter
            )
        elif msg_type == WSMessageType.INPUT.value:
            await self._handle_input(connection_id, message)
        elif msg_type == WSMessageType.CANCEL.value:
            await self._handle_cancel(connection_id)
        elif msg_type == WSMessageType.PING.value:
            await self._send_message(websocket, WSMessage(WSMessageType.PONG))
        else:
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.ERROR, {"message": f"Unknown message type: {msg_type}"})
            )
    
    async def _handle_run(
        self,
        websocket: WebSocket,
        connection_id: str,
        user_id: int,
        message: dict,
        exercise_getter: Optional[Callable[[int], Exercise]] = None,
    ) -> None:
        """Handle code execution request."""
        exercise_id = message.get("exercise_id")
        code = message.get("code", "")
        language = message.get("language", "python")
        input_data = message.get("input_data")
        timeout = message.get("timeout", self.EXECUTION_TIMEOUT)
        
        if not code:
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.ERROR, {"message": "No code provided"})
            )
            return
        
        # Get exercise if provided
        exercise = None
        if exercise_id and exercise_getter:
            exercise = await exercise_getter(exercise_id)
            if exercise:
                language = exercise.language
        
        # Create execution tracking
        execution_id = str(uuid.uuid4())
        execution = ActiveExecution(
            execution_id=execution_id,
            exercise_id=exercise_id or 0,
            code=code,
            language=language,
            start_time=time.time(),
        )
        self._executions[connection_id] = execution
        
        # Get sandbox — use E2B if connected, otherwise local executor
        e2b = get_e2b_service()
        executor = e2b if e2b.is_connected else get_local_executor()

        sandbox_id = self._user_sandboxes.get(user_id)
        if not sandbox_id:
            try:
                sandbox_id = await executor.create_sandbox(user_id=user_id, language=language)
                self._user_sandboxes[user_id] = sandbox_id
            except Exception as e:
                await self._send_message(
                    websocket,
                    WSMessage(WSMessageType.ERROR, {"message": f"Failed to create sandbox: {str(e)}"})
                )
                return

        try:
            # Execute code with streaming
            result = await executor.execute_code(
                sandbox_id=sandbox_id,
                code=code,
                language=language,
                input_data=input_data,
                timeout=min(timeout, self.EXECUTION_TIMEOUT),
                on_stdout=lambda s: asyncio.create_task(
                    self._stream_output(websocket, execution, "stdout", s)
                ),
                on_stderr=lambda s: asyncio.create_task(
                    self._stream_output(websocket, execution, "stderr", s)
                ),
            )
            
            # Check if cancelled
            if execution.cancelled:
                return
            
            execution.completed = True
            execution.stdout = result.stdout
            execution.stderr = result.stderr
            
            # Send completion message
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.COMPLETE, {
                    "execution_id": execution_id,
                    "exit_code": result.exit_code,
                    "execution_time": result.execution_time,
                    "timed_out": result.timed_out,
                    "error": result.error,
                })
            )
            
            # Run autograding if exercise has test cases
            if exercise and exercise.test_cases:
                await self._run_grading(websocket, exercise, result.stdout)
            
        except asyncio.TimeoutError:
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.ERROR, {"message": "Execution timed out"})
            )
        except Exception as e:
            logger.error(f"Execution error: {e}")
            await self._send_message(
                websocket,
                WSMessage(WSMessageType.ERROR, {"message": str(e)})
            )
        finally:
            self._executions.pop(connection_id, None)
    
    async def _stream_output(
        self,
        websocket: WebSocket,
        execution: ActiveExecution,
        stream_type: str,
        content: str,
    ) -> None:
        """Stream output to WebSocket."""
        if execution.cancelled:
            return
        
        msg_type = WSMessageType.STDOUT if stream_type == "stdout" else WSMessageType.STDERR
        await self._send_message(
            websocket,
            WSMessage(msg_type, {"content": content})
        )
        
        # Accumulate output
        if stream_type == "stdout":
            execution.stdout += content
        else:
            execution.stderr += content
    
    async def _handle_input(self, connection_id: str, message: dict) -> None:
        """Handle input for running program."""
        execution = self._executions.get(connection_id)
        if not execution:
            return
        
        input_data = message.get("data", "")
        
        # Send input to E2B
        e2b = get_e2b_service()
        if e2b.is_connected:
            # This would need the execution_id from E2B
            # For now, we'll store it for the next execution
            pass
    
    async def _handle_cancel(self, connection_id: str) -> None:
        """Handle execution cancellation."""
        execution = self._executions.get(connection_id)
        if execution:
            execution.cancelled = True
            logger.info(f"Execution cancelled: {execution.execution_id}")
    
    async def _run_grading(
        self,
        websocket: WebSocket,
        exercise: Exercise,
        output: str,
    ) -> None:
        """Run autograding and send results."""
        await self._send_message(
            websocket,
            WSMessage(WSMessageType.GRADING, {"message": "Running tests..."})
        )
        
        # Get test cases
        test_cases = exercise.test_cases or []
        
        # Run grading
        result = self._autograder.grade(output, test_cases)
        
        # Send results
        await self._send_message(
            websocket,
            WSMessage(WSMessageType.GRADING_RESULT, {
                "passed": result.passed,
                "total_tests": result.total_tests,
                "passed_tests": result.passed_tests,
                "score": result.score,
                "feedback": result.feedback,
                "test_results": result.test_results,
            })
        )
    
    async def _send_message(self, websocket: WebSocket, message: WSMessage) -> None:
        """Send a message to the WebSocket."""
        try:
            await websocket.send_text(message.to_json())
        except Exception as e:
            logger.warning(f"Failed to send WebSocket message: {e}")


# Global WebSocket manager instance
ws_manager = WebSocketManager()


def get_ws_manager() -> WebSocketManager:
    """Get the global WebSocket manager."""
    return ws_manager
