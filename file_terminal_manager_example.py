import asyncio
import uuid
from typing import Dict, Any
from e2b import AsyncSandbox
from file_manager import FileManager
from terminal_manager import TerminalManager

class SandboxEnvironment:
    """Manages both terminal and file operations in a single sandbox"""
    
    def __init__(self):
        self.sandbox = None
        self.file_manager = None
        self.terminal_manager = None
        
    async def initialize(self):
        """Initialize the sandbox environment with file manager and terminals"""
        try:
            # Initialize terminal manager first
            self.terminal_manager = TerminalManager()
            
            # Create the shared sandbox through terminal manager
            await self.terminal_manager.initialize_sandbox(
                template="base",
                api_key="e2b_25759fe29f1d0ab6ecb00f615f0dec122c70b6fa"
            )
            
            # Get the sandbox instance
            self.sandbox = self.terminal_manager.get_sandbox()
            
            # Initialize file manager with the same sandbox
            self.file_manager = FileManager(self.sandbox, file_watch_callback=self.on_files_changed)
            await self.file_manager.initialize()
            
            # Create an initial terminal
            await self.create_terminal("main")
            
            print("Sandbox environment initialized successfully")
            return True
        except Exception as e:
            print(f"Failed to initialize sandbox environment: {e}")
            return False
        
    def on_files_changed(self, files: list):
        # """Callback when files change in the sandbox"""
        # print("Files changed")
        # self._print_file_tree(files)
        pass
    
    def _print_file_tree(self, files, indent=0):
        """Helper to print file tree structure"""
        for file in files:
            print(" " * indent + f"- {file['name']} ({'dir' if file['type'] == 'folder' else 'file'})")
            if file['type'] == 'folder' and 'children' in file:
                self._print_file_tree(file['children'], indent + 2)
    
    async def create_terminal(self, terminal_id: str = None):
        """Create a new terminal session"""
        if terminal_id is None:
            terminal_id = str(uuid.uuid4())
            
        # Terminal output handler
        def handle_output(data):
            print(f"[Terminal {terminal_id}]: {data}", end="")
            
        # Create terminal using the terminal manager
        terminal_id = await self.terminal_manager.create_terminal(
            id=terminal_id,
            on_data=handle_output,
            default_directory=self.file_manager.project_dir if self.file_manager else "/project"
        )
        
        print(f"Created terminal with ID: {terminal_id}")
        return terminal_id
    
    async def send_to_terminal(self, terminal_id: str, command: str):
        """Send a command to a specific terminal"""
        try:
            await self.terminal_manager.send_terminal_data(terminal_id, command + "\r")
            return True
        except ValueError:
            print(f"Terminal {terminal_id} not found")
            return False
    
    async def create_test_files(self):
        """Create some test files in the sandbox"""
        # Create a Python file
        await self.file_manager.create_file(self.file_manager.project_dir, "hello.py")
        await self.file_manager.save_file(
            f"{self.file_manager.project_dir}/hello.py", 
            "print('Hello from the sandbox!')"
        )
        
        # Create a folder
        await self.file_manager.create_folder(self.file_manager.project_dir, "test_folder")
        
        # Create a file in the folder
        await self.file_manager.create_file(
            f"{self.file_manager.project_dir}/test_folder", 
            "README.md"
        )
        await self.file_manager.save_file(
            f"{self.file_manager.project_dir}/test_folder/README.md",
            "# Test Folder\n\nThis is a test markdown file."
        )
        
        print("Test files created successfully")
    
    async def run_file_in_terminal(self, file_path: str, terminal_id: str = "main"):
        """Run a file in the specified terminal"""
        # Check if the file exists
        file_info = await self.file_manager.get_file(file_path)
        if not file_info:
            print(f"File {file_path} not found")
            return False
        
        # Check the file extension to determine how to run it
        file_name = file_info["name"]
        if file_name.endswith(".py"):
            await self.send_to_terminal(terminal_id, f"python {file_path}")
        elif file_name.endswith(".js"):
            await self.send_to_terminal(terminal_id, f"node {file_path}")
        elif file_name.endswith(".sh"):
            await self.send_to_terminal(terminal_id, f"bash {file_path}")
        else:
            await self.send_to_terminal(terminal_id, f"cat {file_path}")
        
        return True
    
    async def close(self):
        """Close all resources"""
        # Close all terminals and the sandbox
        if self.terminal_manager:
            try:
                await self.terminal_manager.close_all_terminals()
                print("All terminals and sandbox closed")
            except Exception as e:
                print(f"Error closing terminals: {e}")
        
        # Close file manager watchers
        if self.file_manager:
            await self.file_manager.close_watchers()


async def main():
    """Run a demo of the sandbox environment"""
    env = SandboxEnvironment()
    
    try:
        # Initialize the environment
        initialized = await env.initialize()
        if not initialized:
            print("Failed to initialize environment")
            return
        
        # Create some test files
        await env.create_test_files()
        
        # Sleep briefly to allow file watchers to process
        await asyncio.sleep(1)

                
        # List the files in the terminal
        # await env.send_to_terminal("main", f"ls -la /home/user/\r")
        # await env.send_to_terminal("main", "pwd\r")
        # await env.send_to_terminal("main", "../\r")
        # See what's in the parent directory
        await env.send_to_terminal("main", 'ls -la\r')

        # # See what's in the root directory
        # await env.send_to_terminal("main", "ls -la /\r")

        # Print current working directory to understand where you are
        # await env.send_to_terminal("main", "ls -R\r")

        # Navigate up one level and see where you are
        # await env.send_to_terminal("main", "cd project && pwd && ls -la\r")
        await asyncio.sleep(1)
        
        # Run the Python file
        py_file_path = f"{env.file_manager.project_dir}/hello.py"
        await env.run_file_in_terminal(py_file_path)
        await asyncio.sleep(1)

        # Run the README file
        readme_file_path = f"{env.file_manager.project_dir}/test_folder/README.md"
        await env.run_file_in_terminal(readme_file_path)
        await asyncio.sleep(1)
        
        # Create a second terminal and navigate to the test folder
        term2_id = await env.create_terminal("secondary")
        await env.send_to_terminal(term2_id, f"cd {env.file_manager.project_dir}/test_folder")
        await asyncio.sleep(0.5)
        await env.send_to_terminal(term2_id, "ls -la\r")
        await asyncio.sleep(1)
        await env.send_to_terminal(term2_id, "cat README.md")
        await asyncio.sleep(1)
        
        # Demonstrate file operations
        print("\nRenaming a file...")
        await env.file_manager.rename_file(py_file_path, "renamed_hello.py")
        await asyncio.sleep(1)
        
        # Check files in terminal
        await env.send_to_terminal("main", f"ls -la {env.file_manager.project_dir}")
        await asyncio.sleep(1)
        
    finally:
        # Clean up all resources
        await env.close()


if __name__ == "__main__":
    asyncio.run(main())
