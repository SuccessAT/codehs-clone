import { useState, useEffect } from 'react';
import type { editor } from 'monaco-editor';
import type { GhostSuggestion } from '@/types/collaboration';

interface GhostSuggestionsProps {
    suggestions: GhostSuggestion[];
    onAccept: (suggestion: GhostSuggestion) => void;
    editor: editor.IStandaloneCodeEditor | null;
}

export function GhostSuggestions({ suggestions, onAccept, editor }: GhostSuggestionsProps) {
    const [currentSuggestion, setCurrentSuggestion] = useState<GhostSuggestion | null>(null);

    useEffect(() => {
        if (suggestions.length > 0 && editor) {
            setCurrentSuggestion(suggestions[0]);
        } else {
            setCurrentSuggestion(null);
        }
    }, [suggestions, editor]);

    if (!currentSuggestion || !editor) return null;

    return (
        <div className="absolute bottom-4 right-4 w-96 bg-card border border-border rounded-lg shadow-xl z-30">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                        style={{ backgroundColor: currentSuggestion.author.color }}
                    >
                        {currentSuggestion.author.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="text-sm font-medium text-foreground">
                            {currentSuggestion.author.name}'s suggestion
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Teacher
                        </div>
                    </div>
                </div>
            </div>

            {/* Suggested Code */}
            <div className="p-3">
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto mb-3">
                    <code>{currentSuggestion.code}</code>
                </pre>

                {/* Actions */}
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            onAccept(currentSuggestion);
                            setCurrentSuggestion(null);
                        }}
                        className="flex-1 px-3 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded"
                    >
                        Accept
                    </button>
                    <button
                        onClick={() => {
                            setCurrentSuggestion(null);
                        }}
                        className="flex-1 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 text-foreground rounded"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
}
