**`README.md` – Full Project Overview & Development Guide**  
**Project Name:** `codehs-clone` – A Self-Hosted Educational Coding Platform (CodeHS Alternative)

---

### 1. Project Goal & Overview
This is a **complete, self-hosted clone** of the core CodeHS experience focused on structured learning:

- Teachers/admins create **Lessons** (with video, description, order)
- Lessons contain **Exercises** (starter code, language, test cases, optional quiz questions)
- Students browse lessons → watch video → do quiz → open IDE with example/starter code
- **Run code instantly** (real-time streaming output) → edit → **Submit for grading**
- All code execution happens securely in your **already-built self-hosted e2b WebSocket terminal**

The app is designed so that **one developer (you) can run it locally** and later share the link with students/friends via ngrok or local network.

**Core Philosophy (tell this to every AI prompt):**  
“Separate **instant execution** (for learning/experimenting) from **graded submission** (for progress tracking). Never mix them. Execution = live sandbox run. Submission = save + autograde + record in DB.”

---

### 2. Tech Stack (Exact Versions Expected)

**Backend** (port 8000)
- FastAPI + Uvicorn
- SQLAlchemy 2.0 + Alembic
- SQLite (dev) / PostgreSQL (prod)
- JWT auth (simple implementation)
- Async WebSocket manager

**Frontend** (port 5173)
- Vite + React 18 + TypeScript
- TailwindCSS + shadcn/ui
- Monaco Editor (@monaco-editor/react)
- Zustand (state)
- React Router v6
- Axios + native WebSocket

**Execution Engine**
- Your existing self-hosted e2b WebSocket terminal (configurable via `WS_E2B_URL`)

---

### 3. Architecture Overview (Draw This in Your Mind)

```
Browser (React)
   ↓ HTTPS / WS
FastAPI Backend (main.py)
   ├── Auth routes
   ├── Lesson / Exercise CRUD
   ├── Submission storage
   └── E2BService → WebSocket to your e2b terminal
         ↓
Your self-hosted e2b terminal (creates isolated sandboxes)
```

Frontend **never** talks directly to e2b. All communication goes through backend.

---

### 4. Complete Page Flow & Routes (Frontend Must Implement Exactly These)

#### Public Pages
1. **`/` – Landing Page**  
   - Hero section: “Learn to code like in CodeHS – 100% self-hosted”  
   - “Browse Sample Lessons” button (redirects to /lessons if logged in, else /login)  
   - Login / Register buttons  
   - Footer with tech stack

2. **`/login`** & **`/register`**  
   - Simple form (username, email, password)  
   - After success → redirect to `/lessons`  
   - Store JWT in localStorage + Zustand

#### Protected Pages (require valid JWT)
3. **`/lessons`** – Lesson Browser  
   - Sidebar: list of all lessons (title + progress bar)  
   - Main area: grid of lesson cards (video thumbnail, title, “Start” button)  
   - Click card → `/lesson/:lessonId`

4. **`/lesson/:lessonId`** – Lesson Viewer  
   - Top: Video embed (YouTube/Vimeo iframe) + lesson description  
   - Middle: “Quiz” section (multiple choice, auto-score)  
   - Bottom: List of Exercises in this lesson  
   - Click exercise → `/exercise/:exerciseId`

5. **`/exercise/:exerciseId`** – Main IDE Page (the “heart” of the app)
   - **Left sidebar (25%)**: Lesson navigation + Exercise instructions + Test cases preview
   - **Center (55%)**: Monaco Editor (full featured, language selector)
   - **Right sidebar (20%)**: 
     - Live User List (stub for now: “You + 2 others”)
     - Version History (later sprint)
   - **Bottom console (20% height)**: 
     - Tabs: Output | Problems | Input (for interactive programs)

**Navigation Flow Summary**  
Landing → Login → Lessons → Lesson Viewer → Exercise IDE  
From anywhere: top navbar with “Lessons”, “My Progress”, “Logout”

---

### 5. Critical Differentiation: Code Execution vs Exercise Submission

**This is the #1 thing the AI must get right.**

| Feature                  | Code Execution (Run button)                  | Exercise Submission (Submit button)             |
|--------------------------|----------------------------------------------|-------------------------------------------------|
| Purpose                  | Instant feedback while learning              | Record progress + get official grade            |
| Triggers                 | Click “Run” or Ctrl+Enter                    | Click “Submit” (only enabled after Run passes) |
| What happens             | Send code to e2b → stream stdout/stderr live | 1. Save code to DB<br>2. Re-run in e2b<br>3. Compare output vs test_cases<br>4. Save Submission record |
| UI Feedback              | Real-time console output (colors, ANSI)      | Modal: “Passed 3/4 tests” + detailed feedback  |
| Persisted?               | No (temporary)                               | Yes – Submission table + history               |
| Sandbox lifetime         | Same sandbox reused during session           | Same sandbox (but results saved)               |
| Can be done offline?     | No                                           | No                                             |

**Message formats (exact JSON)**

**Execution request (WS)**
```json
{
  "action": "run",
  "exerciseId": 5,
  "code": "print('hello')",
  "language": "python"
}
```

**Submission request (HTTP POST)**
```json
POST /api/submissions/
{ "exercise_id": 5, "code": "..." }
```

**Streaming response (WS)**
```json
{ "type": "stdout", "data": "hello\n" }
{ "type": "stderr", "data": "error..." }
{ "type": "exit", "code": 0 }
```

---

### 6. Frontend ↔ Backend Communication Rules

- **All HTTP calls** → `http://localhost:8000/api/...` (Axios instance with Authorization header)
- **WebSocket** → `ws://localhost:8000/ws/execute` (one persistent connection per user)
- Backend must attach the current user’s sandbox to the WS connection
- On frontend mount of Exercise page: connect WS automatically
- On unmount: gracefully close WS (backend keeps sandbox alive 30 min)

**CORS**: Backend must allow origin `http://localhost:5173`

---

### 7. Login & Authentication Flow

1. User registers → password hashed with bcrypt
2. Login → returns JWT (valid 24h)
3. Every protected route & WS connection validates JWT
4. Frontend stores JWT in localStorage + Zustand store
5. On page refresh → auto-login from token (try /me endpoint)
6. Role system (student/teacher) – teacher can see all submissions (future sprint)

---

### 8. Database Models (Must Exist)

- `users`
- `lessons`
- `exercises` (starter_code, language, test_cases JSONB)
- `quiz_questions` (linked to exercise)
- `submissions` (user_id, exercise_id, code, output, status, passed_tests)
- `sandbox_sessions` (user_id, sandbox_id_from_e2b, last_active)

---

### 9. Sample Data (Seed on First Run)

3 lessons minimum:
1. “Python Basics” – 4 exercises (print, variables, loops, functions)
2. “JavaScript Canvas” – drawing exercises
3. “Intro to Karel” – grid movement simulation

---

### 10. Local Development Setup (Exact Commands)

```bash
# 1. Terminal 1 – Your e2b WebSocket terminal (you already have this)
#    Make sure it's running and listening on WS_E2B_URL (default ws://localhost:8765)

# 2. Terminal 2 – Backend
cd backend
cp .env.example .env
# Edit .env → WS_E2B_URL=ws://localhost:8765
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000

# 3. Terminal 3 – Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

### 11. Full Testing Flow (Do This After Every Sprint)

1. Register/login
2. Go to /lessons → click “Python Basics”
3. Watch video → complete quiz
4. Click first exercise
5. Editor loads starter code
6. Click **Run** → see live output in console
7. Modify code → Run again
8. Click **Submit** → see grading modal
9. Go back to lesson list → see progress updated

---

### 12. Other Necessities the AI Must Implement

- Responsive design (mobile-friendly)
- Dark theme only (like CodeHS)
- Loading spinners everywhere
- Error boundaries & toast notifications
- Keyboard shortcuts (Ctrl+Enter = Run, Ctrl+S = Save draft)
- Auto-save draft every 10s (localStorage + optional backend)
- Console supports `input()` for interactive programs (show input field when sandbox waits)
- Version history stub (later)
- Export code button
- Clear console button

---

### 13. Deployment Notes (Future)

- Use Docker Compose (one file for backend + frontend)
- Expose via ngrok: `ngrok http 5173` and `ngrok http 8000`
- Change WS_E2B_URL to your public e2b terminal URL
