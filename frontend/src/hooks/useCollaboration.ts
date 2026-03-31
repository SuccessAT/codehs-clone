import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import randomColor from 'randomcolor';
import type { editor } from 'monaco-editor';
import type { Collaborator, Comment, CommentReply, GhostSuggestion, CollaborationMessage } from '@/types/collaboration';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

interface UseCollaborationOptions {
    roomId: string;
    userId: string;
    userName: string;
    userRole: 'teacher' | 'student';
    initialCode?: string;
    language?: string;
}

interface UseCollaborationReturn {
    ydoc: Y.Doc | null;
    provider: WebsocketProvider | null;
    isConnected: boolean;
    collaborators: Map<string, Collaborator>;
    comments: Comment[];
    suggestions: GhostSuggestion[];
    currentUser: Collaborator;
    sendComment: (comment: Omit<Comment, 'id' | 'author' | 'createdAt' | 'replies'>) => void;
    sendReply: (commentId: string, text: string) => void;
    resolveComment: (commentId: string) => void;
    sendSuggestion: (code: string, position: { line: number; column: number }) => void;
    acceptSuggestion: (suggestionId: string) => void;
    updateCursor: (line: number, column: number, selection?: any) => void;
    setTyping: (isTyping: boolean) => void;
    cleanup: () => void;
}

// Generate a consistent color for a user based on their ID
const getUserColor = (userId: string): string => {
    return randomColor({ luminosity: 'bright', seed: userId });
};

export function useCollaboration({
    roomId,
    userId,
    userName,
    userRole,
    initialCode = '',
}: UseCollaborationOptions): UseCollaborationReturn {
    const [isConnected, setIsConnected] = useState(false);
    const [collaborators, setCollaborators] = useState<Map<string, Collaborator>>(new Map());
    const [comments, setComments] = useState<Comment[]>([]);
    const [suggestions, setSuggestions] = useState<GhostSuggestion[]>([]);
    const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
    const [provider, setProvider] = useState<WebsocketProvider | null>(null);

    const ydocRef = useRef<Y.Doc | null>(null);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const bindingRef = useRef<MonacoBinding | null>(null);
    const commentsWsRef = useRef<WebSocket | null>(null);
    const currentUserRef = useRef<Collaborator>({
        id: userId,
        name: userName,
        color: getUserColor(userId),
        role: userRole,
    });

    // Initialize Yjs and WebSocket provider
    useEffect(() => {
        // Get JWT token from localStorage
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('No authentication token found');
            return;
        }

        // Create Yjs document
        const ydoc = new Y.Doc();
        ydocRef.current = ydoc;
        setYdoc(ydoc);

        // Create WebSocket provider for CRDT sync with token
        const provider = new WebsocketProvider(
            `${WS_URL}/ws/editor`,
            roomId,
            ydoc,
            { params: { token } }
        );
        providerRef.current = provider;
        setProvider(provider);

        // Connection status with reconnection
        provider.on('status', (event: { status: string }) => {
            setIsConnected(event.status === 'connected');

            if (event.status === 'disconnected') {
                // Auto-reconnect after delay
                setTimeout(() => {
                    if (providerRef.current) {
                        providerRef.current.connect();
                    }
                }, 3000);
            }
        });

        // Set up awareness for cursor presence
        const awareness = provider.awareness;

        // Set local user state
        awareness.setLocalStateField('user', {
            id: userId,
            name: userName,
            color: currentUserRef.current.color,
            role: userRole,
        });

        // Listen for awareness changes (cursor updates)
        awareness.on('change', () => {
            const states = awareness.getStates();
            const newCollaborators = new Map<string, Collaborator>();

            states.forEach((state: any) => {
                if (state.user && state.user.id !== userId) {
                    newCollaborators.set(state.user.id, {
                        ...state.user,
                        cursor: state.cursor,
                        isTyping: state.typing || false,
                    });
                }
            });

            setCollaborators(newCollaborators);
        });

        // Connect to comments WebSocket with token
        const commentsWs = new WebSocket(`${WS_URL}/ws/comments?room=${roomId}&token=${encodeURIComponent(token)}`);
        commentsWsRef.current = commentsWs;

        commentsWs.onopen = () => {
            console.log('Comments WebSocket connected');
        };

        commentsWs.onmessage = (event) => {
            try {
                const message: CollaborationMessage = JSON.parse(event.data);
                handleCollaborationMessage(message);
            } catch (error) {
                console.error('Failed to parse collaboration message:', error);
            }
        };

        commentsWs.onerror = (error) => {
            console.error('Comments WebSocket error:', error);
        };

        commentsWs.onclose = () => {
            console.log('Comments WebSocket disconnected');
        };

        // Cleanup on unmount
        return () => {
            if (bindingRef.current) {
                bindingRef.current.destroy();
            }
            provider.disconnect();
            ydoc.destroy();
            if (commentsWsRef.current) {
                commentsWsRef.current.close();
            }
        };
    }, [roomId, userId, userName, userRole]);

    // Handle incoming collaboration messages
    const handleCollaborationMessage = useCallback((message: CollaborationMessage) => {
        switch (message.type) {
            case 'COMMENT_NEW':
                setComments(prev => [...prev, message.payload]);
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
                setSuggestions(prev => [...prev, message.payload]);
                break;
            case 'SUGGESTION_ACCEPT':
                setSuggestions(prev => prev.filter(s => s.id !== message.payload.suggestionId));
                break;
            case 'PRESENCE_UPDATE':
                // Handle presence updates
                break;
            case 'USER_JOIN':
                // User join handled by awareness
                break;
            case 'USER_LEAVE':
                // User leave handled by awareness
                break;
        }
    }, []);

    // Send a new comment
    const sendComment = useCallback((comment: Omit<Comment, 'id' | 'author' | 'createdAt' | 'replies'>) => {
        const newComment: Comment = {
            ...comment,
            id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            author: currentUserRef.current,
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
    }, [userId]);

    // Send a reply to a comment
    const sendReply = useCallback((commentId: string, text: string) => {
        const reply: CommentReply = {
            id: `reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            commentId,
            author: currentUserRef.current,
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
    }, [userId]);

    // Resolve a comment
    const resolveComment = useCallback((commentId: string) => {
        const message: CollaborationMessage = {
            type: 'COMMENT_RESOLVE',
            payload: { commentId },
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }
    }, [userId]);

    // Send a ghost suggestion (teacher only)
    const sendSuggestion = useCallback((code: string, position: { line: number; column: number }) => {
        if (userRole !== 'teacher') return;

        const suggestion: GhostSuggestion = {
            id: `suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            code,
            author: currentUserRef.current,
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

    // Accept a suggestion
    const acceptSuggestion = useCallback((suggestionId: string) => {
        const message: CollaborationMessage = {
            type: 'SUGGESTION_ACCEPT',
            payload: { suggestionId },
            userId,
            timestamp: new Date().toISOString(),
        };

        if (commentsWsRef.current?.readyState === WebSocket.OPEN) {
            commentsWsRef.current.send(JSON.stringify(message));
        }
    }, [userId]);

    // Update cursor position
    const updateCursor = useCallback((line: number, column: number, selection?: any) => {
        if (providerRef.current) {
            providerRef.current.awareness.setLocalStateField('cursor', {
                line,
                column,
                selection,
            });
        }
    }, []);

    // Set typing status
    const setTyping = useCallback((isTyping: boolean) => {
        if (providerRef.current) {
            providerRef.current.awareness.setLocalStateField('typing', isTyping);
        }
    }, []);

    // Cleanup
    const cleanup = useCallback(() => {
        if (bindingRef.current) {
            bindingRef.current.destroy();
        }
        if (providerRef.current) {
            providerRef.current.disconnect();
        }
        if (ydocRef.current) {
            ydocRef.current.destroy();
        }
        if (commentsWsRef.current) {
            commentsWsRef.current.close();
        }
    }, []);

    return {
        ydoc,
        provider,
        isConnected,
        collaborators,
        comments,
        suggestions,
        currentUser: currentUserRef.current,
        sendComment,
        sendReply,
        resolveComment,
        sendSuggestion,
        acceptSuggestion,
        updateCursor,
        setTyping,
        cleanup,
    };
}
