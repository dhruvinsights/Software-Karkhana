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
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
)
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
    # owner | admin | reviewer | guide | member: what they may do, independent of their title.
    access: Mapped[str] = mapped_column(String, default="member")
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
    # Setup details: problemStatement, targetUsers, techStack, repositoryUrl,
    # keyFeatures, constraints, teamSpaces (station ids used by its projects).
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class IdeaScan(Base):
    """A codebase scan job running multi-agent analysis on a product repository."""

    __tablename__ = "idea_scans"
    id: Mapped[uuid.UUID] = _uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String, default="running")  # running | done | failed
    provider: Mapped[str] = mapped_column(String, default="ollama")
    model: Mapped[str] = mapped_column(String)
    repo_url: Mapped[str] = mapped_column(String)
    started_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RepoSnapshot(Base):
    """A product's repository at one commit, packed by repomix (migration 027)."""

    __tablename__ = "repo_snapshots"
    id: Mapped[uuid.UUID] = _uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    repo_url: Mapped[str] = mapped_column(String)
    commit_sha: Mapped[str] = mapped_column(String)
    tree: Mapped[str] = mapped_column(Text)
    files: Mapped[dict[str, str]] = mapped_column(JSONB)
    paths: Mapped[list[str]] = mapped_column(JSONB, default=list)  # git ls-files (031)
    file_count: Mapped[int] = mapped_column(Integer)
    chars: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = _now()


class Idea(Base):
    """A feature idea under validation with AI feasibility radar and reviewer approval."""

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
    source: Mapped[str] = mapped_column(String, default="manual")  # manual | agent
    scan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("idea_scans.id", ondelete="SET NULL"), nullable=True)
    evidence: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    review_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # "feature" (lands in an existing project) or "project" (groups related features).
    scope: Mapped[str] = mapped_column(String, default="feature")
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ideas.id", ondelete="SET NULL"), nullable=True
    )
    delivery: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
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


class IdeaChat(Base):
    """Multi-turn brainstorm chat session attached to a product or idea."""

    __tablename__ = "idea_chats"
    id: Mapped[uuid.UUID] = _uuid_pk()
    idea_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ideas.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String, default="ollama")
    model: Mapped[str] = mapped_column(String)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class IdeaChatMessage(Base):
    """One message in an IdeaChat."""

    __tablename__ = "idea_chat_messages"
    id: Mapped[uuid.UUID] = _uuid_pk()
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("idea_chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String)  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    thinking: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = _now()


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
    # Progress of the PRD/ERD/backlog drafting job (migration 028).
    docs_status: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProjectDocument(Base):
    """A versioned PRD, ERD or design spec: drafted by AI, approved by people (028)."""

    __tablename__ = "project_documents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)  # prd | erd | design
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft | approved
    model: Mapped[str] = mapped_column(String)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


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
    # False: every station of the project. True: only ``stations`` (set by a PM
    # or the project lead to narrow someone's access). Migration 038.
    limited: Mapped[bool] = mapped_column(Boolean, default=False)
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
    # Unit, integration, ... each with its state and counts (migration 033).
    test_suites: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    error: Mapped[str | None] = mapped_column(Text)
    artifacts_uri: Mapped[str | None] = mapped_column(String)
    # Headroom token accounting reported by the worker (migration 015).
    context_compression: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


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
    # [{"userId", "name", "by", "at"}]: people asked to review (migration 034).
    requested_reviewers: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
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
    # Tenant chain (migration 014): "<workspace id>", "platform" or "legacy".
    # No FK on workspace_id: evidence outlives the workspace it describes.
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    chain: Mapped[str] = mapped_column(String, default="legacy")
    chain_seq: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
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
    # 'public': every workspace member; 'private': chat_channel_members only.
    visibility: Mapped[str] = mapped_column(String, default="public")
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    # The project station (team space) the channel belongs to (migration 036).
    station: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class ChatChannelMember(Base):
    """Participants of DMs and private channels."""

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


class ChatAttachment(Base):
    """A file, image or voice message sent in chat (migration 024)."""

    __tablename__ = "chat_attachments"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_channels.id", ondelete="CASCADE"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True)
    uploader_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    filename: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)  # 'image' | 'audio' | 'file'
    size_bytes: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    created_at: Mapped[dt.datetime] = _now()


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
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), nullable=True)
    epic_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("epics.id", ondelete="SET NULL"), nullable=True)
    acceptance_criteria: Mapped[list[str]] = mapped_column(JSONB, default=list)
    source_quote: Mapped[str] = mapped_column(Text, default="")
    estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The developer's manual check (story) or fix confirmation (bug); migration 034.
    dev_check: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)
    # The QA agent's last run on this story (migration 035).
    qa_agent: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GitHubToken(Base):
    """A user's GitHub OAuth token, encrypted at rest (migrations 009, 013).

    ``token`` is ciphertext from :mod:`app.crypto`; read and write it only via
    :mod:`app.integrations.github_tokens`.
    """

    __tablename__ = "github_tokens"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    token: Mapped[str] = mapped_column(Text)
    scopes: Mapped[str] = mapped_column(Text, default="repo,read:org")
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


# ── Lifecycle stations (016_stations.sql) ─────────────────────────────────────
from sqlalchemy import Date, Numeric  # noqa: E402 - appended block, kept self-contained


class Adr(Base):
    """An architecture decision record on a project."""

    __tablename__ = "adrs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="proposed")
    context: Mapped[str] = mapped_column(Text, default="")
    decision: Mapped[str] = mapped_column(Text, default="")
    rationale: Mapped[str] = mapped_column(Text, default="")
    consequences: Mapped[list[str]] = mapped_column(JSONB, default=list)
    affected_components: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


class TestScenario(Base):
    """A QA test scenario and its latest execution result."""

    __test__ = False  # not a pytest class
    __tablename__ = "test_scenarios"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    issue_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("issues.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="Functional")
    priority: Mapped[str] = mapped_column(String, default="P1")
    steps: Mapped[list[str]] = mapped_column(JSONB, default=list)
    expected_result: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="not_run")
    actual_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    automation_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


class SecurityFinding(Base):
    """A security finding (CVE/CWE) tracked to remediation or waiver."""

    __tablename__ = "security_findings"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String)
    cve_id: Mapped[str | None] = mapped_column(String, nullable=True)
    cwe_category: Mapped[str] = mapped_column(String, default="")
    severity: Mapped[str] = mapped_column(String, default="MEDIUM")
    cvss_score: Mapped[float] = mapped_column(Numeric(3, 1, asdecimal=False), default=0)
    status: Mapped[str] = mapped_column(String, default="open")
    affected_component: Mapped[str] = mapped_column(String, default="")
    remediation_advice: Mapped[str] = mapped_column(Text, default="")
    sla_deadline: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()

class RagDocument(Base):
    """A document in a workspace's RAG knowledge base (migration 015)."""

    __tablename__ = "rag_documents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    content_chars: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = _now()


class RagChunk(Base):
    """One embedded chunk of a RAG document; carries its workspace for SQL filtering."""

    __tablename__ = "rag_chunks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    chunk_text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768))
    embedding_model: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[dt.datetime] = _now()


class RagChatMessage(Base):
    """A RAG chat turn, private to one user in one workspace."""

    __tablename__ = "rag_chat_messages"
    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )


class AgentDevice(Base):
    """A developer machine running karkhana-agent (029). Secrets are stored hashed."""

    __tablename__ = "agent_devices"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    platform: Mapped[str] = mapped_column(String, default="")
    harness: Mapped[str] = mapped_column(String, default="")
    token_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    pairing_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    pairing_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | active | revoked
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()


class AgentJob(Base):
    """One agent execution; for builds on a machine, tied to the run it executes (026, 029)."""

    __tablename__ = "agent_jobs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    issue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("issues.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String)
    engine: Mapped[str] = mapped_column(String, default="bob")
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    instruction: Mapped[str] = mapped_column(Text, default="")
    output: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sandbox: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_devices.id", ondelete="SET NULL"), nullable=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentJobLog(Base):
    """One line of an agent job's live log (026). Append-only."""

    __tablename__ = "agent_job_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent_jobs.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    level: Mapped[str] = mapped_column(String, default="info")  # info | thinking | output | error
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()


class Release(Base):
    """A release record: what ships, its evidence, and who approved it (030)."""

    __tablename__ = "releases"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    version: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft | published
    manifest: Mapped[dict[str, Any]] = mapped_column(JSONB)
    blockers: Mapped[list[str]] = mapped_column(JSONB, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    commit_sha: Mapped[str] = mapped_column(String, default="")
    release_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QaSuggestion(Base):
    """A bug the QA agent suggests; a QA engineer accepts or dismisses it."""

    __tablename__ = "qa_suggestions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    issue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String, default="functional")
    severity: Mapped[str] = mapped_column(String, default="P2")
    steps: Mapped[list[str]] = mapped_column(JSONB, default=list)
    expected: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String, default="open")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    bug_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("issues.id", ondelete="SET NULL"), nullable=True)
    model: Mapped[str] = mapped_column(String, default="")
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _now()
