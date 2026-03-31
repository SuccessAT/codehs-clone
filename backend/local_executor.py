"""
Local code execution engine using subprocess.

Provides the same interface as E2BService so websocket_manager can use it
as a drop-in fallback when the E2B sandbox server is unavailable.

Supports: Python, JavaScript (Node.js), TypeScript, Java, C, C++
"""
import asyncio
import logging
import os
import shutil
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

EXECUTION_TIMEOUT = 30.0

LANGUAGE_CONFIG: dict[str, dict[str, Any]] = {
    "python": {
        "cmd": [sys.executable],
        "ext": ".py",
        "mode": "file",
    },
    "javascript": {
        "cmd": ["node"],
        "ext": ".js",
        "mode": "file",
    },
    "typescript": {
        "cmd": ["npx", "ts-node", "--transpile-only"],
        "ext": ".ts",
        "mode": "file",
    },
    "java": {
        "cmd": [],  # special handling
        "ext": ".java",
        "mode": "java",
    },
    "c": {
        "cmd": [],
        "ext": ".c",
        "mode": "compile",
        "compiler": "gcc",
    },
    "cpp": {
        "cmd": [],
        "ext": ".cpp",
        "mode": "compile",
        "compiler": "g++",
    },
}


@dataclass
class ExecutionResult:
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    execution_time: float = 0.0
    error: Optional[str] = None
    timed_out: bool = False


@dataclass
class SandboxSession:
    sandbox_id: str
    user_id: int
    created_at: datetime
    last_activity: datetime
    status: str = "active"
    language: str = "python"
    execution_count: int = 0

    def is_expired(self, timeout_minutes: int = 30) -> bool:
        return datetime.utcnow() - self.last_activity > timedelta(minutes=timeout_minutes)


class LocalExecutor:
    """
    Local subprocess-based code executor.

    Mirrors the E2BService interface so it can be used as a fallback
    when E2B is unavailable.
    """

    is_connected = True  # Always available

    def __init__(self):
        self._sandboxes: dict[str, SandboxSession] = {}
        self._user_sandboxes: dict[int, set[str]] = {}
        self._active_processes: dict[str, asyncio.subprocess.Process] = {}

    async def create_sandbox(self, user_id: int, language: str = "python") -> str:
        sandbox_id = f"local-{uuid.uuid4().hex[:12]}"
        session = SandboxSession(
            sandbox_id=sandbox_id,
            user_id=user_id,
            created_at=datetime.utcnow(),
            last_activity=datetime.utcnow(),
            language=language,
        )
        self._sandboxes[sandbox_id] = session
        self._user_sandboxes.setdefault(user_id, set()).add(sandbox_id)
        logger.info(f"LocalExecutor: created sandbox {sandbox_id} for user {user_id}")
        return sandbox_id

    async def get_sandbox(self, sandbox_id: str) -> Optional[SandboxSession]:
        return self._sandboxes.get(sandbox_id)

    async def get_user_sandboxes(self, user_id: int) -> list[SandboxSession]:
        ids = self._user_sandboxes.get(user_id, set())
        return [self._sandboxes[sid] for sid in ids if sid in self._sandboxes]

    async def terminate_sandbox(self, sandbox_id: str) -> None:
        session = self._sandboxes.pop(sandbox_id, None)
        if session:
            self._user_sandboxes.get(session.user_id, set()).discard(sandbox_id)
            logger.info(f"LocalExecutor: terminated sandbox {sandbox_id}")

    async def execute_code(
        self,
        sandbox_id: str,
        code: str,
        language: str = "python",
        input_data: Optional[str] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
        timeout: Optional[float] = None,
    ) -> ExecutionResult:
        session = self._sandboxes.get(sandbox_id)
        if session:
            session.last_activity = datetime.utcnow()
            session.execution_count += 1

        timeout = timeout or EXECUTION_TIMEOUT
        start_time = time.time()
        tmpdir = tempfile.mkdtemp(prefix="codehs_exec_")
        result = ExecutionResult()

        try:
            cmd = await self._build_command(code, language, tmpdir)
            if cmd is None:
                result.error = f"Unsupported language: {language}"
                result.stderr = result.error
                if on_stderr:
                    on_stderr(result.error)
                return result

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )

            self._active_processes[sandbox_id] = proc

            stdin_bytes = input_data.encode() if input_data else b""

            stdout_buf: list[str] = []
            stderr_buf: list[str] = []

            async def read_stream(stream, buf: list, callback: Optional[Callable]):
                while True:
                    chunk = await stream.read(4096)
                    if not chunk:
                        break
                    text = chunk.decode(errors="replace")
                    buf.append(text)
                    if callback:
                        try:
                            callback(text)
                        except Exception:
                            pass

            try:
                if stdin_bytes:
                    proc.stdin.write(stdin_bytes)
                    await proc.stdin.drain()
                proc.stdin.close()

                await asyncio.wait_for(
                    asyncio.gather(
                        read_stream(proc.stdout, stdout_buf, on_stdout),
                        read_stream(proc.stderr, stderr_buf, on_stderr),
                        proc.wait(),
                    ),
                    timeout=timeout,
                )

                result.exit_code = proc.returncode
                result.stdout = "".join(stdout_buf)
                result.stderr = "".join(stderr_buf)

            except asyncio.TimeoutError:
                proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass
                result.timed_out = True
                result.error = f"Execution timed out after {timeout:.0f} seconds"
                result.stdout = "".join(stdout_buf)
                result.stderr = "".join(stderr_buf)
                if on_stderr:
                    on_stderr(f"\n[Timed out after {timeout:.0f}s]")

        except FileNotFoundError as e:
            result.error = f"Runtime not found: {e}"
            result.stderr = result.error
            if on_stderr:
                on_stderr(result.error)
        except Exception as e:
            logger.exception(f"LocalExecutor: unexpected error")
            result.error = str(e)
            result.stderr = result.error
            if on_stderr:
                on_stderr(result.error)
        finally:
            self._active_processes.pop(sandbox_id, None)
            result.execution_time = time.time() - start_time
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception:
                pass

        return result

    async def _build_command(self, code: str, language: str, tmpdir: str) -> Optional[list[str]]:
        cfg = LANGUAGE_CONFIG.get(language)
        if not cfg:
            return None

        ext = cfg["ext"]
        mode = cfg["mode"]
        src_path = os.path.join(tmpdir, f"main{ext}")

        with open(src_path, "w", encoding="utf-8") as f:
            f.write(code)

        if mode == "file":
            runner = cfg["cmd"][:]
            # Check that the runtime exists
            if runner and shutil.which(runner[0]) is None:
                return None
            return runner + [src_path]

        if mode == "compile":
            compiler = cfg.get("compiler", "gcc")
            if shutil.which(compiler) is None:
                return None
            out_path = os.path.join(tmpdir, "program")
            compile_proc = await asyncio.create_subprocess_exec(
                compiler, src_path, "-o", out_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
            )
            _, compile_err = await compile_proc.communicate()
            if compile_proc.returncode != 0:
                raise RuntimeError(compile_err.decode(errors="replace"))
            return [out_path]

        if mode == "java":
            if shutil.which("javac") is None:
                return None
            compile_proc = await asyncio.create_subprocess_exec(
                "javac", src_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
            )
            _, compile_err = await compile_proc.communicate()
            if compile_proc.returncode != 0:
                raise RuntimeError(compile_err.decode(errors="replace"))
            return ["java", "-cp", tmpdir, "main"]

        return None

    async def cancel_execution(self, sandbox_id: str) -> None:
        proc = self._active_processes.get(sandbox_id)
        if proc:
            try:
                proc.kill()
            except Exception:
                pass


_local_executor: Optional[LocalExecutor] = None


def get_local_executor() -> LocalExecutor:
    global _local_executor
    if _local_executor is None:
        _local_executor = LocalExecutor()
    return _local_executor
