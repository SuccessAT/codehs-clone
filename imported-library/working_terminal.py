import asyncio
import signal
import sys
import os
import re
from typing import Callable, Optional, Dict, Any
from e2b import AsyncSandbox
from e2b.sandbox.commands.command_handle import PtySize, PtyOutput

# ANSI escape sequence removal regex
ANSI_ESCAPE_PATTERN = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')


def strip_ansi_codes(text):
    """Remove ANSI escape sequences from text"""
    return ANSI_ESCAPE_PATTERN.sub('', text)

class Terminal:
    def __init__(self, template: str = "base", api_key: str = None, existing_sandbox=None):
        self.sandbox = existing_sandbox
        self.pty_pid = None
        self.command_handle = None
        self.output_buffer = []
        self.output_buffer = []
        self.clean_output_buffer = []
        self.interactive_mode = False
        self.command_output = {}  # Track output for specific commands
        self.current_command = None
        self.last_prompt = ""
        self.template = template
        self.api_key = api_key or os.environ.get("E2B_API_KEY")
        self.owns_sandbox = existing_sandbox is None  # Track if we created the sandbox

    async def init(self, on_data: Optional[Callable[[str], Any]] = None):
        async def handle_output(output: PtyOutput):
            try:
                # Handle bytes directly
                if isinstance(output, bytes):
                    # Decode the raw output
                    decoded_data = output.decode("utf-8")
                    
                    # Store in raw buffer
                    self.output_buffer.append(decoded_data)
                    
                    # Create clean version (strip ANSI codes)
                    clean_data = strip_ansi_codes(decoded_data)
                    self.clean_output_buffer.append(clean_data)
                    
                    # Track command output if we're tracking a command
                    if self.current_command:
                        if self.current_command not in self.command_output:
                            self.command_output[self.current_command] = []
                        self.command_output[self.current_command].append(clean_data)
                    
                    # Check if this output contains a prompt
                    if re.search(r'\$\s*$', clean_data):
                        self.last_prompt = clean_data
                        
                    # Call the clean data callback if provided
                    if on_data:
                        # Check if callback is a coroutine function
                        if asyncio.iscoroutinefunction(on_data):
                            await on_data(clean_data)
                        else:
                            on_data(clean_data)
                else:
                    print(f"Unknown output type: {type(output)}, value: {repr(output)}")
            except Exception as e:
                print(f"Error in output handler: {e}")
        try:
            # Create sandbox instance only if not provided
            if self.sandbox is None:
                print("Creating new sandbox instance...")
                self.sandbox = await AsyncSandbox.create(
                    template=self.template,
                    api_key=self.api_key
                )
            
            # Create PTY and attach output handler
            self.command_handle = await self.sandbox.pty.create(
                size=PtySize(rows=24, cols=80),
                on_data=handle_output,
                # Set a shorter timeout to help with cleanup
                timeout=1800,
            )
            self.pty_pid = self.command_handle.pid
            
        except Exception as e:
            print(f"[INIT ERROR]: {e}")
            raise

    async def send_data(self, data: str):
        if self.pty_pid:
            try:
                await self.sandbox.pty.send_stdin(
                    pid=self.pty_pid,
                    data=data.encode("utf-8")
                )
                
            except Exception as e:
                print(f"[SEND ERROR]: {e}")

    async def resize(self, size: Dict[str, int]):
        if self.pty_pid:
            try:
                await self.sandbox.pty.resize(
                    pid=self.pty_pid,
                    size=PtySize(rows=size.get("rows", 24), cols=size.get("cols", 80))
                )
            except Exception as e:
                print(f"[RESIZE ERROR]: {e}")

    async def close(self):
        try:
            # First try to disconnect the command handle if it exists
            if self.command_handle:
                try:
                    await self.command_handle.disconnect()
                except Exception as e:
                    print(f"[DISCONNECT ERROR]: {e}")
                
            # Then kill the PTY
            if self.pty_pid:
                try:
                    await self.sandbox.pty.kill(pid=self.pty_pid)
                except Exception as e:
                    print(f"[KILL PTY ERROR]: {e}")
            
            # Only kill the sandbox if we created it
            if self.sandbox and self.owns_sandbox:
                try:
                    await self.sandbox.kill()
                except Exception as e:
                    print(f"[KILL SANDBOX ERROR]: {e}")
                
        except Exception as e:
            print(f"[CLOSE ERROR]: {e}")

    # Method to get the sandbox instance
    def get_sandbox(self):
        return self.sandbox


# Helper function to handle graceful shutdown
async def shutdown(terminal, signal=None):
    """Cleanup resources before shutting down."""
    if signal:
        print(f"Received exit signal {signal.name}...")
    
    print("Closing terminal...")
    await terminal.close()
    print("Terminal closed successfully.")


# Example main with better signal handling
async def main():
    terminal = Terminal()
    
    # Setup input handler to print all output
    def print_output(data):
        print(f"TERMINAL OUTPUT: {data}")
    
    try:
        print("Initializing terminal...")
        await terminal.init(on_data=print_output)
        
        print("Sending command: pwd")
        await terminal.send_data('pwd\r')
        await asyncio.sleep(1)
        
        print("Sending command: echo 'Hello World'")
        await terminal.send_data('echo "Hello World"\r')
        await asyncio.sleep(1)
        
        print("Sending command: ls -la")
        await terminal.send_data('ls -la\r')
        await asyncio.sleep(2)
        
        print("Creating and reading a file")
        await terminal.send_data('echo "This is a test file" > test.txt\r')
        await asyncio.sleep(0.5)
        await terminal.send_data('cat test.txt\r')
        await asyncio.sleep(1)
        
        print("Testing terminal resize")
        await terminal.resize({'cols': 100, 'rows': 30})
        await terminal.send_data('echo "Terminal resized"\r')
        await asyncio.sleep(1)
        
        print("Getting terminal size")
        await terminal.send_data('stty size\r')
        await asyncio.sleep(1)
        
        print("Running a background process")
        await terminal.send_data('sleep 3 & echo "Background process started with PID: $!"\r')
        await asyncio.sleep(4)
    finally:
        # Ensure we properly shut down even if there's an exception
        await shutdown(terminal)


# This helps prevent the generator didn't stop after athrow() error
def handle_asyncio_exception(loop, context):
    # Just log the error but don't propagate it
    if "generator didn't stop after athrow()" in str(context.get("exception")):
        print("Handled known asyncio error during shutdown")
    else:
        print(f"Unhandled exception: {context}")


if __name__ == "__main__":
    # Set up custom exception handler
    loop = asyncio.get_event_loop_policy().get_event_loop()
    loop.set_exception_handler(handle_asyncio_exception)
    
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Main exception: {e}")
    finally:
        # Force cleanup of any pending tasks
        pending = asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()