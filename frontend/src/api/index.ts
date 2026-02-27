import type { Lesson, LessonWithExercises, ExerciseDetail, UserProgress, Submission, QuizAnswer } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'An error occurred' }));
        throw new ApiError(response.status, error.detail || 'An error occurred');
    }

    return response.json();
}

export const lessonsApi = {
    list: () => fetchApi<Lesson[]>('/api/v1/lessons/'),

    get: (id: number) => fetchApi<LessonWithExercises>(`/api/v1/lessons/${id}`),

    create: (lesson: { title: string; description?: string; video_url?: string; order?: number }) =>
        fetchApi<Lesson>('/api/v1/lessons', {
            method: 'POST',
            body: JSON.stringify(lesson),
        }),

    getExercise: (id: number) => fetchApi<ExerciseDetail>(`/api/v1/exercises/${id}`),

    getMyProgress: () => fetchApi<{ total_exercises: number; completed_exercises: number; progress_percentage: number; total_submissions: number; total_points: number }>('/api/v1/users/me/progress'),

    listSubmissions: () => fetchApi<Submission[]>('/api/v1/submissions/'),

    // Submit code for grading - saves to DB, runs in E2B, grades against test cases
    submitCode: (exerciseId: number, code: string) =>
        fetchApi<Submission>('/api/v1/submissions/', {
            method: 'POST',
            body: JSON.stringify({ exercise_id: exerciseId, code }),
        }),

    submitQuiz: (exerciseId: number, answers: QuizAnswer[]) =>
        fetchApi<{ result: { passed: boolean; score: number; feedback: string } }>(`/api/v1/exercises/${exerciseId}/submit-quiz/`, {
            method: 'POST',
            body: JSON.stringify({ answers: answers.map(a => ({ question_id: a.question_id, answer: Number(a.answer) })) }),
        }),
};

export const authApi = {
    login: (username: string, password: string) => {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        return fetchApi<{ access_token: string }>('/api/v1/auth/login', {
            method: 'POST',
            body: formData,
        });
    },

    register: (username: string, email: string, password: string, role: string = 'student') =>
        fetchApi<{ id: number; username: string; email: string }>('/api/v1/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password, role }),
        }),

    getCurrentUser: () => fetchApi<{ id: number; username: string; email: string; role: 'student' | 'teacher' }>('/api/v1/auth/me'),

    logout: () => fetchApi<{ message: string }>('/api/v1/auth/logout', {
        method: 'POST',
    }),
};
