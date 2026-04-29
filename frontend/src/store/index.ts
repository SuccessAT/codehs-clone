import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, Lesson, UserProgress } from '@/types';

// UI Store
interface UIState {
    darkMode: boolean;
    editorFontSize: number;
    editorTheme: string;
    activeTab: 'code' | 'output';
    setDarkMode: (darkMode: boolean) => void;
    setEditorFontSize: (fontSize: number) => void;
    setEditorTheme: (theme: string) => void;
    setActiveTab: (tab: 'code' | 'output') => void;
}

export const useUIStore = create<UIState>((set) => ({
    darkMode: true,
    editorFontSize: 14,
    editorTheme: 'vs-dark',
    activeTab: 'code',
    setDarkMode: (darkMode) => set({ darkMode }),
    setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
    setEditorTheme: (editorTheme) => set({ editorTheme }),
    setActiveTab: (activeTab) => set({ activeTab }),
}));

// Auth Store
interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    _hasHydrated: boolean;
    login: (user: User, token: string) => void;
    logout: () => void;
    setToken: (token: string) => void;
    setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            _hasHydrated: false,
            login: (user, token) => {
                localStorage.setItem('token', token);
                set({ user, token, isAuthenticated: true });
            },
            logout: () => {
                localStorage.removeItem('token');
                set({ user: null, token: null, isAuthenticated: false });
            },
            setToken: (token) => {
                localStorage.setItem('token', token);
                set({ token, isAuthenticated: true });
            },
            setHasHydrated: (v) => set({ _hasHydrated: v }),
        }),
        {
            name: 'auth-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ user: state.user, token: state.token }),
            onRehydrateStorage: () => (hydratedState, error) => {
                // Defer state updates to ensure `useAuthStore` is fully initialized
                Promise.resolve().then(() => {
                    if (error) {
                        useAuthStore.setState({ _hasHydrated: true });
                        return;
                    }

                    let token = hydratedState?.token;

                    // Migrate: pick up token from the old localStorage key if the
                    // persist store doesn't have one yet.
                    if (!token) {
                        const legacyToken = localStorage.getItem('token');
                        if (legacyToken) {
                            token = legacyToken;
                            useAuthStore.setState({ token: legacyToken });
                        }
                    }

                    useAuthStore.setState({
                        isAuthenticated: !!(hydratedState?.user && token),
                        _hasHydrated: true,
                    });
                });
            },
        },
    ),
);

// Lesson Store
interface LessonState {
    lessons: Lesson[];
    userProgress: UserProgress | null;
    isLoading: boolean;
    error: string | null;
    setLessons: (lessons: Lesson[]) => void;
    setUserProgress: (progress: UserProgress) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
}

export const useLessonStore = create<LessonState>((set) => ({
    lessons: [],
    userProgress: null,
    isLoading: false,
    error: null,
    setLessons: (lessons) => set({ lessons }),
    setUserProgress: (userProgress) => set({ userProgress }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
}));

// Execution Store
interface ExecutionState {
    stdout: string;
    stderr: string;
    isExecuting: boolean;
    error: string | null;
    setStdout: (stdout: string) => void;
    setStderr: (stderr: string) => void;
    setExecuting: (executing: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
    stdout: '',
    stderr: '',
    isExecuting: false,
    error: null,
    setStdout: (stdout) => set({ stdout }),
    setStderr: (stderr) => set({ stderr }),
    setExecuting: (isExecuting) => set({ isExecuting }),
    setError: (error) => set({ error }),
    reset: () => set({ stdout: '', stderr: '', isExecuting: false, error: null }),
}));
