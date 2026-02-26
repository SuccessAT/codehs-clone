import { useState, useCallback } from 'react';
import { lessonsApi, authApi } from '@/api';
import type { QuizAnswer, Submission } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
    const [user, setUser] = useState<{ id: number; username: string; email: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const login = useCallback(async (username: string, password: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                throw new Error('Login failed');
            }

            const data = await response.json();
            localStorage.setItem('token', data.access_token);
            setUser(data.user);
            return data;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const register = useCallback(async (username: string, email: string, password: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            });

            if (!response.ok) {
                throw new Error('Registration failed');
            }

            const data = await response.json();
            localStorage.setItem('token', data.access_token);
            setUser(data.user);
            return data;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Registration failed';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        setUser(null);
    }, []);

    return { user, isLoading, error, login, logout, register };
}
