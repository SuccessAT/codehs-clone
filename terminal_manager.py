from typing import Dict, Callable, Optional, Any
import uuid
import asyncio
from working_terminal import Terminal
from e2b import AsyncSandbox

class TerminalManager:
    """Manages multiple terminal sessions within a sandbox container"""
    
    def __init__(self):
        self.terminals: Dict[str, Terminal] = {}
        self.sandbox = None
        self.keep_alive_tasks: Dict[str, asyncio.Task] = {}
        
    async def initialize_sandbox(self, template: str = "base", 
                                api_key: str = "e2b_25759fe29f1d0ab6ecb00f615f0dec122c70b6fa"):
        """Initialize the shared sandbox instance"""
        if not self.sandbox:
            self.sandbox = await AsyncSandbox.create(
                template=template,
                api_key=api_key,
                timeout=1800

            )
        return self.sandbox
    
    async def _keep_alive(self, id: str, terminal: Terminal):
        """Keep the terminal alive by sending a null byte periodically"""
        try:
            while id in self.terminals:
                await asyncio.sleep(20)  # Send keep-alive every 20 seconds
                try:
                    await terminal.send_data('\0')  # harmless null byte
                except Exception:
                    break  # terminal already closed
        except asyncio.CancelledError:
            # Task was cancelled, clean up
            pass
        except Exception as e:
            print(f"Keep-alive task error for terminal {id}: {e}")
        
    async def create_terminal(self, id: str = None, on_data: Optional[Callable[[str], Any]] = None, 
                            default_directory: str = "home/user/project", 
                            default_commands: list = None) -> str:
        """
        Create a new terminal session with the given ID or generate a new UUID
        
        Args:
            id: Optional terminal ID, a new UUID is generated if None
            on_data: Callback for data received from the terminal
            default_directory: Default directory to start in
            default_commands: List of commands to execute on startup
        """
        # Generate a UUID if no ID is provided
        if id is None:
            id = str(uuid.uuid4())
        
        # Set default commands if none provided
        if default_commands is None:
            default_commands = [
                f'cd "{default_directory}"',
                'export PS1=\'user> \'',
                f"sudo chown -R user \"{default_directory}\"\r",
                'sudo apt update && sudo apt install -y default-jdk && clear\r',
            ]
        
        # Create the shared sandbox if it doesn't exist
        if not self.sandbox:
            await self.initialize_sandbox()
        
        # Create a new terminal instance using our shared sandbox
        terminal = Terminal(existing_sandbox=self.sandbox)
        
        # Initialize the terminal with dimensions
        await terminal.init(on_data=on_data)
        
        # Store the terminal in our dictionary
        self.terminals[id] = terminal
        
        # Start keep-alive task for this terminal
        self.keep_alive_tasks[id] = asyncio.create_task(self._keep_alive(id, terminal))
        
        # Send the default commands
        for command in default_commands:
            await terminal.send_data(command + "\r")

        return id
    
    async def resize_terminal(self, id: str, dimensions: Dict[str, int]) -> None:
        """Resize a specific terminal to the given dimensions"""
        if id not in self.terminals:
            raise ValueError(f"Terminal with ID {id} does not exist")
            
        await self.terminals[id].resize(dimensions)
    
    async def send_terminal_data(self, id: str, data: str) -> None:
        """Send data to a specific terminal"""
        if id not in self.terminals:
            raise ValueError(f"Terminal with ID {id} does not exist")
            
        await self.terminals[id].send_data(data)

    async def close_terminal(self, id: str) -> None:
        """Close a specific terminal"""
        if id not in self.terminals:
            raise ValueError(f"Terminal with ID {id} does not exist")
        
        # Cancel the keep-alive task if it exists
        if id in self.keep_alive_tasks:
            self.keep_alive_tasks[id].cancel()
            del self.keep_alive_tasks[id]
            
        await self.terminals[id].close()
        del self.terminals[id]
    
    async def close_all_terminals(self) -> None:
        """Close all terminal sessions"""
        terminal_ids = list(self.terminals.keys())
        
        for terminal_id in terminal_ids:
            await self.close_terminal(terminal_id)
            
        # Close the sandbox after all terminals are closed
        if self.sandbox:
            try:
                await self.sandbox.kill()
            except Exception as e:
                print(f"Error closing sandbox: {e}")
            self.sandbox = None

    def get_terminal_output(self, id: str, clean: bool = True) -> list:
        """Get the accumulated output from a specific terminal"""
        if id not in self.terminals:
            raise ValueError(f"Terminal with ID {id} does not exist")
            
        terminal = self.terminals[id]
        
        if clean:
            return terminal.clean_output_buffer
        else:
            return terminal.output_buffer
            
    def get_terminal_ids(self) -> list:
        """Get a list of all active terminal IDs"""
        return list(self.terminals.keys())
        
    def get_terminal_count(self) -> int:
        """Get the number of active terminals"""
        return len(self.terminals)
    
    def get_sandbox(self):
        """Get the shared sandbox instance"""
        return self.sandbox