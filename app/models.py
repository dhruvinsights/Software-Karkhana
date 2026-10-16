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
    """A person with an enterprise role and identity."""

    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()


class Workspace(Base):
    """An organization workspace container."""

    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String)
    slug: Mapped[str] = mapped_column(String, unique=True)
    domain: Mapped[str | None] = mapped_column(String, nullable=True)
    plan: Mapped[str] = mapped_column(String, default="enterprise")
    security_posture: Mapped[str] = mapped_column(String, default="STANDARD")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class WorkspaceMember(Base):
    """Membership connecting users to workspaces with RBAC."""

    __tablename__ = "workspace_members"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[dt.datetime] = _now()


class Product(Base):
    """A product anchor containing projects and ideas."""

    __tablename__ = "products"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String)
    code: Mapped[str] = mapped_column(String)
    domain: Mapped[str] = mapped_column(String, default="Cloud Services")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="active")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class Idea(Base):
    """A feature idea under validation with AI feasibility radar."""

    __tablename__ = "ideas"
    id: Mapped[uuid.UUID] = _uuid_pk()
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String)
    problem_statement: Mapped[str] = mapped_column(Text)
    target_user: Mapped[str] = mapped_column(String, default="Enterprise Users")
    expected_value: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft")
    complexity: Mapped[str] = mapped_column(String, default="Medium")
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    assessment: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class IdeaApproval(Base):
    """One reviewer's decision on an idea (all assigned reviewers must approve)."""

    __tablename__ = "idea_approvals"
    id: Mapped[uuid.UUID] = _uuid_pk()
    idea_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ideas.id", ondelete="CASCADE"))
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String, default="pending")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Project(Base):
    """One project record, from idea onward."""

    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = _uuid_pk()
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String)
    idea_text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    stage: Mapped[str] = mapped_column(String, default="evaluate")
    stage_status: Mapped[str] = mapped_column(String, default="submitted")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    idea_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ideas.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WorkspaceInvite(Base):
    """An invitation token to join an enterprise workspace."""

    __tablename__ = "workspace_invites"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    inviter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, default="developer")
    token: Mapped[str] = mapped_column(String, unique=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[dt.datetime] = _now()
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    stations: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    is_lead: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectMember(Base):
    """Role and station permissions for users assigned to a project."""

    __tablename__ = "project_members"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String, default="developer")
    stations: Mapped[list[str]] = mapped_column(
        JSONB,
        default=lambda: ["product", "architecture", "developer", "qa", "devops", "security", "release"],
    )
    is_lead: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[dt.datetime] = _now()


class ProductDocument(Base):
    """An uploaded product brief or documentation file."""

    __tablename__ = "product_documents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    filename: Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String, default="text/plain")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    parsed_spec: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class ProductDocumentChunk(Base):
    """A semantic chunk of product documentation with a pgvector 768-d embedding."""

    __tablename__ = "product_document_chunks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_documents.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    chunk_text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class Evaluation(Base):
    """A validated, versioned AI evaluation of a project idea."""

    __tablename__ = "evaluations"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String)
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
    # Set once a review engine has produced a verdict, even with zero comments.
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    review_engine: Mapped[str | None] = mapped_column(String)
    review_model: Mapped[str | None] = mapped_column(String)
    review_summary: Mapped[str | None] = mapped_column(Text)


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
    embedding_model: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[dt.datetime] = _now()


class ContextEntry(Base):
    """A decision, note or handoff that people and agents both read. Insert-only."""

    __tablename__ = "context_entries"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    author_label: Mapped[str] = mapped_column(String)
    author_kind: Mapped[str] = mapped_column(String)
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"))
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


# ── Chat & Activity models ────────────────────────────────────────────────────

class ChatChannel(Base):
    """A #channel or DM thread scoped to a workspace."""

    __tablename__ = "chat_channels"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="channel")  # 'channel' | 'dm'
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class ChatChannelMember(Base):
    """DM thread participants (only for type='dm')."""

    __tablename__ = "chat_channel_members"
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class ChatMessage(Base):
    """A single message in a channel or DM thread."""

    __tablename__ = "chat_messages"
    id: Mapped[uuid.UUID] = _uuid_pk()
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_channels.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[Any]] = mapped_column(JSONB, default=list)  # list of user UUIDs
    edited_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class ChatReadCursor(Base):
    """Tracks the last message each user has seen per channel."""

    __tablename__ = "chat_read_cursors"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True)
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProjectComment(Base):
    """A threaded comment on a project, supporting @mentions."""

    __tablename__ = "project_comments"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    edited_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class ActivityEvent(Base):
    """Workspace activity feed: mentions, comments, PR events, approvals."""

    __tablename__ = "activity_events"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    type: Mapped[str] = mapped_column(String)  # mention|comment|review|approval|run_complete|pr_merged
    summary: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[str | None] = mapped_column(String, nullable=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = _now()


class Issue(Base):
    """An issue or bug raised on a project and assigned to whoever fixes it."""

    __tablename__ = "issues"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String, default="task")
    priority: Mapped[str] = mapped_column(String, default="P2")
    status: Mapped[str] = mapped_column(String, default="todo")
    source: Mapped[str] = mapped_column(String, default="manual")
    labels: Mapped[list[str]] = mapped_column(JSONB, default=list)
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    pr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pull_requests.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
