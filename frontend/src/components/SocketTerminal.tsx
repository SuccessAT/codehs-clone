/*Socket.io sample for terminal*/
import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { io, Socket } from "socket.io-client";
import { extractFilename } from "@/lib/utils";
import { Button } from "./ui/button";
import { Play, RefreshCw, Send, X } from "lucide-react";
import { send } from "vite";

export interface DebugSocketIOTerminalProps {
    initialUrl?: string;
    className?: string;
    codeInput?: string;
    filesInput?: Record<string, string>;
    runConfig?: {
        entrypoint?: string;
        language?: string;
        runCommand?: string;
        stdin?: string;
    };
    multiFileRun?: MultiFileRunPayload | null;
    triggerTerminalRun?: boolean;
    setTriggerTerminalRun?: (value: boolean) => void;
    onCloseTerminal?: () => void;
    onMultiFileRunComplete?: () => void;
}

interface ConnectionState {
    text: string;
    isWarning: boolean;
    remainingMs: number | null;
}

interface TerminalState {
    connected: boolean;
    projectId: string | null;
    terminalId: string | null;
    sessionId: string | null;
    connectionTime: ConnectionState;
    connectionDurationMs: number | null;
}

export interface MultiFileOperation {
    filename: string;
    content: string;
}

export interface MultiFileRunPayload {
    files: MultiFileOperation[];
    filenames: string[];
    mainClass: string;
}

export interface DebugSocketIOTerminalRef {
    connect: () => void;
    disconnect: () => void;
    sendCommand: (cmd: string) => void;
    runTerminalCommand: (command: string) => void;
    manualCreateTerminal: (projectId?: string) => void;
    runPython: () => void;
    savePythonFile: (content: string) => void;
    saveFile: (content: string) => void;
    saveAndRunCode: (code: string) => void;
    saveAndRunFiles: (files: Record<string, string>, options?: { entrypoint?: string; language?: string; runCommand?: string; stdin?: string }) => void;
    resetConnectionState: () => void;
    runJava: (filename: string, compileAll?: boolean) => void;
    showLoadingAnimation: () => void;
    stopLoadingAnimation: () => void;
    clearLogs: () => void;
    closeTerminal: () => void;
    getState: () => TerminalState;
    // Multi-file support
    saveMultipleFiles: (files: MultiFileOperation[]) => Promise<void>;
    compileAndRunJava: (filenames: string[], mainClass: string) => Promise<void>;
}

export const DebugSocketIOTerminal = forwardRef<
    DebugSocketIOTerminalRef,
    DebugSocketIOTerminalProps
>(
    (
        {
            initialUrl = import.meta.env.VITE_TERMINAL_URL ??
                "https://ltd-terminal-backend.seqhubai.com",
            className,
            codeInput,
            filesInput,
            runConfig,
            multiFileRun,
            triggerTerminalRun,
            setTriggerTerminalRun,
            onCloseTerminal,
            onMultiFileRunComplete,
        },
        ref
    ) => {
        // Refs
        const terminalContainerRef = useRef<HTMLDivElement>(null);
        const terminalRef = useRef<Terminal | null>(null);
        const fitAddonRef = useRef(new FitAddon());
        const terminalReadyRef = useRef<boolean>(false);
        const loadingElementRef = useRef<HTMLDivElement>(null);
        const connectionTimeRef = useRef<HTMLSpanElement>(null);
        const connectionTimestampRef = useRef<number | null>(null);
        const warningShownRef = useRef<boolean>(false);
        const wsUrlRef = useRef<string>(initialUrl);
        const statusRef = useRef<HTMLDivElement>(null);
        const pingStatusRef = useRef<HTMLDivElement>(null);
        const pingInfoRef = useRef<HTMLSpanElement>(null);
        const sessionRef = useRef<HTMLDivElement>(null);
        const pingCountRef = useRef<HTMLDivElement>(null);
        const projectIdRef = useRef<HTMLSpanElement>(null);
        const projectStatusRef = useRef<HTMLSpanElement>(null);
        const terminalIdRef = useRef<HTMLSpanElement>(null);
        const terminalInputRef = useRef<HTMLInputElement>(null);
        const logContainerRef = useRef<HTMLDivElement>(null);
        const messageInputRef = useRef<HTMLTextAreaElement>(null);
        const ConnectBtnRef = useRef<HTMLButtonElement>(null);
        const disconnectBtnRef = useRef<HTMLButtonElement>(null);
        const sendConnectBtnRef = useRef<HTMLButtonElement>(null);
        const sendPingBtnRef = useRef<HTMLButtonElement>(null);
        const createProjectBtnRef = useRef<HTMLButtonElement>(null);
        const createTerminalBtnRef = useRef<HTMLButtonElement>(null);
        const runPythonBtnRef = useRef<HTMLButtonElement>(null);
        const runLsBtnRef = useRef<HTMLButtonElement>(null);
        const runEchoBtnRef = useRef<HTMLButtonElement>(null);
        const runPwdBtnRef = useRef<HTMLButtonElement>(null);
        const saveFileBtnRef = useRef<HTMLButtonElement>(null);
        const manualProjectInputRef = useRef<HTMLInputElement>(null);
        const manualTerminalBtnRef = useRef<HTMLButtonElement>(null);
        const clearLogsBtnRef = useRef<HTMLButtonElement>(null);
        const socketRef = useRef<Socket | null>(null); // Use socket.io Socket type
        const socketConnected = useRef(false);
        const engineIoConnected = useRef(false);
        const socketIoConnected = useRef(false);
        const sessionIdRef = useRef<string | null>(null);
        const activeProjectId = useRef<string | null>(null);
        const activeTerminalId = useRef<string | null>(null);
        const projectDirRef = useRef<string>("/home/user/project");
        const pingPongCount = useRef(0);
        const lastPingTime = useRef<Date | null>(null);
        const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
        const terminalHistoryRef = useRef<Array<any>>([]);
        const lastRunRef = useRef<number>(0);
        const filesInputRef = useRef<Record<string, string> | null>(null);
        const runConfigRef = useRef<{
            entrypoint?: string;
            language?: string;
            runCommand?: string;
            stdin?: string;
        } | null>(null);
        const pendingAutoRunRef = useRef(false);
        const pendingTerminalCreateRef = useRef(false);
        const terminalCreateRequestedRef = useRef(false);
        const projectReadyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
        const CONNECTION_LIMIT_MS = 60 * 60 * 1000; // 1 hour in milliseconds
        const WARNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
        let isLoadingAnimationActive = false;
        let javaInstallationStarted = false; // Track Java installation
        const terminalInitializedRef = useRef(false); // Use ref so socket callbacks can access current value
        const javaInstalledRef = useRef(false); // Track if Java is installed
        const javaInstallInProgressRef = useRef(false); // Suppress terminal output during Java install
        const compilationHandledRef = useRef(false);
        const pendingMultiFileRunRef = useRef<MultiFileRunPayload | null>(null);

        useEffect(() => {
            pendingMultiFileRunRef.current = multiFileRun ?? null;
        }, [multiFileRun]);

        useEffect(() => {
            if (!multiFileRun) return;

            let intervalId: NodeJS.Timeout | null = null;
            let timeoutId: NodeJS.Timeout | null = null;

            const tryRun = () => {
                if (activeTerminalId.current) {
                    void runPendingMultiFile();
                    return true;
                }
                return false;
            };

            if (!tryRun()) {
                intervalId = setInterval(() => {
                    if (tryRun() && intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                }, 500);

                timeoutId = setTimeout(() => {
                    if (intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                    if (pendingMultiFileRunRef.current && terminalRef.current) {
                        terminalRef.current.write(
                            "\r\n\x1b[31mTerminal not ready to run. Please click Run again.\x1b[0m\r\n"
                        );
                    }
                }, 10000);
            }

            return () => {
                if (intervalId) clearInterval(intervalId);
                if (timeoutId) clearTimeout(timeoutId);
            };
        }, [multiFileRun]);

        // Terminal initialization
        useEffect(() => {
            console.log("Terminal initialization starting");

            // Clean up any existing terminal
            if (terminalRef.current) {
                try {
                    terminalRef.current.dispose();
                } catch (e) {
                    console.error("Error disposing terminal:", e);
                }
                terminalRef.current = null;
            }
            terminalReadyRef.current = false;
            terminalInitializedRef.current = false;

            if (!terminalContainerRef.current) {
                console.error("Terminal container not found");
                return;
            }

            // Clear the container
            while (terminalContainerRef.current.firstChild) {
                terminalContainerRef.current.removeChild(terminalContainerRef.current.firstChild);
            }

            // Show loading indicator
            if (loadingElementRef.current) {
                loadingElementRef.current.style.display = "block";
            }

            try {
                // Create terminal with explicit size
                const term = new Terminal({
                    cursorBlink: true,
                    theme: { background: "#000", foreground: "#fff" },
                    fontSize: 14,
                    convertEol: true,
                    rows: 20, // Explicit sizing
                    cols: 80,
                });

                // Load addons
                term.loadAddon(fitAddonRef.current);
                term.loadAddon(new WebLinksAddon());

                // Open in container
                term.open(terminalContainerRef.current);

                // Forward keyboard input to the remote terminal for interactive stdin
                term.onData((data: string) => {
                    if (socketRef.current && activeTerminalId.current) {
                        socketRef.current.emit("project_command", {
                            command: "terminalData",
                            args: { id: activeTerminalId.current, data },
                        });
                    }
                });

                // Save reference
                terminalRef.current = term;

                // Fit after a slight delay
                setTimeout(() => {
                    try {
                        fitAddonRef.current.fit();
                        term.write("\x1b[1;31mTerminal initialized successfully\x1b[0m\r\n");

                        // Update ready state and hide loading
                        terminalReadyRef.current = true;
                        terminalInitializedRef.current = true;
                        if (pendingTerminalCreateRef.current && socketRef.current) {
                            pendingTerminalCreateRef.current = false;
                            createTerminal();
                        }
                        if (loadingElementRef.current) {
                            loadingElementRef.current.style.display = "none";
                        }
                        debugInit();
                    } catch (e) {
                        console.error("Error fitting terminal:", e);
                    }
                }, 200);

                // Keep xterm dimensions synced with both window resize and splitter-driven container resize.
                let resizeRafId: number | null = null;
                const scheduleFit = () => {
                    if (resizeRafId !== null) {
                        cancelAnimationFrame(resizeRafId);
                    }
                    resizeRafId = requestAnimationFrame(() => {
                        resizeRafId = null;
                        try {
                            fitAddonRef.current.fit();
                        } catch (e) {
                            console.error("Error on resize:", e);
                        }
                    });
                };

                const resizeHandler = () => {
                    scheduleFit();
                };
                window.addEventListener("resize", resizeHandler);

                const resizeObserver = new ResizeObserver(() => {
                    scheduleFit();
                });
                resizeObserver.observe(terminalContainerRef.current);

                return () => {
                    window.removeEventListener("resize", resizeHandler);
                    resizeObserver.disconnect();
                    if (resizeRafId !== null) {
                        cancelAnimationFrame(resizeRafId);
                    }
                    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
                    if (socketRef.current) {
                        try {
                            socketRef.current.disconnect();
                        } catch (e) {
                            console.error("Error disconnecting socket:", e);
                        }
                    }
                    if (terminalRef.current) {
                        try {
                            terminalRef.current.dispose();
                        } catch (e) {
                            console.error("Error disposing terminal:", e);
                        }
                        terminalRef.current = null;
                    }
                    terminalReadyRef.current = false;
                    terminalInitializedRef.current = false;
                };
            } catch (err) {
                console.error("Terminal creation error:", err);
            }
        }, []);

        // Trigger connection on triggerTerminalRun change
        useEffect(() => {
            if (triggerTerminalRun) {
                disconnect(); // Ensure clean disconnect before reconnect
                pendingAutoRunRef.current = true;
                connect();
            }
        }, [triggerTerminalRun]);

        // Update refs synchronously on every render to ensure they're always current
        // This is necessary because socket callbacks might fire before useEffect runs
        filesInputRef.current = filesInput ?? null;
        runConfigRef.current = runConfig ?? null;

        // Update connection time every second
        useEffect(() => {
            const interval = setInterval(() => {
                if (socketConnected.current) {
                    updateConnectionTime();
                }
            }, 1000);
            return () => clearInterval(interval);
        }, []);

        // Connection time warning and disconnect
        useEffect(() => {
            const interval = setInterval(() => {
                if (socketConnected.current) {
                    updateConnectionTime();
                    const { remainingMs, isWarning } = getConnectionElapsedTime();

                    if (isWarning && remainingMs !== null) {
                        if (!warningShownRef.current) {
                            warningShownRef.current = true;
                            if (terminalRef.current) {
                                terminalRef.current.write(
                                    "\r\n\x1b[31m⚠️ WARNING: Terminal connection will expire in 15 minutes. Save your work!\x1b[0m\r\n"
                                );
                            }
                            logMessage(
                                "⚠️ WARNING: Terminal connection will expire in 15 minutes. Save your work!",
                                "error"
                            );
                        }

                        if (remainingMs < 5 * 60 * 1000 && remainingMs > 4.9 * 60 * 1000) {
                            if (terminalRef.current) {
                                terminalRef.current.write(
                                    "\r\n\x1b[31m⚠️ URGENT: Terminal connection will expire in 5 minutes!\x1b[0m\r\n"
                                );
                            }
                            logMessage(
                                "⚠️ URGENT: Terminal connection will expire in 5 minutes!",
                                "error"
                            );
                        }

                        if (remainingMs < 60 * 1000 && remainingMs > 59 * 1000) {
                            if (terminalRef.current) {
                                terminalRef.current.write(
                                    "\r\n\x1b[31m⚠️ CRITICAL: Terminal connection will expire in 1 minute!\x1b[0m\r\n"
                                );
                            }
                            logMessage(
                                "⚠️ CRITICAL: Terminal connection will expire in 1 minute!",
                                "error"
                            );
                        }
                    }

                    if (remainingMs !== null && remainingMs <= 0) {
                        if (terminalRef.current) {
                            terminalRef.current.write(
                                "\r\n\x1b[31m⚠️ Connection time limit reached. Disconnecting...\x1b[0m\r\n"
                            );
                        }
                        logMessage("Connection time limit reached. Disconnecting...", "error");
                        disconnect();
                    }
                }
            }, 1000);
            return () => clearInterval(interval);
        }, []);

        const closeTerminal = () => {
            // Disconnect the socket
            disconnect();

            // Call the parent's close handler if provided
            // Use setTimeout to ensure disconnect completes before parent unmounts this component
            if (onCloseTerminal) {
                setTimeout(() => {
                    onCloseTerminal();
                }, 0);
            }
        };

        // Imperative handle for external control
        useImperativeHandle(ref, () => ({
            connect,
            disconnect,
            sendCommand,
            runTerminalCommand,
            manualCreateTerminal,
            runPython,
            savePythonFile,
            saveFile,
            saveAndRunCode,
            saveAndRunFiles,
            resetConnectionState,
            runJava,
            showLoadingAnimation,
            clearTerminal,
            stopLoadingAnimation,
            clearLogs,
            closeTerminal,
            // Multi-file support
            saveMultipleFiles,
            compileAndRunJava,
            getState: () => ({
                connected: socketConnected.current,
                projectId: activeProjectId.current,
                terminalId: activeTerminalId.current,
                sessionId: sessionIdRef.current,
                connectionTime: getConnectionElapsedTime(),
                connectionDurationMs: connectionTimestampRef.current
                    ? Date.now() - connectionTimestampRef.current
                    : null,
            }),
        }));

        // Reset connection state
        const resetConnectionState = () => {
            console.log("resetConnectionState called");
            socketConnected.current = false;
            engineIoConnected.current = false;
            socketIoConnected.current = false;
            sessionIdRef.current = null;
            activeProjectId.current = null;
            activeTerminalId.current = null;
            connectionTimestampRef.current = null;
            warningShownRef.current = false; // Reset warning flag
            javaInstalledRef.current = false; // Reset Java installation flag
            pendingAutoRunRef.current = false;
            pendingTerminalCreateRef.current = false;
            terminalCreateRequestedRef.current = false;
            if (projectReadyTimeoutRef.current) {
                clearTimeout(projectReadyTimeoutRef.current);
                projectReadyTimeoutRef.current = null;
            }
            updateStatus("Disconnected", "disconnected");
            updateSession("");
            updateProject(null, "");
            updateTerminal("");
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            pingPongCount.current = 0;
            updatePing();
            javaInstallationStarted = false;
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };

        // Connection logic
        const connect = () => {
            if (socketConnected.current) {
                logMessage("Already connected, ignoring connect request.", "system");
                return;
            }

            logMessage(`Connecting to ${wsUrlRef.current}...`, "system");
            try {
                if (socketRef.current) {
                    try {
                        socketRef.current.disconnect();
                    } catch (e) {
                        console.error("Error disconnecting previous socket:", e);
                        logMessage(
                            `Error disconnecting previous socket: ${(e as Error).message}`,
                            "error"
                        );
                    }
                }
                socketConnected.current = false;
                engineIoConnected.current = false;
                socketIoConnected.current = false;
                sessionIdRef.current = null;

                // Use socket.io-client
                const socket = io(wsUrlRef.current, {
                    transports: ["websocket"], // Force WebSocket transport
                    upgrade: false, // prevent HTTP long-polling fallback
                });
                socketRef.current = socket;

                updateStatus("Connecting...", "disconnected");

                socket.on("connect", () => {
                    logMessage("Socket.IO connection established", "system");
                    socketConnected.current = true;
                    engineIoConnected.current = true;
                    socketIoConnected.current = true;
                    connectionTimestampRef.current = Date.now();
                    sessionIdRef.current = socket.id; // Get the session ID
                    updateSession(`Session ID: ${socket.id}`);
                    updateStatus("Socket.IO Connected", "connected");
                    setupPingPong(); // Start ping-pong
                    createProject();
                });

                socket.on("disconnect", (reason) => {
                    logMessage(`Socket.IO connection closed (Reason: ${reason})`, "system");
                    resetConnectionState();
                });

                socket.on("connect_error", (error) => {
                    console.error("Socket.IO connection error:", error);
                    logMessage(`Socket.IO connection error: ${error.message}`, "error");
                    resetConnectionState();
                });

                socket.on("error", (error) => {
                    console.error("Socket.IO error:", error);
                    logMessage(`Socket.IO error: ${error.message}`, "error");
                    resetConnectionState();
                });

                // Listen for all events and handle them.
                socket.onAny((eventName, ...args) => {
                    handleSocketIoEvent(eventName, ...args);
                });
            } catch (err) {
                console.error("Connection error:", err);
                logMessage(`Connection error: ${(err as Error).message}`, "error");
                resetConnectionState();
            }
        };

        // Disconnect logic
        const disconnect = () => {
            console.log("disconnect called");
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (socketRef.current) {
                try {
                    socketRef.current.disconnect();
                } catch (e) {
                    console.error("Error on disconnect close", e);
                    logMessage(`Error on disconnect close: ${(e as Error).message}`, "error");
                }
            }
            setTriggerTerminalRun?.(false); // Reset trigger (optional chaining since prop is optional)
            logMessage("Disconnected from server", "system");
            logMessage("\r\x1b[K", "system");
            javaInstalledRef.current = false; // Reset Java installation flag
            resetConnectionState();
        };

        // Protocol handlers (Simplified with Socket.IO)
        function handleSocketIoEvent(event: string, data: any) {
            switch (event) {
                case "connection_established":
                    socketIoConnected.current = true;
                    createProject();
                    break;
                case "project_initializing":
                    activeProjectId.current = data.project_id;
                    updateProject(data.project_id, "Initializing");
                    if (projectReadyTimeoutRef.current) {
                        clearTimeout(projectReadyTimeoutRef.current);
                    }
                    projectReadyTimeoutRef.current = setTimeout(() => {
                        if (!activeTerminalId.current) {
                            requestTerminalCreate();
                        }
                    }, 2000);
                    break;
                case "project_ready":
                    if (data?.project_id) {
                        activeProjectId.current = data.project_id;
                        updateProject(data.project_id, "Ready");
                    }
                    if (data?.details?.project_dir) {
                        projectDirRef.current = data.details.project_dir;
                    }
                    requestTerminalCreate();
                    break;
                case "project_error":
                    updateProject(activeProjectId.current, "Error");
                    logMessage(
                        `Project Error: ${data?.message || "Unknown project error"}`,
                        "error"
                    );
                    break;
                case "command_result":
                    handleCommandResult(data);
                    break;
                case "terminalResponse":
                case "terminal_response":
                    let terminalReady = false;
                    if (data?.id && !activeTerminalId.current) {
                        activeTerminalId.current = data.id;
                        updateTerminal(data.id);
                        terminalReady = true;
                    }
                    stopLoadingAnimation();
                    appendToTerminal(data.data);
                    if (terminalReady) {
                        handleTerminalReady();
                    }
                    break;
                case "terminalOutput":
                case "terminal_output":
                    // appendToTerminal(data.output); // Removed this line, not used.
                    break;
                case "error":
                    stopLoadingAnimation();
                    logMessage(
                        data?.message || data?.error || "Terminal error",
                        "error"
                    );
                    if (terminalRef.current) {
                        terminalRef.current.write(
                            `\r\n\x1b[31m${data?.message || data?.error || "Terminal error"}\x1b[0m\r\n`
                        );
                    }
                    break;
                case "pong":
                    pingPongCount.current++;
                    lastPingTime.current = new Date();
                    updatePing();
                    break;
                default:
                    logMessage(`Unhandled Socket.IO event: ${event}`, "warning");
            }
        }

        function handleCommandResult(data: any) {
            const terminalId =
                data?.result?.id ??
                data?.result?.terminal_id ??
                data?.result?.terminalId ??
                data?.terminal_id ??
                data?.terminalId ??
                null;

            if ((data.command === "createTerminal" || data.command === "runCommand") && terminalId) {
                activeTerminalId.current = terminalId;
                updateTerminal(terminalId);
                stopLoadingAnimation(); // Stop loading animation here
                if (data.command === "createTerminal") {
                    handleTerminalReady();
                }
            } else if (data.command === "createTerminal" && data.error) {
                logMessage(`Create Terminal Error: ${data.error}`, "error");
                stopLoadingAnimation();
                terminalCreateRequestedRef.current = false;
                if (terminalInputRef.current) {
                    terminalInputRef.current.disabled = false;
                }
            }
        }

        // Ping/Pong (Simplified with Socket.IO)
        function setupPingPong() {
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            // Use Socket.IO's built-in ping/pong mechanism.
            if (socketRef.current) {
                pingIntervalRef.current = setInterval(() => {
                    if (socketRef.current) {
                        socketRef.current.emit("ping");
                    }
                }, 25000); //  Match the default pingInterval
            }
        }

        // Outgoing actions (Simplified with Socket.IO)
        function createProject() {
            if (socketRef.current) {
                socketRef.current.emit("create_project", { type: "base" });
                updateProject(activeProjectId.current, "Creating...");
                logMessage("Sent Create Project Message", "outgoing");
            }
        }

        function createTerminal() {
            if (terminalCreateRequestedRef.current || activeTerminalId.current) {
                return;
            }
            if (socketRef.current && terminalInitializedRef.current) {
                terminalCreateRequestedRef.current = true;
                socketRef.current.emit("project_command", {
                    command: "createTerminal",
                    args: { project_id: activeProjectId.current },
                });
                showLoadingAnimation();
                if (terminalInputRef.current) {
                    terminalInputRef.current.disabled = true;
                }
            }
        }

        function requestTerminalCreate() {
            if (terminalInitializedRef.current) {
                createTerminal();
            } else {
                pendingTerminalCreateRef.current = true;
            }
        }

        function maybeRunInitialPayload() {
            if (!pendingAutoRunRef.current) {
                return;
            }
            pendingAutoRunRef.current = false;
            if (pendingMultiFileRunRef.current) {
                return;
            }
            // Use refs which are updated synchronously on render
            // This ensures we always have the latest values even when called from socket callbacks
            const latestFiles = filesInputRef.current;
            const latestRunConfig = runConfigRef.current;
            if (latestFiles && Object.keys(latestFiles).length > 0) {
                saveAndRunFiles(latestFiles, latestRunConfig ?? undefined);
                return;
            }
            if (codeInput) {
                saveAndRunCode(codeInput);
            }
        }

        function handleTerminalReady() {
            if (pendingMultiFileRunRef.current) {
                pendingAutoRunRef.current = false;
                void runPendingMultiFile();
                return;
            }
            maybeRunInitialPayload();
        }

        // Helper function to format remaining time
        function formatRemainingTime(remainingMs: number): string {
            const minutes = Math.floor(remainingMs / 60000);
            const seconds = Math.floor((remainingMs % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }

        // Helper function to calculate connection elapsed time
        function getConnectionElapsedTime(): ConnectionState {
            if (!connectionTimestampRef.current) {
                return { text: "Not connected", isWarning: false, remainingMs: null };
            }
            const elapsedMs = Date.now() - connectionTimestampRef.current;
            const remainingMs = CONNECTION_LIMIT_MS - elapsedMs;
            const isWarning = remainingMs <= WARNING_THRESHOLD_MS;

            let remainingText;
            if (remainingMs <= 0) {
                remainingText = "Time expired";
            } else {
                const hours = Math.floor(remainingMs / 3600000);
                const minutes = Math.floor((remainingMs % 3600000) / 60000);
                const seconds = Math.floor((remainingMs % 60000) / 1000);

                if (hours > 0) {
                    remainingText = `${hours}h ${minutes}m ${seconds}s`;
                } else if (minutes > 0) {
                    remainingText = `${minutes}m ${seconds}s`;
                } else {
                    remainingText = `${seconds}s`;
                }
            }

            if (isWarning) {
                return {
                    text: `⚠️ ${formatRemainingTime(remainingMs)} remaining`,
                    isWarning: true,
                    remainingMs,
                };
            }
            return { text: remainingText, isWarning: false, remainingMs };
        }

        // Update connection time display
        function updateConnectionTime() {
            if (connectionTimeRef.current) {
                const { text, isWarning } = getConnectionElapsedTime();
                connectionTimeRef.current.textContent = text;
                if (isWarning) {
                    connectionTimeRef.current.classList.add("connection-warning");
                } else {
                    connectionTimeRef.current.classList.remove("connection-warning");
                }
            }
        }

        // Send a command to the terminal
        function sendCommand(cmd: string) {
            if (terminalInputRef.current) {
                terminalInputRef.current.value = cmd;
            }
            _sendTerminal(cmd);
        }

        function _sendTerminal(command: string, cwd?: string) {
            if (isLoadingAnimationActive) {
                if (terminalRef.current) {
                    terminalRef.current.write(
                        "\r\n\x1b[31mCommands are blocked during environment initialization\x1b[0m\r\n"
                    );
                }
                return;
            }
            if (socketRef.current) {
                const args: { terminalId?: string; command: string; cwd?: string } = {
                    command,
                };
                if (activeTerminalId.current) {
                    args.terminalId = activeTerminalId.current;
                }
                if (cwd) {
                    args.cwd = cwd;
                }
                socketRef.current.emit("project_command", {
                    command: "runCommand",
                    args,
                });
                logMessage(`Sent command: ${command}`, "outgoing");
            } else if (terminalRef.current) {
                terminalRef.current.write("\r\n\x1b[31mTerminal not ready yet. Please try again.\x1b[0m\r\n");
            }
            if (terminalInputRef.current) {
                terminalInputRef.current!.value = "";
            }
        }

        // Run a terminal command (for debugging)
        function runTerminalCommand(command: string) {
            if (socketRef.current && activeTerminalId.current) {
                socketRef.current.emit("project_command", {
                    command: "terminalData",
                    args: { id: activeTerminalId.current, data: command + "\n" },
                });
                logMessage(`Sent terminal data: ${command}`, "outgoing");
            } else {
                _sendTerminal(command, projectDirRef.current);
            }
            appendToTerminal(`$ ${command}\n`);
        }

        // Show loading animation in the terminal
        let loadingAnimationInterval: NodeJS.Timeout | null = null;
        const loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let currentFrame = 0;
        function showLoadingAnimation() {
            stopLoadingAnimation();
            isLoadingAnimationActive = true;
            if (terminalInputRef.current) {
                terminalInputRef.current.disabled = true;
            }
            if (terminalRef.current) {
                terminalRef.current.write("\r\n\x1b[33mInitializing environment...\x1b[0m\r\n");
            }
            loadingAnimationInterval = setInterval(() => {
                if (terminalRef.current) {
                    terminalRef.current.write("\r\x1b[K");
                    terminalRef.current.write(
                        `\x1b[33m${loadingFrames[currentFrame]} Loading modules and preparing environment...\x1b[0m`
                    );
                    currentFrame = (currentFrame + 1) % loadingFrames.length;
                }
            }, 100);
        }

        // Stop loading animation
        function stopLoadingAnimation() {
            if (loadingAnimationInterval) {
                clearInterval(loadingAnimationInterval);
                loadingAnimationInterval = null;
            }
            if (terminalRef.current) {
                terminalRef.current.write("\r\x1b[K");
                // terminalRef.current.write("\x1b[32mEnvironment ready!\x1b[0m\r\n\r\n");
            }
            if (terminalInputRef.current && activeTerminalId.current) {
                terminalInputRef.current.disabled = false;
            }
            isLoadingAnimationActive = false;
        }

        // Manually create a terminal
        function manualCreateTerminal(projectId?: string) {
            const pid =
                projectId ||
                (manualProjectInputRef.current
                    ? manualProjectInputRef.current.value.trim()
                    : activeProjectId.current);
            if (socketRef.current) {
                socketRef.current.emit("project_command", {
                    command: "createTerminal",
                    args: { project_id: pid },
                });
                logMessage("Sent manual create terminal command", "outgoing");
            }
        }

        // Save Python file
        function savePythonFile(content: string) {
            if (socketRef.current) {
                socketRef.current.emit("project_command", {
                    command: "saveFile",
                    args: {
                        project_id: activeProjectId.current,
                        path: `${projectDirRef.current}/main.py`,
                        content,
                    },
                });
                logMessage("Sent save python file command", "outgoing");
            }
        }

        // Add this function after your other terminal functions
        function clearTerminal() {
            if (terminalRef.current) {
                terminalRef.current.clear();
                // Send the ANSI escape sequence to clear the screen and reset cursor position
                terminalRef.current.write("\x1bc");

                // Add a welcome message after clearing
                setTimeout(() => {
                    if (terminalRef.current) {
                        terminalRef.current.write("\r\n\x1b[1;32mTerminal cleared\x1b[0m\r\n\r\n");
                    }
                }, 100);

                logMessage("Terminal display cleared", "system");
            }
        }

        // Save a generic file
        function saveFile(code: string) {
            let filename = extractFilename(code) ?? "main.java";
            if (filename.endsWith(".py")) {
                filename = "main.py";
            }
            // const filename = extractFilename(content);
            if (socketRef.current) {
                socketRef.current.emit("project_command", {
                    command: "saveFile",
                    args: {
                        project_id: activeProjectId.current,
                        path: `${projectDirRef.current}/${filename}`,
                        content: code,
                    },
                });
                // logMessage(`Sent save file command for ${filename}`, "outgoing");
            }
        }

        // Save and run code (Python or Java)
        function saveAndRunCode(code: string) {
            // Add protection against duplicate runs
            const now = Date.now();
            if (lastRunRef.current && now - lastRunRef.current < 1000) {
                console.log("Preventing duplicate run");
                return; // Skip if last run was less than 1 second ago
            }
            lastRunRef.current = now;

            let filename = extractFilename(code) ?? "main.java";
            if (filename.endsWith(".py")) {
                filename = "main.py";
            }

            if (socketRef.current) {
                // Disable input during the operation
                if (terminalInputRef.current) {
                    terminalInputRef.current.disabled = true;
                }

                // Show saving indication in terminal
                if (terminalRef.current) {
                    terminalRef.current.write("\r\n\x1b[33m⏳ Saving file...\x1b[0m");
                }

                // Send save command
                socketRef.current.emit("project_command", {
                    command: "saveFile",
                    args: {
                        project_id: activeProjectId.current,
                        path: `${projectDirRef.current}/${filename}`,
                        content: code,
                    },
                });

                // Log the action
                logMessage(`Saving code to ${filename}...`, "system");

                // Add a flag to track if we're in the middle of a save-run operation
                let saveRunInProgress = true;

                // Use promise and setTimeout to properly sequence operations
                new Promise<void>((resolve) => {
                    // Wait for save to complete
                    setTimeout(() => {
                        // Update terminal with completion message
                        if (terminalRef.current) {
                            terminalRef.current.write("\r\x1b[K"); // Clear line
                            terminalRef.current.write(
                                "\x1b[32m✅ File saved successfully!\x1b[0m\r\n"
                            );
                        }
                        resolve();
                    }, 1500);
                })
                    .then(() => {
                        // Small additional delay before running
                        return new Promise<void>((resolve) => {
                            if (terminalRef.current) {
                                terminalRef.current.write(
                                    "\x1b[33m⏳ Preparing to run code...\x1b[0m\r\n"
                                );
                            }
                            setTimeout(resolve, 500);
                        });
                    })
                    .then(() => {
                        // Only proceed if we're still in the same operation
                        if (!saveRunInProgress) return;

                        // Run the code with appropriate command
                        logMessage(`Running ${filename}`, "system");

                        let runPromise: Promise<void>;

                        if (filename.endsWith(".py")) {
                            _sendTerminal(`python ${filename}`);
                            runPromise = Promise.resolve();
                        } else {
                            runPromise = runJava(filename, false);
                        }
                        // Only re-enable input after the run operation completes
                        runPromise.then(() => {
                            // Re-enable input after operation completes
                            if (terminalInputRef.current) {
                                terminalInputRef.current.disabled = false;
                            }

                            // Reset our operation state after a delay
                            setTimeout(() => {
                                lastRunRef.current = 0;
                            }, 2000);
                        });
                    });

                // Cancel the operation if another save is initiated
                return () => {
                    saveRunInProgress = false;
                };
            }
        }

        function saveAndRunFiles(
            files: Record<string, string>,
            options?: { entrypoint?: string; language?: string; runCommand?: string; stdin?: string }
        ) {
            const now = Date.now();
            if (lastRunRef.current && now - lastRunRef.current < 1000) {
                return;
            }
            lastRunRef.current = now;

            const entries = Object.entries(files || {});
            if (!entries.length || !socketRef.current || !activeProjectId.current) {
                return;
            }

            const runCommand = options?.runCommand?.trim();
            const language = (options?.language || "").toLowerCase();
            const entrypoint = options?.entrypoint || entries[0][0];
            const javaEntries = entries.filter(([filename]) => filename.toLowerCase().endsWith(".java"));
            const isPython = language === "python" || entrypoint.toLowerCase().endsWith(".py");
            const effectiveEntrypoint =
                !runCommand && !isPython && !entrypoint.toLowerCase().endsWith(".java") && javaEntries.length > 0
                    ? javaEntries[0][0]
                    : entrypoint;

            if (terminalInputRef.current) {
                terminalInputRef.current.disabled = true;
            }

            if (terminalRef.current) {
                terminalRef.current.write("\r\n\x1b[33m⏳ Saving files...\x1b[0m");
            }

            entries.forEach(([filename, content]) => {
                socketRef.current?.emit("project_command", {
                    command: "saveFile",
                    args: {
                        project_id: activeProjectId.current,
                        path: `${projectDirRef.current}/${filename}`,
                        content,
                    },
                });
            });

            new Promise<void>((resolve) => {
                setTimeout(() => {
                    if (terminalRef.current) {
                        terminalRef.current.write("\r\x1b[K");
                        terminalRef.current.write("\x1b[32m✅ Files saved successfully!\x1b[0m\r\n");
                    }
                    resolve();
                }, 1500);
            })
                .then(() => {
                    return new Promise<void>((resolve) => {
                        if (terminalRef.current) {
                            terminalRef.current.write("\x1b[33m⏳ Preparing to run...\x1b[0m\r\n");
                        }
                        setTimeout(resolve, 500);
                    });
                })
                .then(() => {
                    if (!activeTerminalId.current) {
                        if (terminalRef.current) {
                            terminalRef.current.write("\r\n\x1b[31mTerminal not ready. Please try again.\x1b[0m\r\n");
                        }
                        return;
                    }
                    let runPromise: Promise<void> = Promise.resolve();

                    if (runCommand) {
                        _sendTerminal(runCommand, projectDirRef.current);
                    } else if (isPython) {
                        _sendTerminal(`python ${effectiveEntrypoint}`, projectDirRef.current);
                    } else if (javaEntries.length === 0) {
                        if (terminalRef.current) {
                            terminalRef.current.write(
                                "\r\n\x1b[31mNo .java files found to run. Add a Java file and try again.\x1b[0m\r\n"
                            );
                        }
                    } else {
                        const compileAll = javaEntries.length > 1;
                        runPromise = runJava(effectiveEntrypoint, compileAll);
                    }

                    runPromise.then(() => {
                        if (terminalInputRef.current) {
                            terminalInputRef.current.disabled = false;
                        }
                        setTimeout(() => {
                            lastRunRef.current = 0;
                        }, 2000);
                    });
                });
        }

        // Save multiple files for multi-file Java projects
        async function saveMultipleFiles(files: { filename: string; content: string }[]): Promise<void> {
            if (!socketRef.current || !activeProjectId.current) {
                console.error("Cannot save files: socket or project not ready");
                return;
            }

            if (terminalRef.current) {
                terminalRef.current.write(`\r\n\x1b[33m⏳ Saving ${files.length} file(s)...\x1b[0m\r\n`);
            }

            for (const file of files) {
                await new Promise<void>((resolve) => {
                    socketRef.current!.emit("project_command", {
                        command: "saveFile",
                        args: {
                            project_id: activeProjectId.current,
                            path: `${projectDirRef.current}/${file.filename}`,
                            content: file.content,
                        },
                    });
                    // Small delay between saves to ensure they complete
                    setTimeout(resolve, 200);
                });
            }

            if (terminalRef.current) {
                terminalRef.current.write(`\x1b[32m✅ Saved ${files.length} file(s)\x1b[0m\r\n`);
            }

            logMessage(`Saved ${files.length} file(s)`, "system");
        }

        async function runPendingMultiFile(): Promise<void> {
            const pending = pendingMultiFileRunRef.current;
            if (!pending) return;

            pendingMultiFileRunRef.current = null;

            try {
                await saveMultipleFiles(pending.files);
                await compileAndRunJava(pending.filenames, pending.mainClass);
            } finally {
                if (onMultiFileRunComplete) {
                    onMultiFileRunComplete();
                }
            }
        }

        // Compile and run multi-file Java project
        async function compileAndRunJava(filenames: string[], mainClass: string): Promise<void> {
            if (!socketRef.current) {
                console.error("Cannot compile: socket not ready");
                return;
            }

            const javaFiles = filenames.filter((name) => name.toLowerCase().endsWith(".java"));
            if (javaFiles.length === 0) {
                if (terminalRef.current) {
                    terminalRef.current.write(
                        "\r\n\x1b[31mNo .java files found to compile. Add a Java file and try again.\x1b[0m\r\n"
                    );
                }
                return;
            }

            // Ensure Java is installed first
            if (!javaInstalledRef.current) {
                if (terminalRef.current) {
                    terminalRef.current.write("\r\n\x1b[33m⏳ Checking Java installation...\x1b[0m\r\n");
                }

                // First check if Java is already available
                javaInstallInProgressRef.current = true;
                _sendTerminal("which javac && javac -version || echo 'Java not found'", projectDirRef.current);

                await new Promise<void>((resolve) => setTimeout(resolve, 2000));

                if (terminalRef.current) {
                    terminalRef.current.write("\r\n\x1b[33m⏳ Installing Java (first time only, ~30 seconds)...\x1b[0m\r\n");
                }

                await new Promise<void>((resolve) => {
                    // Try multiple installation approaches
                    _sendTerminal(
                        "sudo apt-get update && sudo apt-get install -y default-jdk || apt-get install -y default-jdk || echo 'Installation failed - Java may need to be pre-installed in container'",
                        projectDirRef.current
                    );
                    setTimeout(() => {
                        javaInstallInProgressRef.current = false;
                        javaInstalledRef.current = true;
                        // Verify Java installation
                        _sendTerminal("javac -version", projectDirRef.current);
                        resolve();
                    }, 35000);
                });
            }

            // Compile all Java files
            const compileCmd = `javac -encoding UTF-8 ${javaFiles.join(" ")}`;

            if (terminalRef.current) {
                terminalRef.current.write(`\r\n\x1b[33m$ ${compileCmd}\x1b[0m\r\n`);
            }

            _sendTerminal(compileCmd, projectDirRef.current);

            // Wait for compilation and check for errors
            return new Promise((resolve) => {
                let compilationSuccessful = false;
                let compilationHandled = false;

                const compilationListener = (data: any) => {
                    if (compilationHandled) return;

                    const errorPatterns = ["error:", "Error:", "Exception", "fatal error"];
                    const hasError = checkOutputForErrors(
                        data,
                        errorPatterns,
                        "Compilation failed. Please fix the errors and try again."
                    );

                    if (hasError) {
                        compilationHandled = true;
                        socketRef.current?.off("terminalResponse", compilationListener);
                        socketRef.current?.off("terminal_response", compilationListener);
                        resolve();
                        return;
                    }

                    // Check for success indicators
                    if (data && data.data) {
                        const output = typeof data.data === "string" ? data.data : String(data.data);
                        if (output.includes("javac") && !output.includes("error")) {
                            compilationSuccessful = true;
                        }
                    }
                };

                socketRef.current?.on("terminalResponse", compilationListener);
                socketRef.current?.on("terminal_response", compilationListener);

                // Timeout and run if no errors detected
                setTimeout(() => {
                    if (!compilationHandled) {
                        compilationHandled = true;
                        socketRef.current?.off("terminalResponse", compilationListener);
                        socketRef.current?.off("terminal_response", compilationListener);

                        // Run the main class
                        const runCmd = `java ${mainClass}`;
                        if (terminalRef.current) {
                            terminalRef.current.write(`\r\n\x1b[33m$ ${runCmd}\x1b[0m\r\n`);
                        }
                        _sendTerminal(runCmd, projectDirRef.current);
                        resolve();
                    }
                }, 3000);
            });
        }

        // Run Python code
        function runPython() {
            savePythonFile('print("Hello from React debug client!")\n');
            setTimeout(() => runTerminalCommand("python main.py"), 500);
        }

        function checkOutputForErrors(
            data: any,
            errorPatterns: (string | RegExp)[],
            errorMessage: string = "Command failed with errors.",
            successCallback?: () => void
        ): boolean {
            // Check if data exists and is a string
            if (!data || !data.data) return false;

            const output = typeof data.data === 'string' ? data.data : String(data.data);

            // Check for any of the error patterns
            const hasError = errorPatterns.some(pattern => {
                if (pattern instanceof RegExp) {
                    return pattern.test(output);
                }
                return output.includes(pattern);
            });

            if (hasError) {
                // Display error message in red
                if (terminalRef.current) {
                    terminalRef.current.write(`\r\n\x1b[31m✖ ${errorMessage}\x1b[0m\r\n`);

                    // Extract and display the actual error message if available
                    const errorLines = output
                        .split('\n')
                        .filter(line => errorPatterns.some(pattern =>
                            pattern instanceof RegExp ? pattern.test(line) : line.includes(pattern)
                        ));

                    if (errorLines.length > 0) {
                        terminalRef.current.write(`\x1b[31m${errorLines.join('\n')}\x1b[0m\r\n`);
                    }
                }

                // Log the error
                logMessage(`Command error: ${errorMessage}`, "error");
                return true;
            }

            // If no errors and success callback provided, call it
            if (successCallback) {
                successCallback();
            }

            return false;
        }

        function runJava(filename: string, compileAll: boolean = false): Promise<void> {
            return new Promise<void>(async (resolve) => {
                const className = filename.replace(".java", "");

                // Use refs to track state across async operations
                compilationHandledRef.current = false;

                let compilationSuccessful = false;
                let fallbackTimeoutId: NodeJS.Timeout | null = null;

                // Function to handle compilation result exactly once
                const handleCompilationResult = (success: boolean) => {
                    if (compilationHandledRef.current) return; // Prevent multiple handling
                    compilationHandledRef.current = true;

                    // Clear any pending fallback timeout
                    if (fallbackTimeoutId) {
                        clearTimeout(fallbackTimeoutId);
                        fallbackTimeoutId = null;
                    }

                    // Remove all listeners
                    if (socketRef.current) {
                        socketRef.current.off("terminalResponse");
                        socketRef.current.off("terminal_response");
                    }

                    // Only run Java if compilation was successful
                    if (success) {
                        if (terminalRef.current) {
                            terminalRef.current.write(`\r\n\x1b[1m$ Running ${className}...\x1b[0m\r\n`);
                        }
                        _sendTerminal(`java ${className}`);
                    }

                    // Resolve the promise
                    setTimeout(resolve, 500);
                };

                // Check if Java needs to be installed
                if (!javaInstalledRef.current) {
                    // Log the start of Java installation
                    console.log("Installing Java for the first time...");

                    // Clear the terminal first
                    if (terminalRef.current) {
                        terminalRef.current.write("\x1bc"); // Clear terminal
                        terminalRef.current.write("\r\n\x1b[1;33m=== Setting up Java Environment ===\x1b[0m\r\n\r\n");
                        terminalRef.current.write("This may take a minute. Please wait while we prepare the environment for your Java code.\r\n\r\n");
                    }

                    // Start a loading animation
                    let loadingAnimationInterval = null;
                    const loadingSteps = [
                        "⣾ Preparing environment...",
                        "⣽ Installing Java components...",
                        "⣻ Configuring compiler...",
                        "⢿ Setting up runtime...",
                        "⡿ Optimizing performance...",
                        "⣟ Almost ready...",
                        "⣯ Finalizing setup...",
                        "⣷ Preparing to compile..."
                    ];
                    let currentStep = 0;

                    loadingAnimationInterval = setInterval(() => {
                        if (terminalRef.current) {
                            terminalRef.current.write("\r\x1b[K"); // Clear line
                            terminalRef.current.write(`\x1b[36m${loadingSteps[currentStep]}\x1b[0m`);
                            currentStep = (currentStep + 1) % loadingSteps.length;
                        }
                    }, 250);

                    // Send the Java installation command with better error handling
                    javaInstallInProgressRef.current = true;
                    sendCommand("sudo apt-get update && sudo apt-get install -y default-jdk || apt-get install -y default-jdk || echo 'Installation failed - Java may need to be pre-installed in container'");

                    // Set the flag to prevent future installations
                    javaInstalledRef.current = true;

                    // Wait for Java installation to complete before compiling and running
                    setTimeout(() => {
                        // Clear the interval when installation is complete
                        if (loadingAnimationInterval) {
                            clearInterval(loadingAnimationInterval);
                        }

                        javaInstallInProgressRef.current = false;
                        if (terminalRef.current) {
                            terminalRef.current.write("\r\x1b[K"); // Clear line
                            terminalRef.current.write("\r\n\x1b[32m✓ Java environment ready!\x1b[0m\r\n\r\n");
                        }

                        // Verify Java installation before proceeding
                        sendCommand("javac -version");
                        setTimeout(() => {
                            compileAndRun();
                        }, 1000);
                    }, 35000); // Wait 35 seconds for Java installation (apt-get update + install)
                } else {
                    // Java is already installed, proceed directly to compile and run
                    compileAndRun();
                }

                // Function to handle compilation and running
                function compileAndRun() {
                    if (terminalRef.current) {
                        terminalRef.current.write(`\x1b[1m$ Compiling ${filename}...\x1b[0m\r\n`);
                    }

                    // Set up a listener for compilation results
                    if (socketRef.current) {
                        const compilationListener = (data: any) => {
                            // Skip if we've already handled compilation
                            if (compilationHandledRef.current) return;

                            // Use our helper function to check for compilation errors
                            const errorPatterns = ["error:", "Error:", "Exception", "fatal error"];
                            const hasError = checkOutputForErrors(
                                data,
                                errorPatterns,
                                "Compilation failed. Please fix the errors and try again."
                            );

                            if (hasError) {
                                // Don't run Java if compilation failed
                                handleCompilationResult(false);
                                return;
                            }

                            // If no errors were found in this output, check if it might indicate success
                            if (data && data.data) {
                                const output = typeof data.data === 'string' ? data.data : String(data.data);

                                // If we see the javac command completing without errors, mark as successful
                                if (output.includes("javac") && !output.includes("error")) {
                                    compilationSuccessful = true;

                                    // Wait a brief moment to ensure we've captured all output
                                    setTimeout(() => {
                                        if (!compilationHandledRef.current) {
                                            handleCompilationResult(true);
                                        }
                                    }, 500);
                                }
                            }
                        };

                        // Listen for both event names since the code uses both formats
                        socketRef.current.on("terminalResponse", compilationListener);
                        socketRef.current.on("terminal_response", compilationListener);
                    }

                    // Send the compilation command
                    const compileCommand = compileAll ? "javac -encoding UTF-8 *.java" : `javac -encoding UTF-8 ${filename}`;
                    _sendTerminal(compileCommand);

                    // Fallback timeout in case we don't get a clear compilation result
                    fallbackTimeoutId = setTimeout(() => {
                        if (!compilationHandledRef.current) {
                            // If we haven't explicitly detected success or failure by now,
                            // check if we've seen any indication of success
                            if (compilationSuccessful) {
                                handleCompilationResult(true);
                            } else {
                                // If we're still uncertain, assume it failed rather than running potentially broken code
                                if (terminalRef.current) {
                                    terminalRef.current.write("\r\n\x1b[33m⚠ Compilation status unclear. No explicit success detected.\x1b[0m\r\n");
                                    terminalRef.current.write("\r\n\x1b[33m⚠ Not running Java code to prevent potential errors.\x1b[0m\r\n");
                                }
                                handleCompilationResult(false);
                            }
                        }
                    }, 30000); // Wait 30 seconds for compilation feedback
                }
            });
        }

        // Clear the log
        function clearLogs() {
            if (logContainerRef.current) {
                logContainerRef.current!.innerHTML = "";
            }
            logMessage("Logs cleared", "system");
        }

        // Send Ping
        function sendPing() {
            if (socketRef.current) {
                socketRef.current.emit("ping"); // Use Socket.IO's emit
                logMessage("Sent ping", "outgoing");
            }
        }

        // UI update functions
        function updateStatus(text: string, status: "connected" | "connecting" | "disconnected") {
            if (statusRef.current) {
                statusRef.current!.textContent = text;
                statusRef.current!.className = `status ${status}`;
            }
        }

        function updateSession(text: string) {
            if (sessionRef.current) {
                sessionRef.current!.textContent = text;
            }
        }

        function updatePing() {
            if (pingCountRef.current) {
                pingCountRef.current!.textContent = `Ping/Pong count: ${pingPongCount.current}`;
            }
            if (pingInfoRef.current) {
                pingInfoRef.current!.textContent = `Ping status: ${new Date().getTime() -
                    (lastPingTime.current ? lastPingTime.current.getTime() : 0)
                    }ms`;
            }

            if (pingStatusRef.current) {
                pingStatusRef.current!.classList.add("active");
                setTimeout(() => {
                    if (pingStatusRef.current) {
                        pingStatusRef.current!.classList.remove("active");
                    }
                }, 1000);
            }
        }

        function updateProject(id: string | null, status: string) {
            if (projectIdRef.current) {
                projectIdRef.current!.textContent = id || "None";
            }
            if (projectStatusRef.current) {
                projectStatusRef.current!.textContent = status;
            }
        }

        function updateTerminal(id: string) {
            if (terminalIdRef.current) {
                terminalIdRef.current!.textContent = `(${id})`;
            }
            if (terminalInputRef.current) {
                terminalInputRef.current!.disabled = false;
            }
        }

        function debugInit() {
            logMessage(`Debug initialized. Suggested URL: ${wsUrlRef.current}`, "system");
        }

        // Append text to the terminal
        function appendToTerminal(text: string) {
            if (isLoadingAnimationActive || javaInstallInProgressRef.current) {
                return;
            }
            if (!terminalRef.current) return;

            const sanitizedText = text.replace(/\n/g, "\r\n");
            try {
                terminalRef.current.write(sanitizedText);
            } catch (err) {
                console.error("Error writing to terminal:", err);
                logMessage(`Error writing to terminal: ${(err as Error).message}`, "error");
            }
        }

        // Log a message
        function logMessage(
            message: any,
            type: "system" | "incoming" | "outgoing" | "error" | "warning"
        ) {
            const ts = new Date().toISOString();
            const connTime = socketConnected.current
                ? ` [Connected: ${getConnectionElapsedTime().text}]`
                : "";
            const logEntry = `${ts} - ${type.toUpperCase()} - ${message}${connTime}\n`;

            if (logContainerRef.current) {
                const p = document.createElement("p");
                p.textContent = logEntry;
                switch (type) {
                    case "system":
                        p.style.color = "#eee";
                        break;
                    case "incoming":
                        p.style.color = "#0f0";
                        break;
                    case "outgoing":
                        p.style.color = "#0ff";
                        break;
                    case "error":
                        p.style.color = "#f00";
                        break;
                    case "warning":
                        p.style.color = "#FFFF00"; // Yellow for warnings
                        break;
                    default:
                        p.style.color = "#fff";
                }
                logContainerRef.current.appendChild(p);
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
            }
        }

        return (
            <div className={className}>
                <div className="flex flex-col h-full">
                    {/* Top Bar */}
                    <div className="flex items-center justify-between p-2 text-gray-300 bg-gray-800 border-b border-gray-700">
                        <div className="flex items-center space-x-1">
                            <h3 className="text-sm">Terminal Restarts in</h3>
                            <span
                                id="connectionTime"
                                ref={connectionTimeRef}
                                className="text-sm connection-time">
                                --
                            </span>
                        </div>
                        <div className="flex items-center space-x-2">

                            <Button
                                onClick={clearTerminal}
                                size="sm"
                                variant="outline"
                                icon={<RefreshCw className="size-3" />}
                            // ref={disconnectBtnRef}
                            >
                                Clear
                            </Button>
                            <Button
                                // ref={ConnectBtnRef}
                                size="sm"
                                variant="outline"
                                icon={<X className="size-3" />}
                                onClick={closeTerminal}>
                                Delete Terminal
                            </Button>
                        </div>
                    </div>

                    {/* Terminal Container */}
                    <div
                        ref={terminalContainerRef}
                        className="flex-grow overflow-hidden font-mono text-sm text-green-400 bg-black overscroll-contain"
                        style={{ flex: 1 }}>
                        {/* Terminal content will be rendered here */}
                    </div>
                    <div
                        ref={loadingElementRef}
                        style={{ display: "none" }}
                        className="absolute inset-0 flex items-center justify-center text-lg text-white bg-black bg-opacity-70">
                        Loading...
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-gray-800 border-t border-gray-700">
                        <div className="flex items-center gap-4">
                            <input
                                ref={terminalInputRef}
                                type="text"
                                placeholder="Enter command..."
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        const command = e.currentTarget.value.trim();
                                        if (command) {
                                            _sendTerminal(command);
                                        }
                                    }
                                }}
                                className="flex-grow px-3 py-2 text-white bg-gray-900 border border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                disabled={true}
                            />
                            <Button
                                ref={sendConnectBtnRef}
                                icon={<Send className="size-3.5" />}
                                onClick={() =>
                                    _sendTerminal(terminalInputRef.current!.value.trim())
                                }
                                className="px-4 py-2 font-bold text-white bg-green-500 rounded hover:bg-green-700">

                                Send
                            </Button>
                        </div>
                    </div>

                    {/* Project and Terminal Info */}
                    <div className="hidden p-4 text-gray-300 bg-gray-800 border-t border-gray-700">
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <div>
                                    Project ID:{" "}
                                    <span id="projectId" ref={projectIdRef}>
                                        None
                                    </span>
                                </div>
                                <div>
                                    Project Status:{" "}
                                    <span id="projectStatus" ref={projectStatusRef}></span>
                                </div>
                            </div>
                            <div>
                                <div>
                                    Terminal ID: <span id="terminalId" ref={terminalIdRef}></span>
                                </div>
                            </div>
                            <div>
                                <button
                                    ref={sendPingBtnRef}
                                    onClick={sendPing}
                                    className="px-4 py-2 font-bold text-white bg-purple-500 rounded hover:bg-purple-700">
                                    Send Ping
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Control Buttons */}
                    <div className="hidden grid-cols-3 gap-4 p-4 bg-gray-800 border-t border-gray-700">
                        <button
                            ref={createProjectBtnRef}
                            onClick={createProject}
                            className="px-4 py-2 font-bold text-gray-900 bg-yellow-500 rounded hover:bg-yellow-700">
                            Create Project
                        </button>
                        <button
                            ref={createTerminalBtnRef}
                            onClick={createTerminal}
                            className="px-4 py-2 font-bold text-white bg-indigo-500 rounded hover:bg-indigo-700">
                            Create Terminal
                        </button>
                        <div className="flex items-center gap-2">
                            <input
                                ref={manualProjectInputRef}
                                type="text"
                                placeholder="Project ID"
                                className="flex-grow px-3 py-2 text-white bg-gray-900 border border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                ref={manualTerminalBtnRef}
                                onClick={() => manualCreateTerminal()}
                                className="px-4 py-2 font-bold text-white bg-pink-500 rounded hover:bg-pink-700">
                                Create Terminal (Manual)
                            </button>
                        </div>
                        <button
                            ref={runPythonBtnRef}
                            onClick={runPython}
                            className="px-4 py-2 font-bold text-white bg-teal-500 rounded hover:bg-teal-700">
                            Run Python
                        </button>
                        <button
                            ref={runLsBtnRef}
                            onClick={() => sendCommand("ls -al")}
                            className="px-4 py-2 font-bold text-white bg-gray-600 rounded hover:bg-gray-700">
                            Run ls -al
                        </button>
                        <button
                            ref={runEchoBtnRef}
                            onClick={() => sendCommand('echo "Hello from React"')}
                            className="px-4 py-2 font-bold text-white bg-gray-600 rounded hover:bg-gray-700">
                            Run Echo
                        </button>
                        <button
                            ref={runPwdBtnRef}
                            onClick={() => sendCommand("pwd")}
                            className="px-4 py-2 font-bold text-white bg-gray-600 rounded hover:bg-gray-700">
                            Run Pwd
                        </button>
                        <button
                            ref={saveFileBtnRef}
                            onClick={() => saveFile("This is a test file.\nIt has multiple lines.")}
                            className="px-4 py-2 font-bold text-white bg-orange-500 rounded hover:bg-orange-700">
                            Save File
                        </button>
                        <button
                            ref={clearLogsBtnRef}
                            onClick={clearLogs}
                            className="px-4 py-2 font-bold text-white bg-gray-700 rounded hover:bg-gray-800">
                            Clear Logs
                        </button>
                    </div>

                    {/* Log Container */}
                    {/* <div
                        ref={logContainerRef}
                        className="hidden p-4 overflow-auto font-mono text-sm text-gray-400 bg-gray-900 border-t border-gray-700 max-h-48">
                        Log messages will be displayed here 
                    </div>*/}
                </div>
            </div>
        );
    }
);

DebugSocketIOTerminal.displayName = "DebugSocketIOTerminal";
export default DebugSocketIOTerminal;
