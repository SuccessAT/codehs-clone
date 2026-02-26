import { useState, useEffect, useRef } from 'react';
import { default as MonacoEditor, OnMount, OnChange } from '@monaco-editor/react';
import { useUIStore } from '@/store';
import clsx from 'clsx';

export interface EditorFile {
    name: string;
    language: string;
    content: string;
}

interface EditorProps {
    files: EditorFile[];
    activeFileIndex: number;
    onFileChange: (index: number, content: string) => void;
    onFileAdd?: (file: EditorFile) => void;
    onFileRemove?: (index: number) => void;
    onLanguageChange?: (index: number, language: string) => void;
    readOnly?: boolean;
    height?: string | number;
    exerciseId?: number;
    starterCode?: string;
}

const SUPPORTED_LANGUAGES = [
    { value: 'python', label: 'Python', extension: '.py' },
    { value: 'javascript', label: 'JavaScript', extension: '.js' },
    { value: 'typescript', label: 'TypeScript', extension: '.ts' },
    { value: 'java', label: 'Java', extension: '.java' },
    { value: 'cpp', label: 'C++', extension: '.cpp' },
    { value: 'c', label: 'C', extension: '.c' },
    { value: 'html', label: 'HTML', extension: '.html' },
    { value: 'css', label: 'CSS', extension: '.css' },
];

const MAX_FILE_SIZE = 50000; // 50KB

export default function Editor({
    files,
    activeFileIndex,
    onFileChange,
    onFileAdd,
    onFileRemove,
    onLanguageChange,
    readOnly = false,
    height = '100%',
    exerciseId,
    starterCode,
}: EditorProps) {
    const editorRef = useRef<any>(null);
    const { darkMode, editorFontSize, editorTheme } = useUIStore();
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
    const [showNewFileDialog, setShowNewFileDialog] = useState(false);
    const [newFileName, setNewFileName] = useState('');

    const activeFile = files[activeFileIndex];

    // Load from localStorage on mount
    useEffect(() => {
        if (exerciseId && activeFile) {
            const saved = localStorage.getItem(`code_${exerciseId}_${activeFile.name}`);
            if (saved && saved !== activeFile.content) {
                onFileChange(activeFileIndex, saved);
            }
        }
    }, [exerciseId, activeFileIndex, activeFile, onFileChange]);

    // Save to localStorage on change
    useEffect(() => {
        if (exerciseId && activeFile && hasUnsavedChanges) {
            const timeout = setTimeout(() => {
                localStorage.setItem(`code_${exerciseId}_${activeFile.name}`, activeFile.content);
                setHasUnsavedChanges(false);
            }, 1000);
            return () => clearTimeout(timeout);
        }
    }, [activeFile?.content, exerciseId, activeFile?.name, hasUnsavedChanges]);

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;

        // Configure editor settings
        editor.updateOptions({
            fontSize: editorFontSize,
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 10,
            lineNumbersMinChars: 3,
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            padding: { top: 10, bottom: 10 },
            fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
            fontLigatures: true,
            bracketPairColorization: { enabled: true },
            guides: {
                bracketPairs: true,
                indentation: true,
            },
            suggest: {
                showKeywords: true,
                showSnippets: true,
                showClasses: true,
                showFunctions: true,
                showVariables: true,
            },
        });

        // Add custom keybindings
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            // Save to localStorage immediately
            if (exerciseId && activeFile) {
                localStorage.setItem(`code_${exerciseId}_${activeFile.name}`, activeFile.content);
                setHasUnsavedChanges(false);
            }
        });

        // Run code with Ctrl+Enter
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            // Trigger run - handled by parent component
            const runEvent = new CustomEvent('editor-run');
            window.dispatchEvent(runEvent);
        });

        // Focus editor
        editor.focus();
    };

    const handleEditorChange: OnChange = (value) => {
        if (value !== undefined) {
            // Check file size
            if (value.length > MAX_FILE_SIZE) {
                alert(`File too large. Maximum size is ${MAX_FILE_SIZE} characters.`);
                return;
            }

            onFileChange(activeFileIndex, value);
            setHasUnsavedChanges(true);
        }
    };

    const handleReset = () => {
        if (starterCode) {
            if (confirm('Reset to original code? Your changes will be lost.')) {
                onFileChange(activeFileIndex, starterCode);
                if (exerciseId && activeFile) {
                    localStorage.removeItem(`code_${exerciseId}_${activeFile.name}`);
                }
                setHasUnsavedChanges(false);
            }
        }
    };

    const handleSaveDraft = () => {
        if (exerciseId && activeFile) {
            localStorage.setItem(`code_${exerciseId}_${activeFile.name}`, activeFile.content);
            setHasUnsavedChanges(false);
        }
    };

    const handleAddFile = () => {
        if (newFileName.trim() && onFileAdd) {
            const ext = newFileName.includes('.') ? '' : '.py';
            const lang = SUPPORTED_LANGUAGES.find(l => newFileName.endsWith(l.extension))?.value || 'python';
            onFileAdd({
                name: newFileName + ext,
                language: lang,
                content: '',
            });
            setNewFileName('');
            setShowNewFileDialog(false);
        }
    };

    const handleLanguageChange = (lang: string) => {
        if (onLanguageChange) {
            onLanguageChange(activeFileIndex, lang);
        }
        setShowLanguageDropdown(false);
    };

    return (
        <div className="h-full flex flex-col bg-ide-editor rounded-lg overflow-hidden border border-border">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 bg-ide-toolbar border-b border-border">
                {/* File tabs */}
                <div className="flex items-center gap-1 overflow-x-auto flex-1">
                    {files.map((file, index) => (
                        <button
                            key={index}
                            onClick={() => {
                                if (hasUnsavedChanges && activeFileIndex === index) {
                                    if (!confirm('You have unsaved changes. Switch anyway?')) {
                                        return;
                                    }
                                }
                                // Save before switching if needed
                                if (exerciseId && activeFile) {
                                    localStorage.setItem(`code_${exerciseId}_${activeFile.name}`, activeFile.content);
                                }
                                onFileChange(index, files[index].content);
                            }}
                            className={clsx(
                                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-t transition-colors',
                                index === activeFileIndex
                                    ? 'bg-ide-editor text-primary border-t border-x border-border'
                                    : 'text-muted-foreground hover:bg-ide-tab-hover'
                            )}
                        >
                            <span className="truncate max-w-[100px]">{file.name}</span>
                            {index === activeFileIndex && hasUnsavedChanges && (
                                <span className="w-2 h-2 bg-yellow-500 rounded-full" title="Unsaved changes" />
                            )}
                            {files.length > 1 && onFileRemove && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Remove ${file.name}?`)) {
                                            onFileRemove(index);
                                        }
                                    }}
                                    className="ml-1 text-gray-400 hover:text-red-500"
                                >
                                    ×
                                </button>
                            )}
                        </button>
                    ))}

                    {/* Add file button */}
                    {onFileAdd && (
                        <button
                            onClick={() => setShowNewFileDialog(true)}
                            className="p-1.5 text-gray-400 hover:text-primary-500"
                            title="Add new file"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-2">
                    {/* Language selector */}
                    {onLanguageChange && (
                        <div className="relative">
                            <button
                                onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                                className="flex items-center gap-1 px-2 py-1 text-sm text-muted-foreground hover:bg-ide-tab-hover rounded"
                            >
                                {activeFile?.language}
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {showLanguageDropdown && (
                                <div className="absolute right-0 top-full mt-1 w-40 bg-card border border-border rounded-lg shadow-lg z-10">
                                    {SUPPORTED_LANGUAGES.map((lang) => (
                                        <button
                                            key={lang.value}
                                            onClick={() => handleLanguageChange(lang.value)}
                                            className={clsx(
                                                'w-full px-3 py-2 text-left text-sm hover:bg-accent',
                                                activeFile?.language === lang.value
                                                    ? 'text-primary bg-primary/10'
                                                    : 'text-foreground'
                                            )}
                                        >
                                            {lang.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Reset button */}
                    {starterCode && (
                        <button
                            onClick={handleReset}
                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-ide-tab-hover rounded"
                            title="Reset to original"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    )}

                    {/* Save draft button */}
                    {exerciseId && (
                        <button
                            onClick={handleSaveDraft}
                            disabled={!hasUnsavedChanges}
                            className={clsx(
                                'p-1.5 rounded',
                                hasUnsavedChanges
                                    ? 'text-yellow-500 hover:bg-yellow-500/10'
                                    : 'text-muted-foreground/50 cursor-not-allowed'
                            )}
                            title="Save draft"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden">
                {activeFile && (
                    <MonacoEditor
                        height="100%"
                        language={activeFile.language}
                        value={activeFile.content}
                        onChange={handleEditorChange}
                        theme={editorTheme}
                        onMount={handleEditorMount}
                        options={{
                            readOnly,
                            fontSize: editorFontSize,
                            fontFamily: "'JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', monospace",
                            fontLigatures: true,
                        }}
                        loading={
                            <div className="flex items-center justify-center h-full bg-ide-editor">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        }
                    />
                )}
            </div>

            {/* New file dialog */}
            {showNewFileDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 w-80 shadow-xl">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">New File</h3>
                        <input
                            type="text"
                            value={newFileName}
                            onChange={(e) => setNewFileName(e.target.value)}
                            placeholder="filename.py"
                            className="input mb-3"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowNewFileDialog(false)}
                                className="btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddFile}
                                disabled={!newFileName.trim()}
                                className="btn-primary"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}