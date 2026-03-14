import { useState, useEffect, useRef, useCallback } from 'react';
import { default as MonacoEditor, OnMount, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import randomColor from 'randomcolor';
import { useUIStore } from '@/store';
import clsx from 'clsx';
import { PresenceBar } from './PresenceBar';
import { CommentThreadWidget } from './CommentThreadWidget';
import { GhostSuggestions } from './GhostSuggestions';
import type { Collaborator, Comment, GhostSuggestion, CollaborationMessage } from '@/types/collaboration';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export interface EditorFile {
    name: string;
    language: string;
    content: string;
}

interface CollaborativeEditorProps {
    files: EditorFile[];
    activeFileIndex: number;
    onFileChange: (index: number, content: string) => void;
    roomId: string;
    userId: string;
    userName: string;
    userRole: 'teacher' | 'student';
    exerciseId?: number;
    starterCode?: string;
    readOnly?: boolean;
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

// Remote cursor CSS
const CURSOR_CSS = `
    .remote-cursor {
        position: absolute;
        width: 2px;
        pointer-events: none;
        z-index: 100;
    }
    .remote-cursor-caret {
        position: absolute;
        width: 2px;
        height: 18px;
        pointer-events: none;
    }
    .remote-cursor-label {
        position: absolute;
        top: -18px;
        left: 0;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 2px;
        white-space: nowrap;
        color: white;
    }
    .comment-glyph {
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23e8a838' d='M14 1H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3l3 3 3-3h3a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z'/%3E%3C/svg%3E") no-repeat center center;
        cursor: pointer;
    }
    .comment-highlight {
        background-color: rgba(232, 168, 56, 0.2);
    }
    .comment-highlight:hover {
        background-color: rgba(232, 168, 56, 0.4);
    }
`;

export default function CollaborativeEditor({
    files,
    activeFileIndex,
    onFileChange,
    roomId,
    userId,
    userName,
    userRole,
    exerciseId,
    starterCode,
    readOnly = false,
}: CollaborativeEditorProps) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<Monaco | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { darkMode, editorFontSize, editorTheme } = useUIStore();

    // Collaboration state
    const [isConnected, setIsConnected] = useState(false);
    const [collaborators, setCollaborators] = useState<Map<string, Collaborator>>(new Map());
    const [comments, setComments] = useState<Comment[]>([]);
    const [suggestions, setSuggestions] = useState<GhostSuggestion[]>([]);
    const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
    const [showCommentInput, setShowCommentInput] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [selectedRange, setSelectedRange] = useState<{ startLine: number; startColumn: number; endLine: number; endColumn: number } | null>(null);

    // Refs for collaboration
    const ydocRef = useRef<Y.Doc | null>(null);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const bindingRef = useRef<MonacoBinding | null>(null);
    const commentsWsRef = useRef<WebSocket | null>(null);
    const cursorDecorationsRef = useRef<string[]>([]);
    const commentDecorationsRef = useRef<string[]>([]);
    const contentWidgetRef = useRef<any>(null);

    const currentUser = useRef<Collaborator>({
        id: userId,
        name: userName,
        color: randomColor({ luminosity: 'bright', seed: userId }),
        role: userRole,
    });

    const activeFile = files[activeFileIndex];

    // Initialize collaboration
    useEffect(() => {
        if (!roomId || !userId) return;

        // Get JWT token from localStorage
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('No authentication token found');
            return;
        }

        // Create Yjs document
        const ydoc = new Y.Doc();
        ydocRef.current = ydoc;

        // Create WebSocket provider for CRDT sync with token
        const provider = new WebsocketProvider(
            `${WS_URL}/ws/editor`,
            roomId,
            ydoc,
            { params: { token } }
        );
        providerRef.current = provider;

        // Connection status
        provider.on('status', (event: { status: string }) => {
            setIsConnected(event.status === 'connected');
        });

        // Set up awareness for cursor presence
        const awareness = provider.awareness;

        // Set local user state
        awareness.setLocalStateField('user', {
            id: userId,
            name: userName,
            color: currentUser.current.color,
            role: userRole,
        });

        // Listen for awareness changes (cursor updates)
        awareness.on('change', () => {
            const states = awareness.getStates();
            const newCollaborators = new Map<string, Collaborator>();

            states.forEach((state: any, clientId: number) => {
                if (state.user && state.user.id !== userId) {
                    newCollaborators.set(state.user.id, {
                        ...state.user,
                        cursor: state.cursor,
                        isTyping: state.typing || false,
                    });
                }
            });

            setCollaborators(newCollaborators);
            updateRemoteCursors(newCollaborators);
        });

        // Connect to comments WebSocket with token
        const commentsWs = new WebSocket(`${WS_URL}/ws/comments?room=${roomId}&token=${encodeURIComponent(token)}`);
        commentsWsRef.current = commentsWs;

        commentsWs.onmessage = (event) => {
            if (commentsWs.readyState !== WebSocket.OPEN) return;

            try {
                const message: CollaborationMessage = JSON.parse(event.data);
                handleCollaborationMessage(message);
            } catch (error) {
                console.error('Failed to parse collaboration message:', error);
            }
        };

        // Inject cursor CSS
        const styleEl = document.createElement('style');
        styleEl.textContent = CURSOR_CSS;
        document.head.appendChild(styleEl);

        return () => {
            if (bindingRef.current) {
                bindingRef.current.destroy();
            }
            provider.disconnect();
            ydoc.destroy();
            if (commentsWsRef.current) {
                commentsWsRef.current.close();
            }
            styleEl.remove();
        };
    }, [roomId, userId, userName, userRole]);

    // Handle collaboration messages
    const handleCollaborationMessage = useCallback((message: CollaborationMessage) => {
        switch (message.type) {
            case 'COMMENT_NEW':
                setComments(prev => {
                    const updated = [...prev, message.payload];
                    renderCommentDecorations(updated);
                    return updated;
                });
                break;
            case 'COMMENT_REPLY':
                setComments(prev => prev.map(c => {
                    if (c.id === message.payload.commentId) {
                        return { ...c, replies: [...c.replies, message.payload] };
                    }
                    return c;
                }));
                break;
            case 'COMMENT_RESOLVE':
                setComments(prev => prev.map(c => {
                    if (c.id === message.payload.commentId) {
                        return { ...c, resolved: true };
                    }
                    return c;
                }));
                break;
            case 'SUGGESTION':
                if (message.userId !== userId) {
                    setSuggestions(prev => [...prev, message.payload]);
                }
                break;
            case 'SUGGESTION_ACCEPT':
                setSuggestions(prev => prev.filter(s => s.id !== message.payload.suggestionId));
                break;
        }
    }, [userId]);

    // Update remote cursor decorations
    const updateRemoteCursors = useCallback((newCollaborators: Map<string, Collaborator>) => {
        if (!editorRef.current || !monacoRef.current) return;

        const decorations: editor.IModelDeltaDecoration[] = [];

        newCollaborators.forEach((collaborator) => {
            if (collaborator.cursor) {
                const { line, column } = collaborator.cursor;

                // Cursor caret
                decorations.push({
                    range: new monacoRef.current!.Range(line, column, line, column),
                    options: {
                        className: `remote-cursor-caret`,
                        beforeContentClassName: `remote-cursor-caret`,
                        stickiness: 1,
                        inlineClassName: `remote-cursor-caret`,
                        inlineClassNameAffectsLetterSpacing: false,
                    },
                });

                // Cursor label (username)
                decorations.push({
                    range: new monacoRef.current!.Range(line, column, line, column),
                    options: {
                        hoverMessage: { value: collaborator.name },
                        beforeContentClassName: `remote-cursor-label`,
                        stickiness: 1,
                    },
                });
            }
        });

        cursorDecorationsRef.current = editorRef.current.deltaDecorations(
            cursorDecorationsRef.current,
            decorations
        );
    }, []);

    // Render comment decorations
    const renderCommentDecorations = useCallback((allComments: Comment[]) => {
        if (!editorRef.current || !monacoRef.current) return;

        const decorations: editor.IModelDeltaDecoration[] = [];

        allComments.forEach((comment) => {
            // Gutter glyph
            decorations.push({
                range: new monacoRef.current!.Range(comment.range.startLine, 1, comment.range.startLine, 1),
                options: {
                    glyphMarginClassName: 'comment-glyph',
                    isWholeLine: true,
                    glyphMarginHoverMessage: { value: `Comment by ${comment.author.name}` },
                },
            });

            // Highlight range
            decorations.push({
                range: new monacoRef.current!.Range(
                    comment.range.startLine,
                    comment.range.startColumn,
                    comment.range.endLine,
                    comment.range.endColumn
                ),
                options: {
                    className: 'comment-highlight',
                    hoverMessage: { value: comment.text },
                },
            });
        });

        commentDecorationsRef.current = editorRef.current.deltaDecorations(
            commentDecorationsRef.current,
            decorations
        );
    }, []);

    // Handle editor mount
    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        if (!ydocRef.current || !providerRef.current) return;

        // Configure editor
        editor.updateOptions({
            fontSize: editorFontSize,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            glyphMargin: true,
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
            readOnly,
        });

        // Bind to Yjs
        const ytext = ydocRef.current.getText('monaco');
        const binding = new MonacoBinding(
            ytext,
            editor.getModel()!,
            new Set([editor]),
            providerRef.current.awareness
        );
        bindingRef.current = binding;

        // Set initial content
        if (starterCode && ytext.length === 0) {
            ytext.insert(0, starterCode);
        }

        // Listen for cursor position changes
        editor.onDidChangeCursorPosition((event) => {
            if (providerRef.current) {
                providerRef.current.awareness.setLocalStateField('cursor', {
                    line: event.position.lineNumber,
                    column: event.position.column,
                    selection: editor.getSelection(),
                });
            }
        });

        // Listen for mouse clicks (comment interactions)
        editor.onMouseDown((event) => {
            // Click on gutter glyph margin
            if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                const lineNumber = event.target.position?.lineNumber;
                if (lineNumber) {
                    const comment = comments.find(c => c.range.startLine === lineNumber);
                    if (comment) {
                        setSelectedComment(comment);
                    }
                }
            }

            // Click on comment highlight
            if (event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) {
                const lineNumber = event.target.position?.lineNumber;
                const column = event.target.position?.column;
                if (lineNumber && column) {
                    const comment = comments.find(c =>
                        lineNumber >= c.range.startLine &&
                        lineNumber <= c.range.endLine &&
                        column >= c.range.startColumn &&
                        column <= c.range.endColumn
                    );
                    if (comment) {
                        setSelectedComment(comment);
                    } else {
                        setSelectedComment(null);
                    }
                }
            }
        });

        // Selection change - show "Add Comment" button
        editor.onDidChangeCursorSelection((event) => {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                setSelectedRange({
                    startLine: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLine: selection.endLineNumber,
                    endColumn: selection.endColumn,
                });
            } else {
                setSelectedRange(null);
                setShowCommentInput(false);
            }
        });

        // Add custom keybindings
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            // Save to localStorage immediately
            if (exerciseId && activeFile) {
                localStorage.setItem(`code_${exerciseId}_${activeFile.name}`, activeFile.content);
            }
        });

        // Run code with Ctrl+Enter
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const runEvent = new CustomEvent('editor-run');
            window.dispatchEvent(runEvent);
        });

        // Add content widget for comment threads
        editor.addContentWidget({
            getId: () => 'comment-thread-widget',
            getDomNode: () => {
                const node = document.createElement('div');
                node.id = 'comment-thread-widget';
                contentWidgetRef.current = node;
                return node;
            },
            getPosition: () => {
                if (!selectedComment || !editorRef.current) return null;

                const model = editorRef.current.getModel();
                if (!model) return null;

                const lineCount = model.getLineCount();
                let lineNumber = selectedComment.range.endLine + 1;

                // Clamp to valid range
                if (lineNumber > lineCount) {
                    lineNumber = lineCount;
                }

                // Ensure at least line 1
                lineNumber = Math.max(1, lineNumber);

                return {
                    position: {
                        lineNumber,
                        column: 1,
                    },
                    preference: [
                        monaco.editor.ContentWidgetPositionPreference.EXACT,
                        monaco.editor.ContentWidgetPositionPreference.BELOW,
                    ],
                };
            },
        });

        // Render existing comment decorations
        renderCommentDecorations(comments);

        editor.focus();
    };

    // Handle editor changes
    const handleEditorChange = (value: string | undefined) => {
        if (value !== undefined) {
            onFileChange(activeFileIndex, value);
        }
    };

    // Send a new comment
    const handleSendComment = useCallback(() => {
        if (!commentText.trim() || !selectedRange) return;

        const selection = editorRef.current?.getSelection();
        const selectedText = selection ? editorRef.current?.getModel()?.getValueInRange(selection) || '' : '';

        const newComment: Comment = {
            id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            fileId: activeFile?.name || 'default',
            range: {
                startLine: selectedRange.startLine,
                startColumn: selectedRange.startColumn,
                endLine: selectedRange.endLine,
                endColumn: selectedRange.endColumn,
                text: selectedText,
            },
            author: currentUser.current,
            text: commentText,
            createdAt: new Date().toISOString(),
            replies: [],
        };

        const message: CollaborationMessage = {
            type: 'COMMENT_NEW',
            payload: newComment,
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }

        setComments(prev => [...prev, newComment]);
        setCommentText('');
        setShowCommentInput(false);
        setSelectedRange(null);
    }, [commentText, selectedRange, activeFile, userId]);

    // Send a reply to a comment
    const handleSendReply = useCallback((commentId: string, text: string) => {
        const reply = {
            id: `reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            commentId,
            author: currentUser.current,
            text,
            createdAt: new Date().toISOString(),
        };

        const message: CollaborationMessage = {
            type: 'COMMENT_REPLY',
            payload: reply,
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }

        setComments(prev => prev.map(c => {
            if (c.id === commentId) {
                return { ...c, replies: [...c.replies, reply] };
            }
            return c;
        }));
    }, [userId]);

    // Resolve a comment
    const handleResolveComment = useCallback((commentId: string) => {
        const message: CollaborationMessage = {
            type: 'COMMENT_RESOLVE',
            payload: { commentId },
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }

        setComments(prev => prev.map(c => {
            if (c.id === commentId) {
                return { ...c, resolved: true };
            }
            return c;
        }));
        setSelectedComment(null);
    }, [userId]);

    // Accept a suggestion (student only)
    const handleAcceptSuggestion = useCallback((suggestion: GhostSuggestion) => {
        if (!editorRef.current) return;

        // Insert the suggestion code at the position
        const position = editorRef.current.getPosition();
        if (position) {
            editorRef.current.executeEdits('accept-suggestion', [{
                range: new monacoRef.current!.Range(
                    suggestion.position.line,
                    suggestion.position.column,
                    suggestion.position.line,
                    suggestion.position.column
                ),
                text: suggestion.code,
            }]);
        }

        // Notify server
        const message: CollaborationMessage = {
            type: 'SUGGESTION_ACCEPT',
            payload: { suggestionId: suggestion.id },
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }

        setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    }, [userId]);

    // Send a ghost suggestion (teacher only)
    const handleSendSuggestion = useCallback((code: string, position: { line: number; column: number }) => {
        if (userRole !== 'teacher') return;

        const suggestion: GhostSuggestion = {
            id: `suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            code,
            author: currentUser.current,
            position,
        };

        const message: CollaborationMessage = {
            type: 'SUGGESTION',
            payload: suggestion,
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }
    }, [userId, userRole]);

    return (
        <div className="h-full flex flex-col bg-ide-editor rounded-lg overflow-hidden border border-border">
            {/* Presence Bar */}
            <PresenceBar
                collaborators={collaborators}
                currentUser={currentUser.current}
                isConnected={isConnected}
            />

            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 bg-ide-toolbar border-b border-border">
                {/* File tabs */}
                <div className="flex items-center gap-1 overflow-x-auto flex-1">
                    {files.map((file, index) => (
                        <button
                            key={index}
                            className={clsx(
                                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-t transition-colors',
                                index === activeFileIndex
                                    ? 'bg-ide-editor text-primary border-t border-x border-border'
                                    : 'text-muted-foreground hover:bg-ide-tab-hover'
                            )}
                        >
                            <span className="truncate max-w-[100px]">{file.name}</span>
                        </button>
                    ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-2">
                    <span className="text-sm text-muted-foreground">
                        {activeFile?.language}
                    </span>
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden relative" ref={containerRef}>
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

                {/* Add Comment Button */}
                {selectedRange && !showCommentInput && (
                    <div
                        className="absolute bg-primary text-white px-3 py-1.5 rounded shadow-lg cursor-pointer hover:bg-primary/90 z-10"
                        style={{
                            top: editorRef.current?.getTopForLineNumber(selectedRange.startLine) || 0,
                            left: (editorRef.current?.getOffsetForColumn(selectedRange.startLine, selectedRange.startColumn) || 0) + 50,
                        }}
                        onClick={() => setShowCommentInput(true)}
                    >
                        + Add Comment
                    </div>
                )}

                {/* Comment Input */}
                {showCommentInput && (
                    <div
                        className="absolute bg-card border border-border rounded-lg shadow-lg p-3 z-20 w-80"
                        style={{
                            top: editorRef.current?.getTopForLineNumber(selectedRange?.endLine || 1) || 0,
                            left: ((editorRef.current?.getOffsetForColumn(selectedRange?.endLine || 1, selectedRange?.endColumn || 1) || 0)) + 50,
                        }}
                    >
                        <textarea
                            className="w-full p-2 border border-border rounded bg-background text-foreground resize-none"
                            rows={3}
                            placeholder="Add a comment..."
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                onClick={() => {
                                    setShowCommentInput(false);
                                    setSelectedRange(null);
                                }}
                                className="px-3 py-1 text-sm text-muted-foreground hover:bg-accent rounded"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSendComment}
                                disabled={!commentText.trim()}
                                className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50"
                            >
                                Comment
                            </button>
                        </div>
                    </div>
                )}

                {/* Comment Thread Widget */}
                {selectedComment && (
                    <CommentThreadWidget
                        comment={selectedComment}
                        onClose={() => setSelectedComment(null)}
                        onReply={handleSendReply}
                        onResolve={handleResolveComment}
                        currentUserId={userId}
                    />
                )}

                {/* Ghost Suggestions */}
                {userRole === 'student' && suggestions.length > 0 && (
                    <GhostSuggestions
                        suggestions={suggestions}
                        onAccept={handleAcceptSuggestion}
                        editor={editorRef.current}
                    />
                )}
            </div>
        </div>
    );
}
