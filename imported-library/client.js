// Simple Socket.IO client for sandbox interaction
import { io } from 'socket.io-client';

// Connect to the server
const socket = io('ws://3.131.13.46:8000', { 
  transports: ['websocket'] 
});

// Track state
let projectId = null;
let terminalId = null;

// Log all server events for debugging
socket.onAny((event, data) => {
  console.log(`[SERVER] ${event}:`, data);
});

// When connected, create a project
socket.on('connect', () => {
  console.log('Connected! Socket ID:', socket.id);
  socket.emit('create_project', { type: 'base' });
});

// When project is ready, create a terminal
socket.on('project_ready', ({ project_id }) => {
  projectId = project_id;
  console.log('Project ready! ID:', projectId);
  
  // Create terminal
  socket.emit('project_command', {
    command: 'createTerminal',
    args: {}
  });
});

// Handle command results
socket.on('command_result', ({ command, result }) => {
  console.log(`Command result for ${command}:`, result);
  
  if (command === 'createTerminal') {
    terminalId = result.id;
    console.log('Terminal created! ID:', terminalId);
    console.log('Waiting 20 seconds before proceeding...');
    
    // Wait 20 seconds before running any commands
    setTimeout(() => {
      console.log('Waiting completed, running test command...');
      
      // Save a test file
      socket.emit('project_command', {
        command: 'saveFile',
        args: {
          path: '/home/user/project/hello.py',
          content: 'print("Hello from Socket.IO client!")\nname = input("What is your name? ")\nprint(f"Nice to meet you, {name}!")'
        }
      });
      
      // Run the Python script after file is saved
      setTimeout(() => {
        socket.emit('project_command', {
          command: 'runCommand',
          args: {
            terminalId: terminalId,
            command: 'python /home/user/project/hello.py'
          }
        });
      }, 1000);
    }, 20000); // 20 seconds delay
  }
});

// Handle terminal output
socket.on('terminalResponse', ({ id, data }) => {
  if (id === terminalId) {
    process.stdout.write(data);
    
    // If terminal is asking for input, provide a response
    if (data.includes('What is your name?')) {
      setTimeout(() => {
        console.log('Sending response: "User"');
        socket.emit('terminalData', {
          id: terminalId,
          data: 'User\n'
        });
      }, 1000);
    }
  }
});

// Handle errors and disconnection
socket.on('error', (error) => {
  console.error('Error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

console.log('Connecting to server...');