import { useState, useEffect } from 'react';
import clsx from 'clsx';
import type { Submission } from '@/types';

interface HistorySidebarProps {
    isOpen: boolean;
    onClose: () => void;
    exerciseId?: number;
    onSelectSubmission?: (submissionId: number) => void;
}

export default function HistorySidebar({
    isOpen,
    onClose,
    exerciseId,
    onSelectSubmission,
}: HistorySidebarProps) {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [isLoading] = useState(false);

    // TODO: Fetch submissions from API when exerciseId changes
    useEffect(() => {
        if (exerciseId && isOpen) {
            // Fetch submissions - stub for now
            setSubmissions([]);
        }
    }, [exerciseId, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl z-50 transform transition-transform">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">
                    Submission History
                </h2>
                <button
                    onClick={onClose}
                    className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                    </div>
                ) : submissions.length === 0 ? (
                    <div className="text-center py-8">
                        <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                            No submissions yet
                        </p>
                        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                            Run your code to see results here
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {submissions.map((submission) => (
                            <button
                                key={submission.id}
                                onClick={() => onSelectSubmission?.(submission.id)}
                                className={clsx(
                                    'w-full p-3 rounded-lg border text-left transition-colors',
                                    submission.status === 'passed'
                                        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 hover:border-green-300 dark:hover:border-green-700'
                                        : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700'
                                )}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className={clsx(
                                        'text-sm font-medium',
                                        submission.status === 'passed' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                                    )}>
                                        {submission.status === 'passed' ? 'Passed' : 'Failed'}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {new Date(submission.created_at).toLocaleTimeString()}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {submission.score}/{submission.test_results?.total_tests || 0} tests
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Stub export for future implementation
export function useSubmissionHistory(exerciseId?: number) {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchSubmissions = async () => {
        if (!exerciseId) return;
        setIsLoading(true);
        try {
            // TODO: Implement API call
            // const data = await lessonsApi.listSubmissions(exerciseId);
            // setSubmissions(data);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        submissions,
        isLoading,
        fetchSubmissions,
    };
}