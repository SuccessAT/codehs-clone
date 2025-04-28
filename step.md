# Socket.IO Client Testing Steps

This guide provides step-by-step instructions for testing the Socket.IO client functionality using the interactive mode. Each step includes the command to run and an explanation of what's happening.

## Prerequisites

- Python environment with socketio package installed
- Access to the server (default: http://localhost:8000)
- The `test_socketio_client.py` file from the repository

## Testing Steps

### 1. Start the client in interactive mode

```bash
python test_socketio_client.py --mode interactive
```

This will start the client in interactive mode, connecting to the server at http://localhost:8000 by default.

### 2. Create a new project

When prompted, type:

```
create
```

This will create a new project with a random UUID and wait for it to be ready. The client will connect to the server and initialize a new project environment.

### 3. Create a main terminal

```
term main_terminal
```

This creates a new terminal with the ID "main_terminal". This terminal will be used for running commands and interacting with your project.

### 4. Create a project directory

```
mkdir project_test
```

This creates a new directory called "project_test" in the project's root directory.

### 5. Check that the directory was created

```
ls project_test
```

This lists the contents of the current directory, verifying that your new directory was created.

### 6. Create a Python file in the directory

```
file project_test/hello.py print('Hello from the test client!')\nname = input('Enter your name: ')\print(f'Hello, {name}!')\nage = input('How old are you? ')\nprint(f'You are {age} years old.')
```

This creates a Python file called "hello.py" in the project_test directory with the following content:

- A greeting message
- A prompt for the user's name
- A response using the input name
- A prompt for the user's age
- A response using the input age

### 7. Verify the Python file content

```
cat project_test/hello.py
```

This displays the content of the hello.py file, allowing you to verify that it was created correctly.

### 8. Run the Python file

```
run main_terminal python project_test/hello.py
```

This runs the Python file in the main terminal. The script will print a greeting and then wait for user input.

### 9. Enter your name when prompted

```
send main_terminal John Doe
```

This sends the text "John Doe" to the terminal as input for the first prompt.

### 10. Enter your age when prompted

```
send main_terminal 30
```

This sends the text "30" to the terminal as input for the second prompt.

### 11. Create another terminal for file operations

```
term file_terminal
```

This creates a second terminal called "file_terminal" for performing additional file operations.

### 12. Navigate to the project directory in the new terminal

```
run file_terminal cd project_test
```

This changes the current directory to the project_test directory in the file_terminal.

### 13. List contents of the project directory

```
run file_terminal ls -la
```

This lists all files in the project_test directory, including hidden files.

### 14. Create a new file in the project directory

```
file project_test/README.md # Project Test\n\nThis is a test project for the Socket.IO client.
```

This creates a README.md file in the project_test directory with a title and description.

### 15. Check the content of the new file

```
cat project_test/README.md
```

This displays the content of the README.md file.

### 16. Rename the Python file

```
rename project_test/hello.py greeting.py
```

This renames the hello.py file to greeting.py.

### 17. Verify the file was renamed

```
ls project_test
```

This lists the contents of the project_test directory to verify that the file was renamed.

### 18. Run the renamed Python file

```
run main_terminal python project_test/greeting.py
```

This runs the renamed Python file in the main terminal.

### 19. Enter your name when prompted

```
send main_terminal Guest User
```

This sends "Guest User" as input for the name prompt.

### 20. Enter your age when prompted

```
send main_terminal 25
```

This sends "25" as input for the age prompt.

### 21. Stop any running commands

```
stop main_terminal
```

This sends a Ctrl+C signal to the main terminal, stopping any running commands.

### 22. Get project status

```
status
```

This retrieves and displays the current status of the project.

### 23. Exit the testing session

```
exit
```

This exits the interactive session and disconnects from the server.

## Troubleshooting

- If a terminal becomes unresponsive, use the `stop` command to interrupt any running processes.
- If you encounter connection issues, ensure the server is running at the specified URL.
- If file operations fail, check that the parent directories exist before creating files.

## Additional Commands

For a full list of available commands, type:

```
help
```

This will display all commands that can be used in the interactive session, including:

- Managing terminals
- File operations
- Running commands
- Sending input to terminals
