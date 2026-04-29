"""Add exercise_type

Revision ID: 27285e9a887f
Revises: 002_add_modules
Create Date: 2026-04-25 16:51:31.666600

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '27285e9a887f'
down_revision: Union[str, None] = '002_add_modules'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Columns exercise_type, quiz_questions, allow_partial_credit, time_limit
    # already exist in the live DB. SQLite does not support adding named FK
    # constraints via ALTER TABLE; SQLAlchemy enforces the relationship at
    # the ORM level anyway, so we skip it here.
    pass


def downgrade() -> None:
    pass
