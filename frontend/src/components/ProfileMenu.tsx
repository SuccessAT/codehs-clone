import { useState, useRef, useEffect } from 'react';
import { useAuthStore, useUIStore } from '@/store';
import { useAuth } from '@/hooks';

export default function ProfileMenu() {
    const { user, isAuthenticated } = useAuthStore();
    const { darkMode, setDarkMode } = useUIStore();
    const { logout } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Theme toggle icon used in both logged-in and logged-out states
    const renderThemeIcon = () => (
        <>
            <svg
                className="w-5 h-5 text-amber-500 dark:block hidden group-hover:rotate-45 transition-transform duration-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg
                className="w-5 h-5 text-slate-700 dark:hidden block group-hover:-rotate-12 transition-transform duration-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
        </>
    );

    // If not authenticated, just render the floating theme toggle button
    if (!isAuthenticated || !user) {
        return (
            <button
                onClick={() => setDarkMode(!darkMode)}
                className="fixed top-4 right-4 z-50 p-2.5 rounded-full bg-card/80 dark:bg-card/80 backdrop-blur-sm border border-border shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-200 group"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
                {renderThemeIcon()}
            </button>
        );
    }

    return (
        <div className="fixed top-4 right-4 z-50" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center w-11 h-11 rounded-full bg-primary text-primary-foreground font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 uppercase text-lg border-2 border-background"
                title="Profile Menu"
            >
                {user.username.charAt(0)}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-64 bg-card border border-border rounded-xl shadow-2xl overflow-hidden py-2 transform origin-top-right">
                    <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm font-black text-foreground truncate">{user.username}</p>
                        <p className="text-xs font-medium text-muted-foreground truncate mb-2">{user.email}</p>
                        <span className="text-[10px] inline-flex items-center px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full uppercase tracking-widest font-bold">
                            {user.role}
                        </span>
                    </div>
                    
                    <div className="p-2 space-y-1">
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-foreground hover:bg-secondary transition-colors group"
                        >
                            <div className="w-5 h-5 flex items-center justify-center">
                                {renderThemeIcon()}
                            </div>
                            {darkMode ? 'Light Mode' : 'Dark Mode'}
                        </button>
                        
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                logout();
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            Log Out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
