import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';

interface OutputPanelProps {
    stdout: string;
    stderr: string;
    isExecuting: boolean;
    error?: string | null;
    onClear?: () => void;
}

export default function OutputPanel({
    stdout,
    stderr,
    isExecuting,
    error,
    onClear,
}: OutputPanelProps) {
    const [activeTab, setActiveTab] = useState<'output' | 'errors'>('output');
    const outputRef = useRef<HTMLPreElement>(null);

    // Auto-scroll to bottom when new output arrives
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [stdout, stderr]);

    const hasOutput = stdout.length > 0;
    const hasErrors = stderr.length > 0 || error;

    return (
        <div className="h-full flex flex-col bg-gray-900 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setActiveTab('output')}
                        className={clsx(
                            'text-sm font-medium transition-colors',
                            activeTab === 'output'
                                ? 'text-primary-400'
                                : 'text-gray-400 hover:text-gray-200'
                        )}
                    >
                        Output
                        {hasOutput && (
                            <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-700 rounded">
                                {stdout.split('\n').length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('errors')}
                        className={clsx(
                            'text-sm font-medium transition-colors flex items-center gap-1',
                            activeTab === 'errors'
                                ? 'text-primary-400'
                                : 'text-gray-400 hover:text-gray-200'
                        )}
                    >
                        Errors
                        {hasErrors && (
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        )}
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {isExecuting && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                            <span>Running...</span>
                        </div>
                    )}
                    {onClear && (
                        <button
                            onClick={onClear}
                            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'output' && (
                    <pre
                        ref={outputRef}
                        className="h-full p-4 text-sm font-mono text-gray-100 overflow-auto whitespace-pre-wrap break-words"
                    >
                        {isExecuting && !stdout && (
                            <span className="text-gray-500 animate-pulse">Waiting for output...</span>
                        )}
                        {!isExecuting && !stdout && (
                            <span className="text-gray-500">No output yet. Run your code to see results.</span>
                        )}
                        {stdout}
                    </pre>
                )}

                {activeTab === 'errors' && (
                    <pre className="h-full p-4 text-sm font-mono overflow-auto whitespace-pre-wrap break-words">
                        {error && (
                            <div className="text-red-400 mb-4 p-3 bg-red-900/20 rounded border border-red-800">
                                <span className="font-semibold">Error: </span>
                                {error}
                            </div>
                        )}
                        {stderr ? (
                            <span className="text-red-400">{stderr}</span>
                        ) : (
                            !error && (
                                <span className="text-gray-500">No errors.</span>
                            )
                        )}
                    </pre>
                )}
            </div>
        </div>
    );
}