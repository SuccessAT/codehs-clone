"""Initial migration - create all tables

Revision ID: 001_initial
Revises: 
Create Date: 2026-02-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create user roles enum
    user_role_enum = postgresql.ENUM('student', 'teacher', name='userrole', create_type=False)
    user_role_enum.create(op.get_bind(), checkfirst=True)
    
    # Create submission status enum
    submission_status_enum = postgresql.ENUM('pending', 'passed', 'failed', name='submissionstatus', create_type=False)
    submission_status_enum.create(op.get_bind(), checkfirst=True)
    
    # Create sandbox status enum
    sandbox_status_enum = postgresql.ENUM('active', 'terminated', 'error', name='sandboxstatus', create_type=False)
    sandbox_status_enum.create(op.get_bind(), checkfirst=True)
    
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=50), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('role', user_role_enum, nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True),
        sa.Column('is_superuser', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
        sa.UniqueConstraint('email'),
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    
    # Create lessons table
    op.create_table(
        'lessons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('video_url', sa.String(length=500), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, default=0),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_lessons_id'), 'lessons', ['id'], unique=False)
    
    # Create exercises table
    op.create_table(
        'exercises',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lesson_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('starter_code', sa.Text(), nullable=True),
        sa.Column('language', sa.String(length=50), nullable=False, default='python'),
        sa.Column('test_cases', sa.JSON(), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, default=0),
        sa.Column('points', sa.Integer(), nullable=False, default=10),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['lesson_id'], ['lessons.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_exercises_id'), 'exercises', ['id'], unique=False)
    op.create_index(op.f('ix_exercises_lesson_id'), 'exercises', ['lesson_id'], unique=False)
    
    # Create submissions table
    op.create_table(
        'submissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('exercise_id', sa.Integer(), nullable=False),
        sa.Column('code', sa.Text(), nullable=False),
        sa.Column('status', submission_status_enum, nullable=False, default='pending'),
        sa.Column('output', sa.Text(), nullable=True),
        sa.Column('error_output', sa.Text(), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('test_results', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_submissions_id'), 'submissions', ['id'], unique=False)
    op.create_index(op.f('ix_submissions_user_id'), 'submissions', ['user_id'], unique=False)
    op.create_index(op.f('ix_submissions_exercise_id'), 'submissions', ['exercise_id'], unique=False)
    op.create_index(op.f('ix_submissions_created_at'), 'submissions', ['created_at'], unique=False)
    
    # Create sandbox_sessions table
    op.create_table(
        'sandbox_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('sandbox_id', sa.String(length=100), nullable=False),
        sa.Column('status', sandbox_status_enum, nullable=False, default='active'),
        sa.Column('language', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('terminated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_sandbox_sessions_id'), 'sandbox_sessions', ['id'], unique=False)
    op.create_index(op.f('ix_sandbox_sessions_user_id'), 'sandbox_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_sandbox_sessions_sandbox_id'), 'sandbox_sessions', ['sandbox_id'], unique=False)
    op.create_index(op.f('ix_sandbox_sessions_created_at'), 'sandbox_sessions', ['created_at'], unique=False)


def downgrade() -> None:
    # Drop sandbox_sessions table
    op.drop_index(op.f('ix_sandbox_sessions_created_at'), table_name='sandbox_sessions')
    op.drop_index(op.f('ix_sandbox_sessions_sandbox_id'), table_name='sandbox_sessions')
    op.drop_index(op.f('ix_sandbox_sessions_user_id'), table_name='sandbox_sessions')
    op.drop_index(op.f('ix_sandbox_sessions_id'), table_name='sandbox_sessions')
    op.drop_table('sandbox_sessions')
    
    # Drop submissions table
    op.drop_index(op.f('ix_submissions_created_at'), table_name='submissions')
    op.drop_index(op.f('ix_submissions_exercise_id'), table_name='submissions')
    op.drop_index(op.f('ix_submissions_user_id'), table_name='submissions')
    op.drop_index(op.f('ix_submissions_id'), table_name='submissions')
    op.drop_table('submissions')
    
    # Drop exercises table
    op.drop_index(op.f('ix_exercises_lesson_id'), table_name='exercises')
    op.drop_index(op.f('ix_exercises_id'), table_name='exercises')
    op.drop_table('exercises')
    
    # Drop lessons table
    op.drop_index(op.f('ix_lessons_id'), table_name='lessons')
    op.drop_table('lessons')
    
    # Drop users table
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_table('users')
    
    # Drop enums
    op.execute('DROP TYPE IF EXISTS sandboxstatus')
    op.execute('DROP TYPE IF EXISTS submissionstatus')
    op.execute('DROP TYPE IF EXISTS userrole')
