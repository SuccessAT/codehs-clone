# Sandbox Environment Documentation

## Overview

This project provides a cloud-based development environment that offers isolated sandboxed containers for code execution. Users can write, edit, and execute code in a secure environment with terminal access and file management capabilities. The system uses WebSockets for real-time communication between clients and the server.

## System Architecture

The system consists of several interconnected components working together to provide a seamless development experience:

1. **E2B Sandbox**: Core execution environment that provides isolated containers
2. **Terminal System**: Terminal emulation within the sandbox
3. **File Management**: File operations within the sandbox
4. **Project Management**: Container lifecycle and session coordination
5. **Socket.IO Server**: Real-time communication layer

### Directory Structure

```
c:\Users\Dami\Documents\python\sandbox\
├── backend\server\src\            # Original TypeScript implementation
│   ├── Project.ts                 # Core project coordination
│   ├── Terminal.ts                # Terminal implementation
│   ├── TerminalManager.ts         # Terminal session management
│   ├── FileManager.ts             # File operations
│   └── ...                        # Other supporting files
└── python_version\                # Python implementation
    ├── project.py                 # Core project coordination
    ├── terminal.py                # Terminal implementation
    ├── terminal_manager.py        # Terminal session management
    ├── file_manager.py            # File operations
    ├── socketio_server.py         # WebSocket communication
    └── __init__.py                # Python package marker
```

## Component Details

### 1. E2B Sandbox

**Purpose**: Provides isolated execution environments where users can run code without affecting the host system.

**Key Features**:

- Container creation and management with lifecycle control (create, pause, resume)
- File system operations (read, write, delete, move)
- Terminal/PTY access with input/output streaming
- Port forwarding for web applications running in the container

**Implementation Details**:

- The Python implementation uses the `e2b` library to interact with sandbox containers
- Containers have configurable timeouts and can be paused to save resources
- Each project gets its own isolated container instance

### 2. Terminal System

#### Terminal Class (`terminal.py`)

**Purpose**: Manages a single pseudo-terminal (PTY) session in the sandbox.

**Key Methods**:

- `__init__(container)`: Initializes with an E2B container
- `init(rows, cols, on_data)`: Sets up the terminal with dimensions and data callback
- `send_data(data)`: Sends input to the terminal
- `resize(size)`: Changes terminal dimensions
- `close()`: Terminates the terminal

**Implementation Details**:

- Uses the E2B container's PTY module for terminal operations
- Handles UTF-8 encoding/decoding of terminal data
- Provides callback mechanism for terminal output

#### Terminal Manager Class (`terminal_manager.py`)

**Purpose**: Manages multiple terminal sessions within a single container.

**Key Methods**:

- `create_terminal(id, on_data)`: Creates a new terminal with default environment
- `resize_terminal(dimensions)`: Resizes all terminals
- `send_terminal_data(id, data)`: Routes data to a specific terminal
- `close_terminal(id)`: Closes a specific terminal
- `close_all_terminals()`: Closes all terminals

**Implementation Details**:

- Maintains a dictionary of terminal instances by ID
- Sets up default environment (working directory, prompt) for new terminals
- Ensures clean termination of all terminals when needed

### 3. File Management System (`file_manager.py`)

**Purpose**: Provides file operations within the sandbox environment.

**Key Methods**:

- `initialize()`: Sets up file watchers and initial state
- `get_file(file_id)`: Retrieves file content and metadata
- `get_folder(folder_id)`: Lists folder contents with metadata
- `save_file(file_id, content)`: Writes content to a file
- `create_file(name)`: Creates a new empty file
- `create_folder(name)`: Creates a new directory
- `rename_file(file_id, new_name)`: Renames a file
- `delete_file(file_id)`: Removes a file
- `delete_folder(folder_id)`: Removes a directory recursively
- `get_file_tree()`: Returns the complete file structure
- `get_files_for_download()`: Creates a base64-encoded tar.gz archive
- `close_watchers()`: Cleans up file watchers

**Implementation Details**:

- Uses the E2B container's filesystem module for file operations
- Implements directory watching for real-time updates
- Maintains a hierarchical file tree representation
- Handles file path conversions between container and client

### 4. Project Management (`project.py`)

**Purpose**: Coordinates container lifecycle, terminal sessions, and file operations.

**Key Methods**:

- `initialize(file_watch_callback)`: Sets up the container, terminal manager, and file manager
- `disconnect()`: Cleans up when a client disconnects
- `create_pause_timer()`: Sets a timer to pause the container
- `handlers(connection)`: Provides event handlers for socket operations

**Implementation Details**:

- Uses a lock manager to ensure exclusive access to resources
- Implements container lifecycle (create, pause, resume)
- Provides a comprehensive set of handlers for all operations
- Manages timeouts and resource cleanup

### 5. Socket.IO Server (`socketio_server.py`)

**Purpose**: Provides real-time bidirectional communication between clients and the server.

**Key Components**:

- Socket.IO server with ASGI interface
- Client connection tracking
- Project session management
- Dynamic event handler registration

**Key Events**:

- `connect`: Handles new client connections
- `disconnect`: Cleans up when clients disconnect
- `join_project`: Associates a client with a project
- Various project-specific events for file and terminal operations

**Implementation Details**:

- Uses `socketio` library for WebSocket communication
- Tracks client connections and their associated projects
- Dynamically registers event handlers for project operations
- Provides error handling and event routing

## Data Flow and Communication

### Connection and Initialization

1. **Client Connects**:

   ```
   Client → Socket.IO Server (connect event)
   ```

2. **Join Project**:
   ```
   Client → Socket.IO Server (join_project event)
   Socket.IO Server → Project (initialize)
   Project → E2B Sandbox (create/resume container)
   Project → Terminal Manager (initialize)
   Project → File Manager (initialize, get file tree)
   Socket.IO Server → Client (joined_project event, initial file tree)
   ```

### File Operations

1. **Get File**:

   ```
   Client → Socket.IO Server (getFile event)
   Socket.IO Server → Project.handlers (handleGetFile)
   Project → File Manager (getFile)
   Socket.IO Server → Client (getFile_response event)
   ```

2. **Save File**:

   ```
   Client → Socket.IO Server (saveFile event)
   Socket.IO Server → Project.handlers (handleSaveFile)
   Project → File Manager (saveFile)
   File Manager → E2B Container (filesystem.write_file)
   Socket.IO Server → Client (saveFile_response event)
   ```

3. **File Change Detection**:
   ```
   E2B Container (file change) → File Manager (watcher)
   File Manager → Project (file_watch_callback)
   Socket.IO Server → All Project Clients (fileChange event)
   ```

### Terminal Operations

1. **Create Terminal**:

   ```
   Client → Socket.IO Server (createTerminal event)
   Socket.IO Server → Project.handlers (handleCreateTerminal)
   Project → Terminal Manager (createTerminal)
   Terminal Manager → Terminal (init)
   Terminal → E2B Container (pty.create)
   Socket.IO Server → Client (createTerminal_response event)
   ```

2. **Terminal Input**:

   ```
   Client → Socket.IO Server (terminalData event)
   Socket.IO Server → Project.handlers (handleTerminalData)
   Project → Terminal Manager (sendTerminalData)
   Terminal Manager → Terminal (sendData)
   Terminal → E2B Container (pty.sendInput)
   ```

3. **Terminal Output**:
   ```
   E2B Container (pty output) → Terminal (onData callback)
   Terminal → Terminal Manager (onData callback)
   Terminal Manager → Project (connection.socket.emit)
   Socket.IO Server → Client (terminalResponse event)
   ```

### Container Lifecycle

1. **Container Creation**:

   ```
   Project (initialize) → E2B Container (create)
   ```

2. **Container Pausing**:

   ```
   Project (timeout) → E2B Container (pause)
   Project → Database (save containerId)
   ```

3. **Container Resuming**:
   ```
   Project (initialize) → Database (get containerId)
   Project → E2B Container (resume)
   ```

## Implementation Notes for Python Version

### Key Dependencies

1. **E2B SDK for Python**:

   ```
   from e2b import Sandbox
   ```

   Primary interface for container operations, file system access, and terminal emulation.

2. **Socket.IO for Python**:

   ```
   import socketio
   ```

   Provides WebSocket server functionality for real-time communication.

3. **Asyncio**:
   ```
   import asyncio
   ```
   Enables asynchronous programming for non-blocking operations.

### Asynchronous Programming

The Python implementation extensively uses `async`/`await` for non-blocking operations:

```python
async def initialize(self, file_watch_callback=None):
    # Asynchronous initialization
    await self.container.filesystem.watch_dir(...)

async def send_data(self, data):
    # Asynchronous terminal I/O
    await self.container.pty.send_input(...)
```

### Error Handling

Comprehensive error handling ensures system stability:

```python
try:
    await self.container.filesystem.write_file(...)
    return True
except Exception as e:
    print(f"Error saving file: {e}")
    return False
```

### Socket.IO Event Handling

Dynamic event handler registration provides flexibility:

```python
for event_name in project_events:
    exec(f"""
@sio.event
async def {event_name}(sid, data):
    # Handler implementation
""")
```

## Common Use Cases

### 1. Code Editing and Execution

Users can:

- Create, edit, and delete files
- Execute code in the terminal
- See real-time updates of file changes across connected clients

### 2. Web Application Development

The system can:

- Detect when a web server starts in the container
- Extract the port number from terminal output
- Create a secure forwarded URL for accessing the web application

### 3. Collaborative Development

Multiple clients can:

- Connect to the same project
- See each other's file changes in real-time
- Share terminal output

### 4. Project Persistence

The system provides:

- Container pausing for efficient resource usage
- Container resumption when users reconnect
- File state preservation between sessions

## Implementation Differences from TypeScript

The Python implementation follows the same architecture but with some language-specific adjustments:

1. **Asyncio Instead of Promises**: Python uses asyncio for asynchronous operations
2. **Class Structure**: Similar class hierarchy with Python idioms
3. **Dynamic Event Registration**: Python uses exec() for dynamic function creation
4. **Error Handling**: Python uses try/except instead of try/catch
5. **Socket.IO API**: Python's socketio library has slightly different API

## Conclusion

This sandbox environment provides a comprehensive, isolated development platform with real-time collaboration features. The architecture separates concerns into clear components:

- **E2B Sandbox**: Isolation and execution
- **Terminal System**: Command execution
- **File Management**: Code editing
- **Project Management**: Lifecycle control
- **Socket.IO Server**: Real-time communication

Together, these components create a powerful development environment that can be used for teaching, collaboration, or secure code execution.
