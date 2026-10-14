# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""ORM mappings. The SQL in db/migrations is the source of truth."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    """Declarative base."""


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[dt.datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    """A person with exactly one server-side role."""

    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    created_at: Mapped[dt.datetime] = _now()


class Project(Base):
    """One project record, from idea onward."""

    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String)
    idea_text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    stage: Mapped[str] = mapped_column(String, default="evaluate")
    stage_status: Mapped[str] = mapped_column(String, default="submitted")
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Evaluation(Base):
    """A validated, versioned AI evaluation of a project idea."""

    __tablename__ = "evaluations"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String)
    served_from_cache: Mapped[bool] = mapped_column(Boolean, default=False)
    memory_used: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[dt.datetime] = _now()


class Approval(Base):
    """A gate decision. Insert-only."""

    __tablename__ = "approvals"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    gate: Mapped[str] = mapped_column(String)
    decision: Mapped[str] = mapped_column(String)
    reason: Mapped[str | None] = mapped_column(Text)
    decided_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[dt.datetime] = _now()


class Epic(Base):
    """An epic, always traceable to a quote from the idea text."""

    __tablename__ = "epics"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    source_quote: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)


class Task(Base):
    """A story on the board."""

    __tablename__ = "tasks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    epic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("epics.id"))
    key: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    acceptance_criteria: Mapped[list[str]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String, default="draft")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()


class Run(Base):
    """One agent execution, owned by the control plane (ADR-001)."""

    __tablename__ = "runs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"))
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String, default="code")
    backend: Mapped[str] = mapped_column(String)
    env_class: Mapped[str] = mapped_column(String, default="standard")
    status: Mapped[str] = mapped_column(String, default="queued")
    external_id: Mapped[str | None] = mapped_column(String)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    phase: Mapped[str | None] = mapped_column(String)
    branch: Mapped[str | None] = mapped_column(String)
    patch: Mapped[str | None] = mapped_column(Text)
    test_command: Mapped[str | None] = mapped_column(String)
    test_exit_code: Mapped[int | None] = mapped_column(Integer)
    test_output: Mapped[str | None] = mapped_column(Text)
    validation_status: Mapped[str] = mapped_column(String, default="not_run")
    error: Mapped[str | None] = mapped_column(Text)
    artifacts_uri: Mapped[str | None] = mapped_column(String)


class PullRequest(Base):
    """A real GitHub pull request opened by a run."""

    __tablename__ = "pull_requests"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), unique=True)
    number: Mapped[int] = mapped_column(Integer)
    url: Mapped[str] = mapped_column(String)
    branch: Mapped[str] = mapped_column(String)
    head_sha: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="open")
    tests_passed: Mapped[bool] = mapped_column(Boolean)
    merged_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    merged_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewComment(Base):
    """An AI review comment awaiting human triage."""

    __tablename__ = "review_comments"
    id: Mapped[uuid.UUID] = _uuid_pk()
    pr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pull_requests.id"))
    path: Mapped[str] = mapped_column(String)
    line: Mapped[int | None] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    triage: Mapped[str] = mapped_column(String, default="open")
    triage_reason: Mapped[str | None] = mapped_column(Text)
    triaged_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    triaged_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Learning(Base):
    """A learning captured on merge; reusable only after human verification."""

    __tablename__ = "learnings"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    pr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pull_requests.id"))
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String, default="unverified")
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768))
    created_at: Mapped[dt.datetime] = _now()


class LedgerEntry(Base):
    """One link in the evidence hash chain."""

    __tablename__ = "ledger"
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_label: Mapped[str] = mapped_column(String)
    actor_kind: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    subject_type: Mapped[str] = mapped_column(String)
    subject_id: Mapped[str] = mapped_column(String)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    prev_hash: Mapped[str] = mapped_column(String)
    hash: Mapped[str] = mapped_column(String, unique=True)
