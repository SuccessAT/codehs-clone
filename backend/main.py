"""
Main FastAPI application for the CodeHS-like educational platform.

This is the entry point that:
- Initializes the FastAPI app
- Configures CORS middleware
- Sets up lifespan events for E2B service
- Includes all routers
- Provides health check and root endpoints
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, Base, get_db
from e2b_service import (
    E2BConnectionError,
    init_e2b_service,
    shutdown_e2b_service,
    get_e2b_service,
)
from models import User, UserRole
from routers import auth_router, lessons_router, execution_router
from schemas import HealthCheckResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# ==================== Demo Seed ====================
async def seed_demo_accounts() -> None:
    """Create demo teacher and student accounts if they don't exist."""
    from dependencies import get_password_hash
    async with AsyncSession(engine) as session:
        for username, email, password, role in [
            ("teacher", "teacher@demo.com", "teacher123", UserRole.TEACHER),
            ("student", "student@demo.com", "student123", UserRole.STUDENT),
        ]:
            result = await session.execute(select(User).where(User.username == username))
            if result.scalar_one_or_none() is None:
                user = User(
                    username=username,
                    email=email,
                    hashed_password=get_password_hash(password),
                    role=role,
                    is_active=True,
                    is_superuser=False,
                )
                session.add(user)
                logger.info(f"Created demo account: {username}")
        await session.commit()


# ==================== Application Events ====================
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    # Startup: Create database tables
    logger.info("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Startup: Seed demo accounts
    await seed_demo_accounts()

    # Try E2B connection in the background so it never blocks request serving.
    async def _try_e2b() -> None:
        try:
            e2b_service = await init_e2b_service()
            logger.info(f"Legacy e2b bridge connected: {e2b_service.is_connected}")
        except E2BConnectionError:
            logger.info("Legacy e2b bridge not available — using local executor fallback (expected).")
        except Exception as e:
            logger.info(f"Local fallback executor ready. (e2b bridge skipped: {e})")

    asyncio.create_task(_try_e2b())

    logger.info("Application startup complete")
    
    yield
    
    # Shutdown: Shutdown E2B service
    logger.info("Shutting down E2B service...")
    await shutdown_e2b_service()
    
    # Shutdown: Dispose engine
    await engine.dispose()
    
    logger.info("Application shutdown complete")


# ==================== FastAPI App ====================
app = FastAPI(
    title="CodeHS Clone API",
    description="""
Backend API for CodeHS-like educational coding platform with E2B sandbox integration.

## Features

- **Authentication**: JWT-based authentication with role-based access control
- **Lessons & Exercises**: CRUD operations for educational content
- **Code Execution**: Real-time code execution in isolated sandboxes
- **Autograding**: Automatic grading with exact match and regex support
- **WebSocket Streaming**: Real-time stdout/stderr streaming

## User Roles

- **student**: Can view lessons, submit code, track progress
- **teacher**: Full access including creating/editing content

## WebSocket Protocol

Connect to `/ws/execute/{user_id}?token={jwt_token}` for real-time execution:

```json
// Run code
{"type": "run", "exercise_id": 1, "code": "print('Hello')", "language": "python"}

// Send input for interactive programs
{"type": "input", "data": "user input"}

// Cancel execution
{"type": "cancel"}
```

Server responses:
```json
{"type": "stdout", "data": {"content": "Hello\\n"}}
{"type": "stderr", "data": {"content": "error message"}}
{"type": "complete", "data": {"exit_code": 0, "execution_time": 0.5}}
{"type": "grading_result", "data": {"passed": true, "score": 100}}
```
    """,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware - allow all origins for Replit proxy compatibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
)


# ==================== Exception Handlers ====================
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global exception handler for unhandled errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    # Safely get request info
    request_info = "unknown"
    if request and hasattr(request, 'url'):
        try:
            request_info = str(request.url)
        except Exception:
            request_info = "unavailable"
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected error occurred",
            "error": str(exc) if logging.DEBUG >= logging.root.level else None,
            "request": request_info,
        }
    )


# ==================== Include Routers ====================
app.include_router(auth_router)
app.include_router(lessons_router)
app.include_router(execution_router)


# ==================== Health Check ====================
@app.get("/health", response_model=HealthCheckResponse, tags=["System"])
async def health_check() -> HealthCheckResponse:
    """
    Health check endpoint.
    
    Returns the health status of the API and E2B service connection.
    """
    e2b = get_e2b_service()
    
    return HealthCheckResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat(),
        e2b_connected=e2b.is_connected,
        active_sandboxes=len(e2b._sandboxes) if e2b else 0,
    )


@app.get("/health/ready", tags=["System"])
async def readiness_check() -> dict:
    """
    Readiness check endpoint.
    
    Returns 200 only if all services are ready.
    """
    e2b = get_e2b_service()
    
    checks = {
        "database": True,  # If we got here, database is working
        "e2b_service": e2b.is_connected,
    }
    
    all_ready = all(checks.values())
    
    if not all_ready:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "checks": checks,
            }
        )
    
    return {
        "status": "ready",
        "checks": checks,
    }


@app.get("/health/live", tags=["System"])
async def liveness_check() -> dict:
    """
    Liveness check endpoint.
    
    Returns 200 if the application is running.
    """
    return {"status": "alive"}


# ==================== Root ====================
@app.get("/", tags=["System"])
async def root() -> dict:
    """Root endpoint with API information."""
    return {
        "message": "Welcome to CodeHS Clone API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
        "websocket": "/ws/execute/{user_id}?token={jwt_token}",
    }


# ==================== API Info ====================
@app.get("/api/v1", tags=["System"])
async def api_info() -> dict:
    """API version information."""
    return {
        "version": "v1",
        "endpoints": {
            "auth": "/api/v1/auth",
            "lessons": "/api/v1/lessons",
            "exercises": "/api/v1/exercises",
            "submissions": "/api/v1/submissions",
            "sandbox": "/api/v1/sandbox",
            "execute": "/api/v1/execute",
            "websocket": "/ws/execute/{user_id}",
        }
    }


# ==================== Development Server ====================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
