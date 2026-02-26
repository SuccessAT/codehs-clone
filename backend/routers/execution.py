"""
Execution router for the CodeHS Clone API.

Handles:
- Sandbox management
- Code execution via REST API
- WebSocket streaming execution
- Autograding
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, async_session_maker
from models import User, Exercise, SandboxSession, SandboxStatus, Submission, SubmissionStatus
from schemas import (
    SandboxCreate, SandboxExecute, SandboxStatusResponse, SandboxListResponse,
    ExecutionResultSchema, Message,
)
from dependencies import (
    get_current_active_user,
    get_e2b_or_raise,
    check_rate_limit,
)
from e2b_service import get_e2b_service, E2BService
from websocket_manager import get_ws_manager, WebSocketManager

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/v1", tags=["Execution"])


# ==================== Sandbox REST Endpoints ====================
@router.get(
    "/sandbox",
    response_model=SandboxListResponse,
    summary="List user's sandboxes",
    description="Get all sandbox sessions for the current user.",
)
async def list_sandbox_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SandboxListResponse:
    """List user's sandbox sessions."""
    e2b = get_e2b_service()
    
    # Get from E2B service
    user_sandboxes = await e2b.get_user_sandboxes(current_user.id)
    
    sandbox_responses = [
        SandboxStatusResponse(
            sandbox_id=s.sandbox_id,
            status=s.status.value,
            language=s.language,
            created_at=s.created_at,
            last_activity=s.last_activity,
            execution_count=s.execution_count,
            is_expired=s.is_expired(30),
        )
        for s in user_sandboxes
    ]
    
    return SandboxListResponse(
        sandboxes=sandbox_responses,
        total=len(sandbox_responses),
    )


@router.post(
    "/sandbox",
    response_model=SandboxStatusResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a sandbox",
    description="Create a new sandbox session for code execution.",
)
async def create_sandbox_session(
    sandbox: SandboxCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SandboxStatusResponse:
    """Create a new sandbox session."""
    await check_rate_limit(current_user)
    
    e2b = get_e2b_or_raise()
    
    try:
        sandbox_id = await e2b.create_sandbox(
            user_id=current_user.id,
            language=sandbox.language,
        )
        
        session = await e2b.get_sandbox(sandbox_id)
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create sandbox session"
            )
        
        # Create database record
        db_sandbox = SandboxSession(
            user_id=current_user.id,
            sandbox_id=sandbox_id,
            status=SandboxStatus.ACTIVE,
            language=sandbox.language,
        )
        db.add(db_sandbox)
        await db.commit()
        
        logger.info(f"Sandbox created: {sandbox_id} for user {current_user.id}")
        
        return SandboxStatusResponse(
            sandbox_id=session.sandbox_id,
            status=session.status.value,
            language=session.language,
            created_at=session.created_at,
            last_activity=session.last_activity,
            execution_count=session.execution_count,
            is_expired=False,
        )
        
    except Exception as e:
        logger.error(f"Failed to create sandbox: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create sandbox: {str(e)}"
        )


@router.get(
    "/sandbox/{sandbox_id}",
    response_model=SandboxStatusResponse,
    summary="Get sandbox status",
    description="Get the status of a specific sandbox.",
)
async def get_sandbox_status(
    sandbox_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SandboxStatusResponse:
    """Get sandbox session status."""
    e2b = get_e2b_service()
    
    session = await e2b.get_sandbox(sandbox_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Sandbox session not found")
    
    # Check ownership
    if session.user_id != current_user.id and current_user.role.value != "teacher":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return SandboxStatusResponse(
        sandbox_id=session.sandbox_id,
        status=session.status.value,
        language=session.language,
        created_at=session.created_at,
        last_activity=session.last_activity,
        execution_count=session.execution_count,
        is_expired=session.is_expired(30),
    )


@router.post(
    "/sandbox/{sandbox_id}/execute",
    response_model=ExecutionResultSchema,
    summary="Execute code in sandbox",
    description="Execute code in a sandbox and return results.",
)
async def execute_in_sandbox(
    sandbox_id: str,
    execution: SandboxExecute,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ExecutionResultSchema:
    """Execute code in a sandbox."""
    await check_rate_limit(current_user)
    
    e2b = get_e2b_or_raise()
    
    # Verify sandbox ownership
    session = await e2b.get_sandbox(sandbox_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Sandbox session not found")
    
    if session.user_id != current_user.id and current_user.role.value != "teacher":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if session.status.value != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Sandbox is not active (status: {session.status.value})"
        )
    
    if session.is_expired(30):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sandbox has expired due to inactivity"
        )
    
    try:
        result = await e2b.execute_code(
            sandbox_id=sandbox_id,
            code=execution.code,
            language=execution.language or session.language,
            input_data=execution.input_data,
            timeout=execution.timeout or 30.0,
        )
        
        return ExecutionResultSchema(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.exit_code,
            execution_time=result.execution_time,
            error=result.error,
            timed_out=result.timed_out,
        )
        
    except asyncio.TimeoutError:
        return ExecutionResultSchema(
            stdout="",
            stderr="Execution timed out",
            exit_code=-1,
            timed_out=True,
            error="Execution exceeded maximum allowed time",
        )
    except Exception as e:
        logger.error(f"Execution error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Execution failed: {str(e)}"
        )


@router.delete(
    "/sandbox/{sandbox_id}",
    response_model=Message,
    summary="Terminate sandbox",
    description="Terminate a sandbox session.",
)
async def terminate_sandbox_session(
    sandbox_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Message:
    """Terminate a sandbox session."""
    e2b = get_e2b_service()
    
    session = await e2b.get_sandbox(sandbox_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Sandbox session not found")
    
    # Only owner or teacher can terminate
    if session.user_id != current_user.id and current_user.role.value != "teacher":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await e2b.terminate_sandbox(sandbox_id)
    
    # Update database record
    result = await db.execute(
        select(SandboxSession).where(SandboxSession.sandbox_id == sandbox_id)
    )
    db_sandbox = result.scalar_one_or_none()
    
    if db_sandbox:
        db_sandbox.status = SandboxStatus.TERMINATED
        db_sandbox.terminated_at = datetime.utcnow()
        await db.commit()
    
    logger.info(f"Sandbox terminated: {sandbox_id}")
    
    return Message(message="Sandbox session terminated")


# ==================== WebSocket Endpoint ====================
@router.websocket("/ws/execute/{user_id}")
async def websocket_execute(
    websocket: WebSocket,
    user_id: int,
    token: str = Query(...),
):
    """
    WebSocket endpoint for real-time code execution.
    
    Protocol:
    1. Connect with token query param for auth
    2. Server sends: {"type": "sandbox_ready", "data": {"sandbox_id": "..."}}
    3. Client sends: {"type": "run", "exercise_id": 1, "code": "...", "language": "python"}
    4. Server streams: {"type": "stdout", "data": {"content": "..."}}
    5. Server sends: {"type": "complete", "data": {"exit_code": 0, ...}}
    6. Server sends: {"type": "grading_result", "data": {...}}
    
    For interactive programs:
    - Client sends: {"type": "input", "data": "user input"}
    - Client sends: {"type": "cancel"} to cancel execution
    """
    # Authenticate
    from dependencies import decode_token, get_db
    
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    token_user_id = payload.get("sub")
    if token_user_id != user_id:
        await websocket.close(code=4003, reason="Not authorized")
        return
    
    # Get user from database
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        
        if not user or not user.is_active:
            await websocket.close(code=4001, reason="User not found or inactive")
            return
    
    # Get WebSocket manager
    ws_manager = get_ws_manager()
    
    # Connect and create sandbox
    connection_id = await ws_manager.connect(websocket, user_id)
    
    # Helper to get exercise
    async def get_exercise(exercise_id: int):
        async with async_session_maker() as db:
            result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
            return result.scalar_one_or_none()
    
    try:
        while True:
            # Receive message
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
            except json.JSONDecodeError:
                await ws_manager._send_message(
                    websocket,
                    {"type": "error", "data": {"message": "Invalid JSON"}}
                )
                continue
            
            # Handle message
            await ws_manager.handle_message(
                websocket=websocket,
                connection_id=connection_id,
                user_id=user_id,
                message=message,
                exercise_getter=get_exercise,
            )
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: user={user_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await ws_manager.disconnect(connection_id)


# ==================== Quick Execute Endpoint ====================
@router.post(
    "/execute",
    response_model=ExecutionResultSchema,
    status_code=status.HTTP_200_OK,
    summary="Quick execute code",
    description="Execute code without creating a persistent sandbox. Creates a temporary sandbox.",
)
async def quick_execute(
    execution: SandboxExecute,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ExecutionResultSchema:
    """Execute code in a temporary sandbox."""
    await check_rate_limit(current_user)
    
    e2b = get_e2b_or_raise()
    
    try:
        # Get or create sandbox
        user_sandboxes = await e2b.get_user_sandboxes(current_user.id)
        active_sandbox = None
        
        for sandbox in user_sandboxes:
            if sandbox.status.value == "active" and not sandbox.is_expired(30):
                active_sandbox = sandbox
                break
        
        if active_sandbox:
            sandbox_id = active_sandbox.sandbox_id
        else:
            sandbox_id = await e2b.create_sandbox(
                user_id=current_user.id,
                language=execution.language or "python"
            )
        
        # Execute code
        result = await e2b.execute_code(
            sandbox_id=sandbox_id,
            code=execution.code,
            language=execution.language or "python",
            input_data=execution.input_data,
            timeout=execution.timeout or 30.0,
        )
        
        return ExecutionResultSchema(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.exit_code,
            execution_time=result.execution_time,
            error=result.error,
            timed_out=result.timed_out,
        )
        
    except asyncio.TimeoutError:
        return ExecutionResultSchema(
            stdout="",
            stderr="Execution timed out",
            exit_code=-1,
            timed_out=True,
            error="Execution exceeded maximum allowed time",
        )
    except Exception as e:
        logger.error(f"Quick execute error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Execution failed: {str(e)}"
        )


# ==================== Autograding Endpoint ====================
@router.post(
    "/grade/{exercise_id}",
    summary="Grade code output",
    description="Grade code output against exercise test cases.",
)
async def grade_code(
    exercise_id: int,
    output: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Grade code output against exercise test cases."""
    # Get exercise
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    if not exercise.test_cases:
        return {
            "passed": False,
            "message": "No test cases defined for this exercise",
        }
    
    # Run autograding
    from websocket_manager import Autograder
    
    grader = Autograder()
    grading_result = grader.grade(output, exercise.test_cases)
    
    return {
        "passed": grading_result.passed,
        "total_tests": grading_result.total_tests,
        "passed_tests": grading_result.passed_tests,
        "score": grading_result.score,
        "feedback": grading_result.feedback,
        "test_results": grading_result.test_results,
    }
