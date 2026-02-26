import { Link } from 'react-router-dom';
import type { Exercise } from '@/types';
import clsx from 'clsx';

interface ExerciseCardProps {
    exercise: Exercise;
    isCompleted?: boolean;
    isActive?: boolean;
}

export default function ExerciseCard({
    exercise,
    isCompleted = false,
    isActive = false,
}: ExerciseCardProps) {
    const typeIcons = {
        coding: '</>',
        quiz: '?',
        mixed: '{?}',
    };

    const typeColors = {
        coding: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400',
        quiz: 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400',
        mixed: 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400',
    };

    return (
        <Link
            to={`/exercises/${exercise.id}`}
            className="block group"
        >
            <div
                className={clsx(
                    'p-4 rounded-lg border transition-all duration-200',
                    isActive
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-700',
                    isCompleted && 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10'
                )}
            >
                <div className="flex items-center gap-3">
                    {/* Type icon */}
                    <div
                        className={clsx(
                            'w-8 h-8 rounded flex items-center justify-center text-xs font-bold',
                            typeColors[exercise.exercise_type]
                        )}
                    >
                        {typeIcons[exercise.exercise_type]}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                            {exercise.title}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="capitalize">{exercise.exercise_type}</span>
                            <span>·</span>
                            <span>{exercise.points} pts</span>
                            {exercise.language && (
                                <>
                                    <span>·</span>
                                    <span>{exercise.language}</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2">
                        {isCompleted && (
                            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        )}
                        <svg
                            className="w-4 h-4 text-gray-400 group-hover:text-primary-500 group-hover:translate-x-1 transition-all"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>
        </Link>
    );
}