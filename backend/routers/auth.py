"""
Authentication router for the CodeHS Clone API.

Handles:
- User registration
- User login (OAuth2 password flow)
- Token refresh
- Current user info
"""
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserRole
from schemas import (
    UserCreate, UserResponse, UserUpdate,
    Token, Message,
)
from dependencies import (
    get_current_active_user,
    get_password_hash,
    verify_password,
    password_needs_rehash,
    create_access_token,
    decode_token_allow_expired,
    check_rate_limit,
    rate_limiter,
    security,
    revoke_token,
    require_teacher,
)
import os

# Configure logging
logger = logging.getLogger(__name__)

# Configuration
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# Create router
router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


# ==================== Registration ====================
@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description="Create a new user account with username, email, and password.",
)
async def register(
    user: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Register a new user."""
    # Check rate limit using the incoming request
    if request is not None:
        await check_rate_limit(request)
    
    # Check if username exists
    result = await db.execute(select(User).where(User.username == user.username))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email exists
    result = await db.execute(select(User).where(User.email == user.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Validate role
    valid_roles = [r.value for r in UserRole]
    user_role = UserRole.STUDENT  # Default
    if user.role and user.role in valid_roles:
        user_role = UserRole(user.role)
    
    # Create user
    hashed_password = get_password_hash(user.password)
    db_user = User(
        username=user.username,
        email=user.email,
        hashed_password=hashed_password,
        role=user_role,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    
    logger.info(f"New user registered: {db_user.username} (id={db_user.id})")
    
    return db_user


# ==================== Login ====================
@router.post(
    "/login",
    response_model=Token,
    summary="Login and get access token",
    description="OAuth2 password flow authentication. Returns a JWT access token.",
)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> Token:
    """Login and get access token."""
    # Check rate limit (use username as key for login attempts)
    await check_rate_limit(request)
    
    # Find user
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()
    
    # Verify credentials
    if not user or not verify_password(form_data.password, user.hashed_password):
        logger.warning(f"Failed login attempt for username: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Transparently upgrade legacy hashes to Argon2
    if password_needs_rehash(user.hashed_password):
        user.hashed_password = get_password_hash(form_data.password)
        await db.commit()
        logger.info(f"Rehashed password to Argon2 for user: {user.username}")

    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.id, "username": user.username, "role": user.role.value},
        expires_delta=access_token_expires
    )
    
    logger.info(f"User logged in: {user.username} (id={user.id})")
    
    return Token(access_token=access_token, token_type="bearer")


# ==================== Current User ====================
@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user",
    description="Get the currently authenticated user's information.",
)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> UserResponse:
    """Get current user information."""
    return current_user


# ==================== Token Refresh ====================
@router.post(
    "/refresh",
    response_model=Token,
    summary="Refresh access token",
    description="Get a new access token. Accepts tokens expired within 7 days.",
)
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Token:
    """Refresh access token, accepting recently-expired tokens."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No credentials provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    old_token = credentials.credentials
    payload = decode_token_allow_expired(old_token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or expired beyond refresh window",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Revoke the old token to prevent reuse
    revoke_token(old_token)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.id, "username": user.username, "role": user.role.value},
        expires_delta=access_token_expires,
    )

    logger.info(f"Token refreshed for user: {user.username} (id={user.id})")
    return Token(access_token=access_token, token_type="bearer")


@router.post(
    "/logout",
    response_model=Message,
    summary="Logout current user",
    description="Revoke the current access token and logout the user.",
)
async def logout(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Message:
    """Logout and revoke the current access token."""
    await check_rate_limit(request, user=current_user)

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    revoke_token(credentials.credentials)
    logger.info(f"User logged out: {current_user.username} (id={current_user.id})")
    return Message(message="Logged out successfully")


# ==================== User Management ====================
@router.get(
    "/users",
    response_model=list[UserResponse],
    summary="List all users",
    description="Get a list of all users. Teachers only.",
)
async def list_users(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> list[UserResponse]:
    """List all users (teachers only)."""
    result = await db.execute(select(User).offset(skip).limit(limit))
    return result.scalars().all()


@router.get(
    "/users/{user_id}",
    response_model=UserResponse,
    summary="Get user by ID",
    description="Get a specific user's information. Users can only view their own profile unless they're a teacher.",
)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserResponse:
    """Get user by ID."""
    # Users can only view their own profile unless they're a teacher
    if current_user.id != user_id and current_user.role != UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user


@router.put(
    "/users/{user_id}",
    response_model=UserResponse,
    summary="Update user",
    description="Update user information. Users can only update their own profile unless they're a teacher.",
)
async def update_user(
    user_id: int,
    user_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserResponse:
    """Update user information."""
    # Users can only update their own profile unless they're a teacher
    if current_user.id != user_id and current_user.role != UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update fields
    update_data = user_update.model_dump(exclude_unset=True)
    
    if "password" in update_data:
        update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
    
    for field, value in update_data.items():
        setattr(user, field, value)
    
    await db.commit()
    await db.refresh(user)
    
    logger.info(f"User updated: {user.username} (id={user.id})")
    
    return user


@router.delete(
    "/users/{user_id}",
    response_model=Message,
    summary="Delete user",
    description="Delete a user account. Teachers only.",
)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> Message:
    """Delete a user (teachers only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent deleting yourself
    if user.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your own account"
        )
    
    username = user.username
    user_id = user.id
    
    await db.delete(user)
    await db.commit()
    
    logger.info(f"User deleted: {username} (id={user_id})")
    
    return Message(message="User deleted successfully")


# ==================== Rate Limit Info ====================
@router.get(
    "/rate-limit",
    summary="Get rate limit info",
    description="Get remaining requests for the current client.",
)
async def get_rate_limit_info(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Get rate limit information."""
    key = f"user:{current_user.id}"
    remaining = rate_limiter.get_remaining(key)
    return {
        "limit_per_minute": rate_limiter.requests_per_minute,
        "limit_per_hour": rate_limiter.requests_per_hour,
        "remaining": remaining,
    }
