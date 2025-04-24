# Socket.IO Test Client Interactive Guide

This guide walks you through using the Socket.IO test client for interacting with your project server in interactive mode.

## Prerequisites

- Python 3.7+
- `python-socketio` package
- `asyncio` library

## Installation

1. Install the required dependencies:

```bash
pip install python-socketio
```

2. Save the test client script as `test_client.py`.

## Starting the Client

Run the client with the following command:

```bash
python test_client.py --server http://localhost:8000 --mode interactive
```

Options:
- `--server` or `-s`: Server URL (default: http://localhost:8000)
- `--mode` or `-m`: Run mode (`test` or `interactive`) (default: interactive)
- `--project-type` or `-t`: Project template type (default: base)

## Interactive Session Workflow

### 1. Initial Connection

When you start the client, it will connect to the server:

```
INFO - Connected to server: http://localhost:8000
INFO - Connection established with SID: [your-session-id]
```

### 2. Create or Join a Project

You'll be prompted to create a new project or join an existing one:

```
Create new project or join existing? (create/join): 
```

Type `create` to create a new project or `join` to connect to an existing project.

If joining an existing project, you'll need to enter the project ID:

```
Enter project ID to join: [project-id]
```

Wait for the project to initialize:

```
INFO - Project [project-id] initializing...
INFO - Project [project-id] is ready
```

### 3. Available Commands

Once connected, use these commands:

```
> help
```

This will display the list of available commands:

## Command Reference

### Terminal Management

| Command | Description | Example |
|---------|-------------|---------|
| `term [terminal_id]` | Create a new terminal | `term main_term` |
| `close [terminal_id]` | Close a terminal | `close main_term` |
| `run [terminal_id] [command]` | Run a command in terminal | `run main_term ls -la` |
| `send [terminal_id] [text]` | Send text to terminal | `send main_term Hello\n` |
| `stop [terminal_id]` | Send Ctrl+C to terminal | `stop main_term` |

### File Operations

| Command | Description | Example |
|---------|-------------|---------|
| `file [path] [content]` | Create or update a file | `file app.py print("Hello")` |
| `mkdir [path]` | Create a directory | `mkdir src` |
| `ls [path]` | List contents of a directory | `ls .` |
| `cat [path]` | Show file contents | `cat app.py` |
| `rename [path] [new_name]` | Rename file or directory | `rename app.py main.py` |
| `rm [path]` | Delete file or directory | `rm app.py` |

### Project Management

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Get project status | `status` |
| `help` | Show help | `help` |
| `exit` | Exit program | `exit` |

## Practical Examples

### Example 1: Creating and Running a Python Script

```
> term python_term
INFO - Command createTerminal success: {"success": true, "id": "python_term"}

> file hello.py print('Hello from the test client!')\nname = input('Enter your name: ')\nprint(f'Hello, {name}!')
INFO - Command createFile success: {"success": true}
INFO - Command saveFile success: {"success": true}

> run python_term python hello.py
INFO - Terminal python_term output: Hello from the test client!
INFO - Terminal python_term output: Enter your name: 

> send python_term Test User
INFO - Terminal python_term output: Test User
INFO - Terminal python_term output: Hello, Test User!
```

### Example 2: Working with Directories

```
> mkdir test_project
INFO - Command createFolder success: {"success": true}

> file test_project/README.md # Test Project\n\nThis is a test project created by the Socket.IO test client.
INFO - Command createFile success: {"success": true}
INFO - Command saveFile success: {"success": true}

> ls test_project
INFO - Command getFolder success: {"path": "test_project", "files": [...]}

> cat test_project/README.md
INFO - Command getFile success: {"path": "test_project/README.md", "content": "# Test Project\n\nThis is a test project created by the Socket.IO test client."}
```

### Example 3: Multiple Terminals

```
> term terminal1
INFO - Command createTerminal success: {"success": true, "id": "terminal1"}

> term terminal2
INFO - Command createTerminal success: {"success": true, "id": "terminal2"}

> run terminal1 cd test_project
INFO - Terminal terminal1 output: [output from cd command]

> run terminal1 ls -la
INFO - Terminal terminal1 output: [file listing]

> run terminal2 python -c "print('Hello from terminal 2')"
INFO - Terminal terminal2 output: Hello from terminal 2
```

## Troubleshooting

### Connection Issues

If you're having trouble connecting:
- Check that your server is running at the specified URL
- Verify network connectivity
- Check for any firewall blocking the connection

### Command Failures

If commands fail:
- Check the error message in the logs
- Verify that terminal IDs are correct
- Ensure paths are valid
- Check that you're using the correct command syntax

## Ending the Session

When finished, type:

```
> exit
```

This will close the interactive session and disconnect from the server.
