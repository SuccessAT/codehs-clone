# Using wscat with Socket.IO

## Initial Connection

Connect to the Socket.IO server using wscat:

```bash
wscat -c "ws://3.131.13.46:8000/socket.io/?EIO=4&transport=websocket"
```

The path includes Socket.IO specific parameters:

- `EIO=4`: Engine.IO protocol version 4
- `transport=websocket`: Use WebSocket transport

## Socket.IO Protocol Messages

Socket.IO messages over WebSocket have specific formats. Here are the basic message types:

- `0`: Socket.IO connect (sent by server)
- `1`: Socket.IO disconnect
- `2`: Socket.IO ping
- `3`: Socket.IO pong
- `4`: Socket.IO message
- `40`: Socket.IO connect (actually opens the Socket.IO connection)
- `42`: Socket.IO event (followed by JSON array with event name and data)

## Communication Flow

1. After connecting, you should receive a `0` message with the session details
2. Send `40` to establish the Socket.IO connection
3. Send Socket.IO events in this format: `42["event_name",{"param":"value"}]`

## Example Messages to Send

After you connect and receive the initial handshake, send these messages:

1. Establish Socket.IO connection:

```
40
```

2. Create a project:

```
42["create_project",{"type":"base"}]
```

3. After receiving project_ready, create a terminal:

```
42["project_command",{"command":"createTerminal","args":{}}]
```

4. After terminal is ready, run a command (replace TERMINAL_ID with the actual terminal ID):

```
42["project_command",{"command":"runCommand","args":{"terminalId":"TERMINAL_ID","command":"echo hello world"}}]
```

5. Send terminal input (replace TERMINAL_ID with the actual terminal ID):

```
42["terminalData",{"id":"TERMINAL_ID","data":"ls -la\n"}]
```

## Important Notes

- You must manually respond to ping messages (type `2`) with pong messages (type `3`)
- Socket.IO events from the server will come as `42["event_name",data]`
- This is much more complex than using a Socket.IO client library
- The session might timeout if you don't respond to pings

## Debugging Tips

- Each message from the server will start with a number indicating its type
- Copy the terminal ID from the createTerminal response for subsequent commands
- Watch for ping messages (`2`) and respond with pong messages (`3`) to keep the connection alive
