import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { lessonsApi } from '@/api';
import { useAuth } from '@/hooks';
import type { LessonWithExercises, Submission } from '@/types';
import clsx from 'clsx';

export default function LessonPage() {
    const { lessonId } = useParams<{ lessonId: string }>();
    const navigate = useNavigate();
    const { logout, isLoading: isAuthLoading } = useAuth();
    const [lesson, setLesson] = useState<LessonWithExercises | null>(null);
    const [submissions, setSubmissions] = useState<Map<number, Submission>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [videoPlaying, setVideoPlaying] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            if (!lessonId) return;

            setIsLoading(true);
            setError(null);

            try {
                const lessonData = await lessonsApi.get(parseInt(lessonId));
                setLesson(lessonData);

                // Fetch submissions for all exercises
                const submissionsData = await lessonsApi.listSubmissions();

                // Get the latest submission for each exercise
                const latestSubmissions = new Map<number, Submission>();
                submissionsData.forEach((sub) => {
                    if (lessonData.exercises.some((e: any) => e.id === sub.exercise_id)) {
                        const existing = latestSubmissions.get(sub.exercise_id);
                        if (!existing || new Date(sub.created_at) > new Date(existing.created_at)) {
                            latestSubmissions.set(sub.exercise_id, sub);
                        }
                    }
                });
                setSubmissions(latestSubmissions);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to fetch lesson';
                setError(message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [lessonId]);

    // Calculate progress
    const completedCount = lesson?.exercises.filter(
        (e: any) => submissions.get(e.id)?.status === 'passed'
    ).length || 0;
    const totalCount = lesson?.exercises.length || 0;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (error || !lesson) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500">{error || 'Lesson not found'}</p>
                <Link to="/dashboard" className="text-primary-500 hover:underline mt-2 inline-block">
                    Back to Dashboard
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <Link
                        to="/dashboard"
                        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-500"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        All Lessons
                    </Link>
                    <button
                        onClick={logout}
                        disabled={isAuthLoading}
                        className="px-3 py-1.5 rounded-lg font-medium text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isAuthLoading ? 'Logging out...' : 'Logout'}
                    </button>
                </div>

                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    {lesson.title}
                </h1>
                {lesson.description && (
                    <p className="text-gray-600 dark:text-gray-400">
                        {lesson.description}
                    </p>
                )}
            </div>

            {/* Progress bar */}
            <div className="mb-8">
                <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Progress</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                        {completedCount}/{totalCount} completed ({progressPercent}%)
                    </span>
                </div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Video Section */}
            {lesson.video_url && (
                <div className="mb-8">
                    <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-lg">
                        {!videoPlaying ? (
                            <div
                                className="relative h-full cursor-pointer group"
                                onClick={() => setVideoPlaying(true)}
                            >
                                <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                                    <div className="w-20 h-20 bg-primary-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                                    <p className="text-white font-medium">Watch Video</p>
                                    <p className="text-gray-300 text-sm">Introduction to this lesson</p>
                                </div>
                            </div>
                        ) : (
                            <video
                                src={lesson.video_url}
                                controls
                                autoPlay
                                className="w-full h-full"
                            >
                                Your browser does not support the video tag.
                            </video>
                        )}
                    </div>
                </div>
            )}

            {/* Exercises Section */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Exercises
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        {totalCount} exercise{totalCount !== 1 ? 's' : ''}
                    </span>
                </div>

                {totalCount === 0 ? (
                    <div className="text-center py-8 card">
                        <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <p className="text-gray-500 dark:text-gray-400">
                            No exercises in this lesson yet.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {lesson.exercises.map((exercise: any, index: number) => {
                            const submission = submissions.get(exercise.id);
                            const isCompleted = submission?.status === 'passed';

                            return (
                                <button
                                    key={exercise.id}
                                    onClick={() => navigate(`/exercises/${exercise.id}`)}
                                    className={clsx(
                                        'w-full p-4 rounded-xl border-2 text-left transition-all duration-200',
                                        'hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md',
                                        isCompleted
                                            ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10'
                                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                                    )}
                                >
                                    <div className="flex items-center gap-4">
                                        {/* Number badge */}
                                        <div className={clsx(
                                            'w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm',
                                            isCompleted
                                                ? 'bg-green-500 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                        )}>
                                            {isCompleted ? (
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            ) : (
                                                index + 1
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                                {exercise.title}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={clsx(
                                                    'px-2 py-0.5 text-xs rounded-full',
                                                    exercise.exercise_type === 'coding'
                                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                                                        : exercise.exercise_type === 'quiz'
                                                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400'
                                                            : 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400'
                                                )}>
                                                    {exercise.exercise_type === 'coding' ? '💻 Code' : exercise.exercise_type === 'quiz' ? '❓ Quiz' : '📝 Mixed'}
                                                </span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                    {exercise.points} points
                                                </span>
                                                {exercise.language && (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                                        · {exercise.language}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Arrow */}
                                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>

                                    {/* Description preview */}
                                    {exercise.description && (
                                        <p className="mt-2 ml-14 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                                            {exercise.description.replace(/<[^>]*>/g, '').slice(0, 150)}
                                        </p>
                                    )}

                                    {/* Score if submitted */}
                                    {submission && (
                                        <div className="mt-2 ml-14 flex items-center gap-2 text-sm">
                                            <span className={clsx(
                                                'font-medium',
                                                isCompleted ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                            )}>
                                                {submission.score}/{exercise.points} pts
                                            </span>
                                            <span className="text-gray-400">·</span>
                                            <span className="text-gray-500 dark:text-gray-400">
                                                {new Date(submission.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Navigation to next lesson */}
            {lesson.order && (
                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={() => {
                            // Navigate to next lesson (would need API to get next lesson)
                        }}
                        className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-center hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
                    >
                        <span className="text-gray-600 dark:text-gray-400">Continue to next lesson</span>
                        <svg className="w-5 h-5 mx-auto mt-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
