import asyncio
import json
import re
import time
from typing import Dict, Any, Optional, Callable, List, Union, Tuple
import os
import logging
from e2b import AsyncSandbox

from terminal_manager import TerminalManager
from file_manager import FileManager

# Configure logging
logger = logging.getLogger("project")

# Constants
CONTAINER_PAUSE = 300000  # 5 minutes in milliseconds
CONTAINER_TIMEOUT = 600000  # 10 minutes in milliseconds
MAX_TERMINALS = 10  # Maximum number of terminals per project
DEFAULT_PROJECT_DIR = "/home/user/project"

class LockManager:
    """Manages locks for exclusive access to resources"""
    def __init__(self):
        self.locks = {}
        
    async def acquire_lock(self, key: str, callback: Callable):
        """Acquire a lock for the given key and execute the callback"""
        if key not in self.locks:
            self.locks[key] = asyncio.Lock()
            
        async with self.locks[key]:
            return await callback()

# Global lock manager
lock_manager = LockManager()

def extract_port_number(input_string: str) -> Optional[int]:
    """Extract port number from a string containing 'http://localhost:<port>'"""
    # Remove ANSI color codes
    cleaned_string = re.sub(r'\x1B\[[0-9;]*m', '', input_string)
    match = re.search(r'http://localhost:(\d+)', cleaned_string)
    return int(match.group(1)) if match else None

class Project:
    """Manages a project environment with terminals, files, and containers"""
    
    def __init__(self, project_id: str, project_type: str = "base", 
                 api_key: str = None):
        # Project properties
        self.project_id = project_id
        self.type = project_type
        self.file_manager = None
        self.terminal_manager = None
        self.sandbox = None
        self.api_key = api_key or os.environ.get("E2B_API_KEY", "e2b_25759fe29f1d0ab6ecb00f615f0dec122c70b6fa")
        self.pause_timeout = None
        self.status = "initializing"
        self.created_at = time.time()
        self.last_activity = time.time()
        self.active_terminals = set()
        self.is_closing = False
        
    async def initialize(self, file_watch_callback: Optional[Callable] = None):
        """Initialize the project with terminal and file managers"""
        try:
            logger.info(f"Initializing project {self.project_id} of type {self.type}")
            self.status = "initializing"
            
            # Initialize terminal manager
            self.terminal_manager = TerminalManager()
            
            # Initialize the sandbox through the terminal manager
            await self.terminal_manager.initialize_sandbox(
                template=self.type,
                api_key=self.api_key
            )
            
            # Get the sandbox instance
            self.sandbox = self.terminal_manager.get_sandbox()
            if not self.sandbox:
                logger.error(f"Failed to get sandbox instance for project {self.project_id}")
                self.status = "error"
                return False
            
            # Initialize file manager with the same sandbox
            self.file_manager = FileManager(
                self.sandbox,
                file_watch_callback=file_watch_callback
            )
            
            # Initialize the file manager
            await self.file_manager.initialize()
            
            self.status = "ready"
            logger.info(f"Project {self.project_id} initialized successfully")
            return True
            
        except Exception as e:
            self.status = "error"
            logger.error(f"Failed to initialize project {self.project_id}: {str(e)}")
            return False
            
    async def disconnect(self):
        """Called when the client disconnects from the project"""
        if self.is_closing:
            return
            
        self.is_closing = True
        
        try:
            logger.info(f"Disconnecting project {self.project_id}")
            self.status = "disconnecting"
            
            # Close all terminals
            if self.terminal_manager:
                await self.terminal_manager.close_all_terminals()
                self.terminal_manager = None
                
            # Close all file watchers
            if self.file_manager:
                await self.file_manager.close_watchers()
                self.file_manager = None
                
            # Close the sandbox if it exists
            if self.sandbox:
                try:
                    await self.sandbox.close()
                except Exception as e:
                    logger.error(f"Error closing sandbox for project {self.project_id}: {str(e)}")
                self.sandbox = None
                
            self.status = "disconnected"
            logger.info(f"Project {self.project_id} disconnected successfully")
            
        except Exception as e:
            self.status = "error"
            logger.error(f"Error disconnecting project {self.project_id}: {str(e)}")
        
    def update_activity(self):
        """Update the last activity timestamp"""
        self.last_activity = time.time()
    
    def get_project_details(self):
        """Get project details for monitoring"""
        return {
            "project_id": self.project_id,
            "type": self.type,
            "status": self.status,
            "created_at": self.created_at,
            "last_activity": self.last_activity,
            "uptime": time.time() - self.created_at,
            "active_terminals": list(self.active_terminals),
            "terminal_count": len(self.active_terminals),
            "project_dir": self.file_manager.project_dir if self.file_manager else DEFAULT_PROJECT_DIR
        }
        
    def handlers(self, connection):
        """Create event handlers for socket connections"""
        
        # Define all the handler functions
        async def handle_heartbeat(_):
            self.update_activity()
            return {"success": True, "timestamp": time.time()}
            
        async def handle_get_file(args):
            self.update_activity()
            file_path = args.get('path')
            if not file_path:
                return {"error": "File path is required"}
                
            if self.file_manager:
                try:
                    file_data = await self.file_manager.get_file(file_path)
                    return {"success": True, "file": file_data}
                except Exception as e:
                    logger.error(f"Error getting file {file_path}: {str(e)}")
                    return {"error": f"Failed to get file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_get_folder(args):
            self.update_activity()
            folder_path = args.get('path')
            if not folder_path:
                return {"error": "Folder path is required"}
                
            if self.file_manager:
                try:
                    folder_data = await self.file_manager.get_folder(folder_path)
                    return {"success": True, "folder": folder_data}
                except Exception as e:
                    logger.error(f"Error getting folder {folder_path}: {str(e)}")
                    return {"error": f"Failed to get folder: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_save_file(args):
            self.update_activity()
            file_path = args.get('path')
            content = args.get('content')
            
            if not file_path:
                return {"error": "File path is required"}
                
            if self.file_manager:
                try:
                    await self.file_manager.save_file(file_path, content)
                    return {"success": True, "path": file_path}
                except Exception as e:
                    logger.error(f"Error saving file {file_path}: {str(e)}")
                    return {"error": f"Failed to save file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_create_file(args):
            self.update_activity()
            parent_path = args.get('parentPath')
            name = args.get('name')
            
            if not parent_path or not name:
                return {"error": "Parent path and file name are required"}
                
            if self.file_manager:
                try:
                    result = await self.file_manager.create_file(parent_path, name)
                    return {"success": True, "file": result}
                except Exception as e:
                    logger.error(f"Error creating file {name} in {parent_path}: {str(e)}")
                    return {"error": f"Failed to create file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_create_folder(args):
            self.update_activity()
            parent_path = args.get('parentPath')
            name = args.get('name')
            
            if not parent_path or not name:
                return {"error": "Parent path and folder name are required"}
                
            if self.file_manager:
                try:
                    result = await self.file_manager.create_folder(parent_path, name)
                    return {"success": True, "folder": result}
                except Exception as e:
                    logger.error(f"Error creating folder {name} in {parent_path}: {str(e)}")
                    return {"error": f"Failed to create folder: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_rename_file(args):
            self.update_activity()
            path = args.get('path')
            new_name = args.get('newName')
            
            if not path or not new_name:
                return {"error": "File path and new name are required"}
                
            if self.file_manager:
                try:
                    result = await self.file_manager.rename_file(path, new_name)
                    return {"success": True, "file": result}
                except Exception as e:
                    logger.error(f"Error renaming file {path} to {new_name}: {str(e)}")
                    return {"error": f"Failed to rename file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_delete_file(args):
            self.update_activity()
            path = args.get('path')
            
            if not path:
                return {"error": "File path is required"}
                
            if self.file_manager:
                try:
                    await self.file_manager.delete_file(path)
                    return {"success": True, "path": path}
                except Exception as e:
                    logger.error(f"Error deleting file {path}: {str(e)}")
                    return {"error": f"Failed to delete file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_delete_folder(args):
            self.update_activity()
            path = args.get('path')
            
            if not path:
                return {"error": "Folder path is required"}
                
            if self.file_manager:
                try:
                    await self.file_manager.delete_folder(path)
                    return {"success": True, "path": path}
                except Exception as e:
                    logger.error(f"Error deleting folder {path}: {str(e)}")
                    return {"error": f"Failed to delete folder: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_create_terminal(args):
            self.update_activity()
            terminal_id = args.get('id')
            
            # Check if we've hit the terminal limit
            if len(self.active_terminals) >= MAX_TERMINALS:
                return {"error": f"Maximum number of terminals ({MAX_TERMINALS}) reached"}
                
            # Generate a terminal ID if not provided
            if not terminal_id:
                terminal_id = f"term_{int(time.time())}_{len(self.active_terminals)}"
                
            async def on_data(response_string):
                # Emit terminal response through socket
                await connection['socket'].emit('terminalResponse', {
                    'id': terminal_id,
                    'data': response_string
                })
                
                # Check for port numbers in the response
                port = extract_port_number(response_string)
                if port and self.sandbox:
                    try:
                        host = await self.sandbox.process.get_hostname(port)
                        if host:
                            await connection['socket'].emit('previewURL', {
                                'id': terminal_id,
                                'url': f"https://{host}"
                            })
                    except Exception as e:
                        logger.error(f"Error getting hostname for port {port}: {str(e)}")
                    
            async def _create_terminal():
                if self.terminal_manager:
                    try:
                        # Get the current directory from file_manager or use default
                        default_dir = self.file_manager.project_dir if self.file_manager else DEFAULT_PROJECT_DIR
                        
                        # Create the terminal
                        await self.terminal_manager.create_terminal(
                            id=terminal_id, 
                            on_data=on_data,
                            default_directory=default_dir
                        )
                        
                        # Add to active terminals
                        self.active_terminals.add(terminal_id)
                        return {"success": True, "id": terminal_id}
                    except Exception as e:
                        logger.error(f"Error creating terminal {terminal_id}: {str(e)}")
                        return {"error": f"Failed to create terminal: {str(e)}"}
                return {"error": "Terminal manager not initialized"}
                    
            return await lock_manager.acquire_lock(f"{self.project_id}_terminal_{terminal_id}", _create_terminal)
            
        async def handle_resize_terminal(args):
            self.update_activity()
            terminal_id = args.get('id')
            dimensions = args.get('dimensions', {})
            
            if not terminal_id:
                return {"error": "Terminal ID is required"}
                
            if terminal_id not in self.active_terminals:
                return {"error": f"Terminal {terminal_id} not found"}
                
            if self.terminal_manager:
                try:
                    await self.terminal_manager.resize_terminal(terminal_id, dimensions)
                    return {"success": True, "id": terminal_id}
                except Exception as e:
                    logger.error(f"Error resizing terminal {terminal_id}: {str(e)}")
                    return {"error": f"Failed to resize terminal: {str(e)}"}
            return {"error": "Terminal manager not initialized"}
                
        async def handle_terminal_data(args):
            self.update_activity()
            terminal_id = args.get('id')
            data = args.get('data')
            
            if not terminal_id or data is None:
                return {"error": "Terminal ID and data are required"}
                
            if terminal_id not in self.active_terminals:
                return {"error": f"Terminal {terminal_id} not found"}
                
            if self.terminal_manager:
                try:
                    await self.terminal_manager.send_terminal_data(terminal_id, data)
                    return {"success": True, "id": terminal_id}
                except Exception as e:
                    logger.error(f"Error sending data to terminal {terminal_id}: {str(e)}")
                    return {"error": f"Failed to send terminal data: {str(e)}"}
            return {"error": "Terminal manager not initialized"}
                
        async def handle_close_terminal(args):
            self.update_activity()
            terminal_id = args.get('id')
            
            if not terminal_id:
                return {"error": "Terminal ID is required"}
                
            if terminal_id not in self.active_terminals:
                return {"error": f"Terminal {terminal_id} not found or already closed"}
                
            if self.terminal_manager:
                try:
                    await self.terminal_manager.close_terminal(terminal_id)
                    self.active_terminals.remove(terminal_id)
                    return {"success": True, "id": terminal_id}
                except Exception as e:
                    logger.error(f"Error closing terminal {terminal_id}: {str(e)}")
                    return {"error": f"Failed to close terminal: {str(e)}"}
            return {"error": "Terminal manager not initialized"}
                
        async def handle_move_file(args):
            self.update_activity()
            source_path = args.get('sourcePath')
            target_path = args.get('targetPath')
            
            if not source_path or not target_path:
                return {"error": "Source and target paths are required"}
                
            if self.file_manager:
                try:
                    await self.file_manager.move_file(source_path, target_path)
                    return {"success": True, "sourcePath": source_path, "targetPath": target_path}
                except Exception as e:
                    logger.error(f"Error moving file from {source_path} to {target_path}: {str(e)}")
                    return {"error": f"Failed to move file: {str(e)}"}
            return {"error": "File manager not initialized"}
            
        async def handle_run_command(args):
            self.update_activity()
            command = args.get('command')
            terminal_id = args.get('terminalId')
            cwd = args.get('cwd')
            
            if not command:
                return {"error": "Command is required"}
                
            # Use existing terminal or create a new one
            if not terminal_id or terminal_id not in self.active_terminals:
                try:
                    # Create a new terminal
                    result = await handle_create_terminal({"id": terminal_id})
                    if "error" in result:
                        return result
                    terminal_id = result["id"]
                except Exception as e:
                    logger.error(f"Error creating terminal for command: {str(e)}")
                    return {"error": f"Failed to create terminal: {str(e)}"}
            
            # Change directory if specified
            if cwd and self.terminal_manager:
                try:
                    await self.terminal_manager.send_terminal_data(terminal_id, f"cd {cwd}\r")
                    # Give it a moment to change directory
                    await asyncio.sleep(0.1)
                except Exception as e:
                    logger.error(f"Error changing directory: {str(e)}")
            
            # Run the command
            try:
                await self.terminal_manager.send_terminal_data(terminal_id, f"{command}\r")
                return {"success": True, "id": terminal_id, "command": command}
            except Exception as e:
                logger.error(f"Error running command {command}: {str(e)}")
                return {"error": f"Failed to run command: {str(e)}"}
            
        async def handle_stop_command(args):
            self.update_activity()
            terminal_id = args.get('terminalId')
            
            if not terminal_id or terminal_id not in self.active_terminals:
                return {"error": "Valid terminal ID is required"}
                
            # Send Ctrl+C to the terminal
            try:
                await self.terminal_manager.send_terminal_data(terminal_id, "\x03")
                return {"success": True, "id": terminal_id}
            except Exception as e:
                logger.error(f"Error stopping command in terminal {terminal_id}: {str(e)}")
                return {"error": f"Failed to stop command: {str(e)}"}
                
        async def handle_get_project_status(_):
            self.update_activity()
            return {"success": True, "status": self.get_project_details()}
            
        # Create a dictionary of all handlers
        return {
            'heartbeat': handle_heartbeat,
            'getFile': handle_get_file,
            'getFolder': handle_get_folder,
            'saveFile': handle_save_file,
            'createFile': handle_create_file,
            'createFolder': handle_create_folder,
            'renameFile': handle_rename_file,
            'deleteFile': handle_delete_file,
            'deleteFolder': handle_delete_folder,
            'createTerminal': handle_create_terminal,
            'resizeTerminal': handle_resize_terminal,
            'terminalData': handle_terminal_data,
            'closeTerminal': handle_close_terminal,
            'moveFile': handle_move_file,
            'runCommand': handle_run_command,
            'stopCommand': handle_stop_command,
            'getProjectStatus': handle_get_project_status,
        }