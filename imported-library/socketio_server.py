import asyncio
import logging
import os
import uuid
from typing import Dict, Any, List

import socketio
from aiohttp import web

from project import Project

# ----------------------------------------------------
# Logging
# ----------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("socketio_server")

# ----------------------------------------------------
# Configuration constants
# ----------------------------------------------------
SESSION_EXPIRY_SECONDS = 60 * 60          # 1 hour
RESTART_INTERVAL_SECONDS = 60 * 60        # 1 hour
PING_TIMEOUT_SECONDS = 300                # 5 minutes
PING_INTERVAL_SECONDS = 25                # 25 seconds


class SocketWrapper:
    """Light wrapper that lets project‑level handlers emit through Socket.IO."""

    def __init__(self, sio: socketio.AsyncServer, sid: str):
        self._sio = sio
        self._sid = sid

    async def emit(self, event: str, data: Any):
        await self._sio.emit(event, data, room=self._sid)


class ProjectServer:
    """Socket.IO WebSocket server that automatically restarts every
    `RESTART_INTERVAL_SECONDS` seconds (15 min by default).

    The restart is *graceful*: all projects are disconnected and the underlying
    aiohttp site is shut down before a new server instance is spawned.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8000):
        # Host / port
        self.host = host
        self.port = port

        # Runtime members that are initialised at `start()` time so that they can
        # be safely torn down in `stop()`
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None
        self._cleanup_task: asyncio.Task | None = None

        # Data stores
        self.projects: Dict[str, Project] = {}
        self.sessions: Dict[str, Dict[str, Any]] = {}

        # Socket.IO setup
        self.sio = socketio.AsyncServer(
            async_mode="aiohttp",
            cors_allowed_origins="*",
            ping_timeout=PING_TIMEOUT_SECONDS,
            ping_interval=PING_INTERVAL_SECONDS,
        )
        self.app = web.Application()
        self.sio.attach(self.app)

        # Register event handlers
        self._register_handlers()

    # ---------------------------------------------------------------------
    # Public API – life‑cycle helpers
    # ---------------------------------------------------------------------
    async def start(self) -> None:
        """Start the underlying aiohttp site *and* the background cleanup task."""
        self._runner = web.AppRunner(self.app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, self.host, self.port)
        await self._site.start()
        logger.info("Server started on http://%s:%s", self.host, self.port)

        # Background task that retires idle sessions / projects every minute
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self) -> None:
        """Gracefully shut down the server instance."""
        logger.info("Stopping server – preparing for restart…")

        # 1️⃣ Cancel background task
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # 2️⃣ Disconnect all active Socket.IO clients (non‑blocking best‑effort)
        for sid in list(self.sessions.keys()):
            try:
                await self.sio.disconnect(sid)
            except Exception:
                pass

        # 3️⃣ Tear down projects
        for pid in list(self.projects.keys()):
            await self._close_project(pid)

        # 4️⃣ Shutdown aiohttp site / runner
        if self._runner:
            await self._runner.cleanup()
        logger.info("Server stopped – restart imminent")

    # ---------------------------------------------------------------------
    # Socket.IO helpers
    # ---------------------------------------------------------------------
    def _register_handlers(self) -> None:
        """Define Socket.IO event handlers inside this helper so they capture `self`."""

        @self.sio.event
        async def connect(sid, environ):
            logger.info("Client connected: %s", sid)
            self.sessions[sid] = {
                "connected_at": asyncio.get_running_loop().time(),
                "project_id": None,
                "active": True,
            }
            await self.sio.emit("connection_established", {"sid": sid}, room=sid)

        @self.sio.event
        async def disconnect(sid):
            logger.info("Client disconnected: %s", sid)
            await self._handle_disconnection(sid)

        @self.sio.event
        async def create_project(sid, data):
            await self._handle_create_project(sid, data)

        @self.sio.event
        async def join_project(sid, data):
            await self._handle_join_project(sid, data)

        @self.sio.event
        async def leave_project(sid, data):
            await self._handle_leave_project(sid)

        @self.sio.event
        async def project_command(sid, data):
            await self._handle_project_command(sid, data)

    # ---------------------------------------------------------------------
    # Event‑handler implementations (factored out for readability)
    # ---------------------------------------------------------------------
    async def _handle_disconnection(self, sid: str):
        session = self.sessions.get(sid)
        if not session:
            return

        project_id = session.get("project_id")
        if project_id:
            still_connected = [
                s
                for s, d in self.sessions.items()
                if s != sid and d.get("project_id") == project_id and d.get("active")
            ]
            if not still_connected:
                logger.info("No more clients for project %s – closing", project_id)
                await self._close_project(project_id)
        # Drop the session record
        self.sessions.pop(sid, None)

    async def _handle_create_project(self, sid: str, data: Dict[str, Any]):
        project_type = data.get("type", "base")
        project_id = data.get("id", str(uuid.uuid4()))
        api_key = data.get("api_key", os.getenv("E2B_API_KEY"))
        logger.info("%s requested project %s (%s)", sid, project_id, project_type)

        if project_id in self.projects:
            self.sessions[sid]["project_id"] = project_id
            await self.sio.emit(
                "project_ready",
                {
                    "project_id": project_id,
                    "status": "ready",
                    "details": self.projects[project_id].get_project_details(),
                },
                room=sid,
            )
            return

        project = Project(project_id, project_type, api_key)

        async def file_watch_callback(files: List[str]):
            recipients = [
                s
                for s, d in self.sessions.items()
                if d.get("project_id") == project_id and d.get("active")
            ]
            for s in recipients:
                await self.sio.emit(
                    "files_changed", {"project_id": project_id, "files": files}, room=s
                )

        await self.sio.emit(
            "project_initializing", {"project_id": project_id, "status": "initializing"}, room=sid
        )

        try:
            if await project.initialize(file_watch_callback=file_watch_callback):
                self.projects[project_id] = project
                self.sessions[sid]["project_id"] = project_id
                await self.sio.emit(
                    "project_ready",
                    {
                        "project_id": project_id,
                        "status": "ready",
                        "details": project.get_project_details(),
                    },
                    room=sid,
                )
            else:
                raise RuntimeError("Failed to initialise project")
        except Exception as exc:
            logger.exception("Initialisation error for project %s", project_id)
            await self.sio.emit(
                "project_error",
                {
                    "project_id": project_id,
                    "error": f"Failed to initialise project: {exc}",
                },
                room=sid,
            )

    async def _handle_join_project(self, sid: str, data: Dict[str, Any]):
        project_id = data.get("project_id")
        if not project_id or project_id not in self.projects:
            await self.sio.emit("error", {"message": f"Project {project_id!r} not found"}, room=sid)
            return
        self.sessions[sid]["project_id"] = project_id
        await self.sio.emit(
            "project_ready",
            {
                "project_id": project_id,
                "status": "ready",
                "details": self.projects[project_id].get_project_details(),
            },
            room=sid,
        )

    async def _handle_leave_project(self, sid: str):
        sess = self.sessions.get(sid)
        if not sess:
            return
        project_id = sess.pop("project_id", None)
        if not project_id:
            return
        others = [
            s
            for s, d in self.sessions.items()
            if s != sid and d.get("project_id") == project_id and d.get("active")
        ]
        if not others and project_id in self.projects:
            logger.info("Last client left project %s – closing", project_id)
            await self._close_project(project_id)
        await self.sio.emit("project_left", {"project_id": project_id}, room=sid)

    async def _handle_project_command(self, sid: str, data: Dict[str, Any]):
        sess = self.sessions.get(sid)
        if not sess:
            await self.sio.emit("error", {"message": "Invalid session"}, room=sid)
            return
        project_id = sess.get("project_id")
        if not project_id or project_id not in self.projects:
            await self.sio.emit("error", {"message": "No active project"}, room=sid)
            return
        command = data.get("command")
        args = data.get("args", {})
        if not command:
            await self.sio.emit("error", {"message": "Command is required"}, room=sid)
            return
        project = self.projects[project_id]
        handlers = project.handlers({"socket": SocketWrapper(self.sio, sid)})
        handler = handlers.get(command)
        if not handler:
            await self.sio.emit("error", {"message": f"Unknown command: {command}"}, room=sid)
            return
        try:
            result = await handler(args)
            await self.sio.emit(
                "command_result", {"command": command, "args": args, "result": result}, room=sid
            )
        except Exception as exc:
            logger.exception("Command %s failed", command)
            await self.sio.emit(
                "error", {"command": command, "message": f"Error executing command: {exc}"}, room=sid
            )

    # ---------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------
    async def _close_project(self, project_id: str):
        project = self.projects.pop(project_id, None)
        if not project:
            return
        try:
            await project.disconnect()
            logger.info("Closed project %s", project_id)
        except Exception:
            logger.exception("Error closing project %s", project_id)

    async def _cleanup_loop(self):
        while True:
            try:
                now = asyncio.get_running_loop().time()
                # Expire sessions
                for sid, data in list(self.sessions.items()):
                    if data.get("active") and now - data["connected_at"] > SESSION_EXPIRY_SECONDS:
                        logger.info("Expiring idle session %s", sid)
                        data["active"] = False
                        try:
                            await self.sio.disconnect(sid)
                        except Exception:
                            pass
                # Close idle projects (no active sessions)
                for pid, project in list(self.projects.items()):
                    if not any(
                        sdata.get("project_id") == pid and sdata.get("active")
                        for sdata in self.sessions.values()
                    ):
                        logger.info("Project %s is idle – closing", pid)
                        await self._close_project(pid)
            except Exception:
                logger.exception("Cleanup loop error")
            await asyncio.sleep(60)


# =====================================================
# Entry‑point with *automatic restart* every 15‑minutes
# =====================================================
async def _run_single_cycle():
    """Spawn one ProjectServer instance and keep it alive for the configured
    restart interval. When the time elapses the instance is shut down and the
    coroutine returns so that the outer loop can spin up a fresh server.
    """
    server = ProjectServer()
    await server.start()
    try:
        await asyncio.sleep(RESTART_INTERVAL_SECONDS)
    finally:
        await server.stop()


async def main() -> None:
    """Main entry‑point – keeps launching fresh server instances forever."""
    while True:
        await _run_single_cycle()


if __name__ == "__main__":
    asyncio.run(main())
