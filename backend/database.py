"""
Database configuration and session management.
"""
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./codehs.db"
    
    # For PostgreSQL in production, uncomment below:
    # DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/codehs"
    
    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # E2B Sandbox
    WS_E2B_URL: str = "ws://localhost:8765"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


# Create async engine
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    poolclass=StaticPool if "sqlite" in settings.DATABASE_URL else None,
    echo=False,
    future=True,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency that provides a database session.
    
    Usage:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables (for development only)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_raw_connection():
    """Get a raw connection for migrations or special operations."""
    async with engine.begin() as conn:
        yield conn
