import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import LessonPage from './pages/LessonPage'
import ExercisePage from './pages/ExercisePage'
import { useAuthStore, useUIStore } from './store'

const ProtectedRoute = ({ children, requireTeacher = false }: { children: React.ReactNode, requireTeacher?: boolean }) => {
    const { isAuthenticated, user } = useAuthStore()
    
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    if (requireTeacher && user?.role !== 'teacher') {
        return <Navigate to="/dashboard" replace />
    }

    return <>{children}</>
}

function App() {
    const { darkMode } = useUIStore()

    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [darkMode])

    return (
        <BrowserRouter>
            <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />

                {/* Protected Routes */}
                <Route path="/dashboard" element={
                    <ProtectedRoute>
                        <DashboardPage />
                    </ProtectedRoute>
                } />
                <Route path="/lesson/:lessonId" element={
                    <ProtectedRoute>
                        <LessonPage />
                    </ProtectedRoute>
                } />
                <Route path="/exercise/:exerciseId" element={
                    <ProtectedRoute>
                        <ExercisePage />
                    </ProtectedRoute>
                } />

                {/* Default redirect to Login */}
                <Route path="/" element={<Navigate to="/login" replace />} />
                
                {/* Catch-all redirect */}
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
