# interactivity_environment

This project provides a scalable backend system for managing cloud-based terminal environments. It allows users to create, manage, and interact with remote development environments in the cloud.

## Features

- Create sandboxed development environments
- Multiple terminal sessions per project
- File system operations (create, read, update, delete)
- Real-time terminal interaction
- Project state synchronization across multiple clients
- Support for various programming languages (Python, Java, Node.js, etc.)
- Automatic resource cleanup for idle projects

## Architecture

The system consists of the following components:

1. **Project Manager**: Handles creation and management of sandbox environments
2. **Terminal Manager**: Manages terminal sessions and interaction
3. **File Manager**: Handles file system operations in the sandbox
4. **Socket.IO Server**: Provides real-time communication with clients
5. **Test Client**: For testing and development

## Setup

### Prerequisites

- Python 3.8+
- [e2b SDK](https://github.com/e2b-dev/e2b-sdk)
- Socket.IO

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/cloud-terminal-project.git
   cd cloud-terminal-project
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set up environment variables:
   ```bash
   export E2B_API_KEY=your_api_key_here
   ```

## Usage

### Starting the Server

To start the Socket.IO server:

```bash
python socketio_server.py
```

The server will start listening on port 8000 by default.

### Testing with the Test Client

You can use the test client to interact with the server:

```bash
# Run automated tests
python test_socketio_client.py --mode test

# Run interactive session
python test_socketio_client.py --mode interactive
```

### Quick Project Test

To quickly test the project functionality without the Socket.IO server:

```bash
python main.py
```

## Frontend Integration

The backend provides a Socket.IO API that can be consumed by any frontend application. Below are the key events and commands for integration.

### Socket.IO Events (Server to Client)

| Event                    | Description                                | Payload                                                   |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| `connection_established` | Initial connection established             | `{ sid: string }`                                         |
| `project_initializing`   | Project is being initialized               | `{ project_id: string, status: string }`                  |
| `project_ready`          | Project is ready for use                   | `{ project_id: string, status: string, details: object }` |
| `project_error`          | Error occurred with project                | `{ project_id: string, error: string }`                   |
| `terminalResponse`       | Output from a terminal                     | `{ id: string, data: string }`                            |
| `previewURL`             | URL for previewing apps running in sandbox | `{ id: string, url: string }`                             |
| `files_changed`          | Notification when files change             | `{ project_id: string, files: array }`                    |
| `command_result`         | Result of a command                        | `{ command: string, args: object, result: object }`       |
| `error`                  | General error message                      | `{ message: string, command?: string }`                   |

### Socket.IO Commands (Client to Server)

| Command           | Description              | Payload                                           |
| ----------------- | ------------------------ | ------------------------------------------------- |
| `create_project`  | Create a new project     | `{ type: string, id?: string, api_key?: string }` |
| `join_project`    | Join an existing project | `{ project_id: string }`                          |
| `leave_project`   | Leave current project    | `{ project_id: string }`                          |
| `project_command` | Execute project command  | `{ command: string, args: object }`               |

### Project Commands

These commands are sent via the `project_command` event:

| Command            | Description                | Arguments                                                    |
| ------------------ | -------------------------- | ------------------------------------------------------------ |
| `createTerminal`   | Create a new terminal      | `{ id?: string }`                                            |
| `closeTerminal`    | Close a terminal           | `{ id: string }`                                             |
| `terminalData`     | Send data to terminal      | `{ id: string, data: string }`                               |
| `resizeTerminal`   | Resize terminal dimensions | `{ id: string, dimensions: { rows: number, cols: number } }` |
| `getFile`          | Get file contents          | `{ path: string }`                                           |
| `getFolder`        | Get folder contents        | `{ path: string }`                                           |
| `saveFile`         | Save file contents         | `{ path: string, content: string }`                          |
| `createFile`       | Create a new file          | `{ parentPath: string, name: string }`                       |
| `createFolder`     | Create a new folder        | `{ parentPath: string, name: string }`                       |
| `renameFile`       | Rename a file              | `{ path: string, newName: string }`                          |
| `deleteFile`       | Delete a file              | `{ path: string }`                                           |
| `deleteFolder`     | Delete a folder            | `{ path: string }`                                           |
| `moveFile`         | Move a file                | `{ sourcePath: string, targetPath: string }`                 |
| `runCommand`       | Run command in terminal    | `{ command: string, terminalId?: string, cwd?: string }`     |
| `stopCommand`      | Stop running command       | `{ terminalId: string }`                                     |
| `getProjectStatus` | Get project status         | `{}`                                                         |

## Frontend Implementation Example

Here's a simple example of how to implement the frontend using JavaScript and Socket.IO:

```javascript
import { io } from "socket.io-client";

class CloudTerminalClient {
  constructor(serverUrl = "http://localhost:8000") {
    this.socket = io(serverUrl);
    this.projectId = null;
    this.terminals = new Set();

    // Register event handlers
    this.registerEventHandlers();
  }

  registerEventHandlers() {
    this.socket.on("connection_established", (data) => {
      console.log("Connected to server:", data.sid);
      // Update UI to show connected status
    });

    this.socket.on("project_ready", (data) => {
      this.projectId = data.project_id;
      console.log("Project ready:", data.project_id);
      // Update UI to show project is ready
    });

    this.socket.on("terminalResponse", (data) => {
      console.log(`Terminal ${data.id} output:`, data.data);
      // Update terminal UI with output
    });

    this.socket.on("files_changed", (data) => {
      console.log("Files changed:", data.files);
      // Update file explorer UI
    });

    // Add more event handlers as needed
  }

  createProject(projectType = "base") {
    this.socket.emit("create_project", {
      type: projectType,
      id: "project-" + Date.now(),
    });
  }

  createTerminal(terminalId = null) {
    const payload = terminalId ? { id: terminalId } : {};
    this.socket.emit("project_command", {
      command: "createTerminal",
      args: payload,
    });
  }

  sendTerminalInput(terminalId, input) {
    this.socket.emit("project_command", {
      command: "terminalData",
      args: {
        id: terminalId,
        data: input + "\r",
      },
    });
  }

  // Add more methods for other commands
}

// Usage example
const client = new CloudTerminalClient();
client.createProject();

// Later, after project_ready event:
client.createTerminal("main");

// Send input to terminal
document.getElementById("terminal-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    client.sendTerminalInput("main", e.target.value);
    e.target.value = "";
  }
});
```

## Frontend Components

When implementing the frontend, consider creating these components:

1. **Project Manager**: Controls project lifecycle and overall state
2. **Terminal Component**: Renders and handles interaction with terminals
3. **File Explorer**: Shows and manages files/folders
4. **Code Editor**: Allows editing files with syntax highlighting
5. **Console Output**: Shows command results and notifications

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [e2b](https://github.com/e2b-dev/e2b-sdk) for providing the sandbox environment
- Socket.IO for real-time communication
