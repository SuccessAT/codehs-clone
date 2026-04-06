import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { coursesApi, modulesApi, lessonsApi } from '@/api';
import type { Course, Module, Lesson, LessonType } from '@/types';
import clsx from 'clsx';
import RichTextEditor from '@/components/RichTextEditor';
import VideoPreview from '@/components/VideoPreview';
import MultiFileCodeEditor from '@/components/MultiFileCodeEditor';


interface NewLesson {
    title: string;
    description: string;
    lesson_type: LessonType | '';
    content: string;
    media_url: string;
    video_url: string;
    starter_code: string;
    language: string;
    order: number;
}

const defaultLesson: NewLesson = {
    title: '',
    description: '',
    lesson_type: '',
    content: '',
    media_url: '',
    video_url: '',
    starter_code: '',
    language: 'python',
    order: 0,
};

export default function CourseManagementPage() {
    const { courseId } = useParams();
    const navigate = useNavigate();
    const [course, setCourse] = useState<Course | null>(null);
    const [modules, setModules] = useState<Module[]>([]);
    const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const [showModuleModal, setShowModuleModal] = useState(false);
    const [newModule, setNewModule] = useState({ name: '', description: '' });

    const [showLessonModal, setShowLessonModal] = useState(false);
    const [newLesson, setNewLesson] = useState<NewLesson>(defaultLesson);
    const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);

    useEffect(() => {
        if (courseId) fetchCourseData();
    }, [courseId]);

    const fetchCourseData = async () => {
        setIsLoading(true);
        try {
            const courseData = await modulesApi.getWithLessons(Number(courseId));
            setCourse(courseData);
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

    const openAddLesson = () => {
        setEditingLesson(null);
        setNewLesson({ ...defaultLesson, order: (activeModule?.lessons?.length || 0) });
        setShowLessonModal(true);
    };

    const openEditLesson = (lesson: Lesson) => {
        setEditingLesson(lesson);
        setNewLesson({
            title: lesson.title,
            description: lesson.description || '',
            lesson_type: lesson.lesson_type,
            content: (lesson as any).content || '',
            media_url: (lesson as any).media_url || '',
            video_url: (lesson as any).video_url || '',
            starter_code: (lesson as any).starter_code || '',
            language: (lesson as any).language || 'python',
            order: lesson.order,
        });
        setShowLessonModal(true);
    };

    const handleSaveLesson = async () => {
        if (!activeModuleId || !newLesson.lesson_type) return;

        // Build payload — only include type-relevant fields
        const payload: any = {
            title: newLesson.title,
            description: newLesson.description,
            lesson_type: newLesson.lesson_type,
            order: newLesson.order,
        };

        switch (newLesson.lesson_type) {
            case 'text':
            case 'assignment':
                payload.content = newLesson.content;
                break;
            case 'video':
                payload.video_url = newLesson.video_url;
                payload.media_url = newLesson.video_url;
                payload.content = newLesson.content;
                break;
            case 'picture':
                payload.media_url = newLesson.media_url;
                payload.content = newLesson.content;
                break;
            case 'codelab':
                payload.language = newLesson.language;
                payload.starter_code = newLesson.starter_code;
                payload.content = newLesson.content;
                break;
        }

        try {
            if (editingLesson) {
                await lessonsApi.update(editingLesson.id, payload);
            } else {
                await modulesApi.createLesson(activeModuleId, payload);
            }
            setShowLessonModal(false);
            setNewLesson(defaultLesson);
            setEditingLesson(null);
            fetchCourseData();
        } catch (err) {
            console.error('Failed to save lesson:', err);
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

    const handlePublish = async () => {
        if (!courseId) return;
        try {
            await coursesApi.publish(Number(courseId));
            fetchCourseData();
        } catch (err) {
            console.error('Failed to publish course:', err);
        }
    };

    const activeModule = modules.find(m => m.id === activeModuleId);

    if (isLoading) return (
        <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto px-4 py-12">
            {/* Header */}
            <div className="mb-12 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <button onClick={() => navigate('/dashboard')} className="p-3 rounded-xl bg-secondary hover:bg-secondary/80">←</button>
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tight">{course?.title}</h1>
                        <p className="text-muted-foreground">Manage modules and curriculum</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handlePublish}
                        className="px-6 h-12 font-bold uppercase rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm"
                    >
                        {course?.is_published ? 'PUBLISHED ✓' : 'PUBLISH'}
                    </button>
                    <button onClick={() => setShowModuleModal(true)} className="btn-primary px-6 h-12 font-bold uppercase">
                        ADD MODULE
                    </button>
                </div>
            </div>

            {/* Module Tabs */}
            <div className="flex overflow-x-auto gap-2 mb-8 border-b border-border pb-px">
                {modules.map((m) => (
                    <div key={m.id} className="group relative flex-shrink-0">
                        <button
                            onClick={() => setActiveModuleId(m.id)}
                            className={clsx(
                                'px-8 py-4 text-sm font-black uppercase tracking-widest transition-all rounded-t-xl border-t border-x',
                                activeModuleId === m.id
                                    ? 'bg-card text-primary border-border'
                                    : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
                            )}
                        >
                            {m.name}
                        </button>
                        <button
                            onClick={() => handleDeleteModule(m.id)}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full text-[10px] items-center justify-center hidden group-hover:flex shadow-lg"
                        >×</button>
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
                        <button onClick={openAddLesson} className="btn-primary px-4 py-2 text-xs font-bold">
                            ADD CONTENT
                        </button>
                    </div>

                    <div className="space-y-4">
                        {!activeModule.lessons?.length ? (
                            <p className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
                                This module has no content yet.
                            </p>
                        ) : (
                            activeModule.lessons.sort((a, b) => a.order - b.order).map((lesson) => (
                                <div
                                    key={lesson.id}
                                    className="flex items-center justify-between p-6 bg-background/50 rounded-xl border border-border group hover:border-primary/50 transition-colors"
                                >
                                    <div className="flex items-center gap-6">
                                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center font-bold text-xs">
                                            {lesson.order + 1}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className={clsx(
                                                    'text-xs font-bold px-2 py-0.5 rounded uppercase',
                                                    lesson.lesson_type === 'text' && 'bg-blue-500/10 text-blue-400',
                                                    lesson.lesson_type === 'video' && 'bg-red-500/10 text-red-400',
                                                    lesson.lesson_type === 'picture' && 'bg-purple-500/10 text-purple-400',
                                                    lesson.lesson_type === 'codelab' && 'bg-green-500/10 text-green-400',
                                                    lesson.lesson_type === 'assignment' && 'bg-yellow-500/10 text-yellow-400',
                                                )}>
                                                    {lesson.lesson_type === 'text' && '📄 Text'}
                                                    {lesson.lesson_type === 'video' && '🎬 Video'}
                                                    {lesson.lesson_type === 'picture' && '🖼️ Image'}
                                                    {lesson.lesson_type === 'codelab' && '💻 Codelab'}
                                                    {lesson.lesson_type === 'assignment' && '📝 Assignment'}
                                                </span>
                                                <h4 className="font-bold">{lesson.title}</h4>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{lesson.description}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => openEditLesson(lesson)}
                                            className="text-xs font-bold hover:text-primary px-3 py-1 rounded border border-border hover:border-primary"
                                        >EDIT</button>
                                        <button
                                            onClick={() => handleDeleteLesson(lesson.id)}
                                            className="text-xs font-bold text-destructive px-3 py-1 rounded border border-destructive/30 hover:border-destructive"
                                        >DELETE</button>
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

            {/* ── Module Modal ──────────────────────────────────────────── */}
            {showModuleModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card w-full max-w-lg p-10 shadow-2xl">
                        <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">Create Module</h2>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Name</label>
                                <input type="text" className="input h-12" value={newModule.name} onChange={(e) => setNewModule({ ...newModule, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Description</label>
                                <textarea className="input h-24 py-3" value={newModule.description} onChange={(e) => setNewModule({ ...newModule, description: e.target.value })} />
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setShowModuleModal(false)} className="flex-1 h-12 rounded-xl border font-bold">CANCEL</button>
                                <button onClick={handleAddModule} className="flex-1 btn-primary h-12 font-bold">CREATE</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Lesson Modal ──────────────────────────────────────────── */}
            {showLessonModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 overflow-y-auto">
                    <div className="card w-full max-w-2xl p-10 shadow-2xl mx-auto my-8">
                        <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">
                            {editingLesson ? 'Edit Content' : 'Add Content Item'}
                        </h2>

                        <div className="space-y-6">
                            {/* ── Step 1: Content Type Picker ── */}
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                                    {newLesson.lesson_type ? 'Content Type' : '① Choose a content type'}
                                </label>
                                <div className="grid grid-cols-5 gap-2">
                                    {([
                                        { type: 'text', icon: '📄', label: 'Text' },
                                        { type: 'video', icon: '🎬', label: 'Video' },
                                        { type: 'picture', icon: '🖼️', label: 'Image' },
                                        { type: 'codelab', icon: '💻', label: 'Codelab' },
                                        { type: 'assignment', icon: '📝', label: 'Assignment' },
                                    ] as { type: LessonType; icon: string; label: string }[]).map(({ type, icon, label }) => (
                                        <button
                                            key={type}
                                            onClick={() => setNewLesson({ ...newLesson, lesson_type: type })}
                                            className={clsx(
                                                'flex flex-col items-center gap-1.5 py-4 text-[10px] font-bold rounded-xl border uppercase transition-all',
                                                newLesson.lesson_type === type
                                                    ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20 scale-[1.03]'
                                                    : 'bg-transparent border-border hover:border-primary/50 hover:bg-secondary/50'
                                            )}
                                        >
                                            <span className="text-xl">{icon}</span>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {!newLesson.lesson_type && (
                                    <p className="text-xs text-muted-foreground mt-3 text-center">
                                        Select a type above to continue filling in the details
                                    </p>
                                )}
                            </div>

                            {/* ── Step 2: Title & Description (only after type chosen) ── */}
                            {newLesson.lesson_type && (
                                <>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Title *</label>
                                <input
                                    type="text"
                                    className="input h-12"
                                    placeholder="Enter a title for this content"
                                    value={newLesson.title}
                                    onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })}
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Short Description</label>
                                <input
                                    type="text"
                                    className="input h-12"
                                    placeholder="Brief summary shown in the lesson list"
                                    value={newLesson.description}
                                    onChange={(e) => setNewLesson({ ...newLesson, description: e.target.value })}
                                />
                            </div>
                                </>
                            )}

                            {/* ── Type-specific fields ── */}

                            {/* TEXT */}
                            {newLesson.lesson_type === 'text' && (
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Content</label>
                                    <RichTextEditor
                                        value={newLesson.content}
                                        onChange={(html) => setNewLesson({ ...newLesson, content: html })}
                                        placeholder="Start writing your lesson content. Use the toolbar to format text, add headings, lists, code blocks, and more..."
                                    />
                                </div>
                            )}

                            {/* VIDEO */}
                            {newLesson.lesson_type === 'video' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Video</label>
                                        <VideoPreview
                                            url={newLesson.video_url}
                                            onChange={(url) => setNewLesson({ ...newLesson, video_url: url, media_url: url })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Transcript / Notes (optional)</label>
                                        <RichTextEditor
                                            value={newLesson.content}
                                            onChange={(html) => setNewLesson({ ...newLesson, content: html })}
                                            placeholder="Add a transcript or companion notes for this video..."
                                        />
                                    </div>
                                </>
                            )}

                            {/* PICTURE */}
                            {newLesson.lesson_type === 'picture' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Image URL</label>
                                        <input
                                            type="url"
                                            className="input h-12"
                                            placeholder="https://example.com/image.png"
                                            value={newLesson.media_url}
                                            onChange={(e) => setNewLesson({ ...newLesson, media_url: e.target.value })}
                                        />
                                    </div>
                                    {newLesson.media_url && (
                                        <div className="rounded-xl overflow-hidden border border-border">
                                            <img src={newLesson.media_url} alt="Preview" className="w-full max-h-48 object-contain bg-black/20" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Caption / Explanation (optional)</label>
                                        <textarea
                                            className="input py-3 text-sm"
                                            rows={4}
                                            placeholder="Describe what students should learn from this image..."
                                            value={newLesson.content}
                                            onChange={(e) => setNewLesson({ ...newLesson, content: e.target.value })}
                                        />
                                    </div>
                                </>
                            )}

                            {/* CODELAB */}
                            {newLesson.lesson_type === 'codelab' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Instructions</label>
                                        <RichTextEditor
                                            value={newLesson.content}
                                            onChange={(html) => setNewLesson({ ...newLesson, content: html })}
                                            placeholder="Describe what students need to do in this coding exercise..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                                            Files &amp; Test Cases
                                        </label>
                                        <MultiFileCodeEditor
                                            value={newLesson.starter_code}
                                            primaryLanguage={newLesson.language || 'python'}
                                            onChange={(serialized, lang) =>
                                                setNewLesson({ ...newLesson, starter_code: serialized, language: lang })
                                            }
                                        />
                                    </div>
                                </>
                            )}

                            {/* ASSIGNMENT */}
                            {newLesson.lesson_type === 'assignment' && (
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Assignment Instructions</label>
                                    <textarea
                                        className="input py-3 text-sm"
                                        rows={10}
                                        placeholder="Describe the assignment requirements, deliverables, and grading criteria..."
                                        value={newLesson.content}
                                        onChange={(e) => setNewLesson({ ...newLesson, content: e.target.value })}
                                    />
                                </div>
                            )}

                            {/* Order — only shown when a type is selected */}
                            {newLesson.lesson_type && (
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Position (order)</label>
                                    <input
                                        type="number"
                                        className="input h-12 w-32"
                                        min={0}
                                        value={newLesson.order}
                                        onChange={(e) => setNewLesson({ ...newLesson, order: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            )}

                            <div className="flex gap-4 pt-2">
                                <button
                                    onClick={() => { setShowLessonModal(false); setEditingLesson(null); }}
                                    className="flex-1 h-12 rounded-xl border font-bold"
                                >CANCEL</button>
                                <button
                                    onClick={handleSaveLesson}
                                    disabled={!newLesson.lesson_type || !newLesson.title.trim()}
                                    className="flex-1 btn-primary h-12 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {editingLesson ? 'SAVE CHANGES' : 'ADD CONTENT'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
