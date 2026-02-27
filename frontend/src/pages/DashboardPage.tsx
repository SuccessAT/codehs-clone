import { useEffect, useMemo, useState } from 'react';
import { courseApi, lessonsApi } from '@/api';
import { useAuthStore, useLessonStore } from '@/store';
import { useAuth } from '@/hooks';
import LessonCard from '@/components/LessonCard';
import type { Course, CourseModule, Lesson, LessonProgress, UserProgress } from '@/types';

type StudentDashboardProps = {
    userProgress: UserProgress | null;
    lessons: Lesson[];
    isLoading: boolean;
    getLessonProgress: (lessonId: number) => number;
    getExerciseCount: (lessonId: number) => number;
};

type TeacherDashboardProps = {
    isLoading: boolean;
};

type CourseFormState = {
    title: string;
    description: string;
    category: string;
    level: 'beginner' | 'intermediate' | 'advanced';
    theme: string;
    is_published: boolean;
};

type ModuleFormState = {
    title: string;
    description: string;
    video_url: string;
    order: string;
    module_type: 'concept' | 'project' | 'assessment' | 'lab' | 'review';
};

export default function DashboardPage() {
    const { user } = useAuthStore();
    const { logout, isLoading: isAuthLoading } = useAuth();
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
                setUserProgress({
                    ...progressData,
                    lessons: progressData.lessons || [],
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
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Welcome back, {user?.username}!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        {user?.role === 'teacher' ? 'Build courses and modules for your students' : 'Continue your coding journey'}
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
                <TeacherDashboard isLoading={localLoading} />
            ) : (
                <StudentDashboard
                    userProgress={userProgress}
                    lessons={lessons}
                    isLoading={localLoading}
                    getLessonProgress={getLessonProgress}
                    getExerciseCount={getExerciseCount}
                />
            )}
        </div>
    );
}

function StudentDashboard({ userProgress, lessons, isLoading, getLessonProgress, getExerciseCount }: StudentDashboardProps) {
    return (
        <>
            {userProgress && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Progress</p>
                        <p className="text-2xl font-bold text-primary">{userProgress.progress_percentage}%</p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Completed</p>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                            {userProgress.completed_exercises}/{userProgress.total_exercises}
                        </p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Total Points</p>
                        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{userProgress.total_points}</p>
                    </div>
                    <div className="card p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Submissions</p>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{userProgress.total_submissions}</p>
                    </div>
                </div>
            )}

            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Your Lessons</h2>
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
    );
}

function TeacherDashboard({ isLoading }: TeacherDashboardProps) {
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
    const [modules, setModules] = useState<CourseModule[]>([]);
    const [isCourseLoading, setIsCourseLoading] = useState(false);
    const [isCreatingCourse, setIsCreatingCourse] = useState(false);
    const [isCreatingModule, setIsCreatingModule] = useState(false);
    const [courseError, setCourseError] = useState<string | null>(null);
    const [moduleError, setModuleError] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const [courseForm, setCourseForm] = useState<CourseFormState>({
        title: '',
        description: '',
        category: '',
        level: 'beginner',
        theme: 'ocean',
        is_published: false,
    });

    const [moduleForm, setModuleForm] = useState<ModuleFormState>({
        title: '',
        description: '',
        video_url: '',
        order: '',
        module_type: 'concept',
    });

    const selectedCourse = useMemo(
        () => courses.find((course) => course.id === selectedCourseId) || null,
        [courses, selectedCourseId]
    );

    useEffect(() => {
        const loadCourses = async () => {
            try {
                setIsCourseLoading(true);
                const data = await courseApi.list();
                setCourses(data);
                if (data.length > 0) {
                    setSelectedCourseId((prev) => prev ?? data[0].id);
                }
            } catch (err) {
                setCourseError(err instanceof Error ? err.message : 'Failed to load courses');
            } finally {
                setIsCourseLoading(false);
            }
        };
        loadCourses();
    }, []);

    useEffect(() => {
        const loadModules = async () => {
            if (!selectedCourseId) {
                setModules([]);
                return;
            }
            try {
                const course = await courseApi.get(selectedCourseId);
                setModules(course.modules || []);
            } catch (err) {
                setModuleError(err instanceof Error ? err.message : 'Failed to load modules');
            }
        };
        loadModules();
    }, [selectedCourseId]);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(timer);
    }, [toast]);

    const handleCreateCourse = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!courseForm.title.trim()) {
            setCourseError('Course title is required.');
            return;
        }

        try {
            setIsCreatingCourse(true);
            setCourseError(null);
            const created = await courseApi.create({
                ...courseForm,
                title: courseForm.title.trim(),
                description: courseForm.description.trim() || undefined,
                category: courseForm.category.trim() || undefined,
            });
            setCourses((prev) => [created, ...prev]);
            setSelectedCourseId(created.id);
            setCourseForm({
                title: '',
                description: '',
                category: '',
                level: 'beginner',
                theme: 'ocean',
                is_published: false,
            });
            setToast(`Course "${created.title}" created`);
        } catch (err) {
            setCourseError(err instanceof Error ? err.message : 'Failed to create course');
        } finally {
            setIsCreatingCourse(false);
        }
    };

    const handleCreateModule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCourseId) {
            setModuleError('Create and select a course first.');
            return;
        }
        if (!moduleForm.title.trim()) {
            setModuleError('Module title is required.');
            return;
        }
        const parsedOrder = moduleForm.order.trim() ? Number(moduleForm.order) : modules.length;
        if (!Number.isInteger(parsedOrder) || parsedOrder < 0) {
            setModuleError('Module order must be a non-negative whole number.');
            return;
        }

        try {
            setIsCreatingModule(true);
            setModuleError(null);
            const created = await courseApi.createModule(selectedCourseId, {
                title: moduleForm.title.trim(),
                description: moduleForm.description.trim() || undefined,
                video_url: moduleForm.video_url.trim() || undefined,
                order: parsedOrder,
                module_type: moduleForm.module_type,
            });
            setModules((prev) => [...prev, created].sort((a, b) => a.module_order - b.module_order));
            setModuleForm({
                title: '',
                description: '',
                video_url: '',
                order: '',
                module_type: 'concept',
            });
            setToast(`Module "${created.lesson.title}" created`);
        } catch (err) {
            setModuleError(err instanceof Error ? err.message : 'Failed to create module');
        } finally {
            setIsCreatingModule(false);
        }
    };

    return (
        <div className="relative">
            {toast && (
                <div className="fixed top-4 right-4 z-50 rounded-lg border border-cyan-300/40 bg-cyan-400/15 px-4 py-2 text-sm text-cyan-100 shadow-xl backdrop-blur">
                    {toast}
                </div>
            )}

            <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-950/90 via-slate-900/85 to-slate-800/75 p-5 shadow-2xl">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                    <section className="xl:col-span-1 rounded-xl border border-slate-700/70 bg-slate-900/60 p-4">
                        <h3 className="text-slate-100 text-lg font-semibold mb-3">Create Course</h3>
                        <form onSubmit={handleCreateCourse} className="space-y-3">
                            <input
                                value={courseForm.title}
                                onChange={(e) => setCourseForm((prev) => ({ ...prev, title: e.target.value }))}
                                placeholder="Course title"
                                className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            />
                            <textarea
                                value={courseForm.description}
                                onChange={(e) => setCourseForm((prev) => ({ ...prev, description: e.target.value }))}
                                placeholder="Description"
                                rows={3}
                                className="w-full resize-none rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    value={courseForm.category}
                                    onChange={(e) => setCourseForm((prev) => ({ ...prev, category: e.target.value }))}
                                    placeholder="Category"
                                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                />
                                <select
                                    value={courseForm.level}
                                    onChange={(e) => setCourseForm((prev) => ({ ...prev, level: e.target.value as CourseFormState['level'] }))}
                                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                >
                                    <option value="beginner">Beginner</option>
                                    <option value="intermediate">Intermediate</option>
                                    <option value="advanced">Advanced</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <select
                                    value={courseForm.theme}
                                    onChange={(e) => setCourseForm((prev) => ({ ...prev, theme: e.target.value }))}
                                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                >
                                    <option value="ocean">Ocean</option>
                                    <option value="ember">Ember</option>
                                    <option value="forest">Forest</option>
                                    <option value="midnight">Midnight</option>
                                </select>
                                <label className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-200">
                                    <input
                                        type="checkbox"
                                        checked={courseForm.is_published}
                                        onChange={(e) => setCourseForm((prev) => ({ ...prev, is_published: e.target.checked }))}
                                    />
                                    Publish
                                </label>
                            </div>
                            {courseError && <p className="text-sm text-rose-300">{courseError}</p>}
                            <button
                                type="submit"
                                disabled={isCreatingCourse}
                                className="w-full rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400 disabled:opacity-50"
                            >
                                {isCreatingCourse ? 'Creating...' : 'Create Course'}
                            </button>
                        </form>

                        <div className="mt-5">
                            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Courses</p>
                            <div className="space-y-2 max-h-80 overflow-auto pr-1">
                                {isCourseLoading || isLoading ? (
                                    <div className="text-sm text-slate-400">Loading courses...</div>
                                ) : courses.length === 0 ? (
                                    <div className="text-sm text-slate-400">No courses yet.</div>
                                ) : (
                                    courses.map((course) => (
                                        <button
                                            key={course.id}
                                            onClick={() => setSelectedCourseId(course.id)}
                                            className={`w-full text-left rounded-lg px-3 py-2 border transition ${
                                                selectedCourseId === course.id
                                                    ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                                                    : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-500'
                                            }`}
                                        >
                                            <p className="font-medium truncate">{course.title}</p>
                                            <p className="text-xs text-slate-400">{course.level}</p>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </section>

                    <section className="xl:col-span-2 rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-slate-100 text-lg font-semibold">
                                {selectedCourse ? `Modules in ${selectedCourse.title}` : 'Modules'}
                            </h3>
                            {selectedCourse && (
                                <span className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-300">
                                    {selectedCourse.category || 'General'} - {selectedCourse.level}
                                </span>
                            )}
                        </div>

                        <form onSubmit={handleCreateModule} className="rounded-xl border border-slate-700 bg-slate-950/55 p-4 space-y-3 mb-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input
                                    value={moduleForm.title}
                                    onChange={(e) => setModuleForm((prev) => ({ ...prev, title: e.target.value }))}
                                    placeholder="Module title"
                                    className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                />
                                <select
                                    value={moduleForm.module_type}
                                    onChange={(e) => setModuleForm((prev) => ({ ...prev, module_type: e.target.value as ModuleFormState['module_type'] }))}
                                    className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                >
                                    <option value="concept">Concept</option>
                                    <option value="project">Project</option>
                                    <option value="assessment">Assessment</option>
                                    <option value="lab">Lab</option>
                                    <option value="review">Review</option>
                                </select>
                            </div>
                            <textarea
                                value={moduleForm.description}
                                onChange={(e) => setModuleForm((prev) => ({ ...prev, description: e.target.value }))}
                                placeholder="Module description"
                                rows={3}
                                className="w-full resize-none rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input
                                    value={moduleForm.video_url}
                                    onChange={(e) => setModuleForm((prev) => ({ ...prev, video_url: e.target.value }))}
                                    placeholder="Video URL (optional)"
                                    className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                />
                                <input
                                    type="number"
                                    min={0}
                                    value={moduleForm.order}
                                    onChange={(e) => setModuleForm((prev) => ({ ...prev, order: e.target.value }))}
                                    placeholder="Module order"
                                    className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                />
                            </div>
                            {moduleError && <p className="text-sm text-rose-300">{moduleError}</p>}
                            <button
                                type="submit"
                                disabled={isCreatingModule || !selectedCourse}
                                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
                            >
                                {isCreatingModule ? 'Creating module...' : 'Add Module'}
                            </button>
                        </form>

                        <div className="space-y-2 max-h-[28rem] overflow-auto pr-1">
                            {modules.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-slate-600 px-4 py-6 text-center text-slate-400">
                                    No modules yet for this course.
                                </div>
                            ) : (
                                modules.map((moduleItem) => (
                                    <article
                                        key={moduleItem.id}
                                        className="rounded-lg border border-slate-700 bg-gradient-to-r from-slate-900/70 to-slate-800/60 p-4"
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div>
                                                <h4 className="font-semibold text-slate-100">{moduleItem.lesson.title}</h4>
                                                <p className="text-sm text-slate-400 mt-1">{moduleItem.lesson.description || 'No description'}</p>
                                            </div>
                                            <div className="text-right">
                                                <span className="inline-block rounded-full border border-cyan-600/60 px-2 py-0.5 text-xs text-cyan-300">
                                                    {moduleItem.module_type}
                                                </span>
                                                <p className="text-xs text-slate-500 mt-1">Order {moduleItem.module_order}</p>
                                            </div>
                                        </div>
                                    </article>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
