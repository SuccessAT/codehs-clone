import asyncio
import uuid
import signal
import sys
from terminal_manager import TerminalManager

# For clean exit handling
stop_event = asyncio.Event()

def handle_signal(sig, frame):
    print(f"\nReceived signal {sig}, shutting down...")
    stop_event.set()

async def run_terminal_tests():
    # Create a terminal manager
    manager = TerminalManager()
    
    try:
        # Output handler to print terminal output with ID prefix
        def create_output_handler(terminal_id):
            def handle_output(data):
                print(f"[Terminal {terminal_id}]: {data}", end="")
            return handle_output
        
        # Create two terminals with different IDs
        terminal1_id = await manager.create_terminal(
            id="main-terminal", 
            on_data=create_output_handler("main-terminal")
        )
        print(f"Created terminal with ID: {terminal1_id}")
        
        # Create another terminal with auto-generated UUID
        terminal2_id = await manager.create_terminal(
            on_data=create_output_handler("auto-id")
        )
        print(f"Created terminal with auto ID: {terminal2_id}")
        
        # Send commands to the first terminal
        print("\n--- First terminal commands ---")
        await manager.send_terminal_data(terminal1_id, "echo 'Hello from main terminal'\r")
        await asyncio.sleep(1)
        await manager.send_terminal_data(terminal1_id, "pwd\r")
        await asyncio.sleep(1)
        
        # Send commands to the second terminal
        print("\n--- Second terminal commands ---")
        await manager.send_terminal_data(terminal2_id, "echo 'Hello from UUID terminal'\r")
        await asyncio.sleep(1)
        await manager.send_terminal_data(terminal2_id, "ls -la\r")
        await asyncio.sleep(2)
        
        # Resize the first terminal
        print("\n--- Resizing first terminal ---")
        await manager.resize_terminal(terminal1_id, {"rows": 30, "cols": 100})
        await manager.send_terminal_data(terminal1_id, "stty size\r")
        await asyncio.sleep(1)
        
        # Get and display the output buffer
        print("\n--- Getting output buffer from first terminal ---")
        output = manager.get_terminal_output(terminal1_id)
        print(f"Clean output buffer length: {len(output)}")
        
        # Close the second terminal
        print("\n--- Closing second terminal ---")
        await manager.close_terminal(terminal2_id)
        print(f"Active terminals: {manager.get_terminal_ids()}")
        
        # Create a new terminal with a specific UUID
        custom_uuid = str(uuid.uuid4())
        print(f"\n--- Creating new terminal with custom UUID: {custom_uuid} ---")
        terminal3_id = await manager.create_terminal(
            id=custom_uuid,
            on_data=create_output_handler(custom_uuid[:8])  # Use first 8 chars of UUID for brevity
        )
        await manager.send_terminal_data(terminal3_id, "echo 'Hello from custom UUID terminal'\r")
        await asyncio.sleep(1)
        
        print(f"\nTerminal count: {manager.get_terminal_count()}")
        print(f"Active terminal IDs: {manager.get_terminal_ids()}")
        
    finally:
        # Close all terminals
        print("\nClosing all terminals...")
        await manager.close_all_terminals()
        print("All terminals closed.")

async def main():
    # Set up signal handlers for graceful shutdown
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, handle_signal)
    
    try:
        # Run the terminal tests
        await run_terminal_tests()
    except Exception as e:
        print(f"Error during terminal tests: {e}")
    finally:
        # Make sure all terminals are closed
        print("Test completed.")

if __name__ == "__main__":
    asyncio.run(main())
