import clsx from 'clsx';
import type { Collaborator } from '@/types/collaboration';

interface PresenceBarProps {
    collaborators: Map<string, Collaborator>;
    currentUser: Collaborator;
    isConnected: boolean;
}

export function PresenceBar({ collaborators, currentUser, isConnected }: PresenceBarProps) {
    const allUsers = [currentUser, ...Array.from(collaborators.values())];

    return (
        <div className="flex items-center justify-between px-3 py-2 bg-ide-toolbar border-b border-border">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
                <div className={clsx(
                    'w-2 h-2 rounded-full',
                    isConnected ? 'bg-green-500' : 'bg-red-500'
                )} />
                <span className="text-xs text-muted-foreground">
                    {isConnected ? 'Connected' : 'Disconnected'}
                </span>
            </div>

            {/* User Avatars */}
            <div className="flex items-center gap-1">
                {allUsers.map((user) => (
                    <div
                        key={user.id}
                        className="relative group"
                        title={`${user.name} (${user.role})`}
                    >
                        {/* Avatar */}
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 border-background"
                            style={{ backgroundColor: user.color }}
                        >
                            {user.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Role Badge */}
                        {user.role === 'teacher' && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                            </div>
                        )}

                        {/* Typing Indicator */}
                        {user.isTyping && (
                            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                        )}

                        {/* Tooltip */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                            {user.name} ({user.role})
                            {user.isTyping && ' - typing...'}
                        </div>
                    </div>
                ))}

                {/* Online count */}
                <span className="text-xs text-muted-foreground ml-2">
                    {allUsers.length} online
                </span>
            </div>
        </div>
    );
}
