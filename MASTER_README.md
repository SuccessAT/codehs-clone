# CodeHS Clone - Complete System

A self-hosted educational coding platform clone of CodeHS, consisting of:
- **Backend**: FastAPI server with E2B sandbox integration
- **Frontend**: React + TypeScript Vite application
- **Execution Engine Options**:
  - Primary: Self-hosted E2B terminal (WebSocket-based)
  - Alternative: Imported library terminal system (Socket.IO-based)

## System Overview

This repository includes two execution engine options:

1. **Primary Execution Engine (Imported Library)**: Socket.IO-based terminal system in the `imported-library/` folder (now integrated with the frontend)
2. **Alternative Execution Engine (E2B Terminal)**: WebSocket-based sandbox system using the official E2B service (available but not currently used by frontend)

```
┌─────────────────┐    HTTPS/WSS    ┌──────────────────┐
│   Browser       │◄───────────────►│   Backend (FastAPI) │
│   (React/Vite)  │                 │                  │
└─────────────────┘                 │  ├── API Routes  │
                                    │  ├── Auth        │
                                    │  ├── Lessons/Exercises │
                                    │  ├── Submissions │
                                    │  ├── Imported Library Service (Primary - Connected to Frontend) │
                                    │  └── E2B Service (Alternative - Available but Not Currently Used) │
                                    │                  │
                                    ▼                  │
                    ┌──────────────────┐       ┌──────────────────┐       │
                    │  Imported Library  │       │  E2B Terminal    │◄──────┘
                    │  Terminal System   │       │  (WebSocket)     │
                    │  (Socket.IO)       │       │  Sandbox Runner  │
                    └──────────────────┘       └──────────────────┘

**Note**: The frontend has been successfully modified to connect to the Imported Library Terminal System via Socket.IO. The E2B Service is still available in the backend but not currently used by the frontend.
```

## Prerequisites

Before you begin, ensure you have installed:

### Backend Requirements
- **Python 3.11+**
- **pip** or **uv** (package manager)
- **Git** (for cloning repositories if needed)

### Frontend Requirements
- **Node.js 18+**
- **npm** or **yarn** (package manager)

### Execution Engine Requirements (Choose One)
- **Option 1 (Primary)**: Docker **OR** Node.js 14+ (for self-hosted E2B terminal)
- **Option 2 (Alternative)**: Python 3.8+ (for imported library terminal system)

## Quick Start

### Option 1: Using Docker Compose (Recommended for Evaluation)
*(If a docker-compose.yml is provided in the repository)*

```bash
# Clone repository
git clone <repository-url>
cd codehs-clone

# Start all services
docker-compose up --build

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Option 2: Manual Local Setup (Development)

Follow these steps to run each component separately for development:

## Step 1: Set Up the Execution Engine (Choose One)

### Option 1: E2B Terminal (Primary - Available but Not Currently Used)
The E2B terminal provides secure sandboxed code execution environments using the official E2B service.
**Note**: The frontend has been modified to use the Imported Library Terminal System instead, but this option remains available.

#### Using Docker (Recommended)
```bash
# Pull and run the E2B terminal
docker run -d \
  --name e2b-terminal \
  -p 8765:8765 \
  -e E2B_API_KEY=your_e2b_api_key_here \
  e2b/terminal:latest
```

> **Note**: Get your E2B API key from https://e2b.dev if you don't have one.
> For local development without actual sandboxing, you can use any value for the API key.

#### Using Self-Hosted E2B from Source
```bash
# Clone the E2B terminal repository
git clone https://github.com/e2b-dev/terminal.git
cd terminal

# Install dependencies
npm install

# Start the WebSocket server on port 8765
npm run start -- --port 8765
```

#### Using Custom WebSocket Terminal
If you have your own WebSocket terminal implementation, ensure it follows the protocol documented in `backend/README.md` and is accessible at `ws://localhost:8765`.

### Option 2: Imported Library Terminal System (Primary - Now Integrated with Frontend)
This is the imported library folder that provides a Socket.IO-based terminal system.
**Note**: The frontend IS now configured to connect to this system via Socket.IO.

```bash
# Navigate to imported-library directory
cd imported-library

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
export E2B_API_KEY=your_e2b_api_key_here  # On Windows: set E2B_API_KEY=your_e2b_api_key_here

# Start the Socket.IO server (default port 8000)
python socketio_server.py
```

> **Important Notes**:
> 1. The imported library system runs on port 8001 **changed* by default, which conflicts with the backend (also port 8000).
> 2. To use this system, you would need to:
>    - Change the port in `imported-library/socketio_server.py` (e.g., to 8001), OR
>    - Run the backend on a different port and update frontend API configuration accordingly
> 3. **Important**: The frontend has already been modified to connect to this Socket.IO server instead of the backend's WebSocket endpoints.
>    - Socket.IO client connections have been implemented in the frontend
>    - The `useSocketExecution` hook has been created and is being used
>    - The API service handles terminal operations via Socket.IO events
```

## Step 2: Set Up the Backend

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv
# On Windows: venv\Scripts\activate
# On Unix/MacOS: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env to set:
#   WS_E2B_URL=ws://localhost:8765
#   SECRET_KEY=your-super-secret-key-change-in-production-min-32-chars
#   (other variables as needed)

# Run database migrations
alembic upgrade head

# Start the server
uvicorn main:app --reload --port 8000
```

The backend will be available at:
- **API**: http://localhost:8000
- **Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

## Step 3: Set Up the Frontend

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Configure environment variables (optional)
# Create .env file with:
#   VITE_API_URL=http://localhost:8000
#   VITE_SOCKET_URL=http://localhost:8000  # For Socket.IO connection to imported-library

# Start the development server
npm run dev
```

The frontend will be available at: http://localhost:5173

## Step 4: Verify the Full System

1. Ensure all three components are running:
   - Imported Library Terminal System (Socket.IO server on port 8000)
   - Backend server (port 8000) - Note: This conflicts with the imported library system, so you'll need to run them on different ports or machines
   - Frontend server (port 5173)

2. Open your browser to http://localhost:5173

3. Register a new account or login with existing credentials

4. Navigate to a lesson and try the "Run" and "Submit" buttons to verify code execution works

> **Note**: Since both the imported library system and backend run on port 8000 by default, you'll need to:
> 1. Change the port in `imported-library/socketio_server.py` (e.g., to 8001), OR
> 2. Run the backend on a different port (e.g., 8001) and update frontend API configuration accordingly
> 3. Or run them on separate machines/devices

## Environment Variables

### Backend (.env file)
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection URL | `sqlite+aiosqlite:///./codehs.db` |
| `SECRET_KEY` | JWT secret key (min 32 chars) | *required* |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token expiration time | `30` |
| `WS_E2B_URL` | E2B WebSocket URL | `ws://localhost:8765` |

### Frontend (.env file)
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:8000` |

## Testing the Setup

After all components are running, you can test the system:

### Backend API Test
```bash
# Health check
curl http://localhost:8000/health

# Register a test user
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "email": "test@example.com", "password": "password123"}'

# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'
```

### Frontend Test
1. Visit http://localhost:5173
2. Register using the form
3. Create a lesson and exercise (if sample data isn't loaded)
4. Try running and submitting code

## Troubleshooting

### E2B Terminal Issues
- **Connection refused**: Ensure the E2B terminal is running on port 8765
- **API key errors**: Verify `E2B_API_KEY` is set correctly in Docker run command
- **Health check fails**: Try `curl http://localhost:8765/health` (if health endpoint exists)

### Backend Issues
- **Database errors**: Run `alembic upgrade head` to ensure migrations are applied
- **Module not found**: Ensure you're in the backend directory and virtual environment is activated
- **Port already in use**: Change the port in `uvicorn` command or free up port 8000

### Frontend Issues
- **Dependency errors**: Try deleting `node_modules` and `package-lock.json` then run `npm install`
- **Port already in use**: Vite will usually try the next available port (5174, 5175, etc.)
- **API connection errors**: Verify `VITE_API_URL` in `.env` matches your backend URL

### Common Issues
- **CORS errors**: Ensure backend CORS middleware allows `http://localhost:5173`
- **WebSocket connection fails**: Check that the backend is running and WS endpoint is correct
- **Port conflicts**: The imported library system runs on port 8000 by default, which conflicts with the backend. Either change the port in imported-library/socketio_server.py or run the systems on different machines.
- **Slow first load**: Initial container/image pulls may take time

## Development Workflow

### Making Changes
1. **Backend**: Modify Python files, then restart `uvicorn main:app --reload`
2. **Frontend**: Modify TypeScript/Vue files, changes will hot-reload via Vite
3. **E2B Terminal**: Usually no changes needed unless modifying the execution engine

### Debugging
- **Backend logs**: Check terminal where `uvicorn` is running
- **Frontend logs**: Check browser developer console
- **E2B logs**: Check Docker logs (`docker logs e2b-terminal`) or terminal output

## Production Deployment Notes

For production deployment, consider:

1. **Database**: Use PostgreSQL instead of SQLite
2. **Security**: 
   - Use strong SECRET_KEY
   - Enable HTTPS
   - Configure proper CORS origins
3. **E2B Terminal**:
   - Use proper API key management
   - Consider resource limits and monitoring
   - Ensure adequate sandbox cleanup
4. **Backend**:
   - Use production ASGI server (e.g., Gunicorn with Uvicorn workers)
   - Enable proper logging
   - Consider using a process manager (PM2, systemd, etc.)
5. **Frontend**:
   - Build for production: `npm run build`
   - Serve static files via CDN or web server (nginx, Apache)
6. **Infrastructure**:
   - Use Docker Compose or Kubernetes for orchestration
   - Set up monitoring and logging
   - Configure backups for database

## Project Structure

```
codehs-clone/
├── backend/                  # FastAPI backend
│   ├── main.py              # Application entry point
│   ├── database.py          # DB configuration
│   ├── models.py            # SQLAlchemy models
│   ├── schemas.py           # Pydantic schemas
│   ├── e2b_service.py       # E2B integration service (Primary)
│   ├── requirements.txt     # Python dependencies
│   ├── alembic/             # Database migrations
│   └── .env.example         # Environment template
├── frontend/                 # React/Vite frontend
│   ├── src/                 # Source code
│   │   ├── components/      # Reusable components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom hooks
│   │   ├── store/           # Zustand stores
│   │   ├── api/             # API client
│   │   └── types/           # TypeScript definitions
│   ├── package.json
│   ├── tailwind.config.ts
│   └── vite.config.ts
├── imported-library/         # Alternative terminal system (Socket.IO-based)
│   ├── socketio_server.py   # Socket.IO server for terminal management
│   ├── app.py               # Main application (alternative to backend)
│   ├── file_manager.py      # File system operations
│   ├── terminal_manager.py  # Terminal session management
│   ├── project.py           # Project management
│   ├── working_terminal.py  # Terminal interaction
│   ├── requirements.txt     # Python dependencies
│   ├── test_socketio_client.py  # Test client
│   └── README.md            # Detailed documentation
└── (optional) docker-compose.yml  # For containerized deployment
```

## License

MIT

## Acknowledgments

- [E2B](https://e2b.dev) for the secure sandbox infrastructure
- [CodeHS](https://codehs.com) for the educational platform inspiration
- The imported library terminal system for alternative Socket.IO-based terminal management
- All open source libraries used in this project