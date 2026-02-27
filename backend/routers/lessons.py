"""
Lessons and exercises router for the CodeHS Clone API.

Handles:
- Lesson CRUD operations
- Exercise CRUD operations
- Exercise submissions
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import User, Lesson, Exercise, Submission, UserRole, SubmissionStatus, Course, CourseModule, Module
from schemas import (
    LessonCreate, LessonResponse, LessonUpdate, LessonWithExercises,
    CourseCreate, CourseResponse, CourseWithModules, CourseModuleCreate, CourseModuleResponse,
    CourseWithNewModules, ModuleCreate, ModuleResponse, ModuleWithLessons, ModuleUpdate,
    ExerciseCreate, ExerciseResponse, ExerciseUpdate, ExerciseResponseWithTests,
    SubmissionCreate, SubmissionResponse, SubmissionWithExercise,
    Message,
)
from dependencies import (
    get_current_active_user,
    require_teacher,
    check_rate_limit,
    get_e2b_or_raise,
    PaginationParams,
)

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/v1", tags=["Lessons & Exercises"])


# ==================== Lesson Routes ====================
@router.get(
    "/lessons",
    response_model=list[LessonResponse],
    summary="List all lessons",
    description="Get a list of all lessons ordered by their sequence.",
)
async def list_lessons(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[LessonResponse]:
    """List all lessons."""
    result = await db.execute(
        select(Lesson)
        .order_by(Lesson.order)
        .offset(pagination.skip)
        .limit(pagination.limit)
    )
    return result.scalars().all()


@router.get(
    "/lessons/{lesson_id}",
    response_model=LessonWithExercises,
    summary="Get lesson with exercises",
    description="Get a specific lesson including all its exercises.",
)
async def get_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
) -> LessonWithExercises:
    """Get lesson with exercises."""
    result = await db.execute(
        select(Lesson)
        .options(selectinload(Lesson.exercises))
        .where(Lesson.id == lesson_id)
    )
    lesson = result.scalar_one_or_none()
    
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    return lesson


@router.get(
    "/courses",
    response_model=list[CourseResponse],
    summary="List teacher courses",
    description="Get all courses created by the current teacher.",
)
async def list_courses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> list[CourseResponse]:
    """List courses for the current teacher."""
    result = await db.execute(
        select(Course)
        .where(Course.owner_id == current_user.id)
        .order_by(Course.created_at.desc())
    )
    return result.scalars().all()


@router.post(
    "/courses",
    response_model=CourseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new course",
    description="Create a new course. Teachers only.",
)
async def create_course(
    course: CourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> CourseResponse:
    """Create a course for the current teacher."""
    db_course = Course(**course.model_dump(), owner_id=current_user.id)
    db.add(db_course)
    await db.commit()
    await db.refresh(db_course)
    return db_course


@router.get(
    "/courses/{course_id}",
    response_model=CourseWithModules,
    summary="Get course with modules",
    description="Get a course and its modules (lessons). Teachers only.",
)
async def get_course(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> CourseWithModules:
    """Get a course with modules for the current teacher."""
    result = await db.execute(
        select(Course)
        .options(
            selectinload(Course.modules).selectinload(CourseModule.lesson)
        )
        .where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.post(
    "/courses/{course_id}/modules",
    response_model=CourseModuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create module in course (legacy)",
    description="Create a lesson module within a course. Teachers only. DEPRECATED - use new module endpoints.",
)
async def create_course_module(
    course_id: int,
    module: CourseModuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> CourseModuleResponse:
    """Create module and attach it to a course. DEPRECATED."""
    course_result = await db.execute(
        select(Course).where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    lesson = Lesson(
        title=module.title,
        description=module.description,
        video_url=module.video_url,
        order=module.order,
    )
    db.add(lesson)
    await db.flush()

    course_module = CourseModule(
        course_id=course_id,
        lesson_id=lesson.id,
        module_type=module.module_type,
        module_order=module.order,
    )
    db.add(course_module)
    await db.commit()

    result = await db.execute(
        select(CourseModule)
        .options(selectinload(CourseModule.lesson))
        .where(CourseModule.id == course_module.id)
    )
    return result.scalar_one()


# ==================== NEW Module Routes ====================
@router.get(
    "/courses/{course_id}/modules/",
    response_model=list[ModuleResponse],
    summary="List modules in a course",
    description="Get all modules for a course. Teachers only.",
)
async def list_modules(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> list[ModuleResponse]:
    """List all modules in a course."""
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    result = await db.execute(
        select(Module)
        .where(Module.course_id == course_id)
        .order_by(Module.order)
    )
    return result.scalars().all()


@router.post(
    "/courses/{course_id}/modules/",
    response_model=ModuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a module",
    description="Create a new module in a course. Teachers only.",
)
async def create_module(
    course_id: int,
    module: ModuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ModuleResponse:
    """Create a new module in a course."""
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    db_module = Module(**module.model_dump(), course_id=course_id)
    db.add(db_module)
    await db.commit()
    await db.refresh(db_module)
    return db_module


@router.get(
    "/modules/{module_id}",
    response_model=ModuleWithLessons,
    summary="Get module with lessons",
    description="Get a module and its lessons. Teachers only.",
)
async def get_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ModuleWithLessons:
    """Get a module with its lessons."""
    result = await db.execute(
        select(Module)
        .options(selectinload(Module.lessons))
        .where(Module.id == module_id)
    )
    module = result.scalar_one_or_none()
    
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == module.course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Module not found")
    
    return module


@router.put(
    "/modules/{module_id}",
    response_model=ModuleResponse,
    summary="Update a module",
    description="Update a module. Teachers only.",
)
async def update_module(
    module_id: int,
    module_update: ModuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ModuleResponse:
    """Update a module."""
    result = await db.execute(select(Module).where(Module.id == module_id))
    module = result.scalar_one_or_none()
    
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == module.course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Module not found")
    
    update_data = module_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(module, field, value)
    
    await db.commit()
    await db.refresh(module)
    
    return module


@router.delete(
    "/modules/{module_id}",
    response_model=Message,
    summary="Delete a module",
    description="Delete a module and all its lessons. Teachers only.",
)
async def delete_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> Message:
    """Delete a module and all its lessons."""
    result = await db.execute(select(Module).where(Module.id == module_id))
    module = result.scalar_one_or_none()
    
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == module.course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Module not found")
    
    await db.delete(module)
    await db.commit()
    
    return Message(message="Module deleted successfully")


@router.post(
    "/modules/{module_id}/lessons/",
    response_model=LessonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a lesson in a module",
    description="Create a new lesson in a module. Teachers only.",
)
async def create_lesson_in_module(
    module_id: int,
    lesson: LessonCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> LessonResponse:
    """Create a new lesson in a module."""
    # Verify module exists
    module_result = await db.execute(select(Module).where(Module.id == module_id))
    module = module_result.scalar_one_or_none()
    
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    
    # Verify course belongs to teacher
    course_result = await db.execute(
        select(Course).where(Course.id == module.course_id, Course.owner_id == current_user.id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Module not found")
    
    db_lesson = Lesson(**lesson.model_dump(), module_id=module_id)
    db.add(db_lesson)
    await db.commit()
    await db.refresh(db_lesson)
    
    return db_lesson


@router.get(
    "/courses/{course_id}/modules/with-lessons/",
    response_model=CourseWithNewModules,
    summary="Get course with modules and lessons",
    description="Get a course with all its modules and lessons. Teachers only.",
)
async def get_course_with_modules(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> CourseWithNewModules:
    """Get a course with all modules and their lessons."""
    result = await db.execute(
        select(Course)
        .options(
            selectinload(Course.modules).selectinload(Module.lessons)
        )
        .where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


# ==================== Public Course Routes (Students) ====================
@router.get(
    "/courses/public/",
    response_model=list[CourseResponse],
    summary="List published courses",
    description="Get all published courses available for students.",
)
async def list_public_courses(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[CourseResponse]:
    """List all published courses."""
    result = await db.execute(
        select(Course)
        .where(Course.is_published == True)
        .order_by(Course.created_at.desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    )
    return result.scalars().all()


@router.get(
    "/courses/public/{course_id}",
    response_model=CourseWithNewModules,
    summary="Get published course with modules",
    description="Get a published course with all its modules and lessons.",
)
async def get_public_course_with_modules(
    course_id: int,
    db: AsyncSession = Depends(get_db),
) -> CourseWithNewModules:
    """Get a published course with all modules and their lessons."""
    result = await db.execute(
        select(Course)
        .options(
            selectinload(Course.modules).selectinload(Module.lessons)
        )
        .where(Course.id == course_id, Course.is_published == True)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.post(
    "/lessons",
    response_model=LessonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new lesson",
    description="Create a new lesson. Teachers only.",
)
async def create_lesson(
    lesson: LessonCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> LessonResponse:
    """Create a new lesson (teachers only)."""
    db_lesson = Lesson(**lesson.model_dump())
    db.add(db_lesson)
    await db.commit()
    await db.refresh(db_lesson)
    
    logger.info(f"Lesson created: {db_lesson.title} (id={db_lesson.id}) by user {current_user.id}")
    
    return db_lesson


@router.put(
    "/lessons/{lesson_id}",
    response_model=LessonResponse,
    summary="Update a lesson",
    description="Update an existing lesson. Teachers only.",
)
async def update_lesson(
    lesson_id: int,
    lesson_update: LessonUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> LessonResponse:
    """Update a lesson (teachers only)."""
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    update_data = lesson_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(lesson, field, value)
    
    await db.commit()
    await db.refresh(lesson)
    
    logger.info(f"Lesson updated: {lesson.title} (id={lesson.id}) by user {current_user.id}")
    
    return lesson


@router.delete(
    "/lessons/{lesson_id}",
    response_model=Message,
    summary="Delete a lesson",
    description="Delete a lesson and all its exercises. Teachers only.",
)
async def delete_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> Message:
    """Delete a lesson (teachers only)."""
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    await db.delete(lesson)
    await db.commit()
    
    logger.info(f"Lesson deleted: {lesson.title} (id={lesson.id}) by user {current_user.id}")
    
    return Message(message="Lesson deleted successfully")


# ==================== Exercise Routes ====================
@router.get(
    "/exercises",
    response_model=list[ExerciseResponse],
    summary="List exercises",
    description="Get a list of exercises, optionally filtered by lesson.",
)
async def list_exercises(
    lesson_id: Optional[int] = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[ExerciseResponse]:
    """List all exercises, optionally filtered by lesson."""
    query = select(Exercise)
    
    if lesson_id:
        query = query.where(Exercise.lesson_id == lesson_id)
    
    result = await db.execute(
        query.order_by(Exercise.order).offset(pagination.skip).limit(pagination.limit)
    )
    return result.scalars().all()


@router.get(
    "/exercises/{exercise_id}",
    response_model=ExerciseResponse,
    summary="Get exercise",
    description="Get a specific exercise by ID.",
)
async def get_exercise(
    exercise_id: int,
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Get exercise by ID."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    return exercise


@router.get(
    "/exercises/{exercise_id}/tests",
    response_model=ExerciseResponseWithTests,
    summary="Get exercise with test cases",
    description="Get exercise including test cases. Teachers only.",
)
async def get_exercise_with_tests(
    exercise_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ExerciseResponseWithTests:
    """Get exercise with test cases (teachers only)."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    return exercise


@router.post(
    "/exercises",
    response_model=ExerciseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new exercise",
    description="Create a new exercise in a lesson. Teachers only.",
)
async def create_exercise(
    exercise: ExerciseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ExerciseResponse:
    """Create a new exercise (teachers only)."""
    # Verify lesson exists
    result = await db.execute(select(Lesson).where(Lesson.id == exercise.lesson_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    db_exercise = Exercise(**exercise.model_dump())
    db.add(db_exercise)
    await db.commit()
    await db.refresh(db_exercise)
    
    logger.info(f"Exercise created: {db_exercise.title} (id={db_exercise.id}) by user {current_user.id}")
    
    return db_exercise


@router.put(
    "/exercises/{exercise_id}",
    response_model=ExerciseResponse,
    summary="Update an exercise",
    description="Update an existing exercise. Teachers only.",
)
async def update_exercise(
    exercise_id: int,
    exercise_update: ExerciseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> ExerciseResponse:
    """Update an exercise (teachers only)."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    update_data = exercise_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(exercise, field, value)
    
    await db.commit()
    await db.refresh(exercise)
    
    logger.info(f"Exercise updated: {exercise.title} (id={exercise.id}) by user {current_user.id}")
    
    return exercise


@router.delete(
    "/exercises/{exercise_id}",
    response_model=Message,
    summary="Delete an exercise",
    description="Delete an exercise. Teachers only.",
)
async def delete_exercise(
    exercise_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
) -> Message:
    """Delete an exercise (teachers only)."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    await db.delete(exercise)
    await db.commit()
    
    logger.info(f"Exercise deleted: {exercise.title} (id={exercise.id}) by user {current_user.id}")
    
    return Message(message="Exercise deleted successfully")


# ==================== Submission Routes ====================
@router.get(
    "/submissions",
    response_model=list[SubmissionResponse],
    summary="List submissions",
    description="Get a list of submissions. Students see only their own submissions.",
)
async def list_submissions(
    exercise_id: Optional[int] = None,
    user_id: Optional[int] = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[SubmissionResponse]:
    """List submissions, filtered by exercise or user."""
    # Students can only see their own submissions
    if current_user.role != UserRole.TEACHER:
        user_id = current_user.id
    
    query = select(Submission)
    
    if user_id:
        query = query.where(Submission.user_id == user_id)
    if exercise_id:
        query = query.where(Submission.exercise_id == exercise_id)
    
    result = await db.execute(
        query.order_by(Submission.created_at.desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    )
    return result.scalars().all()


@router.get(
    "/submissions/{submission_id}",
    response_model=SubmissionWithExercise,
    summary="Get submission",
    description="Get a specific submission with exercise details.",
)
async def get_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SubmissionWithExercise:
    """Get submission by ID."""
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.exercise))
        .where(Submission.id == submission_id)
    )
    submission = result.scalar_one_or_none()
    
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    # Students can only view their own submissions
    if submission.user_id != current_user.id and current_user.role != UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return submission


@router.post(
    "/submissions",
    response_model=SubmissionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit code",
    description="Submit code for an exercise. Code will be executed in E2B sandbox.",
)
async def create_submission(
    submission: SubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SubmissionResponse:
    """Create a new submission and execute code in E2B sandbox."""
    await check_rate_limit(current_user)
    
    # Verify exercise exists
    result = await db.execute(select(Exercise).where(Exercise.id == submission.exercise_id))
    exercise = result.scalar_one_or_none()
    
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    # Create submission with pending status
    db_submission = Submission(
        user_id=current_user.id,
        exercise_id=submission.exercise_id,
        code=submission.code,
        status=SubmissionStatus.PENDING,
    )
    db.add(db_submission)
    await db.commit()
    await db.refresh(db_submission)
    
    # Try to execute code in E2B sandbox
    try:
        e2b = get_e2b_or_raise()
        
        # Get or create sandbox for user
        user_sandboxes = await e2b.get_user_sandboxes(current_user.id)
        active_sandbox = None
        
        for sandbox in user_sandboxes:
            if sandbox.status.value == "active" and not sandbox.is_expired(30):
                active_sandbox = sandbox
                break
        
        if active_sandbox:
            sandbox_id = active_sandbox.sandbox_id
        else:
            sandbox_id = await e2b.create_sandbox(
                user_id=current_user.id,
                language=exercise.language
            )
        
        # Execute code
        exec_result = await e2b.execute_code(
            sandbox_id=sandbox_id,
            code=submission.code,
            language=exercise.language,
            timeout=30.0,
        )
        
        # Update submission with results
        db_submission.output = exec_result.stdout
        db_submission.error_output = exec_result.stderr
        
        # Run autograding if exercise has test cases
        if exercise.test_cases:
            from websocket_manager import Autograder
            
            grader = Autograder()
            grading_result = grader.grade(exec_result.stdout or "", exercise.test_cases)
            
            # Store grading results
            db_submission.test_results = {
                "passed": grading_result.passed,
                "total_tests": grading_result.total_tests,
                "passed_tests": grading_result.passed_tests,
                "score": grading_result.score,
                "feedback": grading_result.feedback,
                "test_results": grading_result.test_results,
            }
            
            # Set status based on grading
            if grading_result.passed:
                db_submission.status = SubmissionStatus.PASSED
                db_submission.score = grading_result.score
            else:
                db_submission.status = SubmissionStatus.FAILED
                db_submission.score = 0
        else:
            # No test cases - just check exit code
            if exec_result.timed_out:
                db_submission.status = SubmissionStatus.FAILED
                db_submission.error_output = (db_submission.error_output or "") + "\nExecution timed out after 30 seconds"
            elif exec_result.exit_code == 0:
                db_submission.status = SubmissionStatus.PASSED
                db_submission.score = exercise.points
            else:
                db_submission.status = SubmissionStatus.FAILED
        
        if exec_result.error:
            db_submission.test_results = {"error": exec_result.error}
            
    except HTTPException:
        # E2B not available - mark as pending
        logger.warning(f"E2B service unavailable for submission {db_submission.id}")
        db_submission.status = SubmissionStatus.PENDING
        db_submission.error_output = "Code execution service unavailable"
    except Exception as e:
        logger.error(f"Execution error for submission {db_submission.id}: {e}")
        db_submission.status = SubmissionStatus.PENDING
        db_submission.error_output = f"Execution error: {str(e)}"
    
    await db.commit()
    await db.refresh(db_submission)
    
    logger.info(f"Submission created: id={db_submission.id} by user {current_user.id}")
    
    return db_submission


@router.get(
    "/users/me/submissions",
    response_model=list[SubmissionWithExercise],
    summary="Get current user's submissions",
    description="Get all submissions for the current user.",
)
async def get_my_submissions(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[SubmissionWithExercise]:
    """Get current user's submissions."""
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.exercise))
        .where(Submission.user_id == current_user.id)
        .order_by(Submission.created_at.desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    )
    return result.scalars().all()


@router.get(
    "/users/me/progress",
    summary="Get current user's progress",
    description="Get progress statistics for the current user.",
)
async def get_my_progress(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Get current user's progress statistics."""
    # Count total exercises
    total_result = await db.execute(select(Exercise.id))
    total_exercises = len(total_result.all())
    
    # Count completed exercises (passed submissions)
    completed_result = await db.execute(
        select(Submission.exercise_id)
        .where(Submission.user_id == current_user.id)
        .where(Submission.status == SubmissionStatus.PASSED)
        .distinct()
    )
    completed_exercises = len(completed_result.all())
    
    # Count total submissions
    submissions_result = await db.execute(
        select(Submission.id).where(Submission.user_id == current_user.id)
    )
    total_submissions = len(submissions_result.all())
    
    # Calculate total points
    points_result = await db.execute(
        select(Submission.score).where(
            Submission.user_id == current_user.id,
            Submission.status == SubmissionStatus.PASSED
        )
    )
    total_points = sum(score for (score,) in points_result.all() if score)
    
    # Get per-lesson progress
    lessons_result = await db.execute(
        select(Lesson).order_by(Lesson.order)
    )
    all_lessons = lessons_result.scalars().all()
    
    lesson_progress = []
    for lesson in all_lessons:
        # Count exercises in this lesson
        lesson_exercises_result = await db.execute(
            select(Exercise.id).where(Exercise.lesson_id == lesson.id)
        )
        lesson_exercise_ids = [e for (e,) in lesson_exercises_result.all()]
        lesson_total = len(lesson_exercise_ids)
        
        if lesson_total > 0:
            # Count completed exercises in this lesson
            completed_in_lesson_result = await db.execute(
                select(Submission.exercise_id)
                .where(Submission.user_id == current_user.id)
                .where(Submission.status == SubmissionStatus.PASSED)
                .where(Submission.exercise_id.in_(lesson_exercise_ids))
                .distinct()
            )
            completed_in_lesson = len(completed_in_lesson_result.all())
            
            lesson_progress.append({
                "lesson_id": lesson.id,
                "lesson_title": lesson.title,
                "total_exercises": lesson_total,
                "completed_exercises": completed_in_lesson,
                "progress": round(completed_in_lesson / lesson_total * 100, 1) if lesson_total > 0 else 0,
            })
    
    return {
        "total_exercises": total_exercises,
        "completed_exercises": completed_exercises,
        "progress_percentage": round(completed_exercises / total_exercises * 100, 1) if total_exercises > 0 else 0,
        "total_submissions": total_submissions,
        "total_points": total_points,
        "lessons": lesson_progress,
    }
