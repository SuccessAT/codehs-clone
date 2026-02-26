import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '@/store';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface ExecutionMessage {
    type: string;
    data: unknown;
    timestamp?: string;
}

interface ExecutionResult {
    stdout: string;
    stderr: string;
    exit_code: number;
    execution_time: number;
    timed_out: boolean;
    error?: string;
}

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

export function useExecution(exerciseId: number, language?: string) {
    const [stdout, setStdout] = useState('');
    const [stderr, setStderr] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sandboxReady, setSandboxReady] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const { token, user } = useAuthStore();

    // Default language if not provided
    const lang = language || 'python';

    // Connect to WebSocket
    const connect = useCallback(() => {
        if (!token || !user) {
            setError('Not authenticated');
            return;
        }

        // Close existing connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/api/v1/ws/execute/${user.id}?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const message: ExecutionMessage = JSON.parse(event.data);

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
                    case 'complete':
                        setIsExecuting(false);
                        // Keep the output for reference
                        break;
                    case 'grading_result':
                        const grading = message.data as GradingResult;
                        setGradingResult(grading);
                        break;
                    case 'grading':
                        // Intermediate grading progress
                        break;
                }
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        ws.onerror = (e) => {
            console.error('WebSocket error:', e);
            setError('WebSocket connection error');
        };

        ws.onclose = (e) => {
            console.log('WebSocket closed:', e.code, e.reason);
            setSandboxReady(false);
            setIsExecuting(false);
        };

        wsRef.current = ws;
    }, [token, user]);

    // Disconnect
    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setSandboxReady(false);
    }, []);

    // Run code via WebSocket
    const runCode = useCallback(async (code: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            connect();
            // Wait for connection
            await new Promise<void>((resolve) => {
                const checkConnection = () => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                setTimeout(checkConnection, 500);
            });
        }

        // Reset output
        setStdout('');
        setStderr('');
        setError(null);
        setGradingResult(null);
        setIsExecuting(true);

        // Send run message
        wsRef.current?.send(JSON.stringify({
            type: 'run',
            exercise_id: exerciseId,
            code,
            language: lang,
        }));
    }, [exerciseId, lang, connect]);

    // Cancel execution
    const cancelExecution = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'cancel',
            }));
        }
        setIsExecuting(false);
    }, []);

    // Reset output
    const reset = useCallback(() => {
        setStdout('');
        setStderr('');
        setError(null);
        setGradingResult(null);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

    return {
        stdout,
        stderr,
        isExecuting,
        error,
        sandboxReady,
        gradingResult,
        runCode,
        cancelExecution,
        reset,
        connect,
        disconnect,
    };
}
