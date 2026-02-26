import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks';
import { useAuthStore } from '@/store';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { login, isLoading, error } = useAuth();
    const { isAuthenticated } = useAuthStore();

    if (isAuthenticated) {
        return <Navigate to="/dashboard" replace />;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await login(username, password);
    };

    return (
        <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8 bg-card p-10 rounded-2xl border shadow-2xl backdrop-blur-xl">
                {/* Header */}
                <div className="text-center">
                    <div className="mx-auto w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-primary/20">
                        <span className="text-primary-foreground font-black text-4xl">C</span>
                    </div>
                    <h2 className="text-4xl font-black text-foreground tracking-tight">
                        CODEHS CLONE
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Sign in to your account to continue learning
                    </p>
                </div>

                {/* Form */}
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg text-sm animate-in fade-in slide-in-from-top-1">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
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
                                className="input h-12 bg-background/50"
                                placeholder="Enter your username"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input h-12 bg-background/50"
                                placeholder="Enter your password"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full btn-primary h-12 text-base font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        {isLoading ? (
                            <div className="flex items-center gap-2">
                                <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                                <span>AUTHENTICATING...</span>
                            </div>
                        ) : (
                            'SIGN IN'
                        )}
                    </button>

                    <div className="text-center text-sm pt-4 border-t">
                        <span className="text-muted-foreground">
                            New here?{' '}
                        </span>
                        <Link
                            to="/register"
                            className="font-bold text-primary hover:underline"
                        >
                            CREATE AN ACCOUNT
                        </Link>
                    </div>
                </form>

                {/* Demo credentials */}
                <div className="mt-6 p-4 bg-muted/50 rounded-xl border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground text-center uppercase tracking-widest mb-3">
                        Quick Access (Demo)
                    </p>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                        <div className="text-center">
                            <p className="font-bold text-foreground">TEACHER</p>
                            <p className="text-muted-foreground">teacher / teacher123</p>
                        </div>
                        <div className="text-center border-l">
                            <p className="font-bold text-foreground">STUDENT</p>
                            <p className="text-muted-foreground">student / student123</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
