import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks';
import { useAuthStore } from '@/store';

export default function RegisterPage() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState<'student' | 'teacher'>('student');
    const { register, isLoading, error } = useAuth();
    const { isAuthenticated } = useAuthStore();

    if (isAuthenticated) {
        return <Navigate to="/dashboard" replace />;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) return;
        await register(username, email, password, role);
    };

    return (
        <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8 bg-card p-10 rounded-2xl border shadow-2xl backdrop-blur-xl">
                <div className="text-center">
                    <div className="mx-auto w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-primary/20">
                        <span className="text-primary-foreground font-black text-4xl">C</span>
                    </div>
                    <h2 className="text-4xl font-black text-foreground tracking-tight uppercase">
                        Join CodeHS
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Create your account to start learning
                    </p>
                </div>

                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                I am a...
                            </label>
                            <div className="flex gap-4">
                                <button
                                    type="button"
                                    onClick={() => setRole('student')}
                                    className={`flex-1 py-2 rounded-lg border font-bold text-sm transition-all ${role === 'student' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'}`}
                                >
                                    STUDENT
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRole('teacher')}
                                    className={`flex-1 py-2 rounded-lg border font-bold text-sm transition-all ${role === 'teacher' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'}`}
                                >
                                    TEACHER
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                Username
                            </label>
                            <input
                                type="text"
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="input h-12 bg-background/50"
                                placeholder="Choose a username"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input h-12 bg-background/50"
                                placeholder="Enter your email"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                Password
                            </label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input h-12 bg-background/50"
                                placeholder="Create a password"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                Confirm Password
                            </label>
                            <input
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="input h-12 bg-background/50"
                                placeholder="Confirm your password"
                            />
                            {password !== confirmPassword && confirmPassword && (
                                <p className="mt-1 text-xs text-destructive">Passwords do not match</p>
                            )}
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || (password !== confirmPassword)}
                        className="w-full btn-primary h-12 text-base font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        {isLoading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
                    </button>

                    <div className="text-center text-sm pt-4 border-t">
                        <span className="text-muted-foreground">
                            Already have an account?{' '}
                        </span>
                        <Link to="/login" className="font-bold text-primary hover:underline">
                            SIGN IN
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
