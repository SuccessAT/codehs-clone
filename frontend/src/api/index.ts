import type { Lesson, LessonWithExercises, ExerciseDetail, Submission, QuizAnswer, Course, Module, LessonProgress, LessonType } from '@/types';

// Use relative path in development to leverage Vite proxy, or custom URL in production
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

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

// Courses API
// Courses API - public and private
export const coursesApi = {
    // List all courses (teachers see all their courses)
    list: () => fetchApi<Course[]>('/api/v1/courses'),

    // List published courses (students see public courses)
    listPublic: () => fetchApi<Course[]>('/api/v1/courses/public/'),

    // Get course by ID (teachers only - includes unpublished)
    get: (id: number) => fetchApi<Course>(`/api/v1/courses/${id}`),

    // Get published course (students)
    getPublic: (id: number) => fetchApi<Course>(`/api/v1/courses/public/${id}`),

    create: (data: { title: string; description?: string }) =>
        fetchApi<Course>('/api/v1/courses', {
            method: 'POST',
            body: JSON.stringify(data)
        }),
    delete: (id: number) => fetchApi<void>(`/api/v1/courses/${id}`, { method: 'DELETE' }),
    publish: (id: number) => fetchApi<Course>(`/api/v1/courses/${id}/publish`, { method: 'POST' }),
};

// Modules API - new endpoints for Module with multiple lessons
export const modulesApi = {
    // GET /courses/{course_id}/modules/ - list modules for a course
    list: (courseId: number) => fetchApi<Module[]>(`/api/v1/courses/${courseId}/modules/`),

    // POST /courses/{course_id}/modules/ - create a new module
    create: (courseId: number, data: { name: string; description?: string }) =>
        fetchApi<Module>(`/api/v1/courses/${courseId}/modules/`, {
            method: 'POST',
            body: JSON.stringify(data)
        }),

    // GET /modules/{module_id} - get module with lessons
    get: (moduleId: number) => fetchApi<Module>(`/api/v1/modules/${moduleId}`),

    // PUT /modules/{module_id} - update module
    update: (moduleId: number, data: { name?: string; description?: string; order?: number }) =>
        fetchApi<Module>(`/api/v1/modules/${moduleId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        }),

    // DELETE /modules/{module_id} - delete module
    delete: (moduleId: number) => fetchApi<void>(`/api/v1/modules/${moduleId}`, { method: 'DELETE' }),

    // POST /modules/{module_id}/lessons/ - create lesson in module
    createLesson: (moduleId: number, data: {
        title: string;
        description?: string;
        lesson_type: LessonType;
        content?: string;
        media_url?: string;
        starter_code?: string;
        language?: string;
        order?: number;
    }) =>
        fetchApi<Lesson>(`/api/v1/modules/${moduleId}/lessons/`, {
            method: 'POST',
            body: JSON.stringify(data)
        }),

    // GET /courses/{course_id}/modules/with-lessons/ - get course with modules and lessons
    getWithLessons: (courseId: number) => fetchApi<Course>(`/api/v1/courses/${courseId}/modules/with-lessons/`),

    // Legacy - for backward compatibility
    updateOrder: (courseId: number, moduleIds: number[]) =>
        fetchApi<void>(`/api/v1/courses/${courseId}/modules/order`, {
            method: 'PUT',
            body: JSON.stringify({ module_ids: moduleIds })
        }),
};

// Lessons API
export const lessonsApi = {
    list: (moduleId: number) => fetchApi<Lesson[]>(`/api/v1/modules/${moduleId}/lessons/`),
    get: (id: number) => fetchApi<LessonWithExercises>(`/api/v1/lessons/${id}`),
    create: (moduleId: number, data: {
        title: string;
        description?: string;
        lesson_type: LessonType;
    }) =>
        fetchApi<Lesson>(`/api/v1/modules/${moduleId}/lessons/`, {
            method: 'POST',
            body: JSON.stringify(data)
        }),
    update: (id: number, data: Record<string, unknown>) =>
        fetchApi<Lesson>(`/api/v1/lessons/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    delete: (id: number) => fetchApi<void>(`/api/v1/lessons/${id}`, { method: 'DELETE' }),
    updateOrder: (moduleId: number, lessonIds: number[]) =>
        fetchApi<void>(`/api/v1/modules/${moduleId}/lessons/order`, {
            method: 'PUT',
            body: JSON.stringify({ lesson_ids: lessonIds })
        }),
    getMyProgress: () => fetchApi<{
        total_exercises: number;
        completed_exercises: number;
        progress_percentage: number;
        total_submissions: number;
        total_points: number;
        lessons: LessonProgress[]
    }>('/api/v1/users/me/progress'),
    listSubmissions: () => fetchApi<Submission[]>('/api/v1/submissions'),
    submitCode: (exerciseId: number, code: string) =>
        fetchApi<Submission>('/api/v1/submissions', {
            method: 'POST',
            body: JSON.stringify({ exercise_id: exerciseId, code }),
        }),
    submitQuiz: (exerciseId: number, answers: QuizAnswer[]) =>
        fetchApi<{ result: { passed: boolean; score: number; feedback: string } }>(`/api/v1/exercises/${exerciseId}/submit-quiz/`, {
            method: 'POST',
            body: JSON.stringify({ answers: answers.map(a => ({ question_id: a.question_id, answer: Number(a.answer) })) }),
        }),
};

// Exercise API
export const exerciseApi = {
    get: (id: number) => fetchApi<ExerciseDetail>(`/api/v1/exercises/${id}`),
};

// Auth API
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
