"""
Database configuration and session management.
"""
from typing import AsyncGenerator
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
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
    
    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # E2B Sandbox – Socket.IO execution server
    WS_E2B_URL: str = "ws://localhost:8008"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

def _build_async_db_url(url: str):
    """Convert a sync DB URL to an async one and strip unsupported query params."""
    # Convert driver schemes
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        # Strip query params not supported by asyncpg (like sslmode)
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        # Remove sslmode; asyncpg handles SSL differently
        params.pop("sslmode", None)
        new_query = urlencode({k: v[0] for k, v in params.items()})
        url = urlunparse(parsed._replace(query=new_query))
    return url


_db_url = _build_async_db_url(settings.DATABASE_URL)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


# Create async engine
engine: AsyncEngine = create_async_engine(
    _db_url,
    connect_args={"check_same_thread": False} if "sqlite" in _db_url else {},
    poolclass=StaticPool if "sqlite" in _db_url else None,
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
