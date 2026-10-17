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
"""Process engine: the 15 lifecycle stages and the only legal transitions.

Every stage change goes through :func:`advance`. The table is data, not
scattered ``if`` statements, so the API, the tests and the stage tracker all
read the same rules. A transition that is not in the table is refused, even if
a caller tries to set the stage directly.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.models import Project, Task


class Role(enum.StrEnum):
    """Server-side roles."""

    PM = "pm"
    PRODUCT_MANAGER = "product_manager"
    DIRECTOR = "director"
    EXECUTIVE = "executive"
    DEVELOPER = "developer"
    LEAD = "lead"
    DESIGNER = "designer"
    ARCHITECT = "architect"
    QA = "qa"
    SECURITY = "security"
    DEVOPS = "devops"
    RELEASE_MANAGER = "release_manager"
    SUPPORT = "support"
    ADMIN = "admin"


@dataclass(frozen=True)
class Stage:
    """One lifecycle stage from the Karkhana blueprint."""

    id: str
    name: str
    phase: str
    owner: str
    gate: str
    wired: bool  # Implemented in this build. Others show as "Planned".


STAGES: tuple[Stage, ...] = (
    Stage(
        "evaluate",
        "Initiate and evaluate",
        "Plan",
        "Project manager",
        "Director approval",
        True,
    ),
    Stage(
        "onboard",
        "Onboard the team",
        "Plan",
        "Project manager",
        "Required roles filled",
        False,
    ),
    Stage(
        "design",
        "Design and prototype",
        "Plan",
        "Designer",
        "PM and designer approval",
        False,
    ),
    Stage(
        "architecture",
        "Architecture and technical plan",
        "Plan",
        "Architect",
        "Architect sign-off",
        False,
    ),
    Stage(
        "plan", "Plan the work", "Plan", "Tech lead, PM", "Definition of ready", True
    ),
    Stage(
        "env",
        "Prepare the dev environment",
        "Build",
        "Platform",
        "Config pack approved",
        False,
    ),
    Stage(
        "implement",
        "Implement",
        "Build",
        "Developers and agents",
        "Ready for validation",
        True,
    ),
    Stage(
        "validate", "Validate", "Build", "Platform", "Validation report attached", True
    ),
    Stage("pr", "Branch and pull request", "Build", "Developer", "PR opened", True),
    Stage(
        "review",
        "Review and merge",
        "Build",
        "Developer, reviewers",
        "All AI comments triaged",
        True,
    ),
    Stage("qa", "QA and QC", "Verify", "QA engineers", "QA checklist complete", False),
    Stage(
        "security",
        "Security and pen-testing",
        "Verify",
        "Security team",
        "Security sign-off",
        False,
    ),
    Stage(
        "cicd",
        "CI/CD and deployment prep",
        "Ship",
        "DevOps",
        "Deployment readiness",
        False,
    ),
    Stage(
        "release",
        "Release and production",
        "Ship",
        "Release team",
        "Release approval",
        False,
    ),
    Stage("feedback", "Feedback and learning", "Learn", "Everyone", "Continuous", True),
)
STAGE_INDEX = {s.id: i for i, s in enumerate(STAGES)}


class Event(enum.StrEnum):
    """Things that move a project."""

    EVALUATED = "evaluated"
    APPROVE = "approve"
    REJECT = "reject"
    RESUBMIT = "resubmit"
    RUN_STARTED = "run_started"
    RUN_FAILED = "run_failed"
    PR_OPENED = "pr_opened"
    REVIEW_POSTED = "review_posted"
    MERGED = "merged"
    PLAN_APPROVED = "plan_approved"


SYSTEM_ONLY: frozenset[Role] = frozenset()  # Only the platform may trigger.

# (stage, status, event) -> (new stage, new status, roles allowed to trigger).
# An empty role set means the platform itself (evaluator, worker callback).
_BUILD_STAGES = ("plan", "implement", "pr", "review", "qa")
TRANSITIONS: dict[tuple[str, str, Event], tuple[str, str, frozenset[Role]]] = {
    ("evaluate", "submitted", Event.EVALUATED): ("evaluate", "evaluated", SYSTEM_ONLY),
    ("evaluate", "evaluated", Event.EVALUATED): ("evaluate", "evaluated", SYSTEM_ONLY),
    ("evaluate", "evaluated", Event.APPROVE): (
        "plan",
        "ready",
        frozenset({Role.DIRECTOR}),
    ),
    ("evaluate", "evaluated", Event.REJECT): (
        "evaluate",
        "rejected",
        frozenset({Role.DIRECTOR}),
    ),
    # A project born from an idea that its reviewers already approved: the
    # plan approval by the PM or lead is the gate into planning.
    ("evaluate", "evaluated", Event.PLAN_APPROVED): (
        "plan",
        "ready",
        frozenset({Role.PM, Role.PRODUCT_MANAGER, Role.LEAD, Role.DIRECTOR, Role.EXECUTIVE}),
    ),
    ("evaluate", "rejected", Event.RESUBMIT): (
        "evaluate",
        "submitted",
        frozenset({Role.PM}),
    ),
    **{
        (stage, status, Event.RUN_STARTED): (
            "implement",
            "running",
            frozenset({Role.DEVELOPER, Role.LEAD}),
        )
        for stage, status in [
            ("plan", "ready"),
            ("implement", "failed"),
            ("implement", "running"),
            ("pr", "open"),
            ("review", "triage"),
            ("qa", "pending"),
        ]
    },
    ("implement", "running", Event.RUN_FAILED): ("implement", "failed", SYSTEM_ONLY),
    # Concurrent tasks: another run's outcome arriving after the project moved
    # on is an explicit, recorded transition, not a silently dropped event.
    ("pr", "open", Event.RUN_FAILED): ("pr", "open", SYSTEM_ONLY),
    ("review", "triage", Event.RUN_FAILED): ("review", "triage", SYSTEM_ONLY),
    ("qa", "pending", Event.RUN_FAILED): ("qa", "pending", SYSTEM_ONLY),
    ("implement", "failed", Event.PR_OPENED): ("pr", "open", SYSTEM_ONLY),
    ("pr", "open", Event.PR_OPENED): ("pr", "open", SYSTEM_ONLY),
    ("review", "triage", Event.PR_OPENED): ("review", "triage", SYSTEM_ONLY),
    ("qa", "pending", Event.PR_OPENED): ("pr", "open", SYSTEM_ONLY),
    ("review", "triage", Event.REVIEW_POSTED): ("review", "triage", SYSTEM_ONLY),
    ("implement", "running", Event.PR_OPENED): ("pr", "open", SYSTEM_ONLY),
    ("pr", "open", Event.REVIEW_POSTED): ("review", "triage", SYSTEM_ONLY),
    ("review", "triage", Event.MERGED): (
        "qa",
        "pending",
        frozenset({Role.DEVELOPER, Role.LEAD}),
    ),
}


class TransitionError(Exception):
    """Raised when the table does not allow a move."""


class ForbiddenTransition(TransitionError):
    """Raised when the move exists but the caller's role may not make it."""


def check(project: Project, event: Event, role: Role | None) -> tuple[str, str]:
    """Validates a transition without applying it.

    Args:
        project: The project to move.
        event: What happened.
        role: The caller's role, or ``None`` when the platform is the caller.

    Returns:
        The new ``(stage, status)``.

    Raises:
        TransitionError: The move is not in the table.
        ForbiddenTransition: The caller's role may not make the move.
    """
    key = (project.stage, project.stage_status, event)
    if key not in TRANSITIONS:
        raise TransitionError(
            f"'{event}' is not allowed while the project is {project.stage}/{project.stage_status}"
        )
    new_stage, new_status, roles = TRANSITIONS[key]
    if role is None:
        return new_stage, new_status
    if not roles or role not in roles:
        raise ForbiddenTransition(f"role '{role}' may not trigger '{event}'")
    return new_stage, new_status


async def advance(
    session: AsyncSession,
    project: Project,
    event: Event,
    *,
    actor: ledger.Actor,
    role: Role | None,
    payload: dict | None = None,
) -> Project:
    """Applies a legal transition and records it in the ledger."""
    from_stage, from_status = project.stage, project.stage_status
    new_stage, new_status = check(project, event, role)
    project.stage, project.stage_status = new_stage, new_status
    # Planned stages the project passes over are recorded, not hidden.
    skipped = [
        s.id
        for s in STAGES[STAGE_INDEX[from_stage] + 1 : STAGE_INDEX[new_stage]]
        if not s.wired
    ]
    await ledger.append(
        session,
        actor=actor,
        action=f"stage.{event}",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={
            "from": f"{from_stage}/{from_status}",
            "to": f"{new_stage}/{new_status}",
            **({"skipped_planned_stages": skipped} if skipped else {}),
            **(payload or {}),
        },
    )
    return project


# Task board: legal status moves.
TASK_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"ready", "backlog"}),  # Director approval, or plan approval.
    "backlog": frozenset({"ready"}),
    "ready": frozenset({"in_progress", "backlog"}),
    "in_progress": frozenset({"review", "ready"}),
    "review": frozenset({"done", "in_progress"}),
    "done": frozenset(),
}


def move_task(task: Task, new_status: str) -> None:
    """Moves a task along the board or raises :class:`TransitionError`."""
    if new_status not in TASK_TRANSITIONS.get(task.status, frozenset()):
        raise TransitionError(
            f"task {task.key} cannot move {task.status} -> {new_status}"
        )
    task.status = new_status
