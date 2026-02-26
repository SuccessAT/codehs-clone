# CodeHS Clone - Backend

A FastAPI-based backend for a CodeHS-like educational coding platform with E2B sandbox integration for secure code execution.

## Tech Stack

- **FastAPI** - Modern Python web framework
- **SQLAlchemy 2.0** - Async ORM with type hints
- **Alembic** - Database migrations
- **Pydantic v2** - Data validation
- **SQLite** - Development database (PostgreSQL-ready for production)
- **WebSockets** - Real-time code execution streaming
- **E2B** - Self-hosted sandbox for code execution

## Project Structure

```
backend/
├── main.py              # FastAPI application and routes
├── database.py          # Database configuration and session management
├── models.py            # SQLAlchemy models
├── schemas.py           # Pydantic schemas for validation
├── e2b_service.py       # E2B WebSocket integration service
├── requirements.txt     # Python dependencies
├── alembic.ini          # Alembic configuration
├── alembic/
│   ├── env.py           # Alembic environment
│   ├── script.py.mako   # Migration template
│   └── versions/        # Migration files
│       └── 001_initial.py
├── .env.example         # Environment variables template
└── README.md            # This file
```

## Prerequisites

- Python 3.11+
- pip or uv (recommended)
- **Self-hosted E2B terminal** (see setup instructions below)

## Setup Instructions

### 1. Create Virtual Environment

```bash
# Using venv
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Or using uv (recommended)
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Copy the `.env.example` file to `.env` and configure:

```bash
cp .env.example .env
```

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection URL | `sqlite+aiosqlite:///./codehs.db` |
| `SECRET_KEY` | JWT secret key (min 32 chars) | *required in production* |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token expiration time | `30` |
| `WS_E2B_URL` | E2B WebSocket URL | `ws://localhost:8765` |

#### Database Configuration

```env
# Development (SQLite)
DATABASE_URL=sqlite+aiosqlite:///./codehs.db

# Production (PostgreSQL)
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/codehs
```

### 4. Run Database Migrations

```bash
# Apply migrations
alembic upgrade head
```

Or let the application create tables automatically on startup.

### 5. Start the Self-Hosted E2B Terminal

The E2B terminal is a WebSocket server that executes code in isolated sandboxes. You need to have it running before starting the backend.

#### Option A: Using the E2B Docker Image

```bash
# Pull and run the E2B terminal
docker run -d \
  --name e2b-terminal \
  -p 8765:8765 \
  -e E2B_API_KEY=your-api-key \
  e2b/terminal:latest
```

#### Option B: Self-Hosted E2B from Source

```bash
# Clone the E2B terminal repository
git clone https://github.com/e2b-dev/terminal.git
cd terminal

# Install dependencies
npm install

# Start the WebSocket server
npm run start -- --port 8765
```

#### Option C: Custom WebSocket Terminal

If you have your own WebSocket terminal implementation, ensure it follows this protocol:

**Client → Server Messages:**

```json
// Create a new sandbox
{
  "action": "create_instance",
  "user_id": 1,
  "sandbox_id": "sandbox-abc123",
  "language": "python"
}

// Execute code
{
  "action": "execute",
  "sandbox_id": "sandbox-abc123",
  "execution_id": "exec-xyz789",
  "code": "print('Hello, World!')",
  "language": "python",
  "input": null,
  "timeout": 30
}

// Send input to running program
{
  "action": "send_input",
  "sandbox_id": "sandbox-abc123",
  "execution_id": "exec-xyz789",
  "input": "user input here"
}

// Terminate sandbox
{
  "action": "terminate_instance",
  "sandbox_id": "sandbox-abc123"
}

// Heartbeat
{
  "action": "ping"
}
```

**Server → Client Messages:**

```json
// Execution output (streaming)
{
  "action": "execution_output",
  "execution_id": "exec-xyz789",
  "stream": "stdout",  // or "stderr"
  "content": "Hello, World!\n"
}

// Execution complete
{
  "action": "execution_complete",
  "execution_id": "exec-xyz789",
  "exit_code": 0,
  "stdout": "Hello, World!\n",
  "stderr": "",
  "timed_out": false
}

// Sandbox created confirmation
{
  "action": "sandbox_created",
  "sandbox_id": "sandbox-abc123"
}

// Sandbox terminated
{
  "action": "sandbox_terminated",
  "sandbox_id": "sandbox-abc123"
}

// Error
{
  "action": "error",
  "code": "SANDBOX_NOT_FOUND",
  "message": "Sandbox sandbox-abc123 not found",
  "sandbox_id": "sandbox-abc123",
  "execution_id": null
}

// Heartbeat response
{
  "action": "pong"
}
```

### 6. Start the Server

```bash
# Development with auto-reload
uvicorn main:app --reload

# Or specify host and port
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at:
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health**: http://localhost:8000/health

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login and get token
- `GET /api/v1/auth/me` - Get current user

### Users
- `GET /api/v1/users` - List users (teachers only)
- `GET /api/v1/users/{id}` - Get user by ID
- `PUT /api/v1/users/{id}` - Update user

### Lessons
- `GET /api/v1/lessons` - List all lessons
- `GET /api/v1/lessons/{id}` - Get lesson with exercises
- `POST /api/v1/lessons` - Create lesson (teachers only)
- `PUT /api/v1/lessons/{id}` - Update lesson (teachers only)
- `DELETE /api/v1/lessons/{id}` - Delete lesson (teachers only)

### Exercises
- `GET /api/v1/exercises` - List exercises
- `GET /api/v1/exercises/{id}` - Get exercise
- `POST /api/v1/exercises` - Create exercise (teachers only)
- `PUT /api/v1/exercises/{id}` - Update exercise (teachers only)
- `DELETE /api/v1/exercises/{id}` - Delete exercise (teachers only)

### Submissions
- `GET /api/v1/submissions` - List submissions
- `GET /api/v1/submissions/{id}` - Get submission
- `POST /api/v1/submissions` - Submit code (executes in E2B sandbox)

### Sandbox
- `GET /api/v1/sandbox` - List user's sandbox sessions
- `POST /api/v1/sandbox` - Create sandbox session
- `GET /api/v1/sandbox/{id}` - Get sandbox status
- `POST /api/v1/sandbox/{id}/execute` - Execute code in sandbox
- `DELETE /api/v1/sandbox/{id}` - Terminate sandbox

### WebSocket Streaming
- `WS /ws/sandbox/{sandbox_id}/execute` - Streaming code execution

#### WebSocket Usage Example

```javascript
// Connect with JWT token
const ws = new WebSocket(`ws://localhost:8000/ws/sandbox/${sandboxId}/execute?token=${token}`);

// Send code for execution
ws.send(JSON.stringify({
  code: 'name = input("Enter name: ")\nprint(f"Hello, {name}!")',
  language: 'python',
  timeout: 30
}));

// Receive streaming output
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.stream === 'stdout') {
    console.log('STDOUT:', data.content);
  } else if (data.stream === 'stderr') {
    console.error('STDERR:', data.content);
  } else if (data.event === 'complete') {
    console.log('Execution complete:', data.exit_code, data.execution_time);
  }
};

// Send input for interactive programs
ws.send(JSON.stringify({ input: 'Alice\n' }));
```

## E2B Service Features

The `E2BService` class provides:

- **Thread-safe WebSocket connection pool** - Single connection reused for all users
- **Automatic reconnection** - Exponential backoff (max 5 retries)
- **Sandbox lifecycle management** - 30-minute inactivity timeout
- **Streaming execution** - Real-time stdout/stderr via callbacks
- **Concurrent execution support** - Multiple executions per user
- **Input relay** - Support for interactive programs

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| E2B WebSocket down | Service runs in degraded mode, submissions marked as pending |
| Sandbox creation fails | Returns 500 error with details |
| Long-running code | Timeout after 30 seconds (configurable) |
| Concurrent executions | Queued per sandbox, executed sequentially |
| Interactive programs | Input relayed via WebSocket or `send_input()` |
| Expired sandboxes | Auto-terminated after 30 min inactivity |
| Connection lost | Auto-reconnect with exponential backoff |

## User Roles

- **student** - Can view lessons, submit code, track progress
- **teacher** - Full access including creating/editing content

## Development

### Running Tests

```bash
pytest
```

### Code Style

The project uses standard Python conventions. Format with:

```bash
ruff check .
ruff format .
```

## Troubleshooting

### E2B Connection Issues

1. **Check E2B terminal is running:**
   ```bash
   curl http://localhost:8765/health
   # or
   wscat -c ws://localhost:8765
   ```

2. **Check WebSocket URL in `.env`:**
   ```env
   WS_E2B_URL=ws://localhost:8765
   ```

3. **Check health endpoint:**
   ```bash
   curl http://localhost:8000/health
   # Response: {"status": "healthy", "e2b_connected": true, ...}
   ```

### Common Errors

| Error | Solution |
|-------|----------|
| `E2B service is not available` | Start E2B terminal, check `WS_E2B_URL` |
| `Sandbox not found` | Create sandbox first via `POST /api/v1/sandbox` |
| `Sandbox has expired` | Create a new sandbox session |
| `Execution timed out` | Code took longer than 30 seconds |

## License

MIT

---

## Testing Flow

After setting up the backend, you can test the full flow:

### 1. Start the E2B Terminal

Make sure your self-hosted E2B terminal is running:
```bash
# If using Docker
docker run -d --name e2b-terminal -p 8765:8765 e2b/terminal:latest
```

### 2. Start the Backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

### 3. Test the API

```bash
# Health check
curl http://localhost:8000/health

# Register a user
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "email": "test@example.com", "password": "password123"}'

# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'

# Get lessons (use token from login)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/v1/lessons

# Submit code (example with exercise ID 1)
curl -X POST http://localhost:8000/api/v1/submissions/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"exercise_id": 1, "code": "print(\"Hello World!\")"}'
```

### 4. WebSocket Testing

```bash
# Connect to WebSocket for streaming execution
wscat -c "ws://localhost:8000/api/v1/ws/execute/1?token=YOUR_TOKEN"

# Send run command
{"type": "run", "exercise_id": 1, "code": "print('Hello World!')", "language": "python"}

# You should receive streaming output messages
```
