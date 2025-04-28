import asyncio
import logging
import os
from typing import Dict, Any, Optional, List
import uuid
import json

import socketio
from aiohttp import web

from project import Project

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("socketio_server")

# Constants
SESSION_EXPIRY = 3600  # 1 hour in seconds

class ProjectServer:
    """WebSocket server for managing projects and client connections"""
    
    def __init__(self, host: str = "0.0.0.0", port: int = 8000):
        # Server settings
        self.host = host
        self.port = port
        
        # Active projects
        self.projects: Dict[str, Project] = {}
        
        # Client sessions
        self.sessions: Dict[str, Dict[str, Any]] = {}
        
        # Setup Socket.IO
        self.sio = socketio.AsyncServer(
            async_mode='aiohttp',
            cors_allowed_origins='*',
            ping_timeout=300,  # 300 seconds before the server considers the client disconnected if no ping response
            ping_interval=25  # 25 seconds between sending pings to the client
        )
        self.app = web.Application()
        self.sio.attach(self.app)
        
        # Register Socket.IO events
        self.register_socketio_handlers()
        
    def register_socketio_handlers(self):
        """Register Socket.IO event handlers"""
        
        @self.sio.event
        async def connect(sid, environ):
            """Handle client connection"""
            logger.info(f"Client connected: {sid}")
            
            # Create a new session
            self.sessions[sid] = {
                "connected_at": asyncio.get_event_loop().time(),
                "project_id": None,
                "active": True
            }
            
            await self.sio.emit('connection_established', {"sid": sid}, room=sid)
            
        @self.sio.event
        async def disconnect(sid):
            """Handle client disconnection"""
            logger.info(f"Client disconnected: {sid}")
            
            # Get associated project
            session = self.sessions.get(sid)
            if session and session.get("project_id"):
                project_id = session["project_id"]
                project = self.projects.get(project_id)
                
                # Check if this was the last client for this project
                same_project_clients = [
                    s for s, data in self.sessions.items()
                    if s != sid and data.get("project_id") == project_id and data.get("active")
                ]
                
                # If no more clients are connected to this project, disconnect it
                if not same_project_clients and project:
                    logger.info(f"Last client for project {project_id} disconnected, closing project")
                    await self.close_project(project_id)
            
            # Remove session
            if sid in self.sessions:
                del self.sessions[sid]
                
        @self.sio.event
        async def create_project(sid, data):
            """Create a new project"""
            project_type = data.get('type', 'base')
            project_id = data.get('id', str(uuid.uuid4()))
            api_key = data.get('api_key', os.environ.get("E2B_API_KEY"))
            
            logger.info(f"Client {sid} requested to create project {project_id} of type {project_type}")
            
            # Check if project already exists
            if project_id in self.projects:
                # Associate client with existing project
                if sid in self.sessions:
                    self.sessions[sid]["project_id"] = project_id
                    
                await self.sio.emit('project_ready', {
                    "project_id": project_id,
                    "status": "ready",
                    "details": self.projects[project_id].get_project_details()
                }, room=sid)
                return
            
            # Create new project
            project = Project(project_id, project_type, api_key)
            
            # Setup file watch callback
            async def file_watch_callback(files: List):
                # Find all clients connected to this project
                project_clients = [
                    s for s, data in self.sessions.items()
                    if data.get("project_id") == project_id and data.get("active")
                ]
                
                # Emit file change event to all connected clients
                for client_sid in project_clients:
                    await self.sio.emit('files_changed', {
                        "project_id": project_id,
                        "files": files
                    }, room=client_sid)
            
            # Initialize the project
            await self.sio.emit('project_initializing', {
                "project_id": project_id,
                "status": "initializing"
            }, room=sid)
            
            try:
                initialized = await project.initialize(file_watch_callback=file_watch_callback)
                
                if initialized:
                    # Store the project
                    self.projects[project_id] = project
                    
                    # Associate client with project
                    if sid in self.sessions:
                        self.sessions[sid]["project_id"] = project_id
                    
                    # Notify client
                    await self.sio.emit('project_ready', {
                        "project_id": project_id,
                        "status": "ready",
                        "details": project.get_project_details()
                    }, room=sid)
                else:
                    # Notify client of failure
                    await self.sio.emit('project_error', {
                        "project_id": project_id,
                        "error": "Failed to initialize project"
                    }, room=sid)
            except Exception as e:
                logger.error(f"Error initializing project {project_id}: {str(e)}")
                await self.sio.emit('project_error', {
                    "project_id": project_id,
                    "error": f"Failed to initialize project: {str(e)}"
                }, room=sid)
                
        @self.sio.event
        async def join_project(sid, data):
            """Join an existing project"""
            project_id = data.get('project_id')
            
            if not project_id:
                await self.sio.emit('error', {
                    "message": "Project ID is required"
                }, room=sid)
                return
                
            # Check if project exists
            if project_id not in self.projects:
                await self.sio.emit('error', {
                    "message": f"Project {project_id} not found"
                }, room=sid)
                return
                
            # Associate client with project
            if sid in self.sessions:
                self.sessions[sid]["project_id"] = project_id
                
            # Get project details
            project = self.projects[project_id]
            
            await self.sio.emit('project_ready', {
                "project_id": project_id,
                "status": "ready",
                "details": project.get_project_details()
            }, room=sid)
            
        @self.sio.event
        async def leave_project(sid, data):
            """Leave the current project"""
            session = self.sessions.get(sid)
            if not session:
                return
                
            project_id = session.get("project_id")
            if not project_id:
                return
                
            # Remove association
            session["project_id"] = None
            
            # Check if this was the last client for this project
            same_project_clients = [
                s for s, data in self.sessions.items()
                if s != sid and data.get("project_id") == project_id and data.get("active")
            ]
            
            # If no more clients are connected to this project, disconnect it
            if not same_project_clients and project_id in self.projects:
                logger.info(f"Last client for project {project_id} left, closing project")
                await self.close_project(project_id)
                
            await self.sio.emit('project_left', {
                "project_id": project_id
            }, room=sid)
            
        @self.sio.event
        async def project_command(sid, data):
            """Handle project commands"""
            session = self.sessions.get(sid)
            if not session:
                await self.sio.emit('error', {
                    "message": "Invalid session"
                }, room=sid)
                return
                
            project_id = session.get("project_id")
            if not project_id or project_id not in self.projects:
                await self.sio.emit('error', {
                    "message": "No active project"
                }, room=sid)
                return
                
            # Get the project
            project = self.projects[project_id]
            
            # Get command details
            command = data.get('command')
            args = data.get('args', {})
            
            if not command:
                await self.sio.emit('error', {
                    "message": "Command is required"
                }, room=sid)
                return
                
            # Create a socket wrapper for the project handler
            socket_wrapper = {
                "socket": SocketWrapper(self.sio, sid)
            }
            
            # Get project handlers
            handlers = project.handlers(socket_wrapper)
            
            # Find the handler for this command
            handler = handlers.get(command)
            if not handler:
                await self.sio.emit('error', {
                    "message": f"Unknown command: {command}"
                }, room=sid)
                return
                
            # Execute the handler
            try:
                result = await handler(args)
                await self.sio.emit('command_result', {
                    "command": command,
                    "args": args,
                    "result": result
                }, room=sid)
            except Exception as e:
                logger.error(f"Error executing command {command} for project {project_id}: {str(e)}")
                await self.sio.emit('error', {
                    "command": command,
                    "message": f"Error executing command: {str(e)}"
                }, room=sid)
    
    async def close_project(self, project_id: str):
        """Close a project and release its resources"""
        project = self.projects.get(project_id)
        if not project:
            return
            
        try:
            await project.disconnect()
            del self.projects[project_id]
            logger.info(f"Project {project_id} closed")
        except Exception as e:
            logger.error(f"Error closing project {project_id}: {str(e)}")
    
    async def start(self):
        """Start the web server"""
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logger.info(f"Server started at http://{self.host}:{self.port}")
        
        # Setup cleanup task
        asyncio.create_task(self._cleanup_task())
        
        return runner, site
        
    async def _cleanup_task(self):
        """Periodic task to clean up expired sessions and idle projects"""
        while True:
            try:
                current_time = asyncio.get_event_loop().time()
                
                # Find expired sessions
                expired_sessions = [
                    sid for sid, data in self.sessions.items()
                    if current_time - data["connected_at"] > SESSION_EXPIRY and data["active"]
                ]
                
                # Close expired sessions
                for sid in expired_sessions:
                    logger.info(f"Closing expired session {sid}")
                    self.sessions[sid]["active"] = False
                    try:
                        await self.sio.disconnect(sid)
                    except Exception:
                        pass
                
                # Find idle projects (no active sessions)
                for project_id, project in list(self.projects.items()):
                    has_active_session = any(
                        data.get("project_id") == project_id and data.get("active")
                        for data in self.sessions.values()
                    )
                    
                    if not has_active_session:
                        logger.info(f"Closing idle project {project_id}")
                        await self.close_project(project_id)
                        
            except Exception as e:
                logger.error(f"Error in cleanup task: {str(e)}")
                
            # Run every minute
            await asyncio.sleep(60)

class SocketWrapper:
    """Wrapper for Socket.IO to be used with project handlers"""
    
    def __init__(self, sio, sid):
        self.sio = sio
        self.sid = sid
        
    async def emit(self, event, data):
        """Emit an event to the client"""
        await self.sio.emit(event, data, room=self.sid)

async def main():
    """Start the server"""
    server = ProjectServer()
    runner, site = await server.start()
    
    try:
        # Keep the server running
        while True:
            await asyncio.sleep(3600)  # Sleep for an hour
    finally:
        # Cleanup on shutdown
        await runner.cleanup()

if __name__ == "__main__":
    asyncio.run(main())