"""
SQLAlchemy models for the CodeHS-like educational platform.
"""
from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class UserRole(str, PyEnum):
    """User roles in the system."""
    STUDENT = "student"
    TEACHER = "teacher"


class SubmissionStatus(str, PyEnum):
    """Submission status values."""
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"


class SandboxStatus(str, PyEnum):
    """Sandbox session status."""
    ACTIVE = "active"
    TERMINATED = "terminated"
    ERROR = "error"


class User(Base):
    """User model for students and teachers."""
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False, default=UserRole.STUDENT)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    submissions: Mapped[list["Submission"]] = relationship(
        "Submission", back_populates="user", cascade="all, delete-orphan"
    )
    sandbox_sessions: Mapped[list["SandboxSession"]] = relationship(
        "SandboxSession", back_populates="user", cascade="all, delete-orphan"
    )
    courses: Mapped[list["Course"]] = relationship(
        "Course", back_populates="owner", cascade="all, delete-orphan"
    )
    
    def __repr__(self) -> str:
        return f"<User(id={self.id}, username='{self.username}', role={self.role})>"


class Lesson(Base):
    """Lesson model for course content."""
    __tablename__ = "lessons"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    module_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("modules.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lesson_type: Mapped[str] = mapped_column(String(50), nullable=False, default="text")  # text, video, picture, codelab, assignment
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Markdown content for text lessons
    media_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # Video or picture URL
    starter_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Starter code for codelab
    language: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # Programming language for codelab
    video_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    module: Mapped[Optional["Module"]] = relationship("Module", back_populates="lessons")
    exercises: Mapped[list["Exercise"]] = relationship(
        "Exercise", back_populates="lesson", cascade="all, delete-orphan", order_by="Exercise.order"
    )
    course_modules: Mapped[list["CourseModule"]] = relationship(
        "CourseModule", cascade="all, delete-orphan"
    )
    
    def __repr__(self) -> str:
        return f"<Lesson(id={self.id}, title='{self.title}', order={self.order})>"


class ExerciseType(str, PyEnum):
    """Exercise types."""
    CODING = "coding"
    QUIZ = "quiz"
    MIXED = "mixed"


class Exercise(Base):
    """Exercise model for coding challenges and quizzes."""
    __tablename__ = "exercises"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lesson_id: Mapped[int] = mapped_column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exercise_type: Mapped[ExerciseType] = mapped_column(
        Enum(ExerciseType), nullable=False, default=ExerciseType.CODING
    )
    starter_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(50), nullable=False, default="python")
    test_cases: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    quiz_questions: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    allow_partial_credit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    time_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # seconds
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    lesson: Mapped["Lesson"] = relationship("Lesson", back_populates="exercises")
    submissions: Mapped[list["Submission"]] = relationship(
        "Submission", back_populates="exercise", cascade="all, delete-orphan"
    )
    
    def __repr__(self) -> str:
        return f"<Exercise(id={self.id}, title='{self.title}', type={self.exercise_type})>"


class Submission(Base):
    """Submission model for user code submissions."""
    __tablename__ = "submissions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    exercise_id: Mapped[int] = mapped_column(Integer, ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus), nullable=False, default=SubmissionStatus.PENDING
    )
    output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    test_results: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="submissions")
    exercise: Mapped["Exercise"] = relationship("Exercise", back_populates="submissions")
    
    def __repr__(self) -> str:
        return f"<Submission(id={self.id}, user_id={self.user_id}, exercise_id={self.exercise_id}, status={self.status})>"


class SandboxSession(Base):
    """Sandbox session model for code execution environments."""
    __tablename__ = "sandbox_sessions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sandbox_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[SandboxStatus] = mapped_column(
        Enum(SandboxStatus), nullable=False, default=SandboxStatus.ACTIVE
    )
    language: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    terminated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="sandbox_sessions")
    
    def __repr__(self) -> str:
        return f"<SandboxSession(id={self.id}, sandbox_id='{self.sandbox_id}', status={self.status})>"


class Course(Base):
    """Course model that groups modules."""
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    level: Mapped[str] = mapped_column(String(50), nullable=False, default="beginner")
    theme: Mapped[str] = mapped_column(String(50), nullable=False, default="ocean")
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner: Mapped["User"] = relationship("User", back_populates="courses")
    modules: Mapped[list["Module"]] = relationship(
        "Module",
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="Module.order",
    )


class Module(Base):
    """Module model - a section within a course containing multiple lessons."""
    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    course: Mapped["Course"] = relationship("Course", back_populates="modules")
    lessons: Mapped[list["Lesson"]] = relationship(
        "Lesson",
        back_populates="module",
        cascade="all, delete-orphan",
        order_by="Lesson.order",
    )


class CourseModule(Base):
    """Legacy join model to attach lessons to courses with module metadata. DEPRECATED - use Module instead."""
    __tablename__ = "course_modules"
    __table_args__ = (
        UniqueConstraint("course_id", "lesson_id", name="uq_course_module_course_lesson"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    lesson_id: Mapped[int] = mapped_column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False, index=True)
    module_type: Mapped[str] = mapped_column(String(50), nullable=False, default="concept")
    module_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    course: Mapped["Course"] = relationship("Course", overlaps="modules")
    lesson: Mapped["Lesson"] = relationship("Lesson", overlaps="course_modules")
