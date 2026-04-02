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

    const handleDeleteCourse = async (id: number) => {
        if (!confirm('Are you sure you want to delete this course?')) return;
        try {
            await coursesApi.delete(id);
            fetchCourses();
        } catch (err) {
            console.error('Failed to delete course', err);
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex justify-between items-center mb-12">
                <div>
                    <h1 className="text-4xl font-black text-foreground tracking-tight uppercase">
                        {user?.role === 'teacher' ? 'Course Management' : 'My Courses'}
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        {user?.role === 'teacher' ? 'Create and manage your educational content' : 'Select a course to start learning'}
                    </p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => setDarkMode(!darkMode)}
                        className="p-3 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors"
                    >
                        {darkMode ? '☀️' : '🌙'}
                    </button>
                    {user?.role === 'teacher' && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="btn-primary px-6 h-12 font-bold"
                        >
                            ADD COURSE
                        </button>
                    )}
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : courses.length === 0 ? (
                <div className="card p-20 text-center border-dashed">
                    <p className="text-muted-foreground font-medium">No courses available yet.</p>
                    {user?.role === 'teacher' && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="mt-4 text-primary font-bold hover:underline"
                        >
                            Create your first course
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {courses.map((course) => (
                        <div key={course.id} className="card group hover:scale-[1.02] transition-all duration-300">
                            <div className="p-8">
                                <h3 className="text-2xl font-bold mb-3">{course.title}</h3>
                                <p className="text-muted-foreground text-sm line-clamp-3 mb-6">
                                    {course.description}
                                </p>
                                <div className="flex items-center justify-between mt-auto">
                                    <Link
                                        to={user?.role === 'teacher' ? `/manage/course/${course.id}` : `/course/${course.id}`}
                                        className="btn-primary px-4 py-2 text-xs font-bold"
                                    >
                                        {user?.role === 'teacher' ? 'MANAGE' : 'VIEW MODULES'}
                                    </Link>
                                    {user?.role === 'teacher' && (
                                        <button
                                            onClick={() => handleDeleteCourse(course.id)}
                                            className="text-destructive font-bold text-xs hover:underline"
                                        >
                                            DELETE
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card w-full max-w-lg p-10 shadow-2xl">
                        <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">Create Course</h2>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Title</label>
                                <input
                                    type="text"
                                    className="input h-12"
                                    placeholder="Enter course title"
                                    value={newCourse.title}
                                    onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Description</label>
                                <textarea
                                    className="input h-32 py-3 resize-none"
                                    placeholder="Enter course description"
                                    value={newCourse.description}
                                    onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 h-12 rounded-xl border font-bold hover:bg-muted transition-colors"
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={handleCreateCourse}
                                    disabled={!newCourse.title}
                                    className="flex-1 btn-primary h-12 font-bold"
                                >
                                    CREATE
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
