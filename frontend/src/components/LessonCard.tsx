import { Link } from 'react-router-dom';
import type { Lesson } from '@/types';
import clsx from 'clsx';

interface LessonCardProps {
    lesson: Lesson;
    progress?: number;
    exerciseCount?: number;
}

export default function LessonCard({ lesson, progress = 0, exerciseCount = 0 }: LessonCardProps) {
    return (
        <Link
            to={`/lessons/${lesson.id}`}
            className="block group"
        >
            <div className="card p-6 hover:shadow-md transition-all duration-200 hover:border-primary-300 dark:hover:border-primary-700">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
                            <span className="text-primary-600 dark:text-primary-400 font-semibold">
                                {lesson.order}
                            </span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                                {lesson.title}
                            </h3>
                            {exerciseCount > 0 && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Arrow */}
                    <svg
                        className="w-5 h-5 text-gray-400 group-hover:text-primary-500 group-hover:translate-x-1 transition-all"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>

                {/* Description */}
                {lesson.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-4">
                        {lesson.description}
                    </p>
                )}

                {/* Progress bar */}
                {progress > 0 && (
                    <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <span>Progress</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className={clsx(
                                    'h-full rounded-full transition-all duration-300',
                                    progress === 100
                                        ? 'bg-green-500'
                                        : 'bg-primary-500'
                                )}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </Link>
    );
}