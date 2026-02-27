import { useEffect, useState } from 'react';
import { lessonsApi } from '@/api';
import { useAuthStore, useLessonStore } from '@/store';
import { useAuth } from '@/hooks';
import LessonCard from '@/components/LessonCard';
import type { Lesson, LessonProgress } from '@/types';

export default function DashboardPage() {
    const { user } = useAuthStore();
    const { logout, isLoading: isAuthLoading } = useAuth();
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

    const handleLessonCreated = (newLesson: Lesson) => {
        const updated = [...lessons, newLesson].sort((a, b) => a.order - b.order);
        setLessons(updated);
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
                <button
                    onClick={logout}
                    disabled={isAuthLoading}
                    className="px-4 py-2 rounded-lg font-medium text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isAuthLoading ? 'Logging out...' : 'Logout'}
                </button>
            </div>

            {user?.role === 'teacher' ? (
                <TeacherDashboard
                    lessons={lessons}
                    isLoading={localLoading}
                    onLessonCreated={handleLessonCreated}
                />
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

function TeacherDashboard({ lessons, isLoading, onLessonCreated }: { lessons: Lesson[]; isLoading: boolean; onLessonCreated: (lesson: Lesson) => void }) {
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{
        title?: string;
        videoUrl?: string;
        order?: string;
    }>({});
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [videoUrl, setVideoUrl] = useState('');
    const [order, setOrder] = useState('');

    useEffect(() => {
        if (!successToast) return;
        const timer = setTimeout(() => setSuccessToast(null), 3000);
        return () => clearTimeout(timer);
    }, [successToast]);

    const validateCreateForm = () => {
        const errors: { title?: string; videoUrl?: string; order?: string } = {};
        const trimmedTitle = title.trim();
        const trimmedVideoUrl = videoUrl.trim();
        const trimmedOrder = order.trim();

        if (!trimmedTitle) {
            errors.title = 'Title is required.';
        } else if (trimmedTitle.length > 255) {
            errors.title = 'Title must be 255 characters or fewer.';
        }

        if (trimmedVideoUrl) {
            try {
                // Basic URL validation for better UX before API call.
                new URL(trimmedVideoUrl);
            } catch {
                errors.videoUrl = 'Please enter a valid URL.';
            }
        }

        if (trimmedOrder) {
            const parsed = Number(trimmedOrder);
            if (!Number.isInteger(parsed)) {
                errors.order = 'Display order must be a whole number.';
            } else if (parsed < 0) {
                errors.order = 'Display order cannot be negative.';
            }
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleCreateLesson = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateCreateForm()) return;

        setCreateError(null);
        setIsCreating(true);

        try {
            const created = await lessonsApi.create({
                title: title.trim(),
                description: description.trim() || undefined,
                video_url: videoUrl.trim() || undefined,
                order: order.trim() ? Number(order) : 0,
            });

            onLessonCreated(created);
            setIsCreateOpen(false);
            setTitle('');
            setDescription('');
            setVideoUrl('');
            setOrder('');
            setFieldErrors({});
            setSuccessToast(`Lesson "${created.title}" created.`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create lesson';
            setCreateError(message);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div>
            {successToast && (
                <div className="fixed top-4 right-4 z-50 max-w-sm rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 shadow-lg dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
                    {successToast}
                </div>
            )}

            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Lesson Management
                </h2>
                <button
                    onClick={() => setIsCreateOpen(true)}
                    className="btn-primary"
                >
                    Create New Lesson
                </button>
            </div>

            {isCreateOpen && (
                <div className="mb-6 card p-5">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Create Lesson
                    </h3>
                    <form onSubmit={handleCreateLesson} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Title
                            </label>
                            <input
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                    if (fieldErrors.title) {
                                        setFieldErrors((prev) => ({ ...prev, title: undefined }));
                                    }
                                }}
                                required
                                minLength={1}
                                maxLength={255}
                                placeholder="Intro to Variables"
                                className="input-field w-full"
                            />
                            {fieldErrors.title && (
                                <p className="mt-1 text-sm text-red-500">{fieldErrors.title}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Description
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                placeholder="What this lesson covers..."
                                className="input-field w-full resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Video URL
                                </label>
                                <input
                                    value={videoUrl}
                                    onChange={(e) => {
                                        setVideoUrl(e.target.value);
                                        if (fieldErrors.videoUrl) {
                                            setFieldErrors((prev) => ({ ...prev, videoUrl: undefined }));
                                        }
                                    }}
                                    placeholder="https://..."
                                    className="input-field w-full"
                                />
                                {fieldErrors.videoUrl && (
                                    <p className="mt-1 text-sm text-red-500">{fieldErrors.videoUrl}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Display Order
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    value={order}
                                    onChange={(e) => {
                                        setOrder(e.target.value);
                                        if (fieldErrors.order) {
                                            setFieldErrors((prev) => ({ ...prev, order: undefined }));
                                        }
                                    }}
                                    placeholder="0"
                                    className="input-field w-full"
                                />
                                {fieldErrors.order && (
                                    <p className="mt-1 text-sm text-red-500">{fieldErrors.order}</p>
                                )}
                            </div>
                        </div>

                        {createError && (
                            <p className="text-sm text-red-500">{createError}</p>
                        )}

                        <div className="flex items-center gap-2">
                            <button
                                type="submit"
                                disabled={isCreating || !title.trim()}
                                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isCreating ? 'Creating...' : 'Create Lesson'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreateOpen(false);
                                    setCreateError(null);
                                }}
                                className="px-4 py-2 rounded-lg font-medium text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

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
