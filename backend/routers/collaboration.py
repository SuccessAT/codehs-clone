"""
Collaboration WebSocket endpoints for real-time collaborative editing.

This module provides:
- WebSocket connection management for collaborative sessions
- Comment synchronization
- Presence tracking
- Ghost code suggestions
"""
import asyncio
import json
import logging
import html
from datetime import datetime
from typing import Dict, Set, Optional
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_user_from_token, decode_token
from models import User

logger = logging.getLogger(__name__)

# Router for collaboration endpoints
collaboration_router = APIRouter()

# Constants for input validation
MAX_COMMENT_LENGTH = 5000
MAX_COMMENTS_PER_USER = 100  # Prevent spam
MAX_SUGGESTION_LENGTH = 2000
MAX_USER_NAME_LENGTH = 100
MAX_ROLE_LENGTH = 20

# Room management constants
MAX_ROOMS = 1000  # Maximum number of concurrent rooms
ROOM_INACTIVITY_TIMEOUT = 30 * 60  # 30 minutes in seconds

# Comment management constants
MAX_COMMENTS_PER_ROOM = 500  # Maximum total comments per room
COMMENT_RETENTION_HOURS = 24  # Keep resolved comments for 24 hours

# Valid roles
VALID_ROLES = {"teacher", "student", "admin"}


@dataclass
class CollaborationUser:
    """Represents a user in a collaboration session."""
    id: str
    name: str
    role: str
    color: str
    websocket: WebSocket
    is_typing: bool = False


@dataclass
class CollaborationRoom:
    """Represents a collaboration room."""
    id: str
    users: Dict[str, CollaborationUser] = field(default_factory=dict)
    comments: list = field(default_factory=list)
    suggestions: list = field(default_factory=list)
    last_activity: datetime = field(default_factory=datetime.utcnow)


class CollaborationManager:
    """
    Manages WebSocket connections for collaborative editing.
    
    Features:
    - Room management with TTL
    - Comment broadcasting
    - Presence tracking
    - Suggestion broadcasting
    """
    
    def __init__(self):
        self.rooms: Dict[str, CollaborationRoom] = {}
        self.user_rooms: Dict[WebSocket, str] = {}
    
    def _cleanup_inactive_rooms(self) -> int:
        """Remove rooms that have been inactive beyond the timeout."""
        now = datetime.utcnow()
        rooms_to_remove = []
        
        for room_id, room in self.rooms.items():
            inactive_seconds = (now - room.last_activity).total_seconds()
            if inactive_seconds > ROOM_INACTIVITY_TIMEOUT:
                rooms_to_remove.append(room_id)
        
        for room_id in rooms_to_remove:
            del self.rooms[room_id]
            logger.info(f"Cleaned up inactive room {room_id}")
        
        # Also clean up old comments in active rooms
        for room in self.rooms.values():
            self._cleanup_old_comments(room)
        
        return len(rooms_to_remove)
    
    def _cleanup_old_comments(self, room: CollaborationRoom) -> int:
        """Remove old resolved comments beyond retention period."""
        now = datetime.utcnow()
        comments_to_keep = []
        removed = 0
        
        for comment in room.comments:
            # Keep unresolved comments
            if not comment.get("resolved"):
                comments_to_keep.append(comment)
                continue
            
            # Check age of resolved comments
            try:
                created = datetime.fromisoformat(comment.get("timestamp", ""))
                age_hours = (now - created).total_seconds() / 3600
                if age_hours < COMMENT_RETENTION_HOURS:
                    comments_to_keep.append(comment)
                else:
                    removed += 1
            except:
                # If timestamp parsing fails, keep the comment
                comments_to_keep.append(comment)
        
        room.comments = comments_to_keep
        return removed
    
    def _limit_comments(self, room: CollaborationRoom) -> int:
        """Enforce maximum comment limit, removing oldest resolved first."""
        if len(room.comments) <= MAX_COMMENTS_PER_ROOM:
            return 0
        
        # Sort by timestamp, keeping unresolved and newest resolved
        unresolved = [c for c in room.comments if not c.get("resolved")]
        resolved = [c for c in room.comments if c.get("resolved")]
        
        # Sort resolved by timestamp (newest first)
        resolved.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        
        # Keep only enough to reach limit
        kept_resolved = resolved[:MAX_COMMENTS_PER_ROOM - len(unresolved)]
        
        removed = len(room.comments) - (len(unresolved) + len(kept_resolved))
        room.comments = unresolved + kept_resolved
        return removed
    
    def _can_create_room(self) -> bool:
        """Check if a new room can be created (with limits)."""
        self._cleanup_inactive_rooms()
        return len(self.rooms) < MAX_ROOMS
    
    async def connect(
        self,
        websocket: WebSocket,
        room_id: str,
        user_id: str,
        user_name: str,
        role: str,
    ) -> CollaborationUser:
        """Connect a user to a collaboration room."""
        await websocket.accept()
        
        # Check room limits before creating new room
        if room_id not in self.rooms and not self._can_create_room():
            logger.warning(f"Room limit reached, rejecting connection to room {room_id}")
            await websocket.close(code=1013, reason="Server is at capacity")
            return None
        
        # Create room if it doesn't exist
        if room_id not in self.rooms:
            self.rooms[room_id] = CollaborationRoom(id=room_id)
        
        room = self.rooms[room_id]
        room.last_activity = datetime.utcnow()  # Update activity timestamp
        
        # Generate user color based on ID
        color = self._generate_color(user_id)
        
        # Create user
        user = CollaborationUser(
            id=user_id,
            name=user_name,
            role=role,
            color=color,
            websocket=websocket,
        )
        
        # Add user to room
        room.users[user_id] = user
        self.user_rooms[websocket] = room_id
        
        # Notify others about new user
        await self._broadcast_to_room(
            room_id,
            {
                "type": "USER_JOIN",
                "payload": {
                    "id": user_id,
                    "name": user_name,
                    "role": role,
                    "color": color,
                },
                "userId": user_id,
                "timestamp": datetime.utcnow().isoformat(),
            },
            exclude_user=user_id,
        )
        
        # Send current room state to new user
        await websocket.send_json({
            "type": "ROOM_STATE",
            "payload": {
                "users": [
                    {
                        "id": u.id,
                        "name": u.name,
                        "role": u.role,
                        "color": u.color,
                        "isTyping": u.is_typing,
                    }
                    for u in room.users.values()
                ],
                "comments": room.comments,
                "suggestions": room.suggestions,
            },
            "userId": user_id,
            "timestamp": datetime.utcnow().isoformat(),
        })
        
        logger.info(f"User {user_name} ({user_id}) joined room {room_id}")
        
        return user
    
    async def disconnect(self, websocket: WebSocket) -> None:
        """Disconnect a user from their room."""
        room_id = self.user_rooms.pop(websocket, None)
        
        if not room_id or room_id not in self.rooms:
            return
        
        room = self.rooms[room_id]
        
        # Find and remove user
        user_to_remove = None
        for user_id, user in room.users.items():
            if user.websocket == websocket:
                user_to_remove = user
                break
        
        if user_to_remove:
            del room.users[user_to_remove.id]
            
            # Notify others
            await self._broadcast_to_room(
                room_id,
                {
                    "type": "USER_LEAVE",
                    "payload": {"userId": user_to_remove.id},
                    "userId": user_to_remove.id,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            
            logger.info(f"User {user_to_remove.name} ({user_to_remove.id}) left room {room_id}")
        
        # Update last activity timestamp
        room.last_activity = datetime.utcnow()
        
        # Clean up empty rooms
        if not room.users:
            del self.rooms[room_id]
    
    async def handle_message(self, websocket: WebSocket, message: dict, user_id: str) -> None:
        """Handle an incoming message from a user."""
        room_id = self.user_rooms.get(websocket)
        
        if not room_id or room_id not in self.rooms:
            return
        
        room = self.rooms[room_id]
        msg_type = message.get("type")
        
        # Find the sender
        sender = None
        for user in room.users.values():
            if user.websocket == websocket:
                sender = user
                break
        
        if not sender:
            return
        
        # Input validation helper
        def sanitize_text(text: str, max_length: int) -> str:
            """Sanitize and truncate text input."""
            if not isinstance(text, str):
                return ""
            # Escape HTML to prevent XSS
            sanitized = html.escape(text.strip())
            # Truncate to max length
            return sanitized[:max_length]
        
        def validate_comment_payload(payload: dict) -> Optional[dict]:
            """Validate and sanitize comment payload."""
            if not payload or not isinstance(payload, dict):
                return None
            
            # Check for existing comments limit per user
            user_comment_count = sum(1 for c in room.comments if c.get("userId") == user_id)
            if user_comment_count >= MAX_COMMENTS_PER_USER:
                logger.warning(f"User {user_id} exceeded comment limit in room {room_id}")
                return None
            
            validated = {}
            
            # Validate text
            text = payload.get("text")
            if text:
                validated["text"] = sanitize_text(text, MAX_COMMENT_LENGTH)
                if not validated["text"]:  # Empty after sanitization
                    return None
            
            # Copy other fields
            for key in ["id", "exerciseId", "line", "column", "timestamp"]:
                if key in payload:
                    validated[key] = payload[key]
            
            # Add user info from verified token
            validated["userId"] = user_id
            
            return validated
        
        def validate_suggestion_payload(payload: dict) -> Optional[dict]:
            """Validate and sanitize suggestion payload."""
            if not payload or not isinstance(payload, dict):
                return None
            
            validated = {}
            
            # Validate code
            code = payload.get("code")
            if code:
                validated["code"] = sanitize_text(code, MAX_SUGGESTION_LENGTH)
                if not validated["code"]:
                    return None
            
            # Validate explanation
            explanation = payload.get("explanation")
            if explanation:
                validated["explanation"] = sanitize_text(explanation, MAX_COMMENT_LENGTH)
            
            # Copy other fields
            for key in ["id", "line", "timestamp"]:
                if key in payload:
                    validated[key] = payload[key]
            
            validated["userId"] = user_id
            
            return validated
        
        if msg_type == "COMMENT_NEW":
            # Validate and sanitize comment
            payload = message.get("payload")
            validated_payload = validate_comment_payload(payload)
            
            if validated_payload is None:
                logger.warning(f"Invalid comment payload from user {user_id}")
                return
            
            # Add comment to room
            room.comments.append(validated_payload)
            
            # Enforce comment limit
            self._limit_comments(room)
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "COMMENT_REPLY":
            # Validate and sanitize reply
            payload = message.get("payload", {})
            comment_id = payload.get("commentId")
            reply_text = payload.get("text")
            
            if not comment_id or not reply_text:
                return
            
            # Sanitize reply text
            sanitized_reply = sanitize_text(reply_text, MAX_COMMENT_LENGTH)
            if not sanitized_reply:
                return
            
            # Find and update comment
            for comment in room.comments:
                if comment.get("id") == comment_id:
                    reply_payload = {
                        "text": sanitized_reply,
                        "userId": user_id,
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    comment.setdefault("replies", []).append(reply_payload)
                    break
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "COMMENT_RESOLVE":
            # Mark comment as resolved (only allow the comment author or teachers)
            comment_id = message.get("payload", {}).get("commentId")
            for comment in room.comments:
                if comment.get("id") == comment_id:
                    # Allow resolving if user is the comment author
                    if comment.get("userId") == user_id:
                        comment["resolved"] = True
                        comment["resolvedBy"] = user_id
                    break
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "SUGGESTION":
            # Validate and sanitize suggestion
            payload = message.get("payload")
            validated_payload = validate_suggestion_payload(payload)
            
            if validated_payload is None:
                logger.warning(f"Invalid suggestion payload from user {user_id}")
                return
            
            # Add suggestion to room
            room.suggestions.append(validated_payload)
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "SUGGESTION_ACCEPT":
            # Remove suggestion from room
            suggestion_id = message.get("payload", {}).get("suggestionId")
            room.suggestions = [s for s in room.suggestions if s.get("id") != suggestion_id]
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "PRESENCE_UPDATE":
            # Update user presence
            sender.is_typing = message.get("payload", {}).get("isTyping", False)
            
            # Broadcast to others
            await self._broadcast_to_room(room_id, message, exclude_user=sender.id)
        
        elif msg_type == "TYPING_START":
            sender.is_typing = True
            await self._broadcast_to_room(
                room_id,
                {
                    "type": "PRESENCE_UPDATE",
                    "payload": {"userId": sender.id, "isTyping": True},
                    "userId": sender.id,
                    "timestamp": datetime.utcnow().isoformat(),
                },
                exclude_user=sender.id,
            )
        
        elif msg_type == "TYPING_END":
            sender.is_typing = False
            await self._broadcast_to_room(
                room_id,
                {
                    "type": "PRESENCE_UPDATE",
                    "payload": {"userId": sender.id, "isTyping": False},
                    "userId": sender.id,
                    "timestamp": datetime.utcnow().isoformat(),
                },
                exclude_user=sender.id,
            )
    
    async def _broadcast_to_room(
        self,
        room_id: str,
        message: dict,
        exclude_user: str = None,
    ) -> None:
        """Broadcast a message to all users in a room."""
        if room_id not in self.rooms:
            return
        
        room = self.rooms[room_id]
        
        for user in room.users.values():
            if exclude_user and user.id == exclude_user:
                continue
            
            try:
                await user.websocket.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to user {user.id}: {e}")
    
    def _generate_color(self, user_id: str) -> str:
        """Generate a consistent color for a user based on their ID."""
        # Simple hash-based color generation
        hash_val = hash(user_id)
        hue = hash_val % 360
        return f"hsl({hue}, 70%, 50%)"


# Global collaboration manager
collaboration_manager = CollaborationManager()


@collaboration_router.websocket("/ws/comments")
async def comments_websocket(
    websocket: WebSocket,
    room: str = Query(..., min_length=1, max_length=200, description="Room ID"),
    token: str = Query(..., description="JWT token for authentication"),
):
    """
    WebSocket endpoint for comment synchronization.
    
    Query parameters:
    - room: The room ID (required)
    - token: JWT token for authentication (required)
    
    Authentication:
    - Token must be provided and verified via JWT
    - User info is extracted from the verified token
    """
    user = None
    verified_user_id = None
    verified_user_name = None
    verified_role = None
    
    # Authenticate via token (required)
    try:
        # Get database session for token verification
        async for db in get_db():
            authenticated_user = await get_user_from_token(token, db)
            
            if authenticated_user:
                verified_user_id = str(authenticated_user.id)
                verified_user_name = authenticated_user.username
                verified_role = authenticated_user.role.value if hasattr(authenticated_user.role, 'value') else str(authenticated_user.role)
                logger.info(f"Authenticated user {verified_user_id} via token for room {room}")
            else:
                logger.warning(f"Invalid token provided for room {room}")
                await websocket.close(code=4004, reason="Invalid or expired token")
                return
            break
    except Exception as e:
        logger.error(f"Error verifying token: {e}")
        await websocket.close(code=4004, reason="Token verification failed")
        return
    
    try:
        # Connect user
        user = await collaboration_manager.connect(
            websocket=websocket,
            room_id=room,
            user_id=verified_user_id,
            user_name=verified_user_name,
            role=verified_role,
        )
        
        # Handle incoming messages
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                # Pass user_id for validation
                await collaboration_manager.handle_message(websocket, message, verified_user_id)
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received: {data[:100]}")
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {user.name if user else 'unknown'}")
    finally:
        await collaboration_manager.disconnect(websocket)


# Import for Yjs WebSocket handling
# Note: y-websocket provides its own server, but we can integrate it
# For now, we'll use the y-websocket package directly on the frontend
# The editor WebSocket is handled by y-websocket package

# Additional utility functions for managing collaboration state

async def get_room_state(room_id: str) -> dict:
    """Get the current state of a room."""
    if room_id not in collaboration_manager.rooms:
        return None
    
    room = collaboration_manager.rooms[room_id]
    
    return {
        "id": room.id,
        "userCount": len(room.users),
        "commentCount": len(room.comments),
        "suggestionCount": len(room.suggestions),
    }


async def clear_room_comments(room_id: str) -> bool:
    """Clear all comments from a room (admin function)."""
    if room_id not in collaboration_manager.rooms:
        return False
    
    room = collaboration_manager.rooms[room_id]
    room.comments = []
    
    # Broadcast the clear to all users
    await collaboration_manager._broadcast_to_room(
        room_id,
        {
            "type": "COMMENTS_CLEARED",
            "payload": {},
            "userId": "system",
            "timestamp": datetime.utcnow().isoformat(),
        },
    )
    
    return True
