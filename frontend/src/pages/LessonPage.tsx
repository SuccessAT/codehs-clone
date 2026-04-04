import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { lessonsApi, coursesApi } from '@/api';
import { useAuth } from '@/hooks';
import type { LessonWithExercises, Submission, Module } from '@/types';
import clsx from 'clsx';

export default function LessonPage() {
    const { lessonId, courseId, moduleId } = useParams<{ lessonId?: string; courseId?: string; moduleId?: string }>();
    const navigate = useNavigate();
    const { logout, isLoading: isAuthLoading } = useAuth();

    // Module view state (when accessed via /course/:courseId/module/:moduleId)
    const [module, setModule] = useState<Module | null>(null);

    // Lesson view state (when accessed via /lesson/:lessonId)
    const [lesson, setLesson] = useState<LessonWithExercises | null>(null);
    const [submissions, setSubmissions] = useState<Map<number, Submission>>(new Map());

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [videoPlaying, setVideoPlaying] = useState(false);

    const isModuleView = !!moduleId && !!courseId;

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                if (isModuleView) {
                    // Fetch the public course and find the requested module
                    const courseData = await coursesApi.getPublic(parseInt(courseId!));
                    const modules = (courseData as any).modules || [];
                    const found = modules.find((m: Module) => m.id === parseInt(moduleId!));
                    if (!found) throw new Error('Module not found');
                    setModule(found);
                } else if (lessonId) {
                    const lessonData = await lessonsApi.get(parseInt(lessonId));
                    setLesson(lessonData);

                    const submissionsData = await lessonsApi.listSubmissions();
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
                } else {
                    throw new Error('No lesson or module ID provided');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to fetch data';
                setError(message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [lessonId, moduleId, courseId, isModuleView]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500">{error}</p>
                <Link to="/dashboard" className="text-primary hover:underline mt-2 inline-block">
                    Back to Dashboard
                </Link>
            </div>
        );
    }

    // ── Module view: show lessons in module ───────────────────────────────────
    if (isModuleView && module) {
        const lessons: any[] = (module as any).lessons || [];

        return (
            <div className="max-w-4xl mx-auto px-4 py-16">
                <button
                    onClick={() => navigate(`/course/${courseId}`)}
                    className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary mb-8 flex items-center gap-2"
                >
                    ← Back to course
                </button>

                <div className="mb-12">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-3">{module.name}</h1>
                    <p className="text-muted-foreground">{module.description}</p>
                </div>

                <div className="space-y-4">
                    <h2 className="text-xs font-black uppercase tracking-[0.3em] text-primary/60 mb-6">Lessons</h2>
                    {lessons.length === 0 ? (
                        <p className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
                            No lessons in this module yet.
                        </p>
                    ) : (
                        lessons.sort((a: any, b: any) => a.order - b.order).map((lesson: any, index: number) => (
                            <div
                                key={lesson.id}
                                onClick={() => navigate(`/lesson/${lesson.id}`)}
                                className="card p-8 flex items-center gap-8 group cursor-pointer hover:border-primary transition-all duration-300"
                            >
                                <div className="text-4xl font-black text-primary/10 group-hover:text-primary/20 transition-colors">
                                    {(index + 1).toString().padStart(2, '0')}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase">
                                            {lesson.lesson_type}
                                        </span>
                                        <h3 className="font-black uppercase group-hover:text-primary transition-colors">
                                            {lesson.title}
                                        </h3>
                                    </div>
                                    {lesson.description && (
                                        <p className="text-sm text-muted-foreground line-clamp-2">{lesson.description}</p>
                                    )}
                                </div>
                                <div className="w-10 h-10 rounded-full border-2 border-border flex items-center justify-center group-hover:bg-primary group-hover:border-primary group-hover:text-white transition-all duration-300">
                                    →
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }

    // ── Lesson view: show lesson content and exercises ────────────────────────
    if (!lesson) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500">Lesson not found</p>
                <Link to="/dashboard" className="text-primary hover:underline mt-2 inline-block">
                    Back to Dashboard
                </Link>
            </div>
        );
    }

    const completedCount = lesson.exercises.filter(
        (e: any) => submissions.get(e.id)?.status === 'passed'
    ).length || 0;
    const totalCount = lesson.exercises.length || 0;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <Link
                        to="/dashboard"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
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

                <h1 className="text-3xl font-bold mb-2">{lesson.title}</h1>
                {lesson.description && (
                    <p className="text-muted-foreground">{lesson.description}</p>
                )}
            </div>

            {totalCount > 0 && (
                <div className="mb-8">
                    <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{completedCount}/{totalCount} completed ({progressPercent}%)</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            )}

            {lesson.video_url && (
                <div className="mb-8">
                    <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-lg">
                        {!videoPlaying ? (
                            <div className="relative h-full cursor-pointer group" onClick={() => setVideoPlaying(true)}>
                                <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                                    <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <video src={lesson.video_url} controls autoPlay className="w-full h-full">
                                Your browser does not support the video tag.
                            </video>
                        )}
                    </div>
                </div>
            )}

            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Exercises</h2>
                    <span className="text-sm text-muted-foreground">{totalCount} exercise{totalCount !== 1 ? 's' : ''}</span>
                </div>

                {totalCount === 0 ? (
                    <div className="text-center py-8 card">
                        <p className="text-muted-foreground">No exercises in this lesson yet.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {lesson.exercises.map((exercise: any, index: number) => {
                            const submission = submissions.get(exercise.id);
                            const isCompleted = submission?.status === 'passed';

                            return (
                                <button
                                    key={exercise.id}
                                    onClick={() => navigate(`/exercise/${exercise.id}`)}
                                    className={clsx(
                                        'w-full p-4 rounded-xl border-2 text-left transition-all duration-200',
                                        'hover:border-primary/50 hover:shadow-md',
                                        isCompleted
                                            ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10'
                                            : 'border-border bg-card'
                                    )}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={clsx(
                                            'w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm',
                                            isCompleted ? 'bg-green-500 text-white' : 'bg-secondary'
                                        )}>
                                            {isCompleted ? (
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            ) : index + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-semibold truncate">{exercise.title}</h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-secondary">
                                                    {exercise.exercise_type}
                                                </span>
                                                <span className="text-xs text-muted-foreground">{exercise.points} pts</span>
                                            </div>
                                        </div>
                                        <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
