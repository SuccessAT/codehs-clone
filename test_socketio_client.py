import asyncio
import logging
import sys
import os
import json
from typing import Dict, Any, Optional, List, Callable
import uuid
import argparse

import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("test_client")

class TestClient:
    """Test client for the project server"""
    
    def __init__(self, server_url: str = "http://localhost:8000"):
        self.server_url = server_url
        self.sid = None
        self.project_id = None
        self.active_terminals = set()
        self.sio = socketio.AsyncClient()
        self.file_tree = []
        self.event_handlers = {}
        
        # Register Socket.IO event handlers
        self.register_socketio_handlers()
        
    def register_socketio_handlers(self):
        """Register Socket.IO event handlers"""
        
        @self.sio.event
        async def connect():
            logger.info(f"Connected to server: {self.server_url}")
            
        @self.sio.event
        async def disconnect():
            logger.info("Disconnected from server")
            self.sid = None
            self.project_id = None
            
        @self.sio.event
        async def connection_established(data):
            self.sid = data.get('sid')
            logger.info(f"Connection established with SID: {self.sid}")
            
            # Call on_connect handlers
            await self._call_event_handlers('connect')
            
        @self.sio.event
        async def project_initializing(data):
            project_id = data.get('project_id')
            logger.info(f"Project {project_id} initializing...")
            
            await self._call_event_handlers('project_initializing', data)
            
        @self.sio.event
        async def project_ready(data):
            project_id = data.get('project_id')
            details = data.get('details', {})
            self.project_id = project_id
            logger.info(f"Project {project_id} is ready")
            logger.info(f"Project details: {json.dumps(details, indent=2)}")
            
            await self._call_event_handlers('project_ready', data)
            
        @self.sio.event
        async def project_error(data):
            project_id = data.get('project_id')
            error = data.get('error')
            logger.error(f"Project {project_id} error: {error}")
            
            await self._call_event_handlers('project_error', data)
            
        @self.sio.event
        async def project_left(data):
            project_id = data.get('project_id')
            logger.info(f"Left project {project_id}")
            
            if project_id == self.project_id:
                self.project_id = None
                
            await self._call_event_handlers('project_left', data)
            
        @self.sio.event
        async def command_result(data):
            command = data.get('command')
            args = data.get('args', {})
            result = data.get('result', {})
            
            if result.get('error'):
                logger.error(f"Command {command} error: {result['error']}")
            else:
                logger.info(f"Command {command} success: {json.dumps(result, indent=2)}")
                
            await self._call_event_handlers('command_result', data)
            
            # Handle specific command results
            if command == 'createTerminal' and result.get('success'):
                terminal_id = result.get('id')
                if terminal_id:
                    self.active_terminals.add(terminal_id)
                    
            elif command == 'closeTerminal' and result.get('success'):
                terminal_id = result.get('id')
                if terminal_id and terminal_id in self.active_terminals:
                    self.active_terminals.remove(terminal_id)
                    
        @self.sio.event
        async def terminalResponse(data):
            terminal_id = data.get('id')
            terminal_data = data.get('data', '')
            
            # Avoid printing binary data or control sequences for clarity
            printable_data = ''.join(c if c.isprintable() or c in '\r\n\t' else f'\\x{ord(c):02x}' 
                                  for c in terminal_data)
            
            logger.info(f"Terminal {terminal_id} output: {printable_data}")
            
            await self._call_event_handlers('terminal_response', data)
            
        @self.sio.event
        async def previewURL(data):
            url = data.get('url')
            terminal_id = data.get('id')
            logger.info(f"Preview URL for terminal {terminal_id}: {url}")
            
            await self._call_event_handlers('preview_url', data)
            
        @self.sio.event
        async def files_changed(data):
            project_id = data.get('project_id')
            files = data.get('files', [])
            logger.info(f"Files changed in project {project_id}")
            self.file_tree = files
            
            # Print file tree
            self._print_file_tree(files)
            
            await self._call_event_handlers('files_changed', data)
            
        @self.sio.event
        async def error(data):
            message = data.get('message')
            command = data.get('command', 'unknown')
            logger.error(f"Error in command {command}: {message}")
            
            await self._call_event_handlers('error', data)
            
    def _print_file_tree(self, files, indent=0):
        """Print file tree structure"""
        for file in files:
            file_type = 'dir' if file.get('type') == 'folder' else 'file'
            print(" " * indent + f"- {file.get('name')} ({file_type})")
            
            if file.get('type') == 'folder' and 'children' in file:
                self._print_file_tree(file.get('children', []), indent + 2)
                
    async def _call_event_handlers(self, event, data=None):
        """Call registered event handlers"""
        handlers = self.event_handlers.get(event, [])
        for handler in handlers:
            try:
                if data is not None:
                    await handler(data)
                else:
                    await handler()
            except Exception as e:
                logger.error(f"Error in event handler for {event}: {str(e)}")
                
    def on(self, event, handler):
        """Register an event handler"""
        if event not in self.event_handlers:
            self.event_handlers[event] = []
            
        self.event_handlers[event].append(handler)
        
    async def connect(self):
        """Connect to the server"""
        try:
            await self.sio.connect(self.server_url, wait_timeout=10)
            return True
        except Exception as e:
            logger.error(f"Connection error: {str(e)}")
            return False
            
    async def disconnect(self):
        """Disconnect from the server"""
        await self.sio.disconnect()
        
    async def create_project(self, project_type: str = "base", project_id: str = None,
                            api_key: str = None):
        """Create a new project"""
        if not project_id:
            project_id = str(uuid.uuid4())
            
        data = {
            "type": project_type,
            "id": project_id
        }
        
        if api_key:
            data["api_key"] = api_key
            
        await self.sio.emit('create_project', data)
        return project_id
        
    async def join_project(self, project_id: str):
        """Join an existing project"""
        await self.sio.emit('join_project', {
            "project_id": project_id
        })
        
    async def leave_project(self):
        """Leave the current project"""
        if not self.project_id:
            logger.warning("No active project to leave")
            return
            
        await self.sio.emit('leave_project', {
            "project_id": self.project_id
        })
        
    async def send_command(self, command: str, args: Dict[str, Any] = None):
        """Send a command to the server"""
        if not args:
            args = {}
            
        if not self.project_id:
            logger.warning("No active project for command")
            return None
            
        await self.sio.emit('project_command', {
            "command": command,
            "args": args
        })
        
    async def create_terminal(self, terminal_id: str = None):
        """Create a new terminal"""
        args = {}
        if terminal_id:
            args["id"] = terminal_id
            
        await self.send_command("createTerminal", args)
        
    async def close_terminal(self, terminal_id: str):
        """Close a terminal"""
        await self.send_command("closeTerminal", {
            "id": terminal_id
        })
        
    async def send_terminal_data(self, terminal_id: str, data: str):
        """Send data to a terminal"""
        await self.send_command("terminalData", {
            "id": terminal_id,
            "data": data
        })
        
    async def run_command(self, command: str, terminal_id: str = None, cwd: str = None):
        """Run a command in a terminal"""
        args = {
            "command": command
        }
        
        if terminal_id:
            args["terminalId"] = terminal_id
            
        if cwd:
            args["cwd"] = cwd
            
        await self.send_command("runCommand", args)
        
    async def stop_command(self, terminal_id: str):
        """Stop a running command"""
        await self.send_command("stopCommand", {
            "terminalId": terminal_id
        })
        
    async def get_file(self, path: str):
        """Get a file from the project"""
        await self.send_command("getFile", {
            "path": path
        })
        
    async def get_folder(self, path: str):
        """Get a folder from the project"""
        await self.send_command("getFolder", {
            "path": path
        })

    async def save_file(self, path: str, content: str):
        """Save a file to the project"""
        await self.send_command("saveFile", {
            "path": path,
            "content": content
        })
        
    async def create_file(self, parent_path: str, name: str):
        """Create a new file"""
        await self.send_command("createFile", {
            "parentPath": parent_path,
            "name": name
        })
        
    async def create_folder(self, parent_path: str, name: str):
        """Create a new folder"""
        await self.send_command("createFolder", {
            "parentPath": parent_path,
            "name": name
        })
        
    async def rename_file(self, path: str, new_name: str):
        """Rename a file"""
        await self.send_command("renameFile", {
            "path": path,
            "newName": new_name
        })
        
    async def delete_file(self, path: str):
        """Delete a file"""
        await self.send_command("deleteFile", {
            "path": path
        })
        
    async def delete_folder(self, path: str):
        """Delete a folder"""
        await self.send_command("deleteFolder", {
            "path": path
        })
        
    async def move_file(self, source_path: str, target_path: str):
        """Move a file"""
        await self.send_command("moveFile", {
            "sourcePath": source_path,
            "targetPath": target_path
        })
        
    async def get_project_status(self):
        """Get project status"""
        await self.send_command("getProjectStatus")
        
    async def resize_terminal(self, terminal_id: str, rows: int = 24, cols: int = 80):
        """Resize a terminal"""
        await self.send_command("resizeTerminal", {
            "id": terminal_id,
            "dimensions": {
                "rows": rows,
                "cols": cols
            }
        })
        
    async def wait_for_event(self, event: str, timeout: float = 10.0, condition: Callable = None):
        """Wait for a specific event with optional condition check"""
        event_future = asyncio.Future()
        
        async def handler(data=None):
            if condition is None or (data is not None and condition(data)):
                event_future.set_result(data)
                
        self.on(event, handler)
        
        try:
            return await asyncio.wait_for(event_future, timeout)
        except asyncio.TimeoutError:
            logger.warning(f"Timeout waiting for event: {event}")
            return None
        finally:
            # Remove the handler
            if event in self.event_handlers and handler in self.event_handlers[event]:
                self.event_handlers[event].remove(handler)


async def run_simple_test(server_url: str, project_type: str = "base"):
    """Run a simple test sequence"""
    client = TestClient(server_url=server_url)
    
    try:
        # Connect to server
        connected = await client.connect()
        if not connected:
            logger.error("Failed to connect to server")
            return False
            
        # Create a project
        project_id = await client.create_project(project_type=project_type)
        logger.info(f"Created project: {project_id}")
        
        # Wait for project to be ready
        project_data = await client.wait_for_event('project_ready')
        if not project_data:
            logger.error("Project initialization timeout")
            return False
            
        # Create a terminal
        await client.create_terminal("main_terminal")
        
        # Wait for terminal to be created
        terminal_result = await client.wait_for_event(
            'command_result',
            condition=lambda data: data.get('command') == 'createTerminal'
        )
        
        if not terminal_result or not terminal_result.get('result', {}).get('success'):
            logger.error("Failed to create terminal")
            return False
            
        # Create test files
        project_dir = project_data.get('details', {}).get('project_dir', '/home/user/project')
        
        # Create a Python file
        await client.create_file(project_dir, "hello.py")
        await client.save_file(
            f"{project_dir}/hello.py",
            "print('Hello from test client!')\n"
            "name = input('Enter your name: ')\n"
            "print(f'Hello, {name}!')"
        )
        
        # Create a folder
        await client.create_folder(project_dir, "test_folder")
        
        # Create a file in the folder
        await client.create_file(f"{project_dir}/test_folder", "README.md")
        await client.save_file(
            f"{project_dir}/test_folder/README.md",
            "# Test Project\n\nThis is a test project created by the Socket.IO test client."
        )
        
        # Run commands in the terminal
        logger.info("Running ls command...")
        await client.run_command("ls -la", terminal_id="main_terminal")
        await asyncio.sleep(1)
        
        # Run the Python file
        logger.info("Running Python file...")
        await client.run_command(f"python {project_dir}/hello.py", terminal_id="main_terminal")
        await asyncio.sleep(1)
        
        # Send input to the terminal
        logger.info("Sending input to Python script...")
        await client.send_terminal_data("main_terminal", "Test User\r")
        await asyncio.sleep(1)
        
        # Create another terminal for the test folder
        logger.info("Creating another terminal for the test folder...")
        await client.create_terminal("folder_terminal")
        await asyncio.sleep(1)
        
        # Navigate to the test folder in the second terminal
        logger.info("Navigating to test folder...")
        await client.run_command(f"cd {project_dir}/test_folder", terminal_id="folder_terminal")
        await asyncio.sleep(0.5)
        await client.run_command("ls -la", terminal_id="folder_terminal")
        await asyncio.sleep(0.5)
        await client.run_command("cat README.md", terminal_id="folder_terminal")
        await asyncio.sleep(1)
        
        # Rename a file
        logger.info("Renaming file...")
        await client.rename_file(f"{project_dir}/hello.py", "renamed_hello.py")
        await asyncio.sleep(1)
        
        # List files to see the renamed file
        await client.run_command(f"ls -la {project_dir}", terminal_id="main_terminal")
        await asyncio.sleep(1)
        
        # Close terminals
        logger.info("Closing terminals...")
        await client.close_terminal("main_terminal")
        await client.close_terminal("folder_terminal")
        await asyncio.sleep(1)
        
        # Leave project
        logger.info("Leaving project...")
        await client.leave_project()
        await asyncio.sleep(1)
        
        logger.info("Test completed successfully!")
        return True
    except Exception as e:
        logger.error(f"Test failed with error: {str(e)}")
        return False
    finally:
        # Disconnect
        await client.disconnect()


async def run_interactive_session(server_url: str, project_type: str = "base"):
    """Run an interactive session for manual testing"""
    client = TestClient(server_url=server_url)
    
    try:
        # Connect to server
        connected = await client.connect()
        if not connected:
            logger.error("Failed to connect to server")
            return
            
        # Create or join a project
        while True:
            choice = input("Create new project or join existing? (create/join): ").strip().lower()
            
            if choice == "create":
                project_id = await client.create_project(project_type=project_type)
                logger.info(f"Creating project: {project_id}")
                
                # Wait for project to be ready
                project_data = await client.wait_for_event('project_ready')
                if not project_data:
                    logger.error("Project initialization timeout")
                    continue
                    
                break
            elif choice == "join":
                project_id = input("Enter project ID to join: ").strip()
                await client.join_project(project_id)
                
                # Wait for project to be ready
                project_data = await client.wait_for_event('project_ready')
                if not project_data:
                    logger.error("Project join timeout")
                    continue
                    
                break
            else:
                print("Invalid choice. Please enter 'create' or 'join'.")
                
        # Create a terminal
        terminal_id = "terminal_" + str(int(asyncio.get_event_loop().time()))
        await client.create_terminal(terminal_id)
        
        # Interactive command loop
        print("\nEnter commands: ('help' for list of commands, 'exit' to quit)")
        
        while True:
            cmd = input("> ")
            cmd_parts = cmd.split()
            
            if not cmd_parts:
                continue
                
            action = cmd_parts[0].lower()
            
            if action == "exit":
                break
                
            elif action == "help":
                print("""
                Available commands:
                - term <terminal_id>           : Create a new terminal
                - close <terminal_id>          : Close a terminal
                - run <terminal_id> <command> : Run a command in terminal
                - send <terminal_id> <text>    : Send text to terminal
                - stop <terminal_id>           : Send Ctrl+C to terminal
                - file <path> <content>        : Create or update a file
                - mkdir <path>                 : Create a directory
                - ls <path>                    : List contents of a directory
                - cat <path>                   : Show file contents
                - rename <path> <new_name>     : Rename file or directory
                - rm <path>                    : Delete file or directory
                - status                       : Get project status
                - help                         : Show this help
                - exit                         : Exit program
                """)
                
            elif action == "term":
                if len(cmd_parts) > 1:
                    term_id = cmd_parts[1]
                else:
                    term_id = "terminal_" + str(int(asyncio.get_event_loop().time()))
                    
                await client.create_terminal(term_id)
                
            elif action == "close":
                if len(cmd_parts) < 2:
                    print("Error: Missing terminal ID")
                    continue
                    
                await client.close_terminal(cmd_parts[1])
                
            elif action == "run":
                if len(cmd_parts) < 3:
                    print("Error: Missing terminal ID or command")
                    continue
                    
                term_id = cmd_parts[1]
                command = " ".join(cmd_parts[2:])
                await client.run_command(command, terminal_id=term_id)
                
            elif action == "send":
                if len(cmd_parts) < 3:
                    print("Error: Missing terminal ID or text")
                    continue
                    
                term_id = cmd_parts[1]
                text = " ".join(cmd_parts[2:])
                await client.send_terminal_data(term_id, text + "\r")
                
            elif action == "stop":
                if len(cmd_parts) < 2:
                    print("Error: Missing terminal ID")
                    continue
                    
                await client.stop_command(cmd_parts[1])
                
            elif action == "file":
                if len(cmd_parts) < 2:
                    print("Error: Missing file path")
                    continue
                    
                file_path = cmd_parts[1]
                content = " ".join(cmd_parts[2:]) if len(cmd_parts) > 2 else ""
                
                # Extract parent path and filename
                path_parts = file_path.rsplit("/", 1)
                if len(path_parts) == 1:
                    parent_path = "."
                    file_name = path_parts[0]
                else:
                    parent_path, file_name = path_parts
                    
                # Create or get parent directory
                await client.get_folder(parent_path)
                
                # Create file if it doesn't exist
                await client.create_file(parent_path, file_name)
                
                # Save content
                if content:
                    await client.save_file(file_path, content)
                    
            elif action == "mkdir":
                if len(cmd_parts) < 2:
                    print("Error: Missing directory path")
                    continue
                    
                path = cmd_parts[1]
                
                # Extract parent path and directory name
                path_parts = path.rsplit("/", 1)
                if len(path_parts) == 1:
                    parent_path = "."
                    dir_name = path_parts[0]
                else:
                    parent_path, dir_name = path_parts
                    
                await client.create_folder(parent_path, dir_name)
                
            elif action == "ls":
                path = cmd_parts[1] if len(cmd_parts) > 1 else "."
                await client.get_folder(path)
                
            elif action == "cat":
                if len(cmd_parts) < 2:
                    print("Error: Missing file path")
                    continue
                    
                await client.get_file(cmd_parts[1])
                
            elif action == "rename":
                if len(cmd_parts) < 3:
                    print("Error: Missing path or new name")
                    continue
                    
                await client.rename_file(cmd_parts[1], cmd_parts[2])
                
            elif action == "rm":
                if len(cmd_parts) < 2:
                    print("Error: Missing path")
                    continue
                    
                # Check if it's a file or folder
                path = cmd_parts[1]
                file_data = await client.get_file(path)
                
                # Delete accordingly
                if file_data:
                    await client.delete_file(path)
                else:
                    await client.delete_folder(path)
                    
            elif action == "status":
                await client.get_project_status()
                
            else:
                print(f"Unknown command: {action}. Type 'help' for available commands.")
                
            # Small delay to allow events to process
            await asyncio.sleep(0.2)
            
    except KeyboardInterrupt:
        print("\nInteractive session terminated.")
    except Exception as e:
        logger.error(f"Error in interactive session: {str(e)}")
    finally:
        # Disconnect
        await client.disconnect()


async def main():
    parser = argparse.ArgumentParser(description="Socket.IO Test Client for Project Server")
    parser.add_argument('--server', '-s', default='http://localhost:8000', 
                      help='Server URL (default: http://localhost:8000)')
    parser.add_argument('--mode', '-m', choices=['test', 'interactive'], default='interactive',
                      help='Run mode: test or interactive (default: interactive)')
    parser.add_argument('--project-type', '-t', default='base',
                      help='Project template type (default: base)')
    
    args = parser.parse_args()
    
    if args.mode == 'test':
        logger.info("Running automated test sequence...")
        success = await run_simple_test(args.server, args.project_type)
        sys.exit(0 if success else 1)
    else:
        logger.info("Starting interactive session...")
        await run_interactive_session(args.server, args.project_type)


if __name__ == "__main__":
    asyncio.run(main())