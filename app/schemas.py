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
"""Pydantic contracts: Gemini structured outputs and the public API.

Gemini is asked for these exact shapes with ``response_schema`` and the reply
is validated again here. Anything that fails validation never reaches the UI.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Gemini structured outputs
# ---------------------------------------------------------------------------


class StoryDraft(BaseModel):
    """A story under an epic."""

    title: str = Field(
        description="Short imperative title, e.g. 'Validate currency codes'."
    )
    acceptance_criteria: list[str] = Field(min_length=1, max_length=5)


class EpicDraft(BaseModel):
    """An epic that must be traceable to the idea text."""

    title: str
    description: str
    source_quote: str = Field(
        description="An exact, verbatim substring of the idea text that this epic comes from."
    )
    stories: list[StoryDraft] = Field(min_length=1, max_length=4)


class Gap(BaseModel):
    """Something the idea does not answer yet."""

    question: str
    why_it_matters: str


class MemoryCitation(BaseModel):
    """A reference to a verified learning that shaped the evaluation."""

    learning_id: str = Field(
        description="The id of a learning from the provided memory list."
    )
    how_it_applies: str


class DirectorReport(BaseModel):
    """What the director reads before the approval gate."""

    summary: str
    recommendation: Literal["approve", "revise", "reject"]
    key_risks: list[str] = Field(min_length=1, max_length=5)
    decision_requested: str


class EvaluationOutput(BaseModel):
    """The evaluator's full answer."""

    score: int = Field(ge=1, le=10, description="Potential, 1 to 10.")
    score_rationale: str
    summary: str
    gaps: list[Gap] = Field(min_length=1, max_length=6)
    epics: list[EpicDraft] = Field(min_length=3, max_length=5)
    director_report: DirectorReport
    memory_citations: list[MemoryCitation] = Field(default_factory=list)
    memory_note: str = Field(
        description="How memory was used, or exactly 'no relevant memory' if none applied."
    )


class ReviewCommentDraft(BaseModel):
    """One AI review comment."""

    path: str
    line: int | None = None
    severity: Literal["high", "medium", "low"]
    body: str


class ReviewOutput(BaseModel):
    """The ADK reviewer's answer: 3 to 5 comments."""

    comments: list[ReviewCommentDraft] = Field(min_length=3, max_length=5)


class LearningOutput(BaseModel):
    """A reusable lesson distilled from a merged PR and its triage."""

    text: str = Field(description="One or two sentences another team could act on.")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class ORM(BaseModel):
    """Base for models read from ORM rows."""

    model_config = ConfigDict(from_attributes=True)


class UserOut(ORM):
    """The signed-in user."""

    id: uuid.UUID
    email: str
    display_name: str
    role: str
    onboarded_at: dt.datetime | None = None


class ProjectCreate(BaseModel):
    """PM's idea submission."""

    name: str = Field(min_length=3, max_length=120)
    idea_text: str = Field(min_length=40, max_length=8000)


class ProjectOut(ORM):
    """A project summary."""

    id: uuid.UUID
    name: str
    idea_text: str
    stage: str
    stage_status: str
    created_at: dt.datetime


class CitationOut(BaseModel):
    """A memory citation enriched from the database, never from the model."""

    learning_id: uuid.UUID
    text: str
    source_project: str
    source_pr_url: str | None
    verified_by: str | None
    verified_at: dt.datetime | None
    how_it_applies: str


class EvaluationOut(BaseModel):
    """A stored evaluation."""

    id: uuid.UUID
    version: int
    model: str
    created_at: dt.datetime
    result: EvaluationOutput
    citations: list[CitationOut]


class Decision(BaseModel):
    """Director's decision on the evaluation gate."""

    decision: Literal["approved", "rejected"]
    reason: str | None = Field(default=None, max_length=2000)


class BatchDecision(BaseModel):
    """Director's batch multi-sig decision on multiple projects."""

    project_ids: list[uuid.UUID]
    decision: Literal["approved", "rejected"] = "approved"
    reason: str | None = Field(default=None, max_length=2000)


class BatchApprovalOut(BaseModel):
    """Result of batch gate decisions."""

    approved_count: int
    approvals: list[ApprovalOut]


class ApprovalOut(ORM):
    """A recorded gate decision."""

    id: uuid.UUID
    gate: str
    decision: str
    reason: str | None
    decided_at: dt.datetime


class TaskOut(ORM):
    """A card on the board."""

    id: uuid.UUID
    key: str
    epic_id: uuid.UUID
    title: str
    description: str
    acceptance_criteria: list[str]
    status: str


class EpicOut(ORM):
    """An epic with its source quote."""

    id: uuid.UUID
    title: str
    description: str
    source_quote: str
    position: int


class RunOut(ORM):
    """Run status, polled by the browser."""

    id: uuid.UUID
    task_id: uuid.UUID
    status: str
    phase: str | None
    backend: str
    branch: str | None
    test_command: str | None
    test_exit_code: int | None
    test_output: str | None
    validation_status: str
    error: str | None
    created_at: dt.datetime
    finished_at: dt.datetime | None


class CommentOut(ORM):
    """An AI review comment and its triage."""

    id: uuid.UUID
    path: str
    line: int | None
    severity: str
    body: str
    triage: str
    triage_reason: str | None


class PullRequestOut(ORM):
    """A PR with its comments."""

    id: uuid.UUID
    task_id: uuid.UUID
    number: int
    url: str
    branch: str
    status: str
    tests_passed: bool
    reviewed_at: dt.datetime | None = None
    review_engine: str | None = None
    review_model: str | None = None
    review_summary: str | None = None
    comments: list[CommentOut] = Field(default_factory=list)
    can_merge: bool = False
    merge_blockers: list[str] = Field(default_factory=list)


class TriageIn(BaseModel):
    """Developer's verdict on one AI comment."""

    triage: Literal["valid", "dismissed"]
    reason: str | None = Field(default=None, max_length=2000)


class LearningOut(ORM):
    """A captured learning."""

    id: uuid.UUID
    project_id: uuid.UUID
    text: str
    status: str
    source: dict
    verified_at: dt.datetime | None
    created_at: dt.datetime


class LedgerOut(ORM):
    """One ledger row as shown at the bottom of every screen."""

    seq: int
    actor_label: str
    actor_kind: str
    action: str
    subject_type: str
    subject_id: str
    payload: dict
    created_at: dt.datetime
    prev_hash: str
    hash: str


class ChainOut(BaseModel):
    """Chain verification result."""

    ok: bool
    entries: int
    head: str
    first_bad_seq: int | None
    reason: str | None


class StageOut(BaseModel):
    """One stage in the tracker."""

    id: str
    name: str
    phase: str
    owner: str
    gate: str
    wired: bool


# --- Worker callbacks (HMAC-authenticated, no user) -----------------------


class ContextIn(BaseModel):
    """A person adds shared context to a project."""

    kind: Literal["decision", "note", "handoff"] = "note"
    title: str = Field(min_length=3, max_length=140)
    body: str = Field(min_length=3, max_length=4000)


class ContextOut(ORM):
    """One shared-context entry."""

    id: uuid.UUID
    project_id: uuid.UUID
    kind: str
    title: str
    body: str
    author_label: str
    author_kind: str
    run_id: uuid.UUID | None = None
    created_at: dt.datetime


class ContextNote(BaseModel):
    """Context handed to the agent with its task."""

    kind: str
    title: str
    body: str
    author: str


class RunSpec(BaseModel):
    """What the worker needs to do one task."""

    run_id: uuid.UUID
    task_key: str
    task_title: str
    task_description: str
    acceptance_criteria: list[str]
    project_name: str
    repo: str | None
    repo_url: str | None
    base_branch: str
    context: list[ContextNote] = Field(default_factory=list)


class RunProgress(BaseModel):
    """Heartbeat from the worker."""

    phase: str


class RunResult(BaseModel):
    """Final report from the worker. Test fields come from the real run.

    The worker never publishes: no branch, PR or commit fields. The control
    plane derives those when it applies ``patch``.
    """

    ok: bool
    error: str | None = None
    patch: str | None = None
    test_command: str | None = None
    test_exit_code: int | None = None
    test_output: str | None = None
    review: list[ReviewCommentDraft] = Field(default_factory=list)
    # False when no engine produced a review; True with zero comments is a clean review.
    reviewed: bool = False
    review_engine: str | None = None
    review_model: str | None = None
    review_summary: str | None = None
    summary: str | None = None  # What the Coder says it did; becomes a handoff.
    artifacts_uri: str | None = None
