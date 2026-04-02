import { useState, useCallback, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Marker to detect when execution is complete in the PTY terminal
const EXEC_DONE_MARKER = '__E2B_EXEC_DONE__';

// Default project directory in e2b sandbox
const PROJECT_DIR = '/home/user/project';

// Language to file/command mapping for e2b sandbox execution
const LANGUAGE_CONFIG: Record<string, { filename: string; command: string }> = {
    python: { filename: 'main.py', command: 'python3' },
    javascript: { filename: 'main.js', command: 'node' },
    typescript: { filename: 'main.ts', command: 'npx ts-node --transpile-only' },
    java: { filename: 'Main.java', command: 'javac Main.java && java Main' },
    c: { filename: 'main.c', command: 'gcc main.c -o _exec && ./_exec' },
    cpp: { filename: 'main.cpp', command: 'g++ main.cpp -o _exec && ./_exec' },
};

interface GradingResult {
    passed: boolean;
    total_tests: number;
    passed_tests: number;
    score: number;
    feedback: string;
    test_results: Array<{
        test_number: number;
        passed: boolean;
        is_hidden: boolean;
        input?: string;
        expected?: string;
        match_type: string;
    }>;
}

// ─── Shell-noise patterns to suppress from e2b PTY output ────────────────────
// The PTY sets PS1='user> ', so we strip lines that are just the prompt.
const PROMPT_PATTERN = /^user>\s*$/m;
// The ANSI clear screen that happens on terminal init
const CLEAR_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

function cleanTerminalLine(line: string): string {
    return line.replace(CLEAR_PATTERN, '');
}

export function useExecution(exerciseId: number, language?: string) {
    const [stdout, setStdout] = useState('');
    const [stderr, setStderr] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [waitingForInput, setWaitingForInput] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sandboxReady, setSandboxReady] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);
    const [usingE2B, setUsingE2B] = useState(false);

    // Socket.IO refs (e2b execution)
    const socketRef = useRef<Socket | null>(null);
    const terminalIdRef = useRef<string | null>(null);
    const isExecutingRef = useRef(false);
    // Suppress echoed command line from PTY
    const suppressNextLineRef = useRef(false);
    // Buffer for partial lines
    const partialLineRef = useRef('');

    // WebSocket refs (fallback local executor)
    const wsRef = useRef<WebSocket | null>(null);

    const { token, user } = useAuthStore();
    const lang = language || 'python';

    // ─── Socket.IO (e2b) ───────────────────────────────────────────────────────

    const connectSocketIO = useCallback(() => {
        if (socketRef.current?.connected) return;

        const socket = io({
            path: '/ws/socket.io',
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 2000,
            timeout: 10000,
        });

        socket.on('connect', () => {
            console.log('[e2b] Socket.IO connected');
        });

        socket.on('connection_established', () => {
            const projectId = `user-${user?.id ?? 'anon'}-ex-${exerciseId}`;
            socket.emit('create_project', { type: 'base', id: projectId });
        });

        socket.on('project_initializing', () => {
            console.log('[e2b] Project initializing (creating sandbox)…');
        });

        socket.on('project_ready', () => {
            socket.emit('project_command', { command: 'createTerminal', args: {} });
        });

        socket.on('command_result', ({ command, result }: { command: string; result: Record<string, unknown> }) => {
            if (command === 'createTerminal' && result?.id) {
                terminalIdRef.current = result.id as string;
                setUsingE2B(true);
                setSandboxReady(true);
                setError(null);
                console.log('[e2b] Terminal ready:', result.id);
            }
        });

        socket.on('terminalResponse', ({ id, data }: { id: string; data: string }) => {
            if (id !== terminalIdRef.current) return;
            if (!isExecutingRef.current) return;

            const cleaned = cleanTerminalLine(data);

            // Check for our done marker — execution finished
            if (cleaned.includes(EXEC_DONE_MARKER)) {
                const before = cleaned.split(EXEC_DONE_MARKER)[0];
                if (before && !PROMPT_PATTERN.test(before)) {
                    setStdout(prev => prev + before);
                }
                setIsExecuting(false);
                isExecutingRef.current = false;
                suppressNextLineRef.current = false;
                partialLineRef.current = '';
                return;
            }

            // Skip pure shell prompts
            if (PROMPT_PATTERN.test(cleaned.trim())) return;

            // Suppress the echoed command line right after we send the command
            if (suppressNextLineRef.current && cleaned.includes('\r\n')) {
                suppressNextLineRef.current = false;
                const afterEcho = cleaned.substring(cleaned.indexOf('\r\n') + 2);
                if (afterEcho && !PROMPT_PATTERN.test(afterEcho)) {
                    setStdout(prev => prev + afterEcho);
                }
                return;
            }

            if (cleaned) {
                setStdout(prev => prev + cleaned);
            }
        });

        socket.on('project_error', ({ error: err }: { error: string }) => {
            console.warn('[e2b] Project error:', err);
            setError(`Sandbox error: ${err}`);
            setSandboxReady(false);
            setUsingE2B(false);
            // Fall back to WebSocket
            connectWebSocket();
        });

        socket.on('error', ({ message }: { message: string }) => {
            console.warn('[e2b] Error:', message);
            if (!sandboxReady) {
                setError(message);
            }
        });

        socket.on('connect_error', (err: Error) => {
            console.warn('[e2b] connect_error:', err.message, '— falling back to local executor');
            setUsingE2B(false);
            connectWebSocket();
        });

        socket.on('disconnect', () => {
            console.log('[e2b] Socket.IO disconnected');
            setSandboxReady(false);
            setIsExecuting(false);
            terminalIdRef.current = null;
            setUsingE2B(false);
        });

        socketRef.current = socket;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, exerciseId]);

    // ─── WebSocket fallback (local executor via backend) ──────────────────────

    const connectWebSocket = useCallback(() => {
        if (!token || !user) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        wsRef.current?.close();

        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsBase = API_BASE_URL
            ? API_BASE_URL.replace(/^https?/, wsProto.replace(':', ''))
            : `${wsProto}//${window.location.host}`;
        const wsUrl = `${wsBase}/api/v1/ws/execute/${user.id}?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[fallback] WebSocket connected');
            setSandboxReady(true);
            setError(null);
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case 'sandbox_ready':
                        setSandboxReady(true);
                        setError(null);
                        break;
                    case 'stdout':
                        setStdout(prev => prev + (message.data as { content: string }).content);
                        break;
                    case 'stderr':
                        setStderr(prev => prev + (message.data as { content: string }).content);
                        break;
                    case 'error':
                        setError((message.data as { message: string }).message);
                        break;
                    case 'waiting_for_input':
                        setWaitingForInput(true);
                        break;
                    case 'complete':
                        setIsExecuting(false);
                        setWaitingForInput(false);
                        break;
                    case 'grading_result':
                        setGradingResult(message.data as GradingResult);
                        break;
                }
            } catch (e) {
                console.error('[fallback] Failed to parse message:', e);
            }
        };

        ws.onerror = () => {
            setError('Connection error — execution unavailable');
        };

        ws.onclose = () => {
            setSandboxReady(false);
            setIsExecuting(false);
        };

        wsRef.current = ws;
    }, [token, user]);

    // ─── Public API ───────────────────────────────────────────────────────────

    const connect = useCallback(() => {
        connectSocketIO();
    }, [connectSocketIO]);

    const disconnect = useCallback(() => {
        socketRef.current?.disconnect();
        wsRef.current?.close();
        wsRef.current = null;
        setSandboxReady(false);
        setUsingE2B(false);
    }, []);

    const runCode = useCallback(async (code: string) => {
        setStdout('');
        setStderr('');
        setError(null);
        setGradingResult(null);
        setIsExecuting(true);
        isExecutingRef.current = true;

        // ── e2b path ──────────────────────────────────────────────────────────
        if (usingE2B && socketRef.current?.connected && terminalIdRef.current) {
            const config = LANGUAGE_CONFIG[lang] ?? LANGUAGE_CONFIG.python;
            const filePath = `${PROJECT_DIR}/${config.filename}`;

            // For compiled languages run from project dir; for interpreted run directly
            const isCompiled = ['java', 'c', 'cpp'].includes(lang);
            const runCommand = isCompiled
                ? `cd ${PROJECT_DIR} && ${config.command}`
                : `${config.command} ${filePath}`;

            // 1. Save the source file
            socketRef.current.emit('project_command', {
                command: 'saveFile',
                args: { path: filePath, content: code },
            });

            // 2. Wait briefly for the file write, then run with done marker
            await new Promise(r => setTimeout(r, 350));
            suppressNextLineRef.current = true;

            socketRef.current.emit('project_command', {
                command: 'runCommand',
                args: {
                    terminalId: terminalIdRef.current,
                    command: `${runCommand} 2>&1; printf '\\n${EXEC_DONE_MARKER}\\n'`,
                },
            });
            return;
        }

        // ── WebSocket fallback ────────────────────────────────────────────────
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            connectWebSocket();
            await new Promise<void>((resolve) => {
                const check = () => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) resolve();
                    else setTimeout(check, 150);
                };
                setTimeout(check, 500);
            });
        }

        wsRef.current?.send(JSON.stringify({
            type: 'run',
            exercise_id: exerciseId,
            code,
            language: lang,
        }));
    }, [usingE2B, lang, exerciseId, connectWebSocket]);

    const cancelExecution = useCallback(() => {
        if (usingE2B && socketRef.current?.connected && terminalIdRef.current) {
            socketRef.current.emit('project_command', {
                command: 'stopCommand',
                args: { terminalId: terminalIdRef.current },
            });
        } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'cancel' }));
        }
        setIsExecuting(false);
        isExecutingRef.current = false;
        setWaitingForInput(false);
    }, [usingE2B]);

    const sendInput = useCallback((input: string) => {
        if (usingE2B && socketRef.current?.connected && terminalIdRef.current) {
            socketRef.current.emit('project_command', {
                command: 'terminalData',
                args: { id: terminalIdRef.current, data: input + '\n' },
            });
        } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'input', data: input }));
        }
        setWaitingForInput(false);
    }, [usingE2B]);

    const reset = useCallback(() => {
        setStdout('');
        setStderr('');
        setError(null);
        setGradingResult(null);
        setWaitingForInput(false);
    }, []);

    // Connect Socket.IO on mount
    useEffect(() => {
        connectSocketIO();
        return () => {
            disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        stdout,
        stderr,
        isExecuting,
        waitingForInput,
        error,
        sandboxReady,
        gradingResult,
        usingE2B,
        runCode,
        cancelExecution,
        sendInput,
        reset,
        connect,
        disconnect,
    };
}
