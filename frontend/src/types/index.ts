// User types
export interface User {
    id: number;
    username: string;
    email: string;
    role: 'student' | 'teacher';
}

export interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    login: (user: User, token: string) => void;
    logout: () => void;
}

// Course Hierarchy (matching frontend2/ structure)
export interface Course {
    id: number;
    title: string;
    description: string;
    teacher_id: number;
    created_at: string;
    modules?: Module[];
}

export interface Module {
    id: number;
    course_id: number;
    name: string;
    description: string;
    order: number;
    lessons?: Lesson[];
}

export type LessonType = 'codelab' | 'text' | 'video' | 'picture' | 'assignment';

export interface Lesson {
    id: number;
    module_id: number;
    title: string;
    description: string;
    lesson_type: LessonType;
    content?: string; // Markdown or JSON
    media_url?: string; // Video or picture
    starter_code?: string; // For codelab
    language?: string; // For codelab
    order: number;
    created_at: string;
}

export interface LessonWithExercises extends Lesson {
    exercises: Exercise[];
}

export interface LessonProgress {
    lesson_id: number;
    lesson_title?: string;
    progress: number;
    total_exercises: number;
    completed_exercises?: number;
}

export interface UserProgress {
    progress_percentage: number;
    completed_exercises: number;
    total_exercises: number;
    total_points: number;
    total_submissions: number;
    lessons: LessonProgress[];
}

// Exercise types
export interface EditorFile {
    name: string;
    language: string;
    content: string;
}

export interface Exercise {
    id: number;
    lesson_id: number;
    title: string;
    description: string;
    exercise_type: 'coding' | 'quiz' | 'mixed';
    language?: string;
    points: number;
    starter_code?: string;
    order: number;
}

export interface ExerciseDetail extends Exercise {
    quiz_questions_student?: QuizQuestion[];
    test_cases?: TestCase[];
}

export interface TestCase {
    id: number;
    input: string;
    expected_output: string;
    is_hidden: boolean;
}

// Quiz types
export interface QuizQuestion {
    id: number;
    question: string;
    options: string[];
    correct_answer: number;
    question_type?: 'multiple_choice' | 'true_false' | 'short_answer';
}

export type QuizQuestionStudent = QuizQuestion;

export interface QuizAnswer {
    question_id: number;
    answer: number | string;
}

// Submission types
export interface Submission {
    id: number;
    exercise_id: number;
    user_id: number;
    code?: string;
    output?: string;
    error_output?: string;
    score: number;
    max_score: number;
    passed: boolean;
    feedback: string;
    status: 'pending' | 'passed' | 'failed';
    created_at: string;
    // Full test results from autograder
    test_results?: {
        passed: boolean;
        total_tests: number;
        passed_tests: number;
        score: number;
        feedback: string;
        test_results: Array<{
            test_number: number;
            passed: boolean;
            is_hidden: boolean;
            input?: string;
            expected?: string;
            match_type: string;
        }>;
    };
}

export interface SubmissionResult {
    passed: boolean;
    score: number;
    max_score: number;
    feedback: string;
}
