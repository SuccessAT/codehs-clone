# CodeHS Clone

An educational coding platform built as a self-hosted alternative to CodeHS. Teachers can create lessons and exercises; students can watch videos, take quizzes, and write/execute code in a secure real-time IDE.

## Architecture

**Frontend** (`frontend/`) — React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui
- Monaco Editor for in-browser code editing
- Zustand for state management
- React Router v6
- Runs on port **5000** (0.0.0.0)

**Backend** (`backend/`) — Python 3.12 + FastAPI + SQLAlchemy 2.0 (async)
- JWT-based authentication with role-based access control (student/teacher)
- PostgreSQL database (via asyncpg) — uses `DATABASE_URL` environment variable
- E2B WebSocket integration for sandboxed code execution (optional, degrades gracefully)
- Alembic for migrations
- Runs on port **8000** (localhost)

## Workflows

- **Start application** — `cd frontend && npm run dev` (port 5000, webview)
- **Backend API** — `cd backend && python main.py` (port 8000, console)

## Key Configuration

- `frontend/vite.config.ts` — configured for host `0.0.0.0`, port 5000, `allowedHosts: true` (Replit proxy), proxies `/api` and `/ws` to backend port 8000
- `backend/database.py` — auto-converts `postgresql://` to `postgresql+asyncpg://` and strips unsupported query params (e.g. `sslmode`)
- `backend/main.py` — CORS configured with `allow_origins=["*"]` for Replit proxy compatibility

## Database

Uses the Replit-provided PostgreSQL database via the `DATABASE_URL` environment variable. Tables are auto-created on startup via SQLAlchemy metadata.

## E2B Sandbox

The app integrates with a self-hosted E2B WebSocket terminal for code execution. If no E2B server is available at `WS_E2B_URL` (default: `ws://localhost:8765`), the app runs in degraded mode — browsing lessons and auth still work, but code execution is unavailable.

## Deployment

Configured for autoscale deployment:
- Build: `cd frontend && npm run build`
- Run: `cd backend && python main.py`
