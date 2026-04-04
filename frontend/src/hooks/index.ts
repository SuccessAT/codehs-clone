import { useState, useCallback } from 'react';
import { authApi, lessonsApi } from '@/api';
import { useAuthStore } from '@/store';
import type { QuizAnswer, Submission } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface SubmissionResult {
    passed: boolean;
    score: number;
    max_score: number;
    feedback: string;
    test_results?: {
        passed: boolean;
        total_tests: number;
        passed_tests: number;
        score: number;
        feedback: string;
        test_results: Array<{
            test_number: number;
            passed: boolean;
            is_hidden: boolean;
            input?: string;
            expected?: string;
            match_type: string;
        }>;
    };
}

export function useSubmission(exerciseId: number) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<SubmissionResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const submitCode = useCallback(async (code: string) => {
        if (!exerciseId) {
            throw new Error('Invalid exercise ID');
        }
        setIsSubmitting(true);
        setError(null);

        try {
            // Submit code - this saves to DB, runs in E2B, grades against test cases
            const submission: Submission = await lessonsApi.submitCode(exerciseId, code);

            // Extract grading result from submission
            const resultWithMaxScore: SubmissionResult = {
                passed: submission.status === 'passed',
                score: submission.score || 0,
                max_score: submission.score || 0,
                feedback: submission.test_results?.feedback || (submission.status === 'passed' ? 'All tests passed!' : 'Some tests failed'),
                test_results: submission.test_results as SubmissionResult['test_results'],
            };

            setResult(resultWithMaxScore);
            return resultWithMaxScore;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to submit code';
            setError(message);
            throw err;
        } finally {
            setIsSubmitting(false);
        }
    }, [exerciseId]);

    const submitQuiz = useCallback(async (answers: QuizAnswer[]) => {
        if (!exerciseId) {
            throw new Error('Invalid exercise ID');
        }
        setIsSubmitting(true);
        setError(null);

        try {
            const response = await lessonsApi.submitQuiz(exerciseId, answers);
            const resultWithMaxScore = {
                ...response.result,
                max_score: response.result.score,
            };
            setResult(resultWithMaxScore);
            return resultWithMaxScore;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to submit quiz';
            setError(message);
            throw err;
        } finally {
            setIsSubmitting(false);
        }
    }, [exerciseId]);

    const reset = useCallback(() => {
        setResult(null);
        setError(null);
    }, []);

    return {
        isSubmitting,
        result,
        error,
        submitCode,
        submitQuiz,
        reset,
    };
}

export function useAuth() {
    const { login: setLogin, logout: setLogout } = useAuthStore();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const login = useCallback(async (username: string, password: string): Promise<void> => {
        setIsLoading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);

            const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Login failed');
            }

            const { access_token } = await response.json();
            localStorage.setItem('token', access_token);

            // Get user info
            const userResponse = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
                headers: { 'Authorization': `Bearer ${access_token}` },
            });
            const userData = await userResponse.json();

            setLogin(userData, access_token);
            return { access_token, user: userData };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [setLogin]);


    const register = useCallback(async (username: string, email: string, password: string, role: string = 'student') => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password, role }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Registration failed');
            }

            const userData = await response.json();

            // Auto login after registration
            return await login(username, password);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Registration failed';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [login]);

    const logout = useCallback(async () => {
        try {
            await authApi.logout();
        } catch {
            // Continue local logout even if backend call fails.
        } finally {
            localStorage.removeItem('token');
            setLogout();
        }
    }, [setLogout]);

    return { isLoading, error, login, logout, register };
}
