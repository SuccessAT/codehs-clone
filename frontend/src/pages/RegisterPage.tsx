import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks';

export default function RegisterPage() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState<'student' | 'teacher'>('student');
    const { register, isLoading, error } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            return;
        }

        await register({ username, email, password, role });
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
                {/* Header */}
                <div className="text-center">
                    <div className="mx-auto w-16 h-16 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
                        <span className="text-white font-bold text-2xl">C</span>
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                        Create an account
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Start your coding journey today
                    </p>
                </div>

                {/* Form */}
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Username
                            </label>
                            <input
                                id="username"
                                name="username"
                                type="text"
                                autoComplete="username"
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="input"
                                placeholder="Choose a username"
                            />
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Email
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input"
                                placeholder="Enter your email"
                            />
                        </div>

                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                I am a...
                            </label>
                            <select
                                id="role"
                                name="role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as 'student' | 'teacher')}
                                className="input"
                            >
                                <option value="student">Student</option>
                                <option value="teacher">Teacher</option>
                            </select>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input"
                                placeholder="Create a password"
                            />
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Confirm Password
                            </label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="input"
                                placeholder="Confirm your password"
                            />
                            {password !== confirmPassword && confirmPassword && (
                                <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                            )}
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || password !== confirmPassword}
                        className="w-full btn-primary py-3 flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Creating account...
                            </>
                        ) : (
                            'Create account'
                        )}
                    </button>

                    <div className="text-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">
                            Already have an account?{' '}
                        </span>
                        <Link
                            to="/login"
                            className="font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500"
                        >
                            Sign in
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}