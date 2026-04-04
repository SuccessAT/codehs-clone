import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { exerciseApi, lessonsApi } from '@/api';
import { useUIStore } from '@/store';
import { useAuth } from '@/hooks';
import Editor from '@/components/Editor';
import Console from '@/components/Console';
import RunButton from '@/components/RunButton';
import Quiz from '@/components/Quiz';
import HistorySidebar from '@/components/HistorySidebar';
import { useSubmission } from '@/hooks';
import { useSocketExecution } from '@/hooks/useSocketExecution';
import type { ExerciseDetail, QuizAnswer, EditorFile } from '@/types';
import clsx from 'clsx';

export default function ExercisePage() {
    const { exerciseId } = useParams<{ exerciseId: string }>();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [runOutput, setRunOutput] = useState({ stdout: '', stderr: '' });
    const [exercise, setExercise] = useState<ExerciseDetail | null>(null);
    const [files, setFiles] = useState<EditorFile[]>([]);
    const [activeFileIndex, setActiveFileIndex] = useState(0);
    const { logout, isLoading: isAuthLoading } = useAuth();

    const { activeTab, setActiveTab } = useUIStore();

    const { isSubmitting, submitCode, submitQuiz, result: submissionResult, reset: resetSubmission } = useSubmission(
        exerciseId ? parseInt(exerciseId) : 0
    );

    const {
        stdout: wsStdout,
        stderr: wsStderr,
        isExecuting: isWsExecuting,
        error: wsError,
        runCode,
        cancelExecution,
        sendInput,
        reset: resetExecution
    } = useSocketExecution(
        exerciseId ? parseInt(exerciseId) : 0,
        exercise?.language || 'python'
    );

    useEffect(() => {
        const fetchExercise = async () => {
            if (!exerciseId) return;

            setIsLoading(true);
            setError(null);

            try {
                const data = await exerciseApi.get(parseInt(exerciseId));
                setExercise(data);

                const lang = data.language || 'python';
                const fileName = getFileName(lang);
                setFiles([{
                    name: fileName,
                    language: lang,
                    content: data.starter_code || getDefaultCode(lang),
                }]);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to fetch exercise';
                setError(message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchExercise();
    }, [exerciseId]);

    useEffect(() => {
        resetExecution();
        resetSubmission();
    }, [exerciseId, resetExecution, resetSubmission]);

    useEffect(() => {
        setRunOutput({ stdout: wsStdout, stderr: wsStderr });
    }, [wsStdout, wsStderr]);

    const getFileName = (language: string): string => {
        const extensions: Record<string, string> = {
            python: 'main.py',
            javascript: 'main.js',
            typescript: 'main.ts',
            java: 'Main.java',
            cpp: 'main.cpp',
            c: 'main.c',
            html: 'index.html',
            css: 'style.css',
        };
        return extensions[language] || 'main.py';
    };

    const getDefaultCode = (language: string): string => {
        const defaults: Record<string, string> = {
            python: '# Write your code here\nprint("Hello, World!")',
            javascript: '// Write your code here\nconsole.log("Hello, World!");',
            typescript: '// Write your code here\nconsole.log("Hello, World!");',
            java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
            cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}',
            c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}',
            html: '<!DOCTYPE html>\n<html>\n<head>\n    <title>My Page</title>\n</head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>',
            css: 'body {\n    font-family: Arial, sans-serif;\n    margin: 20px;\n}',
        };
        return defaults[language] || '# Write your code here';
    };

    const handleRunCode = useCallback(async () => {
        if (!files[activeFileIndex]?.content.trim()) return;
        await runCode(files[activeFileIndex].content);
    }, [files, activeFileIndex, runCode]);

    const handleSubmitCode = useCallback(async () => {
        if (!files[activeFileIndex]?.content.trim()) return;
        await submitCode(files[activeFileIndex].content);
    }, [files, activeFileIndex, submitCode]);

    const handleQuizSubmit = useCallback(async (answers: QuizAnswer[]) => {
        await submitQuiz(answers);
    }, [submitQuiz]);

    const handleFileChange = (index: number, content: string) => {
        setFiles(prev => prev.map((f, i) => i === index ? { ...f, content } : f));
    };

    const handleLanguageChange = (index: number, language: string) => {
        setFiles(prev => prev.map((f, i) => {
            if (i === index) {
                const ext = language === 'python' ? '.py' :
                    language === 'javascript' ? '.js' :
                        language === 'typescript' ? '.ts' :
                            language === 'java' ? '.java' :
                                language === 'cpp' ? '.cpp' :
                                    language === 'c' ? '.c' :
                                        language === 'html' ? '.html' : '.css';
                const baseName = f.name.replace(/\.[^.]+$/, '');
                return { ...f, language, name: baseName + ext };
            }
            return f;
        }));
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error || !exercise) {
        return (
            <div className="text-center py-12">
                <p className="text-ide-error">{error || 'Exercise not found'}</p>
                <Link to="/dashboard" className="text-primary hover:underline mt-2 inline-block">
                    Back to Dashboard
                </Link>
            </div>
        );
    }

    const isQuiz = exercise.exercise_type === 'quiz';
    const showResults = submissionResult !== null;
    const activeFile = files[activeFileIndex];

    return (
        <div className="h-[calc(100vh-3rem)] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-ide-toolbar">
                <div className="flex items-center gap-4">
                    <Link
                        to={`/lesson/${exercise.lesson_id}`}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </Link>
                    <div>
                        <h1 className="font-semibold text-foreground">
                            {exercise.title}
                        </h1>
                        <p className="text-xs text-muted-foreground">
                            {exercise.points} points · {exercise.language}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={logout}
                        disabled={isAuthLoading}
                        className="px-3 py-1.5 rounded-lg font-medium text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isAuthLoading ? 'Logging out...' : 'Logout'}
                    </button>

                    <button
                        onClick={() => setShowHistory(true)}
                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"
                        title="Submission history"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>

                    {!isQuiz && (
                        <>
                            <RunButton
                                onRun={handleRunCode}
                                onStop={cancelExecution}
                                isRunning={isWsExecuting || isSubmitting}
                                language={activeFile?.language || (exercise?.language || 'python')}
                                showSettings={false}
                            />

                            <button
                                onClick={handleSubmitCode}
                                disabled={isSubmitting || !files[activeFileIndex]?.content.trim()}
                                className={clsx(
                                    'px-4 py-2 rounded-lg font-medium text-sm',
                                    'bg-ide-success text-white hover:bg-ide-success/90',
                                    (isSubmitting || !files[activeFileIndex]?.content.trim()) && 'opacity-50 cursor-not-allowed'
                                )}
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit'}
                            </button>

                            <button
                                onClick={() => setActiveTab(activeTab === 'code' ? 'output' : 'code')}
                                className={clsx(
                                    'px-4 py-2 rounded-lg font-medium text-sm',
                                    activeTab === 'output'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-secondary text-secondary-foreground'
                                )}
                            >
                                {activeTab === 'output' ? 'Show Code' : 'Show Output'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-80 border-r border-border overflow-y-auto bg-card">
                    <div className="p-4">
                        <h2 className="font-semibold text-foreground mb-3">
                            Instructions
                        </h2>
                        {exercise.description ? (
                            <div
                                className="prose prose-sm max-w-none text-muted-foreground"
                                dangerouslySetInnerHTML={{ __html: exercise.description }}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">No description available.</p>
                        )}

                        {exercise.test_cases && exercise.test_cases.length > 0 && (
                            <div className="mt-6">
                                <h3 className="font-semibold text-foreground mb-2">
                                    Test Cases
                                </h3>
                                <div className="space-y-2">
                                    {exercise.test_cases.slice(0, 3).map((tc, i) => (
                                        <div key={i} className="p-2 bg-secondary rounded text-xs">
                                            <p className="font-mono text-muted-foreground">
                                                Input: {tc.input || '(none)'}
                                            </p>
                                            <p className="font-mono text-muted-foreground">
                                                Expected: {tc.expected_output}
                                            </p>
                                        </div>
                                    ))}
                                    {exercise.test_cases.length > 3 && (
                                        <p className="text-xs text-muted-foreground">
                                            +{exercise.test_cases.length - 3} more test cases
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden">
                    {isQuiz ? (
                        <div className="flex-1 overflow-y-auto p-6 bg-ide-editor">
                            {exercise.quiz_questions_student && exercise.quiz_questions_student.length > 0 ? (
                                <Quiz
                                    questions={exercise.quiz_questions_student}
                                    onSubmit={handleQuizSubmit}
                                    isSubmitting={isSubmitting}
                                />
                            ) : (
                                <p className="text-muted-foreground">No quiz questions available.</p>
                            )}
                        </div>
                    ) : (
                        <>
                            {activeTab === 'code' ? (
                                <div className="flex-1 overflow-hidden">
                                    <Editor
                                        files={files}
                                        activeFileIndex={activeFileIndex}
                                        onFileChange={handleFileChange}
                                        onFileAdd={(file) => setFiles(prev => [...prev, file])}
                                        onFileRemove={(index) => setFiles(prev => prev.filter((_, i) => i !== index))}
                                        onLanguageChange={handleLanguageChange}
                                        exerciseId={exercise.id}
                                        starterCode={exercise.starter_code || undefined}
                                    />
                                </div>
                            ) : (
                                <div className="flex-1 overflow-hidden">
                                    <Console
                                        stdout={runOutput.stdout}
                                        stderr={runOutput.stderr}
                                        isExecuting={isWsExecuting || isSubmitting}
                                        error={wsError}
                                        waitingForInput={false}
                                        onClear={resetExecution}
                                        onInput={(input) => {
                                            sendInput(input);
                                        }}
                                        onCancel={cancelExecution}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {submissionResult && (
                <div
                    className={clsx(
                        'px-4 py-3 border-t',
                        submissionResult.passed
                            ? 'bg-ide-success/10 border-ide-success/30'
                            : 'bg-ide-error/10 border-ide-error/30'
                    )}
                >
                    <div className="flex items-center justify-between max-w-4xl mx-auto">
                        <div className="flex items-center gap-3">
                            {submissionResult.passed ? (
                                <svg className="w-6 h-6 text-ide-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            ) : (
                                <svg className="w-6 h-6 text-ide-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            )}
                            <div>
                                <span className={submissionResult.passed ? 'text-ide-success font-semibold' : 'text-ide-error font-semibold'}>
                                    {submissionResult.passed ? 'Great job!' : 'Not quite right'}
                                </span>
                                <span className="ml-2 text-muted-foreground">
                                    {submissionResult.feedback}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-sm font-medium">
                                <span className={submissionResult.passed ? 'text-ide-success' : 'text-ide-error'}>
                                    {submissionResult.score}/{submissionResult.max_score}
                                </span>
                                <span className="text-muted-foreground"> points</span>
                            </div>
                            <button
                                onClick={() => {
                                    resetSubmission();
                                    setActiveTab('code');
                                }}
                                className="px-3 py-1 text-sm bg-secondary hover:bg-secondary/80 rounded-lg"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>

                    {submissionResult.test_results && (
                        <div className="mt-3 pt-3 border-t border-border/30 max-w-4xl mx-auto">
                            <h4 className="text-sm font-medium text-foreground mb-2">
                                Test Results: {submissionResult.test_results.passed_tests}/{submissionResult.test_results.total_tests} passed
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {submissionResult.test_results.test_results?.map((test, idx) => (
                                    <div
                                        key={idx}
                                        className={clsx(
                                            'flex items-center gap-2 p-2 rounded text-xs',
                                            test.passed ? 'bg-ide-success/10' : 'bg-ide-error/10'
                                        )}
                                    >
                                        {test.passed ? (
                                            <svg className="w-4 h-4 text-ide-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <svg className="w-4 h-4 text-ide-error flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        )}
                                        <span className={test.passed ? 'text-ide-success' : 'text-ide-error'}>
                                            Test {test.test_number}: {test.passed ? 'Passed' : 'Failed'}
                                        </span>
                                        {!test.is_hidden && test.input && (
                                            <span className="text-muted-foreground ml-1">
                                                ({test.input})
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <HistorySidebar
                isOpen={showHistory}
                onClose={() => setShowHistory(false)}
                exerciseId={exercise.id}
            />
        </div>
    );
}
