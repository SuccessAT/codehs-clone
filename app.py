from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
import json

import socketio
from fastapi import Body, Depends, FastAPI, HTTPException, Path, WebSocket, WebSocketDisconnect, Query, status
from fastapi.responses import JSONResponse

from pydantic import BaseModel, Field

SOCKET_SERVER_URL = "http://localhost:8000"
PING_TIMEOUT = 300  # must be ≥ server ping_timeout


# ────────────────────────── helpers ──────────────────────────
class _Pending:
    """promise registry keyed by command name"""

    def __init__(self):
        self._waiting: List[tuple[str, asyncio.Future]] = []

    def add(self, command: str) -> asyncio.Future:
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiting.append((command, fut))
        return fut

    def resolve(self, command: str, result: Any):
        # first waiter for that command wins
        for idx, (cmd, fut) in enumerate(self._waiting):
            if cmd == command and not fut.done():
                fut.set_result(result)
                del self._waiting[idx]
                break


# ────────────────────────── user session ─────────────────────
class UserSession:
    def __init__(self):
        self.sio = socketio.AsyncClient(reconnection=False, logger=False)
        self.project_id: str | None = None
        self.details: Dict[str, Any] = {}
        self._connected = asyncio.Event()
        self._project_ready = asyncio.Event()
        self._pending = _Pending()
        
        # Terminal state tracking
        self.active_terminals: Dict[str, Dict[str, Any]] = {}
        self.terminal_output_queues: Dict[str, asyncio.Queue] = {}
        self.terminal_waiting_input: Dict[str, bool] = {}
        
        # Event handlers
        self.sio.on("connection_established", self._on_connected)
        self.sio.on("project_ready", self._on_project_ready)
        self.sio.on("error", self._on_error)
        self.sio.on("command_result", self._on_command_result)
        self.sio.on("terminalResponse", self._on_terminal_response)

    # -------- socket-io event handlers ----------
    async def _on_connected(self, data):
        self.sid = data["sid"]
        self._connected.set()

    async def _on_project_ready(self, data):
        self.project_id = data["project_id"]
        self.details = data.get("details", {})
        self._project_ready.set()

    async def _on_error(self, data):
        # forward as HTTP error
        raise HTTPException(status_code=400, detail=data.get("message", "socket error"))

    async def _on_command_result(self, data):
        self._pending.resolve(data["command"], data["result"])
    
    async def _on_terminal_response(self, data):
        """Handle terminal output and detect input prompts"""
        terminal_id = data.get("id")
        output_data = data.get("data", "")
        
        if not terminal_id or terminal_id not in self.active_terminals:
            return
            
        # Check if this output indicates the program is waiting for input
        input_indicators = [
            ": ", # Common input prompts like "Enter your name: "
            "? ",  # For question prompts
            ">>> ", # Python REPL prompt
            "... ",  # Python continuation prompt
            "input(" # Python input function (partial match)
        ]
        
        # Update terminal state if we detect an input prompt
        terminal_info = self.active_terminals[terminal_id]
        
        # Check if the output ends with a common input prompt pattern
        is_input_prompt = any(output_data.rstrip().endswith(indicator) for indicator in input_indicators)
        # Or if it contains input() without a newline after
        contains_input_fn = "input(" in output_data and not output_data.endswith("\n")
        
        if is_input_prompt or contains_input_fn:
            self.terminal_waiting_input[terminal_id] = True
            terminal_info["awaiting_input"] = True
        
        # Add the output to the terminal's queue
        if terminal_id in self.terminal_output_queues:
            await self.terminal_output_queues[terminal_id].put({
                "data": output_data,
                "is_input_prompt": is_input_prompt or contains_input_fn
            })

    # -------- public helpers ----------
    async def connect(self):
        if not self.sio.connected:
            await self.sio.connect(SOCKET_SERVER_URL, wait_timeout=PING_TIMEOUT)
            await asyncio.wait_for(self._connected.wait(), 5)

    async def ensure_project(self):
        if self.project_id:
            return
        pid = uuid.uuid4().hex
        await self.sio.emit("create_project", {"id": pid, "type": "base"})
        await asyncio.wait_for(self._project_ready.wait(), 30)

    async def call(self, command: str, args: Dict[str, Any] | None = None):
        await self.ensure_project()
        future = self._pending.add(command)
        await self.sio.emit("project_command", {"command": command, "args": args or {}})
        result = await asyncio.wait_for(future, timeout=60)
        if isinstance(result, dict) and result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    
    async def register_terminal(self, terminal_id: str):
        """Register a terminal for interactive output handling"""
        if terminal_id not in self.active_terminals:
            self.active_terminals[terminal_id] = {
                "id": terminal_id,
                "running": False,
                "awaiting_input": False,
                "last_command": None,
                "created_at": asyncio.get_event_loop().time()
            }
            self.terminal_output_queues[terminal_id] = asyncio.Queue()
            self.terminal_waiting_input[terminal_id] = False
        return self.active_terminals[terminal_id]
    
    async def get_terminal_output(self, terminal_id: str, timeout: float = 0.1):
        """Get accumulated terminal output, non-blocking with timeout"""
        if terminal_id not in self.terminal_output_queues:
            return []
        
        queue = self.terminal_output_queues[terminal_id]
        outputs = []
        
        # Try to get all available items from the queue with a timeout
        try:
            while True:
                output = await asyncio.wait_for(queue.get(), timeout=timeout)
                outputs.append(output)
                queue.task_done()
                # After first item, reduce timeout to poll quickly
                timeout = 0.01
        except asyncio.TimeoutError:
            # This is expected when the queue is empty
            pass
        
        return outputs


# singleton for demo; swap to proper auth in prod
async def get_session() -> UserSession:
    if not hasattr(get_session, "_session"):
        get_session._session = UserSession()
        await get_session._session.connect()
    return get_session._session


# ─────────────────────── models with examples ────────────────────
class RunCommandIn(BaseModel):
    terminal_id: str = Field(..., alias="terminalId", example="term_a1b2c3")
    command: str = Field("python /home/user/project/hello.py", example="ls -la")
    cwd: str | None = Field(None, example="/home/user/project")


class TerminalInputIn(BaseModel):
    terminal_id: str = Field(..., alias="terminalId", example="term_a1b2c3")
    input: str = Field(..., example="42\n")


class SaveFileIn(BaseModel):
    path: str = Field(..., example="/home/user/project/hello.py")
    content: str = Field("print('Stage 1: Let\\'s get to know you.')\\nname = input('What is your name? ')\\nprint(f'Nice to meet you, {name}!')\\nage = input('How old are you? ')\\nprint(f'{age} is a great age.')\\nlocation = input('Where are you joining from? ')\\nprint(f'{location} sounds like a wonderful place.')\\n\\nprint('\\nStage 2: A few more fun questions...\\n')\\nfavorite_food = input('What\\'s your favorite food? ')\\nprint('Yum!')\\nhobby = input('What do you enjoy doing in your free time? ')\\nprint('Sounds fun!')\\naspiration = input('What\\'s one thing you dream of doing someday? ')\\nprint('That\\'s inspiring!')\\n\\nprint('\\n--- Here\\'s your story ---')\\nprint(f\"Meet {name}, a {age}-year-old from {location}. {name} loves eating {favorite_food}, especially after a long day spent enjoying {hobby}. One day, {name} hopes to {aspiration}. Let\\'s cheer them on!\")",
    example="print('Stage 1: Let\\'s get to know you.')\\nname = input('What is your name? ')\\nprint(f'Nice to meet you, {name}!')\\nage = input('How old are you? ')\\nprint(f'{age} is a great age.')\\nlocation = input('Where are you joining from? ')\\nprint(f'{location} sounds like a wonderful place.')\\n\\nprint('\\nStage 2: A few more fun questions...\\n')\\nfavorite_food = input('What\\'s your favorite food? ')\\nprint('Yum!')\\nhobby = input('What do you enjoy doing in your free time? ')\\nprint('Sounds fun!')\\naspiration = input('What\\'s one thing you dream of doing someday? ')\\nprint('That\\'s inspiring!')\\n\\nprint('\\n--- Here\\'s your story ---')\\nprint(f\"Meet {name}, a {age}-year-old from {location}. {name} loves eating {favorite_food}, especially after a long day spent enjoying {hobby}. One day, {name} hopes to {aspiration}. Let\\'s cheer them on!\")"
)


class CreateFileIn(BaseModel):
    parent_path: str = Field(..., alias="parentPath", example="/home/user/project")
    name: str = Field(..., example="main.py")


class RenameIn(BaseModel):
    path: str = Field(..., example="/home/user/project/old.py")
    new_name: str = Field(..., alias="newName", example="new.py")


class MoveIn(BaseModel):
    source_path: str = Field(..., alias="sourcePath", example="/home/user/project/a.txt")
    target_path: str = Field(..., alias="targetPath", example="/home/user/project/archive/a.txt")


class ResizeIn(BaseModel):
    terminal_id: str = Field(..., alias="terminalId", example="term_a1b2c3")
    rows: int = Field(24, example=30)
    cols: int = Field(80, example=120)


class TerminalStatusResponse(BaseModel):
    terminal_id: str
    running: bool
    awaiting_input: bool
    last_command: Optional[str]


# ────────────────────────── FastAPI app ──────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if hasattr(get_session, "_session"):
        await get_session._session.sio.disconnect()


app = FastAPI(title="Project-Server REST Gateway", lifespan=lifespan)


# ---------- project ----------
@app.get("/project")
async def project(session: UserSession = Depends(get_session)):
    await session.ensure_project()
    return {"project_id": session.project_id, "details": session.details}


# ---------- terminal ----------
@app.post("/terminal")
async def create_terminal(session: UserSession = Depends(get_session)):
    # let server generate UUID
    result = await session.call("createTerminal")
    
    # Register the terminal for tracking
    terminal_id = result.get("id")
    if terminal_id:
        await session.register_terminal(terminal_id)
        
    return result


@app.get("/terminal/{terminal_id}/status")
async def terminal_status(
    terminal_id: str, 
    session: UserSession = Depends(get_session)
):
    """Get status of a terminal including if it's awaiting input"""
    if terminal_id not in session.active_terminals:
        # Try to register it if it exists on the server
        try:
            # Just checking if the terminal exists by attempting to resize it
            await session.call("resizeTerminal", {"id": terminal_id, "dimensions": {"rows": 24, "cols": 80}})
            await session.register_terminal(terminal_id)
        except HTTPException:
            raise HTTPException(status_code=404, detail=f"Terminal {terminal_id} not found")
    
    terminal_info = session.active_terminals[terminal_id]
    return {
        "terminal_id": terminal_id,
        "running": terminal_info.get("running", False),
        "awaiting_input": terminal_info.get("awaiting_input", False),
        "last_command": terminal_info.get("last_command")
    }


@app.post("/terminal/{terminal_id}/resize")
async def resize_terminal(
    req: ResizeIn, session: UserSession = Depends(get_session)
):
    return await session.call(
        "resizeTerminal",
        {"id": req.terminal_id, "dimensions": {"rows": req.rows, "cols": req.cols}},
    )


@app.delete("/terminal/{terminal_id}")
async def delete_terminal(terminal_id: str, session: UserSession = Depends(get_session)):
    # Clean up our tracking data
    if terminal_id in session.active_terminals:
        del session.active_terminals[terminal_id]
    if terminal_id in session.terminal_output_queues:
        del session.terminal_output_queues[terminal_id]
    if terminal_id in session.terminal_waiting_input:
        del session.terminal_waiting_input[terminal_id]
        
    return await session.call("closeTerminal", {"id": terminal_id})


@app.post("/terminal/run", response_model=dict)
async def run_command(
    req: RunCommandIn,
    wait_seconds: float = 2.0,
    session: UserSession = Depends(get_session),
):
    """
    Run a shell command and return both the Socket-IO ack and initial output.
    For long-running interactive processes, use the /terminal/output endpoint to get more output.
    """
    terminal_id = req.terminal_id
    
    # Make sure the terminal is registered
    if terminal_id not in session.active_terminals:
        await session.register_terminal(terminal_id)
    
    terminal_info = session.active_terminals[terminal_id]
    
    # Update terminal state
    terminal_info["running"] = True
    terminal_info["awaiting_input"] = False
    terminal_info["last_command"] = req.command
    
    # Clear any existing output queue
    if terminal_id in session.terminal_output_queues:
        while not session.terminal_output_queues[terminal_id].empty():
            try:
                session.terminal_output_queues[terminal_id].get_nowait()
                session.terminal_output_queues[terminal_id].task_done()
            except asyncio.QueueEmpty:
                break
    
    # Run the command
    result = await session.call(
        "runCommand",
        {"terminalId": terminal_id, "command": req.command, "cwd": req.cwd},
    )
    
    # Wait a short time to collect initial output
    await asyncio.sleep(wait_seconds)
    
    # Get accumulated output
    outputs = await session.get_terminal_output(terminal_id)
    
    # Check if the command is waiting for input based on the collected output
    if terminal_id in session.terminal_waiting_input:
        terminal_info["awaiting_input"] = session.terminal_waiting_input[terminal_id]
    
    # Process output for response
    output_text = "".join([item.get("data", "") for item in outputs])
    awaiting_input = terminal_info.get("awaiting_input", False)
    
    return {
        "ack": result,
        "output": output_text,
        "awaiting_input": awaiting_input,
        "terminal_id": terminal_id
    }


@app.get("/terminal/{terminal_id}/output")
async def get_terminal_output(
    terminal_id: str,
    timeout: float = Query(0.5, description="How long to wait for new output in seconds"),
    session: UserSession = Depends(get_session)
):
    """Long-polling endpoint to get terminal output"""
    if terminal_id not in session.active_terminals:
        raise HTTPException(status_code=404, detail=f"Terminal {terminal_id} not found")
        
    # Get any output that has accumulated
    outputs = await session.get_terminal_output(terminal_id, timeout=timeout)
    
    # Update terminal status
    terminal_info = session.active_terminals[terminal_id]
    awaiting_input = any(item.get("is_input_prompt", False) for item in outputs)
    if awaiting_input:
        terminal_info["awaiting_input"] = True
        session.terminal_waiting_input[terminal_id] = True
    
    # Process output for response
    output_text = "".join([item.get("data", "") for item in outputs])
    
    return {
        "terminal_id": terminal_id,
        "output": output_text,
        "has_data": len(outputs) > 0,
        "awaiting_input": terminal_info.get("awaiting_input", False)
    }


@app.post("/terminal/input")
async def send_terminal_input(
    req: TerminalInputIn,
    session: UserSession = Depends(get_session)
):
    """Send input to a terminal that's waiting for user input"""
    terminal_id = req.terminal_id
    
    if terminal_id not in session.active_terminals:
        raise HTTPException(status_code=404, detail=f"Terminal {terminal_id} not found")
    
    terminal_info = session.active_terminals[terminal_id]
    
    # Only allow input if terminal is expecting it
    if not terminal_info.get("awaiting_input", False):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"detail": "Terminal is not awaiting input"}
        )
    
    # Reset awaiting input flag
    terminal_info["awaiting_input"] = False
    session.terminal_waiting_input[terminal_id] = False
    
    # Make sure input ends with newline if not present
    input_data = req.input if req.input.endswith('\n') else req.input + '\n'
    
    # Send input to terminal
    await session.call("terminalData", {"id": terminal_id, "data": input_data})
    
    # Wait a short time to collect any immediate response
    await asyncio.sleep(0.5)
    
    # Get any new output after sending input
    outputs = await session.get_terminal_output(terminal_id)
    output_text = "".join([item.get("data", "") for item in outputs])
    
    # Check if there's another input prompt
    awaiting_input = any(item.get("is_input_prompt", False) for item in outputs)
    if awaiting_input:
        terminal_info["awaiting_input"] = True
        session.terminal_waiting_input[terminal_id] = True
    
    return {
        "terminal_id": terminal_id,
        "output": output_text,
        "awaiting_input": terminal_info.get("awaiting_input", False)
    }


@app.post("/terminal/stdin/{terminal_id}")
async def stdin(
    terminal_id: str,
    data: str = Body(..., media_type="text/plain"),
    session: UserSession = Depends(get_session),
):
    """Legacy stdin endpoint for backward compatibility"""
    return await session.call("terminalData", {"id": terminal_id, "data": data})


# ---------- WebSocket support ----------
@app.websocket("/ws/terminal/{terminal_id}")
async def terminal_websocket(
    websocket: WebSocket, 
    terminal_id: str,
    session: UserSession = Depends(get_session)
):
    """WebSocket endpoint for real-time terminal interaction"""
    await websocket.accept()
    
    # Register terminal if not already registered
    if terminal_id not in session.active_terminals:
        try:
            # Check if terminal exists
            await session.call("resizeTerminal", {"id": terminal_id, "dimensions": {"rows": 24, "cols": 80}})
            await session.register_terminal(terminal_id)
        except HTTPException:
            await websocket.close(code=1000, reason=f"Terminal {terminal_id} not found")
            return
    
    # Set up output queue
    if terminal_id not in session.terminal_output_queues:
        session.terminal_output_queues[terminal_id] = asyncio.Queue()
    
    try:
        # Send initial terminal status
        terminal_info = session.active_terminals[terminal_id]
        await websocket.send_json({
            "type": "status",
            "running": terminal_info.get("running", False),
            "awaiting_input": terminal_info.get("awaiting_input", False),
            "last_command": terminal_info.get("last_command")
        })
        
        # Create tasks for receiving from client and forwarding terminal output
        output_task = asyncio.create_task(forward_terminal_output(websocket, terminal_id, session))
        input_task = asyncio.create_task(handle_terminal_input(websocket, terminal_id, session))
        
        # Wait for either task to complete
        done, pending = await asyncio.wait(
            [output_task, input_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # Cancel the remaining task
        for task in pending:
            task.cancel()
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        # Ensure WebSocket is closed
        try:
            await websocket.close()
        except:
            pass


async def forward_terminal_output(websocket: WebSocket, terminal_id: str, session: UserSession):
    """Forward terminal output to WebSocket client"""
    queue = session.terminal_output_queues[terminal_id]
    
    while True:
        try:
            # Wait for output from the terminal
            output = await queue.get()
            queue.task_done()
            
            terminal_info = session.active_terminals[terminal_id]
            
            # Update awaiting_input status if needed
            if output.get("is_input_prompt", False):
                terminal_info["awaiting_input"] = True
                session.terminal_waiting_input[terminal_id] = True
            
            # Send to client
            await websocket.send_json({
                "type": "output",
                "data": output.get("data", ""),
                "awaiting_input": terminal_info.get("awaiting_input", False)
            })
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"Output error: {str(e)}"})
            break


async def handle_terminal_input(websocket: WebSocket, terminal_id: str, session: UserSession):
    """Handle input from WebSocket client"""
    while True:
        try:
            # Wait for input from client
            message = await websocket.receive_text()
            
            # Parse the message
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                # Treat as raw input if not JSON
                data = {"type": "input", "data": message}
                
            if data.get("type") == "input":
                input_data = data.get("data", "")
                
                # Make sure input ends with newline if not present
                if not input_data.endswith('\n'):
                    input_data += '\n'
                
                # Reset awaiting input flag
                if terminal_id in session.active_terminals:
                    session.active_terminals[terminal_id]["awaiting_input"] = False
                session.terminal_waiting_input[terminal_id] = False
                
                # Send to terminal
                await session.call("terminalData", {"id": terminal_id, "data": input_data})
            
            elif data.get("type") == "command":
                # Run a command
                command = data.get("command", "")
                cwd = data.get("cwd")
                
                if terminal_id in session.active_terminals:
                    terminal_info = session.active_terminals[terminal_id]
                    terminal_info["running"] = True
                    terminal_info["awaiting_input"] = False
                    terminal_info["last_command"] = command
                
                # Run the command
                await session.call(
                    "runCommand",
                    {"terminalId": terminal_id, "command": command, "cwd": cwd},
                )
                
                # Acknowledge command receipt
                await websocket.send_json({
                    "type": "command_ack",
                    "command": command,
                    "status": "sent"
                })
                
        except asyncio.CancelledError:
            break
        except WebSocketDisconnect:
            break
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"Input error: {str(e)}"})
            break


# ---------- files ----------
@app.get("/file")
async def get_file(path: str, session: UserSession = Depends(get_session)):
    return await session.call("getFile", {"path": path})


@app.get("/folder")
async def get_folder(path: str, session: UserSession = Depends(get_session)):
    return await session.call("getFolder", {"path": path})


@app.post("/file")
async def save_file(req: SaveFileIn, session: UserSession = Depends(get_session)):
    return await session.call("saveFile", req.dict(by_alias=True))


@app.post("/file/create")
async def create_file(req: CreateFileIn, session: UserSession = Depends(get_session)):
    return await session.call("createFile", req.dict(by_alias=True))


@app.post("/folder/create")
async def create_folder(
    req: CreateFileIn, session: UserSession = Depends(get_session)
):
    return await session.call("createFolder", req.dict(by_alias=True))


@app.post("/file/rename")
async def rename(req: RenameIn, session: UserSession = Depends(get_session)):
    return await session.call("renameFile", req.dict(by_alias=True))


@app.post("/file/move")
async def move(req: MoveIn, session: UserSession = Depends(get_session)):
    return await session.call("moveFile", req.dict(by_alias=True))


@app.delete("/file")
async def delete_file(path: str, session: UserSession = Depends(get_session)):
    return await session.call("deleteFile", {"path": path})


@app.delete("/folder")
async def delete_folder(path: str, session: UserSession = Depends(get_session)):
    return await session.call("deleteFolder", {"path": path})


# ---------- misc ----------
@app.get("/project/status")
async def status(session: UserSession = Depends(get_session)):
    return await session.call("getProjectStatus")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8001, reload=True)