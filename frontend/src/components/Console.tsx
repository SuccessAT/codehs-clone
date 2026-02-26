import { useState, useEffect, useRef, useCallback } from 'react';

interface ConsoleLine {
    id: string;
    type: 'stdout' | 'stderr' | 'info' | 'system';
    content: string;
    timestamp: number;
}

interface ConsoleProps {
    stdout: string;
    stderr: string;
    isExecuting: boolean;
    error?: string | null;
    waitingForInput?: boolean;
    onClear?: () => void;
    onInput?: (input: string) => void;
    onCancel?: () => void;
}

const MAX_LINES = 1000;
const MAX_LINE_LENGTH = 5000;

// ANSI color codes
const ANSI_COLORS: Record<string, string> = {
    '30': 'text-black',
    '31': 'text-red-600',
    '32': 'text-green-600',
    '33': 'text-yellow-600',
    '34': 'text-blue-600',
    '35': 'text-purple-600',
    '36': 'text-cyan-600',
    '37': 'text-gray-600',
    '90': 'text-gray-500',
    '91': 'text-red-500',
    '92': 'text-green-500',
    '93': 'text-yellow-500',
    '94': 'text-blue-500',
    '95': 'text-purple-500',
    '96': 'text-cyan-500',
    '97': 'text-white',
};

const ANSI_BG_COLORS: Record<string, string> = {
    '40': 'bg-black',
    '41': 'bg-red-600',
    '42': 'bg-green-600',
    '43': 'bg-yellow-600',
    '44': 'bg-blue-600',
    '45': 'bg-purple-600',
    '46': 'bg-cyan-600',
    '47': 'bg-gray-600',
};

// Parse ANSI codes and return styled spans
function parseAnsiText(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const regex = /\x1b\[([0-9;]*)m/g;
    let lastIndex = 0;
    let match;
    let currentStyles: string[] = [];

    let keyIndex = 0;
    while ((match = regex.exec(text)) !== null) {
        // Add text before this match
        if (match.index > lastIndex) {
            const textPart = text.slice(lastIndex, match.index);
            if (textPart) {
                parts.push(
                    <span key={`ansi-${keyIndex++}`} className={currentStyles.join(' ')}>
                        {textPart}
                    </span>
                );
            }
        }

        // Parse ANSI codes
        const codes = match[1].split(';');
        codes.forEach((code) => {
            if (code === '0') {
                currentStyles = []; // Reset
            } else if (code in ANSI_COLORS) {
                currentStyles.push(ANSI_COLORS[code]);
            } else if (code in ANSI_BG_COLORS) {
                currentStyles.push(ANSI_BG_COLORS[code]);
            }
        });

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        const textPart = text.slice(lastIndex);
        if (textPart) {
            parts.push(
                <span key={`ansi-${keyIndex++}`} className={currentStyles.join(' ')}>
                    {textPart}
                </span>
            );
        }
    }

    return parts;
}

export default function Console({
    stdout,
    stderr,
    isExecuting,
    error,
    waitingForInput = false,
    onClear,
    onInput,
    onCancel,
}: ConsoleProps) {
    const [activeTab, setActiveTab] = useState<'output' | 'errors'>('output');
    const [inputValue, setInputValue] = useState('');
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const outputRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Combine stdout and stderr into lines
    const [lines, setLines] = useState<ConsoleLine[]>([]);

    // Update lines when stdout/stderr change
    useEffect(() => {
        // Clear lines when starting a new execution (empty strings indicate new run)
        if (!stdout && !stderr && !error && lines.length > 0) {
            setLines([]);
            return;
        }

        const newLines: ConsoleLine[] = [];
        const now = Date.now();

        // Process stdout
        if (stdout) {
            stdout.split('\n').forEach((line, index) => {
                if (line || index < stdout.split('\n').length - 1) {
                    newLines.push({
                        id: `stdout-${now}-${index}`,
                        type: 'stdout',
                        content: line.slice(0, MAX_LINE_LENGTH),
                        timestamp: now + index,
                    });
                }
            });
        }

        // Process stderr
        if (stderr) {
            stderr.split('\n').forEach((line, index) => {
                if (line || index < stderr.split('\n').length - 1) {
                    newLines.push({
                        id: `stderr-${now}-${index}`,
                        type: 'stderr',
                        content: line.slice(0, MAX_LINE_LENGTH),
                        timestamp: now + 1000 + index,
                    });
                }
            });
        }

        // Process error
        if (error) {
            newLines.push({
                id: `error-${now}`,
                type: 'stderr',
                content: `Error: ${error}`,
                timestamp: now + 2000,
            });
        }

        if (newLines.length > 0) {
            setLines((prev) => {
                const combined = [...prev, ...newLines];
                // Keep only last MAX_LINES
                return combined.slice(-MAX_LINES);
            });
        }
    }, [stdout, stderr, error]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [lines]);

    // Focus input when waiting for input
    useEffect(() => {
        if (waitingForInput && inputRef.current) {
            inputRef.current.focus();
        }
    }, [waitingForInput]);

    const handleInputSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim() && onInput) {
            // Add to history
            setHistory((prev) => [...prev.slice(-99), inputValue]);
            setHistoryIndex(-1);

            // Send input
            onInput(inputValue + '\n');
            setInputValue('');
        }
    }, [inputValue, onInput]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (history.length > 0) {
                const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
                setHistoryIndex(newIndex);
                setInputValue(history[history.length - 1 - newIndex] || '');
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setInputValue(history[history.length - 1 - newIndex] || '');
            } else if (historyIndex === 0) {
                setHistoryIndex(-1);
                setInputValue('');
            }
        }
    }, [history, historyIndex]);

    const hasOutput = stdout.trim().length > 0;
    const hasErrors = stderr.length > 0 || error;

    return (
        <div className="h-full flex flex-col bg-ide-output rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-ide-toolbar border-b border-border">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setActiveTab('output')}
                        className={
                            'text-sm font-medium transition-colors' +
                            (activeTab === 'output'
                                ? ' text-primary'
                                : ' text-muted-foreground hover:text-foreground')
                        }
                    >
                        Output
                        {hasOutput && (
                            <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-secondary rounded">
                                {stdout.split('\n').length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('errors')}
                        className={
                            'text-sm font-medium transition-colors flex items-center gap-1' +
                            (activeTab === 'errors'
                                ? ' text-primary'
                                : ' text-muted-foreground hover:text-foreground')
                        }
                    >
                        Errors
                        {hasErrors && (
                            <span className="w-2 h-2 bg-ide-error rounded-full animate-pulse" />
                        )}
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {isExecuting && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span>Running...</span>
                        </div>
                    )}
                    {onClear && (
                        <button
                            onClick={onClear}
                            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div
                    ref={outputRef}
                    className="flex-1 p-4 text-sm font-mono overflow-auto whitespace-pre-wrap break-words bg-ide-output"
                >
                    {activeTab === 'output' ? (
                        <>
                            {!isExecuting && !stdout && (
                                <span className="text-muted-foreground">Run your code to see output here.</span>
                            )}
                            {lines
                                .filter((line) => line.type === 'stdout' || line.type === 'info' || line.type === 'system')
                                .map((line) => (
                                    <div key={line.id} className="text-foreground">
                                        {parseAnsiText(line.content)}
                                    </div>
                                ))}
                        </>
                    ) : (
                        <>
                            {error && (
                                <div className="text-ide-error mb-4 p-3 bg-ide-error/10 rounded border border-ide-error/30">
                                    <span className="font-semibold">Error: </span>
                                    {error}
                                </div>
                            )}
                            {lines
                                .filter((line) => line.type === 'stderr')
                                .map((line) => (
                                    <div key={line.id} className="text-ide-error">
                                        {parseAnsiText(line.content)}
                                    </div>
                                ))}
                            {!error && !stderr && (
                                <span className="text-muted-foreground">No errors.</span>
                            )}
                        </>
                    )}
                </div>

                {/* Input field for interactive programs */}
                {(waitingForInput || (isExecuting && activeTab === 'output')) && (
                    <form onSubmit={handleInputSubmit} className="border-t border-border p-2">
                        <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-sm">{'>'}</span>
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={!waitingForInput && !isExecuting}
                                className="flex-1 bg-transparent text-foreground font-mono text-sm focus:outline-none"
                                placeholder={waitingForInput ? "Enter input..." : "Waiting for input..."}
                                autoFocus
                            />
                            {waitingForInput && (
                                <button
                                    type="submit"
                                    disabled={!inputValue.trim()}
                                    className="px-3 py-1 bg-primary hover:bg-primary/90 disabled:bg-muted text-primary-foreground text-sm rounded"
                                >
                                    Send
                                </button>
                            )}
                            {isExecuting && onCancel && !waitingForInput && (
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    className="px-3 py-1 bg-ide-error hover:bg-ide-error/90 text-white text-sm rounded"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}