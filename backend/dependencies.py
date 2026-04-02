"""
Shared dependencies for the FastAPI application.

This module contains reusable dependencies for:
- Authentication and authorization
- Rate limiting
- Database sessions
- E2B service access
"""
import asyncio
import hashlib
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import jwt
from jwt.exceptions import InvalidTokenError

from database import get_db
from models import User, UserRole
from e2b_service import E2BService, get_e2b_service

# Configure logging
logger = logging.getLogger(__name__)

# ==================== Configuration ====================
SECRET_KEY = os.getenv("SECRET_KEY", "your-super-secret-key-change-in-production-min-32-chars")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# Security scheme
security = HTTPBearer(auto_error=False)


# ==================== Rate Limiting ====================
class RateLimiter:
    """
    Simple in-memory rate limiter using sliding window.
    
    For production, consider using Redis-based rate limiting.
    """
    
    def __init__(
        self,
        requests_per_minute: int = 60,
        requests_per_hour: int = 1000,
    ):
        self.requests_per_minute = requests_per_minute
        self.requests_per_hour = requests_per_hour
        self._minute_requests: dict[str, list[float]] = defaultdict(list)
        self._hour_requests: dict[str, list[float]] = defaultdict(list)
        # Lock for thread-safe access
        self._lock = asyncio.Lock()
    
    async def is_allowed(self, key: str) -> tuple[bool, Optional[str]]:
        """
        Check if request is allowed for the given key.
        
        Returns:
            Tuple of (is_allowed, error_message)
        """
        async with self._lock:
            now = time.time()
            
            # Clean up old requests
            self._minute_requests[key] = self._cleanup_old_requests(
                self._minute_requests[key], 60
            )
            self._hour_requests[key] = self._cleanup_old_requests(
                self._hour_requests[key], 3600
            )
            
            # Check minute limit
            if len(self._minute_requests[key]) >= self.requests_per_minute:
                return False, f"Rate limit exceeded: {self.requests_per_minute} requests per minute"
            
            # Check hour limit
            if len(self._hour_requests[key]) >= self.requests_per_hour:
                return False, f"Rate limit exceeded: {self.requests_per_hour} requests per hour"
            
            # Record this request
            self._minute_requests[key].append(now)
            self._hour_requests[key].append(now)
            
            return True, None
    
    def is_allowed_sync(self, key: str) -> tuple[bool, Optional[str]]:
        """
        Synchronous version for non-async contexts.
        Check if request is allowed for the given key.
        
        Returns:
            Tuple of (is_allowed, error_message)
        """
        now = time.time()
        
        # Clean up old requests
        self._minute_requests[key] = self._cleanup_old_requests(
            self._minute_requests[key], 60
        )
        self._hour_requests[key] = self._cleanup_old_requests(
            self._hour_requests[key], 3600
        )
        
        # Check minute limit
        if len(self._minute_requests[key]) >= self.requests_per_minute:
            return False, f"Rate limit exceeded: {self.requests_per_minute} requests per minute"
        
        # Check hour limit
        if len(self._hour_requests[key]) >= self.requests_per_hour:
            return False, f"Rate limit exceeded: {self.requests_per_hour} requests per hour"
        
        # Record this request
        self._minute_requests[key].append(now)
        self._hour_requests[key].append(now)
        
        return True, None
    
    async def get_remaining(self, key: str) -> dict[str, int]:
        """Get remaining requests for the key."""
        async with self._lock:
            self._minute_requests[key] = self._cleanup_old_requests(
                self._minute_requests[key], 60
            )
            self._hour_requests[key] = self._cleanup_old_requests(
                self._hour_requests[key], 3600
            )
            
            return {
                "minute_remaining": self.requests_per_minute - len(self._minute_requests[key]),
                "hour_remaining": self.requests_per_hour - len(self._hour_requests[key]),
            }


# Global rate limiter instance
rate_limiter = RateLimiter(
    requests_per_minute=int(os.getenv("RATE_LIMIT_PER_MINUTE", "60")),
    requests_per_hour=int(os.getenv("RATE_LIMIT_PER_HOUR", "1000")),
)

# In-memory token revocation list: token -> expiry epoch seconds
_revoked_tokens: dict[str, float] = {}


def _cleanup_revoked_tokens() -> None:
    """Remove expired tokens from the revocation list."""
    now = time.time()
    expired = [token for token, exp_ts in _revoked_tokens.items() if exp_ts <= now]
    for token in expired:
        _revoked_tokens.pop(token, None)


def revoke_token(token: str) -> None:
    """Revoke a JWT until its expiry time."""
    _cleanup_revoked_tokens()
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"verify_exp": False},
        )
        exp = payload.get("exp")
        if isinstance(exp, (int, float)):
            _revoked_tokens[token] = float(exp)
        else:
            # Fallback: if token has no exp (unexpected), revoke for 24h.
            _revoked_tokens[token] = time.time() + 86400
    except InvalidTokenError:
        # Invalid tokens are already unusable, but keep a short-lived block entry.
        _revoked_tokens[token] = time.time() + 300


def is_token_revoked(token: str) -> bool:
    """Check if a JWT has been revoked."""
    _cleanup_revoked_tokens()
    return token in _revoked_tokens


async def check_rate_limit(
    request: Optional[Request],
    user: Optional[User] = None,
) -> None:
    """
    Dependency to check rate limits.
    
    Uses IP address for unauthenticated requests,
    user ID for authenticated requests.
    """
    # Skip rate limiting if request is None (shouldn't happen but be safe)
    if request is None:
        return
        
    # Use user ID if authenticated, otherwise IP
    if user:
        key = f"user:{user.id}"
    else:
        # Get client IP (handle proxies)
        try:
            forwarded = request.headers.get("X-Forwarded-For") if request.headers else None
            if forwarded:
                ip = forwarded.split(",")[0].strip()
            else:
                ip = request.client.host if request.client else "unknown"
        except Exception:
            ip = "unknown"
        key = f"ip:{ip}"
    
    allowed, error_message = await rate_limiter.is_allowed(key)
    
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=error_message,
            headers={
                "Retry-After": "60",
                "X-RateLimit-Limit": str(rate_limiter.requests_per_minute),
            }
        )


# ==================== Password Utilities ====================
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""
    salt = hashed_password.split(':')[0] if ':' in hashed_password else ''
    if salt:
        stored_hash = hashed_password.split(':')[1] if ':' in hashed_password else hashed_password
        test_hash = hashlib.pbkdf2_hmac('sha256', plain_password.encode(), salt.encode(), 100000).hex()
        return test_hash == stored_hash
    else:
        # Legacy format
        test_hash = hashlib.sha256(plain_password.encode()).hexdigest()
        return test_hash == hashed_password


def get_password_hash(password: str) -> str:
    """Hash a password using PBKDF2."""
    import secrets
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
    return f"{salt}:{hashed}"


# ==================== JWT Utilities ====================
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT token."""
    if is_token_revoked(token):
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except InvalidTokenError:
        return None


# ==================== Authentication Dependencies ====================
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from JWT token.
    
    Raises:
        HTTPException: If credentials are invalid or user not found.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if not credentials:
        raise credentials_exception
    
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload is None:
        raise credentials_exception
    
    user_id: int = payload.get("sub")
    username: str = payload.get("username")
    
    if user_id is None or username is None:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Get the current active user.
    
    Raises:
        HTTPException: If user is inactive.
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """
    Get the current user if authenticated, otherwise return None.
    Useful for endpoints that work with or without authentication.
    """
    if not credentials:
        return None
    
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload is None:
        return None
    
    user_id = payload.get("sub")
    if user_id is None:
        return None
    
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


# ==================== Authorization Dependencies ====================
def require_teacher(current_user: User = Depends(get_current_active_user)) -> User:
    """
    Require teacher role for access.
    
    Raises:
        HTTPException: If user is not a teacher.
    """
    if current_user.role != UserRole.TEACHER and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher access required"
        )
    return current_user


def require_superuser(current_user: User = Depends(get_current_active_user)) -> User:
    """
    Require superuser role for access.
    
    Raises:
        HTTPException: If user is not a superuser.
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser access required"
        )
    return current_user


def require_owner_or_teacher(
    user_id: int,
    current_user: User = Depends(get_current_active_user),
) -> User:
    """
    Require the user to be the owner of the resource or a teacher.
    
    Args:
        user_id: The ID of the resource owner.
        
    Returns:
        The current user if authorized.
        
    Raises:
        HTTPException: If user is not authorized.
    """
    if current_user.id != user_id and current_user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this resource"
        )
    return current_user


# ==================== E2B Service Dependencies ====================
def get_e2b_or_raise() -> E2BService:
    """
    Get E2B service or raise 503 if unavailable.
    
    Raises:
        HTTPException: If E2B service is not connected.
    """
    e2b = get_e2b_service()
    if not e2b.is_connected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E2B sandbox service is not available. Please try again later."
        )
    return e2b


async def get_e2b_sandbox_for_user(
    user_id: int,
    language: str = "python",
) -> tuple[E2BService, str]:
    """
    Get or create an E2B sandbox for a user.
    
    Args:
        user_id: The user ID.
        language: The programming language for the sandbox.
        
    Returns:
        Tuple of (E2BService, sandbox_id).
        
    Raises:
        HTTPException: If E2B is unavailable or sandbox creation fails.
    """
    e2b = get_e2b_or_raise()
    
    # Check for existing active sandbox
    user_sandboxes = await e2b.get_user_sandboxes(user_id)
    for sandbox in user_sandboxes:
        if sandbox.status.value == "active" and not sandbox.is_expired(30):
            return e2b, sandbox.sandbox_id
    
    # Create new sandbox
    try:
        sandbox_id = await e2b.create_sandbox(user_id=user_id, language=language)
        return e2b, sandbox_id
    except Exception as e:
        logger.error(f"Failed to create sandbox for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create sandbox: {str(e)}"
        )


# ==================== WebSocket Authentication ====================
async def get_user_from_token(
    token: str,
    db: AsyncSession,
) -> Optional[User]:
    """
    Authenticate a WebSocket connection using a JWT token.
    
    Args:
        token: The JWT token.
        db: Database session.
        
    Returns:
        The authenticated user or None.
    """
    payload = decode_token(token)
    if payload is None:
        return None
    
    user_id = payload.get("sub")
    if user_id is None:
        return None
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if user and user.is_active:
        return user
    
    return None


# ==================== Pagination ====================
class PaginationParams:
    """Common pagination parameters."""
    
    def __init__(
        self,
        skip: int = Query(0, ge=0, description="Number of items to skip"),
        limit: int = Query(100, ge=1, le=100, description="Number of items to return"),
    ):
        self.skip = skip
        self.limit = limit


# ==================== Request Context ====================
class RequestContext:
    """Context information for the current request."""
    
    def __init__(
        self,
        request: Request,
        user: Optional[User] = None,
    ):
        self.request = request
        self.user = user
        self.start_time = time.time()
    
    @property
    def client_ip(self) -> str:
        """Get the client IP address."""
        forwarded = self.request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.request.client.host if self.request.client else "unknown"
    
    @property
    def user_agent(self) -> str:
        """Get the user agent."""
        return self.request.headers.get("User-Agent", "unknown")
    
    @property
    def elapsed_ms(self) -> float:
        """Get elapsed time in milliseconds."""
        return (time.time() - self.start_time) * 1000
