import { useState } from 'react';
import clsx from 'clsx';
import type { Comment, CommentReply } from '@/types/collaboration';

interface CommentThreadWidgetProps {
    comment: Comment;
    onClose: () => void;
    onReply: (commentId: string, text: string) => void;
    onResolve: (commentId: string) => void;
    currentUserId: string;
}

export function CommentThreadWidget({
    comment,
    onClose,
    onReply,
    onResolve,
    currentUserId,
}: CommentThreadWidgetProps) {
    const [replyText, setReplyText] = useState('');
    const [showReplyInput, setShowReplyInput] = useState(false);

    const handleSendReply = () => {
        if (replyText.trim()) {
            onReply(comment.id, replyText);
            setReplyText('');
            setShowReplyInput(false);
        }
    };

    const isResolved = comment.resolved;
    const canResolve = comment.author.id === currentUserId || comment.replies.some(r => r.author.id === currentUserId);

    return (
        <div className="absolute right-4 top-20 w-80 bg-card border border-border rounded-lg shadow-xl z-30 max-h-[500px] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                        style={{ backgroundColor: comment.author.color }}
                    >
                        {comment.author.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="text-sm font-medium text-foreground">
                            {comment.author.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {comment.author.role === 'teacher' ? 'Teacher' : 'Student'}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {isResolved && (
                        <span className="text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded">
                            Resolved
                        </span>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 text-muted-foreground hover:text-foreground rounded"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Commented Code */}
            <div className="p-3 bg-muted/50 border-b border-border">
                <div className="text-xs text-muted-foreground mb-1">
                    Line {comment.range.startLine} - {comment.range.endLine}
                </div>
                <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                    <code className="whitespace-pre-wrap">{comment.range.text || '(No code selected)'}</code>
                </pre>
            </div>

            {/* Main Comment */}
            <div className="p-3 border-b border-border">
                <div className="text-sm text-foreground">
                    {comment.text}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                    {new Date(comment.createdAt).toLocaleString()}
                </div>
            </div>

            {/* Replies */}
            {comment.replies.length > 0 && (
                <div className="border-b border-border">
                    {comment.replies.map((reply) => (
                        <div key={reply.id} className="p-3 border-b border-border last:border-b-0">
                            <div className="flex items-center gap-2 mb-1">
                                <div
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                    style={{ backgroundColor: reply.author.color }}
                                >
                                    {reply.author.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-medium text-foreground">
                                    {reply.author.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {new Date(reply.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <div className="text-sm text-foreground ml-7">
                                {reply.text}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Reply Input */}
            {showReplyInput ? (
                <div className="p-3">
                    <textarea
                        className="w-full p-2 border border-border rounded bg-background text-foreground text-sm resize-none"
                        rows={2}
                        placeholder="Write a reply..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            onClick={() => setShowReplyInput(false)}
                            className="px-3 py-1 text-xs text-muted-foreground hover:bg-accent rounded"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSendReply}
                            disabled={!replyText.trim()}
                            className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50"
                        >
                            Reply
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-3 flex gap-2">
                    <button
                        onClick={() => setShowReplyInput(true)}
                        className="flex-1 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 text-foreground rounded"
                    >
                        Reply
                    </button>
                    {!isResolved && canResolve && (
                        <button
                            onClick={() => onResolve(comment.id)}
                            className="flex-1 px-3 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded"
                        >
                            Resolve
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
