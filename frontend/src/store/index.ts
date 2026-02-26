import { create } from 'zustand';
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
    login: (user: User, token: string) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: null,
    isAuthenticated: false,
    login: (user, token) => set({ user, token, isAuthenticated: true }),
    logout: () => set({ user: null, token: null, isAuthenticated: false }),
}));

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
