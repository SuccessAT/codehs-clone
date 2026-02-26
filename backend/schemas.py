"""
Pydantic schemas for request/response validation.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ==================== User Schemas ====================

class UserBase(BaseModel):
    """Base user schema with common fields."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr


class UserCreate(UserBase):
    """Schema for creating a new user."""
    password: str = Field(..., min_length=8)
    role: str = "student"


class UserUpdate(BaseModel):
    """Schema for updating user information."""
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=8)
    is_active: Optional[bool] = None


class UserResponse(UserBase):
    """Schema for user response (excludes sensitive data)."""
    id: int
    role: str
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class UserLogin(BaseModel):
    """Schema for user login."""
    username: str
    password: str


class Token(BaseModel):
    """Schema for JWT token response."""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Schema for token payload data."""
    user_id: Optional[int] = None
    username: Optional[str] = None


# ==================== Lesson Schemas ====================

class LessonBase(BaseModel):
    """Base lesson schema."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    video_url: Optional[str] = None
    order: int = 0


class LessonCreate(LessonBase):
    """Schema for creating a new lesson."""
    pass


class LessonUpdate(BaseModel):
    """Schema for updating a lesson."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    video_url: Optional[str] = None
    order: Optional[int] = None


class LessonResponse(LessonBase):
    """Schema for lesson response."""
    id: int
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class LessonWithExercises(LessonResponse):
    """Schema for lesson with exercises."""
    exercises: list["ExerciseResponse"] = []
    
    model_config = ConfigDict(from_attributes=True)


# ==================== Exercise Schemas ====================

class TestCase(BaseModel):
    """Schema for a single test case."""
    input: str = ""
    expected_output: str
    match_type: str = "exact"  # exact, regex, contains
    is_hidden: bool = False


class QuizQuestion(BaseModel):
    """Schema for a quiz question."""
    id: str
    question: str
    question_type: str = "multiple_choice"  # multiple_choice, multiple_answer, true_false, short_answer
    options: Optional[list[str]] = None  # For multiple choice
    correct_answer: str  # Single answer or comma-separated for multiple
    explanation: Optional[str] = None
    points: int = 1


class QuizAnswer(BaseModel):
    """Schema for a quiz answer submission."""
    question_id: str
    answer: str  # User's answer


class ExerciseBase(BaseModel):
    """Base exercise schema."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    exercise_type: str = "coding"  # coding, quiz, mixed
    starter_code: Optional[str] = None
    language: str = "python"
    test_cases: Optional[list[TestCase]] = None
    quiz_questions: Optional[list[QuizQuestion]] = None
    order: int = 0
    points: int = 10
    allow_partial_credit: bool = True
    time_limit: Optional[int] = None  # seconds


class ExerciseCreate(ExerciseBase):
    """Schema for creating a new exercise."""
    lesson_id: int


class ExerciseUpdate(BaseModel):
    """Schema for updating an exercise."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    exercise_type: Optional[str] = None
    starter_code: Optional[str] = None
    language: Optional[str] = None
    test_cases: Optional[list[TestCase]] = None
    quiz_questions: Optional[list[QuizQuestion]] = None
    order: Optional[int] = None
    points: Optional[int] = None
    allow_partial_credit: Optional[bool] = None
    time_limit: Optional[int] = None


class ExerciseResponse(BaseModel):
    """Schema for exercise response (excludes test cases and answers for students)."""
    id: int
    lesson_id: int
    exercise_type: str
    allow_partial_credit: bool
    time_limit: Optional[int]
    created_at: datetime
    updated_at: datetime
    
    # Include test cases only if explicitly requested or for teachers
    model_config = ConfigDict(from_attributes=True, exclude=["test_cases", "quiz_questions"])


class ExerciseResponseWithTests(ExerciseResponse):
    """Schema for exercise response with test cases (for teachers/admin)."""
    test_cases: Optional[list[TestCase]] = None
    quiz_questions: Optional[list[QuizQuestion]] = None
    
    model_config = ConfigDict(from_attributes=True)


class ExerciseDetailResponse(ExerciseResponse):
    """Schema for exercise detail with starter code for students."""
    title: str
    description: Optional[str]
    starter_code: Optional[str]
    language: str
    order: int
    points: int
    # Quiz questions without correct answers for students
    quiz_questions_student: Optional[list[dict]] = None
    
    model_config = ConfigDict(from_attributes=True)


# ==================== Submission Schemas ====================

class SubmissionBase(BaseModel):
    """Base submission schema."""
    code: str


class SubmissionCreate(SubmissionBase):
    """Schema for creating a new submission."""
    exercise_id: int


class SubmissionUpdate(BaseModel):
    """Schema for updating submission status (admin/teacher only)."""
    status: Optional[str] = None
    score: Optional[int] = None
    feedback: Optional[str] = None


class SubmissionResponse(SubmissionBase):
    """Schema for submission response."""
    id: int
    user_id: int
    exercise_id: int
    status: str
    output: Optional[str]
    error_output: Optional[str]
    score: Optional[int]
    test_results: Optional[dict]
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class SubmissionWithExercise(SubmissionResponse):
    """Schema for submission with exercise details."""
    exercise: Optional[ExerciseResponse] = None
    
    model_config = ConfigDict(from_attributes=True)


# ==================== Sandbox Session Schemas ====================

class SandboxSessionBase(BaseModel):
    """Base sandbox session schema."""
    language: Optional[str] = "python"


class SandboxSessionCreate(SandboxSessionBase):
    """Schema for creating a new sandbox session."""
    pass


class SandboxSessionUpdate(BaseModel):
    """Schema for updating sandbox session."""
    status: Optional[str] = None


class SandboxSessionResponse(SandboxSessionBase):
    """Schema for sandbox session response."""
    id: int
    user_id: int
    sandbox_id: str
    status: str
    created_at: datetime
    terminated_at: Optional[datetime]
    
    model_config = ConfigDict(from_attributes=True)


# ==================== Execution Schemas ====================

class ExecutionRequest(BaseModel):
    """Schema for code execution request."""
    code: str = Field(..., min_length=1, max_length=100000)
    language: str = Field(default="python", pattern="^(python|javascript|java|cpp|c|go|rust|ruby|php|typescript)$")
    input_data: Optional[str] = Field(None, max_length=100000)
    timeout: Optional[float] = Field(None, ge=1.0, le=300.0, description="Execution timeout in seconds (1-300)")


class ExecutionResultSchema(BaseModel):
    """Schema for execution result response."""
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    execution_time: float = 0.0
    error: Optional[str] = None
    timed_out: bool = False
    
    model_config = ConfigDict(from_attributes=True)


class ExecutionStreamChunk(BaseModel):
    """Schema for streaming execution output."""
    execution_id: str
    stream: str  # "stdout" or "stderr"
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ExecutionComplete(BaseModel):
    """Schema for execution completion notification."""
    execution_id: str
    exit_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    execution_time: float = 0.0
    timed_out: bool = False
    error: Optional[str] = None


# ==================== Extended Sandbox Schemas ====================

class SandboxCreate(BaseModel):
    """Schema for creating a new sandbox."""
    language: str = Field(default="python", pattern="^(python|javascript|java|cpp|c|go|rust|ruby|php|typescript)$")


class SandboxExecute(BaseModel):
    """Schema for executing code in a sandbox."""
    code: str = Field(..., min_length=1, max_length=100000)
    language: Optional[str] = Field(None, pattern="^(python|javascript|java|cpp|c|go|rust|ruby|php|typescript)$")
    input_data: Optional[str] = Field(None, max_length=100000)
    timeout: Optional[float] = Field(None, ge=1.0, le=300.0)


class SandboxInput(BaseModel):
    """Schema for sending input to a running program."""
    execution_id: str
    input_data: str = Field(..., max_length=100000)


class SandboxStatusResponse(BaseModel):
    """Schema for sandbox status response."""
    sandbox_id: str
    status: str
    language: Optional[str] = None
    created_at: datetime
    last_activity: datetime
    execution_count: int = 0
    is_expired: bool = False
    
    model_config = ConfigDict(from_attributes=True)


class SandboxListResponse(BaseModel):
    """Schema for listing user's sandboxes."""
    sandboxes: list[SandboxStatusResponse]
    total: int


# ==================== Utility Schemas ====================

class Message(BaseModel):
    """Generic message response."""
    message: str


class ErrorResponse(BaseModel):
    """Error response schema."""
    detail: str
    code: Optional[str] = None


class HealthCheckResponse(BaseModel):
    """Schema for health check response."""
    status: str
    timestamp: str
    e2b_connected: bool = False
    active_sandboxes: int = 0


# Update forward references
LessonWithExercises.model_rebuild()
