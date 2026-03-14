"""
Yjs WebSocket server for real-time collaborative editing.

This module provides a WebSocket endpoint that handles the Yjs CRDT sync protocol.
It integrates with the y-websocket package to provide collaborative editing.
"""
import asyncio
import base64
import json
import logging
from typing import Dict, Set, Optional
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import hashlib

from database import get_db
from dependencies import get_user_from_token

logger = logging.getLogger(__name__)

# Router for Yjs WebSocket
yjs_router = APIRouter()

# Room management constants
MAX_YJS_ROOMS = 500  # Maximum number of concurrent Yjs rooms
YJS_ROOM_INACTIVITY_TIMEOUT = 60 * 60  # 60 minutes in seconds (Yjs documents are larger)


@dataclass
class YjsRoom:
    """Represents a Yjs document room."""
    id: str
    updates: list = field(default_factory=list)  # Buffer of all updates
    last_activity: datetime = field(default_factory=datetime.utcnow)


@dataclass
class YjsConnection:
    """Represents a Yjs WebSocket connection."""
    websocket: WebSocket
    room_id: str
    client_id: int
    user_id: Optional[str] = None  # Authenticated user ID
    connected_at: datetime = field(default_factory=datetime.utcnow)


class YjsServer:
    """
    Simple Yjs WebSocket server for CRDT synchronization.
    
    This handles the basic Yjs sync protocol messages:
    - Sync Step 1: Client sends their state
    - Sync Step 2: Server sends updates needed
    - Update: Client sends document updates
    """
    
    def __init__(self):
        self.rooms: Dict[str, YjsRoom] = {}
        self.connections: Dict[WebSocket, YjsConnection] = {}
    
    def _cleanup_inactive_rooms(self) -> int:
        """Remove rooms that have been inactive beyond the timeout."""
        now = datetime.utcnow()
        rooms_to_remove = []
        
        for room_id, room in self.rooms.items():
            inactive_seconds = (now - room.last_activity).total_seconds()
            if inactive_seconds > YJS_ROOM_INACTIVITY_TIMEOUT:
                rooms_to_remove.append(room_id)
        
        for room_id in rooms_to_remove:
            del self.rooms[room_id]
            logger.info(f"Cleaned up inactive Yjs room {room_id}")
        
        return len(rooms_to_remove)
    
    def _can_create_room(self) -> bool:
        """Check if a new room can be created (with limits)."""
        self._cleanup_inactive_rooms()
        return len(self.rooms) < MAX_YJS_ROOMS
    
    async def handle_connection(self, websocket: WebSocket, room_id: str, user_id: Optional[str] = None) -> None:
        """Handle a new Yjs WebSocket connection."""
        await websocket.accept()
        
        # Check room limits before creating new room
        if room_id not in self.rooms and not self._can_create_room():
            logger.warning(f"Yjs room limit reached, rejecting connection to room {room_id}")
            await websocket.close(code=1013, reason="Server is at capacity")
            return
        
        # Generate a unique client ID
        client_id = int(hashlib.sha256(f"{room_id}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:8], 16)
        
        connection = YjsConnection(
            websocket=websocket,
            room_id=room_id,
            client_id=client_id,
            user_id=user_id,
        )
        self.connections[websocket] = connection
        
        # Initialize room if needed
        if room_id not in self.rooms:
            self.rooms[room_id] = YjsRoom(id=room_id)
        
        # Update room activity
        self.rooms[room_id].last_activity = datetime.utcnow()
        
        logger.info(f"Yjs client {client_id} connected to room {room_id} (user_id: {user_id})")
        
        try:
            # Send welcome message with client ID
            await websocket.send_json({
                "type": "sync",
                "step": 1,
                "clientID": client_id,
            })
            
            # Handle incoming messages
            while True:
                data = await websocket.receive_text()
                await self._handle_message(websocket, data)
                
        except WebSocketDisconnect:
            logger.info(f"Yjs client {client_id} disconnected from room {room_id} (user_id: {connection.user_id})")
        finally:
            # Clean up
            self.connections.pop(websocket, None)
            if room_id in self.rooms:
                room = self.rooms[room_id]
                # Note: We no longer track per-client states, so no cleanup needed
                # Update room activity
                room.last_activity = datetime.utcnow()
    
    async def _handle_message(self, websocket: WebSocket, data: str) -> None:
        """Handle an incoming Yjs message."""
        try:
            message = json.loads(data)
            msg_type = message.get("type")
            
            if msg_type == "sync":
                await self._handle_sync(websocket, message)
            elif msg_type == "update":
                await self._handle_update(websocket, message)
            elif msg_type == "awareness":
                await self._handle_awareness(websocket, message)
                
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON received: {data}")
    
    async def _handle_sync(self, websocket: WebSocket, message: dict) -> None:
        """Handle sync messages."""
        connection = self.connections.get(websocket)
        if not connection:
            return
        
        step = message.get("step")
        
        if step == 1:
            # Client is sending their state vector
            # We don't need to do anything special - we maintain a merged doc
            pass
        
        elif step == 2:
            # Client is requesting updates
            # Send all buffered updates to the client
            room = self.rooms.get(connection.room_id)
            
            if room:
                # Send all accumulated updates
                await websocket.send_json({
                    "type": "sync",
                    "step": 2,
                    "updates": room.updates,  # Send all accumulated updates
                })
    
    async def _handle_update(self, websocket: WebSocket, message: dict) -> None:
        """Handle document update messages."""
        connection = self.connections.get(websocket)
        if not connection:
            return
        
        update = message.get("update")
        
        if update:
            room = self.rooms.get(connection.room_id)
            if not room:
                return
            
            # Store update in buffer
            room.updates.append(update)
            room.last_activity = datetime.utcnow()
            
            # Broadcast to other clients in the room
            await self._broadcast_to_room(
                connection.room_id,
                {
                    "type": "update",
                    "update": message.get("update"),  # Send original format for backward compatibility
                },
                exclude_websocket=websocket,
            )
    
    async def _handle_awareness(self, websocket: WebSocket, message: dict) -> None:
        """Handle awareness (cursor/presence) messages."""
        connection = self.connections.get(websocket)
        if not connection:
            return
        
        # Update room activity
        room = self.rooms.get(connection.room_id)
        if room:
            room.last_activity = datetime.utcnow()
        
        # Broadcast awareness to other clients
        await self._broadcast_to_room(
            connection.room_id,
            {
                "type": "awareness",
                "states": message.get("states", {}),
                "origin": connection.client_id,
            },
            exclude_websocket=websocket,
        )
    
    async def _broadcast_to_room(
        self,
        room_id: str,
        message: dict,
        exclude_websocket: WebSocket = None,
    ) -> None:
        """Broadcast a message to all clients in a room."""
        for conn in self.connections.values():
            if conn.room_id == room_id and conn.websocket != exclude_websocket:
                try:
                    await conn.websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to client: {e}")


# Global Yjs server instance
yjs_server = YjsServer()


@yjs_router.websocket("/ws/editor")
async def yjs_websocket(
    websocket: WebSocket,
    room: str = Query(..., min_length=1, max_length=200, description="Room ID for collaborative editing"),
    token: str = Query(..., description="JWT token for authentication"),
):
    """
    WebSocket endpoint for Yjs document synchronization.
    
    Query parameters:
    - room: The room ID for collaborative editing (required)
    - token: JWT token for authentication (required)
    
    Authentication:
    - Token must be provided and verified via JWT
    - User must be authenticated to access collaborative documents
    """
    user_id = None
    
    # Authenticate via token (required)
    try:
        async for db in get_db():
            authenticated_user = await get_user_from_token(token, db)
            
            if authenticated_user:
                user_id = str(authenticated_user.id)
                logger.info(f"Authenticated user {user_id} via token for Yjs room {room}")
            else:
                logger.warning(f"Invalid token provided for Yjs room {room}")
                await websocket.close(code=4004, reason="Invalid or expired token")
                return
            break
    except Exception as e:
        logger.error(f"Error verifying token for Yjs: {e}")
        await websocket.close(code=4004, reason="Token verification failed")
        return
    
    await yjs_server.handle_connection(websocket, room, user_id)
