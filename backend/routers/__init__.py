"""
Routers package for the CodeHS Clone API.

This package contains modular routers for:
- Authentication (auth.py)
- Lessons and exercises (lessons.py)
- Code execution (execution.py)
"""

from routers.auth import router as auth_router
from routers.lessons import router as lessons_router
from routers.execution import router as execution_router

__all__ = [
    "auth_router",
    "lessons_router",
    "execution_router",
]
