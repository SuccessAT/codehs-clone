# fastapi_gateway.py  –  copy-and-paste ready
from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List
import json

import socketio
from fastapi import Body, Depends, FastAPI, HTTPException, Path, WebSocket, WebSocketDisconnect

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

        self.sio.on("connection_established", self._on_connected)
        self.sio.on("project_ready", self._on_project_ready)
        self.sio.on("error", self._on_error)
        self.sio.on("command_result", self._on_command_result)

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


class SaveFileIn(BaseModel):
    path: str = Field(..., example="/home/user/project/hello.py")
    content: str = Field("print('hi')\n", example="print('Hello World')\n")


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
    return await session.call("createTerminal")


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
    return await session.call("closeTerminal", {"id": terminal_id})


# ───────── replace current /terminal/run route ─────────
@app.post("/terminal/run", response_model=dict)
async def run_command(
    req: RunCommandIn,
    wait_seconds: int = 2,          # how long to gather output
    session: UserSession = Depends(get_session),
):
    """
    Run a shell command and return both the Socket-IO ack *and*
    any terminal output collected within ``wait_seconds`` seconds.
    """
    # 1. issue runCommand
    result = await session.call(
        "runCommand",
        {"terminalId": req.terminal_id, "command": req.command, "cwd": req.cwd},
    )

    # 2. collect output lines for a short window
    output: list[str] = []

    async def _grab(data):
        if data.get("id") == req.terminal_id:
            output.append(data.get("data", ""))

    # register handler
    session.sio.on("terminalResponse", _grab)

    try:
        await asyncio.sleep(wait_seconds)
    finally:
        # ---- remove callback even on old socketio versions ----
        ns_handlers = session.sio.handlers.get("/", {})
        entry = ns_handlers.get("terminalResponse")

        if isinstance(entry, list):
            # normal case ≥ python-socketio-5.2
            try:
                entry.remove(_grab)
            except ValueError:
                pass
        elif callable(entry):
            # very old release stores a single fn, not a list
            if entry is _grab:
                ns_handlers["terminalResponse"] = []
    
    return {
        "ack": result,
        "output": "".join(output),
    }



@app.post("/terminal/stdin/{terminal_id}")
async def stdin(
    terminal_id: str,
    data: str = Body(..., media_type="text/plain"),
    session: UserSession = Depends(get_session),
):
    return await session.call("terminalData", {"id": terminal_id, "data": data})


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

# ──────────────────────────────────────────────────────────
#  Live terminal WebSocket  (ws://…/terminal/ws/{id})
# ──────────────────────────────────────────────────────────
@app.websocket("/terminal/ws/{terminal_id}")
async def terminal_ws(
    websocket: WebSocket,
    terminal_id: str,
    session: UserSession = Depends(get_session),
):
    """
    A true interactive channel:

      • Server → client : every chunk printed by the shell
      • Client → server : any text (stdin) OR special JSON to start a program

    Message rules from the *front-end*:

      1.  To **run** a command:      { "run": "python main.py", "cwd": "/foo" }
      2.  To **send stdin bytes**:   raw text (e.g. "John\\n")

    Everything the PTY prints is forwarded as plain text frames.
    """

    await websocket.accept()

    # 1. make sure the terminal exists (create if missing)
    if not terminal_id or terminal_id == "new":
        result = await session.call("createTerminal")
        terminal_id = result["id"]

    # 2. pump terminal output → websocket
    async def _listener(data):
        if data.get("id") == terminal_id:
            await websocket.send_text(data.get("data", ""))

    session.sio.on("terminalResponse", _listener)

    try:
        while True:
            try:
                msg = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            # ── JSON = runCommand; plain text = stdin ─────────────────────
            if msg.startswith("{") and msg.endswith("}"):
                try:
                    payload = json.loads(msg)
                    cmd = payload["run"]
                    cwd = payload.get("cwd")
                except Exception:
                    await websocket.send_text("[bad run payload]")
                    continue

                args = {"terminalId": terminal_id, "command": cmd}
                if cwd:
                    args["cwd"] = cwd

                ack = await session.call("runCommand", args)
                await websocket.send_text(json.dumps({"ack": ack}))
            else:
                # treat as stdin
                await session.call("terminalData", {"id": terminal_id, "data": msg})
    finally:
        # remove listener
        ns = session.sio.handlers.get("/", {})
        lst = ns.get("terminalResponse", [])
        if isinstance(lst, list) and _listener in lst:
            lst.remove(_listener)
        elif callable(lst) and lst is _listener:
            ns["terminalResponse"] = []

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8001, reload=True)
