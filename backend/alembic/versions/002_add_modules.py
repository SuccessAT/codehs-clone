"""Add new Module model and update Lesson

Revision ID: 002_add_modules
Revises: 001_initial
Create Date: 2026-02-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002_add_modules'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if modules table already exists
    conn = op.get_bind()
    result = conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name='modules'"))
    modules_table_exists = result.fetchone() is not None
    
    if not modules_table_exists:
        # Create new modules table
        op.create_table(
            'modules',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('course_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('order', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_modules_id'), 'modules', ['id'])
        op.create_index(op.f('ix_modules_course_id'), 'modules', ['course_id'])
    else:
        # Table exists, just add index if not exists
        try:
            op.create_index(op.f('ix_modules_course_id'), 'modules', ['course_id'])
        except:
            pass  # Index might already exist

    # Add new columns to lessons table (if they don't exist)
    try:
        op.add_column('lessons', sa.Column('module_id', sa.Integer(), nullable=True))
    except:
        pass  # Column might already exist
        
    try:
        op.add_column('lessons', sa.Column('lesson_type', sa.String(length=50), nullable=False, server_default='text'))
    except:
        pass
        
    try:
        op.add_column('lessons', sa.Column('content', sa.Text(), nullable=True))
    except:
        pass
        
    try:
        op.add_column('lessons', sa.Column('media_url', sa.String(length=500), nullable=True))
    except:
        pass
        
    try:
        op.add_column('lessons', sa.Column('starter_code', sa.Text(), nullable=True))
    except:
        pass
        
    try:
        op.add_column('lessons', sa.Column('language', sa.String(length=50), nullable=True))
    except:
        pass

    # Create index on module_id (if not exists)
    try:
        op.create_index(op.f('ix_lessons_module_id'), 'lessons', ['module_id'])
    except:
        pass

    # Add foreign key constraint for module_id (if not exists)
    try:
        op.create_foreign_key(
            'fk_lessons_modules',
            'lessons', 'modules',
            ['module_id'], ['id'],
            ondelete='CASCADE'
        )
    except:
        pass


def downgrade() -> None:
    # This would be dangerous in production, but for development:
    # Remove foreign key and index
    try:
        op.drop_constraint('fk_lessons_modules', 'lessons', type_='foreignkey')
    except:
        pass
        
    try:
        op.drop_index(op.f('ix_lessons_module_id'), table_name='lessons')
    except:
        pass

    # Remove new columns from lessons
    try:
        op.drop_column('lessons', 'language')
    except:
        pass
    try:
        op.drop_column('lessons', 'starter_code')
    except:
        pass
    try:
        op.drop_column('lessons', 'media_url')
    except:
        pass
    try:
        op.drop_column('lessons', 'content')
    except:
        pass
    try:
        op.drop_column('lessons', 'lesson_type')
    except:
        pass
    try:
        op.drop_column('lessons', 'module_id')
    except:
        pass

    # Drop modules table
    try:
        op.drop_index(op.f('ix_modules_course_id'), table_name='modules')
    except:
        pass
    try:
        op.drop_index(op.f('ix_modules_id'), table_name='modules')
    except:
        pass
    try:
        op.drop_table('modules')
    except:
        pass
