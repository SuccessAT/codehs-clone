# CodeHS Clone - Frontend

A React + TypeScript frontend for a CodeHS-like educational coding platform.

## Tech Stack

- **Vite** - Build tool and dev server
- **React 18** - UI library
- **TypeScript** - Type safety
- **TailwindCSS** - Styling
- **Monaco Editor** - Code editor (same as VS Code)
- **Zustand** - State management
- **React Router v6** - Routing

## Project Structure

```
frontend/
├── src/
│   ├── api/           # API client
│   ├── components/     # Reusable components
│   ├── hooks/         # Custom React hooks
│   ├── pages/         # Page components
│   ├── store/         # Zustand stores
│   ├── types/         # TypeScript types
│   ├── App.tsx        # Main app component
│   ├── main.tsx       # Entry point
│   └── index.css      # Global styles
├── package.json
├── tailwind.config.ts
├── vite.config.ts
└── README.md
```

## Prerequisites

- Node.js 18+
- npm or yarn

## Setup Instructions

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file (optional - defaults work for local development):

```env
VITE_API_URL=http://localhost:8000
```

### 3. Start the Development Server

```bash
npm run dev
```

The app will be available at http://localhost:5173

## Development

### Running the Full Stack Locally

1. **Terminal 1 - E2B Terminal** (if using self-hosted e2b):
   ```bash
   # Your e2b terminal setup
   docker run -d --name e2b-terminal -p 8765:8765 e2b/terminal:latest
   ```

2. **Terminal 2 - Backend**:
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env to set WS_E2B_URL=ws://localhost:8765
   pip install -r requirements.txt
   alembic upgrade head
   uvicorn main:app --reload --port 8000
   ```

3. **Terminal 3 - Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Features

### Code Execution Flow

The app differentiates between **Run** (instant feedback) and **Submit** (graded submission):

| Feature | Run Button | Submit Button |
|---------|-----------|---------------|
| Purpose | Instant feedback while learning | Record progress + get grade |
| Trigger | Click "Run" or Ctrl+Enter | Click "Submit" |
| What happens | Send code to e2b → stream stdout/stderr live | 1. Save code to DB<br>2. Re-run in e2b<br>3. Compare output vs test_cases<br>4. Save Submission record |
| UI Feedback | Real-time console output | Modal: "Passed 3/4 tests" + detailed feedback |
| Persisted? | No (temporary) | Yes – Submission table + history |

### Key Pages

1. **/** - Landing page with login/register
2. **/login** - User login
3. **/register** - User registration
4. **/dashboard** - Lesson browser with progress
5. **/lesson/:lessonId** - Lesson viewer with video, quiz, exercises
6. **/exercise/:exerciseId** - Full IDE with:
   - Monaco Editor
   - Instructions sidebar
   - Run button (WebSocket streaming)
   - Submit button (REST API + autograding)
   - Console output
   - Submission history

### Autograding

Exercises can have test cases. When you submit code:
1. Code runs in E2B sandbox
2. Output is compared against expected test case outputs
3. Results show which tests passed/failed

## API Integration

The frontend communicates with the backend via:

- **REST API** - For CRUD operations and submissions
- **WebSocket** - For streaming code execution

### Key Endpoints

- `GET /api/v1/lessons/` - List lessons
- `GET /api/v1/lessons/:id` - Get lesson with exercises
- `GET /api/v1/exercises/:id` - Get exercise details
- `POST /api/v1/submissions/` - Submit code (triggers execution + grading)
- `GET /api/v1/users/me/progress` - Get user progress
- `WS /api/v1/ws/execute/:userId` - Streaming execution

## Troubleshooting

### CORS Errors

If you see CORS errors, ensure the backend allows the frontend origin:

```python
# In backend/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### WebSocket Connection Issues

1. Check that the backend is running
2. Verify the JWT token is valid
3. Check browser console for errors

### API Errors

Check the browser network tab for error responses. Common issues:
- 401: Not authenticated (login first)
- 404: Resource not found
- 500: Server error (check backend logs)

## License

MIT
