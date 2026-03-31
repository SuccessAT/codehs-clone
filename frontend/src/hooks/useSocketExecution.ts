import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '@/store';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000';

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

export function useSocketExecution(exerciseId: number, language?: string) {
    const [stdout, setStdout] = useState('');
    const [stderr, setStderr] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sandboxReady, setSandboxReady] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const { token, user } = useAuthStore();

    // Default language if not provided
    const lang = language || 'python';

    // Connect to Socket.IO
    const connect = useCallback(() => {
        if (!token || !user) {
            setError('Not authenticated');
            return;
        }

        // Close existing connection
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const socket = io(SOCKET_URL, {
            auth: {
                token: token
            }
        });

        socket.on('connect', () => {
            console.log('Socket.IO connected');
            // Join the user's execution room
            socket.emit('join_execution_room', { userId: user.id });
        });

        socket.on('disconnect', () => {
            console.log('Socket.IO disconnected');
            setSandboxReady(false);
            setIsExecuting(false);
        });

        socket.on('execution_message', (message: ExecutionMessage) => {
            try {
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
                    case 'input_request':
                        // Handle input request from server
                        // This would typically trigger showing an input field in the UI
                        // For now, we'll just log it - the Console component handles input
                        console.log('Input requested:', message.data);
                        break;
                }
            } catch (e) {
                console.error('Failed to parse Socket.IO message:', e);
            }
        });

        socket.on('connect_error', (err: any) => {
            console.error('Socket.IO connection error:', err);
            setError('Socket.IO connection error');
        });

        socketRef.current = socket;
    }, [token, user]);

    // Disconnect
    const disconnect = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setSandboxReady(false);
    }, []);

    // Run code via Socket.IO
    const runCode = useCallback(async (code: string) => {
        if (!socketRef.current || !socketRef.current.connected) {
            connect();
            // Wait for connection
            await new Promise<void>((resolve) => {
                const checkConnection = () => {
                    if (socketRef.current?.connected) {
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
        socketRef.current?.emit('execute_code', {
            exercise_id: exerciseId,
            code,
            language: lang,
        });
    }, [exerciseId, lang, connect]);

    // Send input to running process
    const sendInput = useCallback((input: string) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('send_input', {
                input: input
            });
        }
    }, []);

    // Cancel execution
    const cancelExecution = useCallback(() => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('cancel_execution', {});
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
        sendInput,
        cancelExecution,
        reset,
        connect,
        disconnect,
    };
}