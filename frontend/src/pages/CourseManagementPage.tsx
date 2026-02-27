import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { coursesApi, modulesApi, lessonsApi } from '@/api';
import type { Course, Module, Lesson, LessonType } from '@/types';
import clsx from 'clsx';

export default function CourseManagementPage() {
    const { courseId } = useParams();
    const navigate = useNavigate();
    const [course, setCourse] = useState<Course | null>(null);
    const [modules, setModules] = useState<Module[]>([]);
    const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Module Form
    const [showModuleModal, setShowModuleModal] = useState(false);
    const [newModule, setNewModule] = useState({ name: '', description: '' });

    // Lesson/Item Form
    const [showLessonModal, setShowLessonModal] = useState(false);
    const [newLesson, setNewLesson] = useState<{
        title: string;
        description: string;
        lesson_type: LessonType;
    }>({ title: '', description: '', lesson_type: 'text' });

    useEffect(() => {
        if (courseId) {
            fetchCourseData();
        }
    }, [courseId]);

    const fetchCourseData = async () => {
        setIsLoading(true);
        try {
            // Use the new endpoint that includes modules with lessons
            const courseData = await modulesApi.getWithLessons(Number(courseId));
            setCourse(courseData);
            
            // Extract modules from the course
            const modulesData = (courseData as any).modules || [];
            setModules(modulesData);
            
            if (modulesData.length > 0 && !activeModuleId) {
                setActiveModuleId(modulesData[0].id);
            }
        } catch (err) {
            console.error('Failed to fetch course details', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddModule = async () => {
        if (!courseId) return;
        try {
            await modulesApi.create(Number(courseId), newModule);
            setShowModuleModal(false);
            setNewModule({ name: '', description: '' });
            fetchCourseData();
        } catch (err) {
            console.error('Failed to create module:', err);
        }
    };

    const handleDeleteModule = async (id: number) => {
        if (!confirm('Delete module and all its lessons?')) return;
        try {
            await modulesApi.delete(id);
            if (activeModuleId === id) setActiveModuleId(null);
            fetchCourseData();
        } catch (err) {
            console.error('Failed to delete module:', err);
        }
    };

    const handleAddLesson = async () => {
        if (!activeModuleId) return;
        try {
            await modulesApi.createLesson(activeModuleId, newLesson);
            setShowLessonModal(false);
            setNewLesson({ title: '', description: '', lesson_type: 'text' });
            fetchCourseData();
        } catch (err) {
            console.error('Failed to create lesson:', err);
        }
    };

    const handleDeleteLesson = async (id: number) => {
        if (!confirm('Delete this lesson?')) return;
        try {
            await lessonsApi.delete(id);
            fetchCourseData();
        } catch (err) {
            console.error('Failed to delete lesson:', err);
        }
    };

    const activeModule = modules.find(m => m.id === activeModuleId);

    if (isLoading) return <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

    return (
        <div className="max-w-7xl mx-auto px-4 py-12">
            <div className="mb-12 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <button onClick={() => navigate('/dashboard')} className="p-3 rounded-xl bg-secondary hover:bg-secondary/80">
                        ←
                    </button>
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tight">{course?.title}</h1>
                        <p className="text-muted-foreground">Manage modules and curriculum</p>
                    </div>
                </div>
                <button onClick={() => setShowModuleModal(true)} className="btn-primary px-6 h-12 font-bold uppercase">
                    ADD MODULE
                </button>
            </div>

            {/* Tabbed Navigation for Modules */}
            <div className="flex overflow-x-auto gap-2 mb-8 border-b border-border pb-px">
                {modules.map((m) => (
                    <div key={m.id} className="group relative flex-shrink-0">
                        <button
                            onClick={() => setActiveModuleId(m.id)}
                            className={clsx(
                                "px-8 py-4 text-sm font-black uppercase tracking-widest transition-all rounded-t-xl border-t border-x",
                                activeModuleId === m.id 
                                    ? "bg-card text-primary border-border" 
                                    : "bg-transparent text-muted-foreground border-transparent hover:bg-muted"
                            )}
                        >
                            {m.name}
                        </button>
                        <button 
                            onClick={() => handleDeleteModule(m.id)}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full text-[10px] items-center justify-center hidden group-hover:flex shadow-lg"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            {activeModule ? (
                <div className="card p-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-start mb-10">
                        <div>
                            <h2 className="text-2xl font-black uppercase mb-2">{activeModule.name}</h2>
                            <p className="text-muted-foreground">{activeModule.description}</p>
                        </div>
                        <button onClick={() => setShowLessonModal(true)} className="btn-primary px-4 py-2 text-xs font-bold">
                            ADD CONTENT
                        </button>
                    </div>

                    <div className="space-y-4">
                        {activeModule.lessons?.length === 0 ? (
                            <p className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">This module has no content yet.</p>
                        ) : (
                            activeModule.lessons?.sort((a,b) => a.order - b.order).map((lesson) => (
                                <div key={lesson.id} className="flex items-center justify-between p-6 bg-background/50 rounded-xl border border-border group hover:border-primary/50 transition-colors">
                                    <div className="flex items-center gap-6">
                                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center font-bold text-xs">
                                            {lesson.order + 1}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase">{lesson.lesson_type}</span>
                                                <h4 className="font-bold">{lesson.title}</h4>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{lesson.description}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="text-xs font-bold hover:text-primary">MOVE UP</button>
                                        <button className="text-xs font-bold hover:text-primary">MOVE DOWN</button>
                                        <button onClick={() => handleDeleteLesson(lesson.id)} className="text-xs font-bold text-destructive">DELETE</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : (
                <div className="text-center py-20 text-muted-foreground uppercase tracking-widest font-bold">
                    Create a module to start building your course.
                </div>
            )}

            {/* Modals for Module and Lesson creation */}
            {showModuleModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card w-full max-w-lg p-10 shadow-2xl">
                        <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">Create Module</h2>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Name</label>
                                <input 
                                    type="text" 
                                    className="input h-12" 
                                    value={newModule.name}
                                    onChange={(e) => setNewModule({ ...newModule, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Description</label>
                                <textarea 
                                    className="input h-32 py-3" 
                                    value={newModule.description}
                                    onChange={(e) => setNewModule({ ...newModule, description: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setShowModuleModal(false)} className="flex-1 h-12 rounded-xl border font-bold">CANCEL</button>
                                <button onClick={handleAddModule} className="flex-1 btn-primary h-12 font-bold">CREATE</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showLessonModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card w-full max-w-lg p-10 shadow-2xl">
                        <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">Add Content Item</h2>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Content Type</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['text', 'video', 'picture', 'codelab', 'assignment'] as LessonType[]).map(type => (
                                        <button 
                                            key={type}
                                            onClick={() => setNewLesson({...newLesson, lesson_type: type})}
                                            className={clsx("py-2 text-[10px] font-bold rounded-lg border uppercase", newLesson.lesson_type === type ? "bg-primary text-white border-primary" : "bg-transparent")}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Title</label>
                                <input type="text" className="input h-12" value={newLesson.title} onChange={(e) => setNewLesson({...newLesson, title: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Short Description</label>
                                <input type="text" className="input h-12" value={newLesson.description} onChange={(e) => setNewLesson({...newLesson, description: e.target.value})} />
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setShowLessonModal(false)} className="flex-1 h-12 rounded-xl border font-bold">CANCEL</button>
                                <button onClick={handleAddLesson} className="flex-1 btn-primary h-12 font-bold">ADD</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
