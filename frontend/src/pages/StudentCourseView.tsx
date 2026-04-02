import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { modulesApi } from '@/api';
import type { Course, Module } from '@/types';

export default function StudentCourseView() {
    const { courseId } = useParams();
    const navigate = useNavigate();
    const [course, setCourse] = useState<Course | null>(null);
    const [modules, setModules] = useState<Module[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (courseId) {
            fetchData();
        }
    }, [courseId]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // Use the new endpoint that includes modules with lessons
            const c = await modulesApi.getWithLessons(Number(courseId));
            setCourse(c);
            // Extract modules from the course response
            setModules((c as any).modules || []);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) return <div className="flex justify-center py-20 animate-pulse uppercase font-black text-primary">Loading curriculum...</div>;

    return (
        <div className="max-w-5xl mx-auto px-4 py-16">
            <div className="mb-16">
                <button onClick={() => navigate('/dashboard')} className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary mb-6 flex items-center gap-2">
                    ← Back to all courses
                </button>
                <h1 className="text-5xl font-black uppercase tracking-tighter mb-4">{course?.title}</h1>
                <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">{course?.description}</p>
            </div>

            <div className="space-y-6">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-primary/60 mb-10">Curriculum Modules</h2>
                {modules.map((module, index) => (
                    <div 
                        key={module.id} 
                        onClick={() => navigate(`/course/${courseId}/module/${module.id}`)}
                        className="card p-10 flex items-center justify-between group cursor-pointer hover:border-primary transition-all duration-500"
                    >
                        <div className="flex items-center gap-10">
                            <div className="text-6xl font-black text-primary/10 group-hover:text-primary/20 transition-colors">
                                {(index + 1).toString().padStart(2, '0')}
                            </div>
                            <div>
                                <h3 className="text-2xl font-black uppercase group-hover:text-primary transition-colors mb-2">{module.name}</h3>
                                <p className="text-muted-foreground">{module.description}</p>
                                <p className="text-xs text-muted-foreground mt-2">{module.lessons?.length || 0} lessons</p>
                            </div>
                        </div>
                        <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center group-hover:bg-primary group-hover:border-primary group-hover:text-white transition-all duration-500">
                            →
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
