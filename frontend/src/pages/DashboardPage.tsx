import { useEffect, useState } from 'react';
import { lessonsApi } from '@/api';
import { useAuthStore, useLessonStore } from '@/store';
import LessonCard from '@/components/LessonCard';
import type { Lesson, LessonProgress } from '@/types';

export default function DashboardPage() {
    const { user } = useAuthStore();
    const { lessons, setLessons, userProgress, setUserProgress, setLoading, setError } = useLessonStore();
    const [localLoading, setLocalLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setLocalLoading(true);
            try {
                const [lessonsData, progressData] = await Promise.all([
                    lessonsApi.list(),
                    lessonsApi.getMyProgress(),
                ]);
                setLessons(lessonsData);
                setUserProgress({ ...progressData, lessons: [] });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to fetch data';
                setError(message);
            } finally {
                setLoading(false);
                setLocalLoading(false);
            }
        };

        fetchData();
    }, [setLessons, setUserProgress, setLoading, setError]);

    const getLessonProgress = (lessonId: number): number => {
        if (!userProgress) return 0;
        const lessonProg = userProgress.lessons.find((l: LessonProgress) => l.lesson_id === lessonId);
        return lessonProg?.progress || 0;
    };

    const getExerciseCount = (lessonId: number): number => {
        if (!userProgress) return 0;
        const lessonProg = userProgress.lessons.find((l: LessonProgress) => l.lesson_id === lessonId);
        return lessonProg?.total_exercises || 0;
    };

    return (
        <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    Welcome back, {user?.username}!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                    Continue your coding journey
                </p>
            </div>

            {/* Stats */}
            {userProgress && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Progress</p>
                        <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                            {userProgress.progress_percentage}%
                        </p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Completed</p>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                            {userProgress.completed_exercises}/{userProgress.total_exercises}
                        </p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Total Points</p>
                        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {userProgress.total_points}
                        </p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Submissions</p>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {userProgress.total_submissions}
                        </p>
                    </div>
                </div>
            )}

            {/* Lessons */}
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                    Lessons
                </h2>

                {localLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                    </div>
                ) : lessons.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 dark:text-gray-400">
                            No lessons available yet.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {lessons.map((lesson: Lesson) => (
                            <LessonCard
                                key={lesson.id}
                                lesson={lesson}
                                progress={getLessonProgress(lesson.id)}
                                exerciseCount={getExerciseCount(lesson.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}