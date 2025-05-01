from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
import json
import logging
import signal
import sys
import os
import time
from datetime import datetime, timedelta


# Add APScheduler for the restart functionality
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import socketio
from fastapi import Body, Depends, FastAPI, HTTPException, Path, WebSocket, WebSocketDisconnect, Query, status
from fastapi.responses import JSONResponse

from pydantic import BaseModel, Field

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("app")

SOCKET_SERVER_URL = "http://localhost:8000"
PING_TIMEOUT = 300  # must be ≥ server ping_timeout

# --------- Server Restart Functions ---------

async def restart_server():
    logger.info("Scheduled restart triggered")
    # non-blocking sleep
    await asyncio.sleep(1)
    os.execv(sys.executable, [sys.executable] + sys.argv)

def setup_scheduler():
    """
    Sets up the scheduler to restart the server every 30 minutes.
    Returns the scheduler instance.
    """
    scheduler = AsyncIOScheduler()
    
    # Schedule the restart_server function to run every 30 minutes
    scheduler.add_job(restart_server, 'interval', minutes=20)
    
    # # Log that the scheduler has started
    # scheduler.add_job(lambda: logger.info("Scheduler started, first restart in 30 minutes"), 
    #                  'date', 
    #                  run_date=datetime.now() + timedelta(seconds=5))
    
    return scheduler

def setup_signal_handlers(scheduler):
    """
    Sets up signal handlers to gracefully shutdown the scheduler.
    """
    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}, shutting down scheduler")
        scheduler.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

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
    command: str = Field("python /home/user/project/test/main.py", example="ls -la")
    cwd: str | None = Field(None, example="/home/user/project")


class TerminalInputIn(BaseModel):
    terminal_id: str = Field(..., alias="terminalId", example="term_a1b2c3")
    input: str = Field(..., example="42\n")


class SaveFileIn(BaseModel):
    path: str = Field(..., example="/home/user/project/test/main.py")
    content: str = Field("print('Stage 1: Lets get to know you.')\nname = input('What is your name? ')\nprint(f'Nice to meet you, {name}!')\n",
    example="print('Stage 1: Lets get to know you.')\nname = input('What is your name? ')\nprint(f'Nice to meet you, {name}!')\n"
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
    # Start the scheduler for auto-restarts
    scheduler = setup_scheduler()
    setup_signal_handlers(scheduler)
    scheduler.start()
    logger.info("Server restart scheduler started (30-minute interval)")
    
    yield
    
    # Cleanup on shutdown
    scheduler.shutdown()
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
                
                # Detect javac command and auto-run corresponding .class
                if command.startswith("javac ") and command.endswith(".java"):  
                    # first compile
                    await session.call(
                        "runCommand",
                        {"terminalId": terminal_id, "command": command, "cwd": cwd}
                    )
                    await websocket.send_json({
                        "type": "command_ack", "command": command, "status": "compiled"
                    })
                    # derive class name
                    java_file = command.split()[1]
                    class_name = java_file.rsplit('.', 1)[0]
                    run_cmd = f"java {class_name}"
                    # then run
                    await session.call(
                        "runCommand",
                        {"terminalId": terminal_id, "command": run_cmd, "cwd": cwd}
                    )
                    await websocket.send_json({
                        "type": "command_ack", "command": run_cmd, "status": "ran"
                    })
                else:
                    # normal command
                    await session.call(
                        "runCommand",
                        {"terminalId": terminal_id, "command": command, "cwd": cwd}
                    )
                    await websocket.send_json({
                        "type": "command_ack", "command": command, "status": "sent"
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

# Track last project creation time
LAST_PROJECT_CREATION_TIME = 0
CURRENT_PROJECT_ID = None
CURRENT_TERMINAL_ID = None
PROJECT_MAX_AGE = 15 * 60  # 15 minutes in seconds

class RunCodeRequest(BaseModel):
    files: Dict[str, str] = Field(..., description="Dictionary of filename to code content")
    cwd: Optional[str] = Field("/home/user/project", description="Working directory")

@app.post("/run-code")
async def run_code(
    req: RunCodeRequest,
    session: UserSession = Depends(get_session),
):
    """
    Endpoint to save and run code in a managed terminal.
    Ensures environment setup finishes, resets scrollback, drains leftover output,
    filters out system logs (e.g., apt-get download/unpacking/progress), then executes user code.
    """
    global LAST_PROJECT_CREATION_TIME, CURRENT_PROJECT_ID, CURRENT_TERMINAL_ID

    # Determine if a new project/session is needed
    now_ts = datetime.now().timestamp()
    new_session = (
        not CURRENT_PROJECT_ID or
        not CURRENT_TERMINAL_ID or
        (now_ts - LAST_PROJECT_CREATION_TIME) > PROJECT_MAX_AGE
    )

    if new_session:
        # (Re)initialize project
        await session.ensure_project()
        CURRENT_PROJECT_ID = session.project_id
        LAST_PROJECT_CREATION_TIME = now_ts

        # Create and register a new terminal
        term = await session.call("createTerminal")
        CURRENT_TERMINAL_ID = term.get("id")
        await session.register_terminal(CURRENT_TERMINAL_ID)

        # Allow background setup (apt installs, etc.) to complete
        await asyncio.sleep(5)

        # Hard reset terminal (clears scrollback)
        await session.call(
            "runCommand",
            {"terminalId": CURRENT_TERMINAL_ID, "command": "clear; printf '\\033c'"}
        )
        # Drain all leftover output
        await asyncio.sleep(0.2)
        while True:
            drained = await session.get_terminal_output(CURRENT_TERMINAL_ID, timeout=0.1)
            if not drained:
                break
    else:
        await session.ensure_project()

    # Validate input
    if not req.files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Save the user's file
    main_file = next(iter(req.files))
    content = req.files[main_file]
    cwd = req.cwd or "/home/user/project"
    import posixpath
    file_path = posixpath.join(cwd, main_file)
    dir_path = posixpath.dirname(file_path)
    if dir_path and dir_path != cwd:
        try:
            await session.call(
                "createFolder",
                {"parentPath": posixpath.dirname(dir_path), "name": posixpath.basename(dir_path)}
            )
        except HTTPException:
            pass
    await session.call("saveFile", {"path": file_path, "content": content})

    # Determine run command
    ext = posixpath.splitext(main_file)[1].lower()
    if ext == ".java":
        await session.call(
            "runCommand",
            {"terminalId": CURRENT_TERMINAL_ID, "command": f"javac {main_file}", "cwd": cwd}
        )
        await asyncio.sleep(2)
        run_cmd = f"java {posixpath.splitext(main_file)[0]}"
    elif ext == ".py":
        run_cmd = f"python {main_file}"
    else:
        run_cmd = f"cat {main_file}"

    # Reset and drain again for a clean execution
    await session.call(
        "runCommand",
        {"terminalId": CURRENT_TERMINAL_ID, "command": "clear; printf '\\033c'"}
    )
    await asyncio.sleep(0.2)
    while True:
        drained = await session.get_terminal_output(CURRENT_TERMINAL_ID, timeout=0.1)
        if not drained:
            break

    # Execute user code
    await session.call(
        "runCommand",
        {"terminalId": CURRENT_TERMINAL_ID, "command": run_cmd, "cwd": cwd}
    )
    await asyncio.sleep(2)

    # Capture raw output
    logs = await session.get_terminal_output(CURRENT_TERMINAL_ID)
    raw = "".join(item.get("data", "") for item in logs)

    # Filter out system logs
    import re
    filtered = []
    for line in raw.splitlines(keepends=True):
        if re.match(r'^\s*\d+% \[', line):
            continue  # progress bars like '15% [#####]'
        if re.match(r'^Get:\d+', line):
            continue  # apt download logs
        if re.match(r'^Preparing to unpack', line):
            continue  # apt unpack logs
        if re.match(r'^Unpacking ', line):
            continue  # apt unpack logs
        if 'Selecting previously unselected package' in line:
            continue
        if "Progress:" in line:
            continue
        if line.strip().startswith("Get:"):
            continue
        if "Preparing to unpack" in line:
            continue
        if "Unpacking" in line:
            continue

        filtered.append(line)
    output_text = "".join(filtered)

    awaiting_input = session.active_terminals[CURRENT_TERMINAL_ID].get("awaiting_input", False)
    return {
        "project_id": CURRENT_PROJECT_ID,
        "terminal_id": CURRENT_TERMINAL_ID,
        "output": output_text,
        "awaiting_input": awaiting_input,
        "command": run_cmd,
        "is_new_session": new_session
    }

# ---------- misc ----------
@app.get("/project/status")
async def status(session: UserSession = Depends(get_session)):
    return await session.call("getProjectStatus")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8001, reload=True)