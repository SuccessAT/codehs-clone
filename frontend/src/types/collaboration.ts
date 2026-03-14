// Types for collaborative editing
export interface CollaboratorCursor {
    line: number;
    column: number;
    selection?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
}

export interface Collaborator {
    id: string;
    name: string;
    color: string;
    role: 'teacher' | 'student';
    cursor?: CollaboratorCursor;
    isTyping?: boolean;
    avatar?: string;
}

export interface CommentRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    text: string;
}

export interface Comment {
    id: string;
    fileId: string;
    range: CommentRange;
    author: Collaborator;
    text: string;
    createdAt: string;
    replies: CommentReply[];
    resolved?: boolean;
}

export interface CommentReply {
    id: string;
    commentId: string;
    author: Collaborator;
    text: string;
    createdAt: string;
}

export interface GhostSuggestion {
    id: string;
    code: string;
    author: Collaborator;
    position: {
        line: number;
        column: number;
    };
    accepted?: boolean;
}

export interface CollaborationMessage {
    type: 'CURSOR_UPDATE' | 'COMMENT_NEW' | 'COMMENT_REPLY' | 'COMMENT_RESOLVE' | 'SUGGESTION' | 'SUGGESTION_ACCEPT' | 'PRESENCE_UPDATE' | 'USER_JOIN' | 'USER_LEAVE';
    payload: any;
    userId: string;
    timestamp: string;
}

export interface RoomState {
    roomId: string;
    users: Collaborator[];
    comments: Comment[];
    suggestions: GhostSuggestion[];
}
