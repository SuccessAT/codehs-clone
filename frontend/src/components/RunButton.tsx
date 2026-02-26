import { useState, useCallback } from 'react';
import clsx from 'clsx';

interface RunButtonProps {
    onRun: () => void;
    onStop?: () => void;
    isRunning: boolean;
    isDisabled?: boolean;
    language?: string;
    showStop?: boolean;
    showSettings?: boolean;
    onSettingsClick?: () => void;
}

const LANGUAGE_CONFIG: Record<string, { icon: string; label: string }> = {
    python: { icon: '🐍', label: 'Python' },
    javascript: { icon: '📜', label: 'JavaScript' },
    typescript: { icon: '📘', label: 'TypeScript' },
    java: { icon: '☕', label: 'Java' },
    cpp: { icon: '⚙️', label: 'C++' },
    c: { icon: '©️', label: 'C' },
    html: { icon: '🌐', label: 'HTML' },
    css: { icon: '🎨', label: 'CSS' },
};

export default function RunButton({
    onRun,
    onStop,
    isRunning,
    isDisabled = false,
    language = 'python',
    showStop = true,
    showSettings = false,
    onSettingsClick,
}: RunButtonProps) {
    const [showDropdown, setShowDropdown] = useState(false);

    const langConfig = LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG.python;

    const handleClick = useCallback(() => {
        if (isRunning) {
            onStop?.();
        } else {
            onRun();
        }
    }, [isRunning, onRun, onStop]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Ctrl+Enter or Cmd+Enter to run
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!isRunning && !isDisabled) {
                onRun();
            }
        }
    }, [isRunning, isDisabled, onRun]);

    return (
        <div className="flex items-center gap-1" onKeyDown={handleKeyDown}>
            {/* Run/Stop Button */}
            <button
                onClick={handleClick}
                disabled={isDisabled || (!isRunning && !onRun)}
                className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    isRunning
                        ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                        : 'bg-primary text-primary-foreground hover:opacity-90 animate-pulse-run',
                    (isDisabled || (!isRunning && !onRun)) && 'opacity-50 cursor-not-allowed'
                )}
            >
                {isRunning ? (
                    <>
                        {/* Stop icon */}
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                        <span>Stop</span>
                    </>
                ) : (
                    <>
                        {/* Play icon */}
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        <span>Run</span>
                    </>
                )}
            </button>

            {/* Keyboard shortcut hint */}
            {!isRunning && (
                <span className="text-xs text-muted-foreground hidden md:inline">
                    Ctrl+Enter
                </span>
            )}

            {/* Language indicator */}
            <div className="relative">
                <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={clsx(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                        'bg-secondary text-secondary-foreground hover:bg-ide-tab-hover'
                    )}
                    disabled={isRunning}
                >
                    <span>{langConfig.icon}</span>
                    <span className="hidden sm:inline">{langConfig.label}</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {/* Language dropdown */}
                {showDropdown && !isRunning && (
                    <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-10">
                        <div className="p-2">
                            <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                                Select Language
                            </p>
                            {Object.entries(LANGUAGE_CONFIG).map(([key, config]) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        // Language change would be handled by parent
                                        setShowDropdown(false);
                                    }}
                                    className={clsx(
                                        'w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent',
                                        key === language
                                            ? 'text-primary bg-primary/10'
                                            : 'text-foreground'
                                    )}
                                >
                                    <span>{config.icon}</span>
                                    <span>{config.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Settings button */}
            {showSettings && (
                <button
                    onClick={onSettingsClick}
                    className={clsx(
                        'p-2 rounded-lg transition-colors',
                        'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                    title="Run settings"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            )}

            {/* Submit button (for grading) */}
            {!isRunning && onRun && (
                <button
                    onClick={onRun}
                    disabled={isDisabled}
                    className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                        'bg-secondary text-secondary-foreground hover:bg-ide-tab-hover',
                        isDisabled && 'opacity-50 cursor-not-allowed'
                    )}
                    title="Submit for grading"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Submit</span>
                </button>
            )}
        </div>
    );
}