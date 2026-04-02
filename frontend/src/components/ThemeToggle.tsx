import { useUIStore } from '@/store';

export default function ThemeToggle() {
    const { darkMode, setDarkMode } = useUIStore();

    return (
        <button
            onClick={() => setDarkMode(!darkMode)}
            className="fixed top-4 right-4 z-50 p-2.5 rounded-full bg-card/80 dark:bg-card/80 backdrop-blur-sm border border-border shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-200 group"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {/* Sun Icon - shown in dark mode */}
            <svg
                className="w-5 h-5 text-amber-500 dark:block hidden group-hover:rotate-45 transition-transform duration-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
            </svg>

            {/* Moon Icon - shown in light mode */}
            <svg
                className="w-5 h-5 text-slate-700 dark:hidden block group-hover:-rotate-12 transition-transform duration-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
            </svg>
        </button>
    );
}
