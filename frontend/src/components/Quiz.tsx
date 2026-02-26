import { useState } from 'react';
import clsx from 'clsx';
import type { QuizQuestionStudent, QuizAnswer } from '@/types';

interface QuizProps {
    questions: QuizQuestionStudent[];
    onSubmit: (answers: QuizAnswer[]) => void;
    isSubmitting?: boolean;
}

export default function Quiz({
    questions,
    onSubmit,
    isSubmitting = false,
}: QuizProps) {
    const [answers, setAnswers] = useState<Map<number, string>>(new Map());
    const [currentQuestion, setCurrentQuestion] = useState(0);

    const handleAnswerChange = (questionId: number, answer: string) => {
        setAnswers((prev) => {
            const newAnswers = new Map(prev);
            newAnswers.set(questionId, answer);
            return newAnswers;
        });
    };

    const handleSubmit = () => {
        const answerList: QuizAnswer[] = [];
        answers.forEach((answer, questionId) => {
            // Convert string answer to number if it's an index
            const numAnswer = parseInt(answer, 10);
            answerList.push({ question_id: questionId, answer: isNaN(numAnswer) ? answer : numAnswer });
        });
        onSubmit(answerList);
    };

    const allAnswered = answers.size === questions.length;
    const question = questions[currentQuestion];

    if (!question) {
        return (
            <div className="text-center py-12">
                <p className="text-gray-500">No quiz questions available.</p>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* Progress bar */}
            <div className="mb-8">
                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>Question {currentQuestion + 1} of {questions.length}</span>
                    <span>{Math.round((answers.size / questions.length) * 100)}% complete</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-300"
                        style={{ width: `${(answers.size / questions.length) * 100}%` }}
                    />
                </div>
            </div>

            {/* Question card */}
            <div className="card p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    {question.question}
                </h3>

                {/* Options */}
                <div className="space-y-3">
                    {question.options && question.options.map((option: string, index: number) => (
                        <label
                            key={index}
                            className={clsx(
                                'flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-all',
                                answers.get(question.id) === String(index)
                                    ? 'bg-primary-50 dark:bg-primary-900/30 border-2 border-primary-500'
                                    : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 border-2 border-transparent'
                            )}
                        >
                            <input
                                type="radio"
                                name={String(question.id)}
                                value={String(index)}
                                checked={answers.get(question.id) === String(index)}
                                onChange={() => handleAnswerChange(question.id, String(index))}
                                disabled={isSubmitting}
                                className="w-5 h-5 text-primary-500 focus:ring-primary-500"
                            />
                            <span className="text-gray-700 dark:text-gray-200">{option}</span>
                        </label>
                    ))}

                    {question.question_type === 'true_false' && (
                        <>
                            <label
                                className={clsx(
                                    'flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-all',
                                    answers.get(question.id) === 'True'
                                        ? 'bg-primary-50 dark:bg-primary-900/30 border-2 border-primary-500'
                                        : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 border-2 border-transparent'
                                )}
                            >
                                <input
                                    type="radio"
                                    name={question.id}
                                    value="True"
                                    checked={answers.get(question.id) === 'True'}
                                    onChange={() => handleAnswerChange(question.id, 'True')}
                                    disabled={isSubmitting}
                                    className="w-5 h-5 text-primary-500 focus:ring-primary-500"
                                />
                                <span className="text-gray-700 dark:text-gray-200">True</span>
                            </label>
                            <label
                                className={clsx(
                                    'flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-all',
                                    answers.get(question.id) === 'False'
                                        ? 'bg-primary-50 dark:bg-primary-900/30 border-2 border-primary-500'
                                        : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 border-2 border-transparent'
                                )}
                            >
                                <input
                                    type="radio"
                                    name={question.id}
                                    value="False"
                                    checked={answers.get(question.id) === 'False'}
                                    onChange={() => handleAnswerChange(question.id, 'False')}
                                    disabled={isSubmitting}
                                    className="w-5 h-5 text-primary-500 focus:ring-primary-500"
                                />
                                <span className="text-gray-700 dark:text-gray-200">False</span>
                            </label>
                        </>
                    )}

                    {question.question_type === 'short_answer' && (
                        <input
                            type="text"
                            value={answers.get(question.id) || ''}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            disabled={isSubmitting}
                            placeholder="Type your answer..."
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    )}
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between">
                <button
                    onClick={() => setCurrentQuestion((prev) => Math.max(0, prev - 1))}
                    disabled={currentQuestion === 0}
                    className={clsx(
                        'px-4 py-2 rounded-lg font-medium transition-colors',
                        currentQuestion === 0
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    )}
                >
                    Previous
                </button>

                <div className="flex gap-2">
                    {/* Question dots */}
                    {questions.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => setCurrentQuestion(index)}
                            className={clsx(
                                'w-3 h-3 rounded-full transition-colors',
                                index === currentQuestion
                                    ? 'bg-primary-500'
                                    : answers.has(questions[index].id)
                                        ? 'bg-green-500'
                                        : 'bg-gray-300 dark:bg-gray-600'
                            )}
                        />
                    ))}
                </div>

                {currentQuestion < questions.length - 1 ? (
                    <button
                        onClick={() => setCurrentQuestion((prev) => Math.min(questions.length - 1, prev + 1))}
                        className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
                    >
                        Next
                    </button>
                ) : (
                    <button
                        onClick={handleSubmit}
                        disabled={!allAnswered || isSubmitting}
                        className={clsx(
                            'px-6 py-2 rounded-lg font-medium transition-colors',
                            allAnswered && !isSubmitting
                                ? 'bg-green-500 hover:bg-green-600 text-white'
                                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 cursor-not-allowed'
                        )}
                    >
                        {isSubmitting ? 'Submitting...' : 'Submit Quiz'}
                    </button>
                )}
            </div>
        </div>
    );
}