# Interactive Mode Quick‑Start Guide

This walkthrough shows any CSC developer how to stand up the Socket IO sandbox locally, create & run code inside the container, and avoid the common pitfalls we have just debugged.

---

## 1. Prerequisites

| Tool                | Version | Notes                                                           |
| ------------------- | ------- | --------------------------------------------------------------- |
| Python              | ≥ 3.10  | The CLI scripts are tested with 3.13 but anything ≥ 3.10 works. |
| pip                 | latest  | for installing packages below                                   |
| Poetry**or**venv    | –       | use whichever you prefer to manage deps                         |
| **python-socketio** | 5.x     | Installed automatically via `requirements.txt`                  |
| **aioconsole**      | latest  | Enables non‑blocking keyboard input in the CLI                  |

```bash
# from repo root
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 2. Start the Web‑Socket server

```bash
python socketio_server.py
```

You should see a line like:

```
Server started at http://0.0.0.0:8000
```

Keep this terminal **open** ; it hosts the container.

---

## 3. Open a second terminal for the interactive client

```bash
python test_socketio_client.py --mode interactive
```

When the prompt appears, type:

1. **`create`** – creates a fresh project (you can also type `join <id>` to reconnect).
2. Watch for **“Project … is ready”** before proceeding.

---

## 4. Essential interactive commands

| Command              | What it does                                                                              | Example                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `term <id>`          | Create a new terminal inside the container                                                | `term main_terminal`                                                            |
| `mkdir <dir>`        | Make directory                                                                            | `mkdir test`                                                                    |
| `file <path> <code>` | Create/overwrite a file. Newlines =`\n`. If `<code>`is omitted the file is created empty. | `file test/hello.py` `file test/hello.py "#!/usr/bin/env python3\nprint('hi')"` |
| `save <path> <code>` | Overwrite an**existing**file only                                                         | `save test/hello.py "print('updated')"`                                         |
| `run <term> <cmd>`   | Run shell command in given terminal                                                       | `run main_terminal python test/hello.py`                                        |
| `send <term> <text>` | Send raw keystrokes (handy for script input)                                              | `send main_terminal MyName`                                                     |
| `close <term>`       | Close the terminal                                                                        | `close main_terminal`                                                           |
| `exit`               | Quit the CLI (project stays alive if other clients attached)                              | –                                                                               |

> **Tip — multiline code** Use `\n` inside the `file`/`save` command to embed newlines, or create the file empty and then use `save`.

---

## 5. Example end‑to‑end workflow

```text
> term main_terminal                  # 1 create terminal
> mkdir test                          # 2 make dir
> file test/hello.py "#!/usr/bin/env python3\nname = input('Name: ')\nprint(f'Hi {name}!')"   # 3 create + write file
> run main_terminal python test/hello.py   # 4 run it
  Name: _type here_                   # 5 interactive input prompt
> close main_terminal                 # 6 tidy up terminal
```

What you should see in the server log:

- PTY created → _pid ###_
- `python …` executed
- User input transmitted
- Script output

---

## 6. Troubleshooting cheatsheet

| Symptom                                                    | Cause                                               | Fix                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **`bash: … Permission denied`**when running `./file.py`    | Execute bit not set                                 | Use `python file.py` **or** `chmod +x file.py`then rerun                                       |
| **`process with pid … not found`/`0 is not a valid Code`** | Terminal sat idle > 30 s – PTY auto‑reaped          | Edit `working_terminal.py`and set `timeout=None` *or*adopt the keep‑alive snippet (see README) |
| File saves in test mode but not interactive                | `file`command sent list not string                  | Already fixed on branch `fix/file-content-as-string`                                           |
| Socket disconnects after ~30 s of silence                  | `input()`blocks the event‑loop so heart‑beat missed | Fixed by using `aioconsole.ainput()`in the CLI                                                 |

---

## 7. Shutting everything down cleanly

1. In the CLI type `exit` (or `Ctrl‑C`).
2. Watch the server log – it will print _“Last client … closing project”_ once all sessions detach.
3. Press `Ctrl‑C` in the server window to stop the cleanup task and exit.

That’s it – your local sandbox is now clean and the E2B container has been released.

---

### Maintainer notes

- The default container template is **`base`** ; adjust in `socketio_server.py → create_project` if you need a custom Docker image.
- Environment variables (API keys, etc.) live in `.env.local` – never commit secrets.
- Keep the **PTY timeout** and **keep‑alive task** settings aligned. If you raise one, drop the other.
