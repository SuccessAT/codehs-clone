import { useEffect, useState } from 'react';
import { lessonsApi } from '@/api';
import { useAuthStore, useLessonStore } from '@/store';
import LessonCard from '@/components/LessonCard';
import type { Lesson, LessonProgress } from '@/types';

export default function DashboardPage() {
    const { user } = useAuthStore();
    const { lessons, setLessons, userProgress, setUserProgress, isLoading, setLoading, setError } = useLessonStore();
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
                setUserProgress({
                    ...progressData,
                    lessons: [] // Default or mapped lessons progress
                });
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
        <div className="max-w-6xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Welcome back, {user?.username}!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        {user?.role === 'teacher' ? 'Manage your classes and lessons' : 'Continue your coding journey'}
                    </p>
                </div>
            </div>

            {user?.role === 'teacher' ? (
                <TeacherDashboard lessons={lessons} isLoading={localLoading} />
            ) : (
                <StudentDashboard userProgress={userProgress} lessons={lessons} isLoading={localLoading} getLessonProgress={getLessonProgress} getExerciseCount={getExerciseCount} />
            )}
        </div>
    );
}

function StudentDashboard({ userProgress, lessons, isLoading, getLessonProgress, getExerciseCount }: any) {
    return (
        <>
            {/* Stats */}
            {userProgress && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Progress</p>
                        <p className="text-2xl font-bold text-primary">
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
                    Your Lessons
                </h2>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
        </>
    )
}

function TeacherDashboard({ lessons, isLoading }: any) {
    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Lesson Management
                </h2>
                <button className="btn-primary">Create New Lesson</button>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {lessons.map((lesson: Lesson) => (
                        <div key={lesson.id} className="card p-6 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold">{lesson.title}</h3>
                                <p className="text-sm text-muted-foreground">{lesson.description}</p>
                            </div>
                            <div className="flex gap-2">
                                <button className="text-sm font-medium text-primary hover:underline">Edit</button>
                                <button className="text-sm font-medium text-destructive hover:underline">Delete</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
