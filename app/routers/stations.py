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

"""Lifecycle stations backed by the server: ADRs, QA scenarios, security findings.

Each record belongs to one project (and, denormalised, its workspace). Reading
or writing needs access to the project *and* its station (architecture, qa,
security). Every create, edit and status change is written to the ledger in
the same transaction as the change itself.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, issue_rules, ledger
from app.auth import CurrentUser
from app.models import Adr, Issue, Project, SecurityFinding, TestScenario, User
from app.services import qa_gate

router = APIRouter(tags=["stations"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

AdrStatus = Literal["proposed", "accepted", "rejected", "superseded"]
ScenarioType = Literal["Functional", "Boundary", "Security / Negative", "Performance / Load", "Accessibility"]
ScenarioPriority = Literal["P0", "P1", "P2"]
ScenarioStatus = Literal["not_run", "passed", "failed", "blocked"]
Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
FindingStatus = Literal["open", "in_remediation", "verified_fixed", "waived"]

Short = Annotated[str, Field(max_length=200)]
Long = Annotated[str, Field(max_length=8000)]


# ── Schemas ──────────────────────────────────────────────────────────────────


class AdrIn(BaseModel):
    """A new architecture decision record."""

    title: str = Field(min_length=3, max_length=200)
    status: AdrStatus = "proposed"
    context: Long = ""
    decision: Long = ""
    rationale: Long = ""
    consequences: list[Short] = Field(default_factory=list, max_length=30)
    affected_components: list[Short] = Field(default_factory=list, max_length=30)


class AdrPatch(BaseModel):
    """Fields to change on an ADR; omitted fields stay as they are."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    status: AdrStatus | None = None
    context: Long | None = None
    decision: Long | None = None
    rationale: Long | None = None
    consequences: list[Short] | None = Field(default=None, max_length=30)
    affected_components: list[Short] | None = Field(default=None, max_length=30)


class ScenarioIn(BaseModel):
    """A new QA test scenario."""

    title: str = Field(min_length=3, max_length=200)
    type: ScenarioType = "Functional"
    priority: ScenarioPriority = "P1"
    steps: list[Annotated[str, Field(max_length=1000)]] = Field(default_factory=list, max_length=50)
    expected_result: Long = ""
    automation_script: Annotated[str, Field(max_length=20000)] | None = None
    issue_id: uuid.UUID | None = None


class ScenarioPatch(BaseModel):
    """Fields to change on a scenario, including a run result."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    type: ScenarioType | None = None
    priority: ScenarioPriority | None = None
    steps: list[Annotated[str, Field(max_length=1000)]] | None = Field(default=None, max_length=50)
    expected_result: Long | None = None
    automation_script: Annotated[str, Field(max_length=20000)] | None = None
    status: ScenarioStatus | None = None
    actual_result: Long | None = None
    evidence_uri: Annotated[str, Field(max_length=2000)] | None = None


class FindingIn(BaseModel):
    """A new security finding."""

    title: str = Field(min_length=3, max_length=200)
    cve_id: Annotated[str, Field(max_length=40)] | None = None
    cwe_category: Short = ""
    severity: Severity = "MEDIUM"
    cvss_score: float = Field(default=0, ge=0, le=10)
    affected_component: Short = ""
    remediation_advice: Long = ""
    sla_deadline: dt.date | None = None


class FindingPatch(BaseModel):
    """Fields to change on a finding; ``reason`` explains a status change."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    cve_id: Annotated[str, Field(max_length=40)] | None = None
    cwe_category: Short | None = None
    severity: Severity | None = None
    cvss_score: float | None = Field(default=None, ge=0, le=10)
    affected_component: Short | None = None
    remediation_advice: Long | None = None
    sla_deadline: dt.date | None = None
    status: FindingStatus | None = None
    reason: Annotated[str, Field(max_length=2000)] | None = None


# ── Shared helpers ───────────────────────────────────────────────────────────


async def _project_for(
    session: AsyncSession, user: User, project_id: uuid.UUID, station: str
) -> Project:
    """The project, if the caller may see it and use ``station`` on it (else 403/404)."""
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, station)
    return project


async def _record_for(session: AsyncSession, model: Any, record_id: uuid.UUID, label: str) -> Any:
    row = await session.scalar(select(model).where(model.id == record_id).with_for_update())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found.")
    return row


def _apply(
    row: Any, patch: BaseModel, fields: tuple[str, ...], nullable: tuple[str, ...] = ()
) -> dict[str, Any]:
    """Copies the fields the client actually sent; returns what changed.

    ``null`` clears a field only where the column allows it (``nullable``);
    elsewhere it is ignored.
    """
    changes: dict[str, Any] = {}
    for field in fields:
        if field not in patch.model_fields_set:
            continue
        value = getattr(patch, field)
        if value is None and field not in nullable:
            continue
        if field == "title":
            value = value.strip()
        if value != getattr(row, field):
            changes[field] = value
            setattr(row, field, value)
    return changes


async def _names(session: AsyncSession, rows: list[Any]) -> dict[uuid.UUID, str]:
    ids = {r.created_by for r in rows}
    if not ids:
        return {}
    users = (await session.scalars(select(User).where(User.id.in_(ids)))).all()
    return {u.id: u.display_name for u in users}


async def _log(
    session: AsyncSession,
    user: User,
    *,
    kind: str,
    created: bool,
    row: Any,
    changes: dict[str, Any],
    extra: dict[str, Any] | None = None,
    status_fields: frozenset[str] = frozenset({"status"}),
) -> None:
    """Writes the ledger event: ``created``, ``status_changed`` or ``updated``.

    A change counts as a status change when it touches ``status`` and nothing
    beyond ``status_fields`` (e.g. a QA result together with its evidence).
    """
    if created:
        action = f"{kind}.created"
    elif "status" in changes and set(changes) <= status_fields:
        action = f"{kind}.status_changed"
    else:
        action = f"{kind}.updated"
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action=action,
        subject_type=kind,
        subject_id=row.id,
        project_id=row.project_id,
        payload=json_safe({**(extra or {}), **changes}),
    )


def json_safe(payload: dict[str, Any]) -> dict[str, Any]:
    """Dates become ISO strings so the ledger payload hashes deterministically."""
    return {k: (v.isoformat() if isinstance(v, dt.date) else v) for k, v in payload.items()}


def _stamp(row: Any) -> None:
    row.updated_at = dt.datetime.now(dt.UTC)


def _iso(value: dt.datetime | dt.date | None) -> str | None:
    return value.isoformat() if value else None


# ── Architecture decision records ────────────────────────────────────────────

ADR_FIELDS = ("title", "status", "context", "decision", "rationale", "consequences", "affected_components")


def _adr_out(a: Adr, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "projectId": str(a.project_id),
        "workspaceId": str(a.workspace_id) if a.workspace_id else None,
        "number": a.number,
        "key": f"ADR-{a.number:03d}",
        "title": a.title,
        "status": a.status,
        "context": a.context,
        "decision": a.decision,
        "rationale": a.rationale,
        "consequences": a.consequences or [],
        "affectedComponents": a.affected_components or [],
        "createdBy": str(a.created_by),
        "author": names.get(a.created_by, ""),
        "date": a.created_at.date().isoformat(),
        "createdAt": _iso(a.created_at),
        "updatedAt": _iso(a.updated_at),
    }


@router.get("/api/projects/{project_id}/adrs")
async def list_adrs(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Architecture decision records of a project, newest first."""
    await _project_for(session, user, project_id, "architecture")
    rows = list(
        (await session.scalars(select(Adr).where(Adr.project_id == project_id).order_by(Adr.number.desc()))).all()
    )
    names = await _names(session, rows)
    return [_adr_out(a, names) for a in rows]


@router.post("/api/projects/{project_id}/adrs", status_code=status.HTTP_201_CREATED)
async def create_adr(project_id: uuid.UUID, body: AdrIn, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Records a decision. Numbers are per project and never reused."""
    project = await _project_for(session, user, project_id, "architecture")
    # Serialise numbering per project so two architects never get the same number.
    await session.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    number = (
        await session.scalar(select(func.coalesce(func.max(Adr.number), 0)).where(Adr.project_id == project_id))
    ) + 1
    adr = Adr(
        id=uuid.uuid4(),
        project_id=project_id,
        workspace_id=project.workspace_id,
        number=number,
        title=body.title.strip(),
        status=body.status,
        context=body.context,
        decision=body.decision,
        rationale=body.rationale,
        consequences=body.consequences,
        affected_components=body.affected_components,
        created_by=user.id,
    )
    session.add(adr)
    await session.flush()
    await session.refresh(adr)
    await _log(
        session, user, kind="adr", created=True, row=adr, changes={},
        extra={"key": f"ADR-{number:03d}", "title": adr.title, "status": adr.status},
    )
    return _adr_out(adr, await _names(session, [adr]))


@router.patch("/api/adrs/{adr_id}")
async def update_adr(adr_id: uuid.UUID, body: AdrPatch, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Edits an ADR or moves its status (proposed, accepted, rejected, superseded)."""
    adr = await _record_for(session, Adr, adr_id, "ADR")
    await _project_for(session, user, adr.project_id, "architecture")
    changes = _apply(adr, body, ADR_FIELDS)
    if changes:
        _stamp(adr)
        await _log(session, user, kind="adr", created=False, row=adr, changes=changes,
                   extra={"key": f"ADR-{adr.number:03d}"})
    return _adr_out(adr, await _names(session, [adr]))


# ── QA test scenarios ────────────────────────────────────────────────────────

SCENARIO_FIELDS = (
    "title", "type", "priority", "steps", "expected_result", "automation_script",
    "status", "actual_result", "evidence_uri",
)


def _scenario_out(t: TestScenario, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "projectId": str(t.project_id),
        "workspaceId": str(t.workspace_id) if t.workspace_id else None,
        "issueId": str(t.issue_id) if t.issue_id else None,
        "title": t.title,
        "type": t.type,
        "priority": t.priority,
        "steps": t.steps or [],
        "expectedResult": t.expected_result,
        "status": t.status,
        "actualResult": t.actual_result,
        "evidenceUri": t.evidence_uri,
        "automationScript": t.automation_script,
        "createdBy": str(t.created_by),
        "author": names.get(t.created_by, ""),
        "createdAt": _iso(t.created_at),
        "updatedAt": _iso(t.updated_at),
    }


@router.get("/api/projects/{project_id}/test-scenarios")
async def list_scenarios(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """QA scenarios of a project, newest first."""
    await _project_for(session, user, project_id, "qa")
    rows = list(
        (
            await session.scalars(
                select(TestScenario)
                .where(TestScenario.project_id == project_id)
                .order_by(TestScenario.created_at.desc())
                .limit(1000)
            )
        ).all()
    )
    names = await _names(session, rows)
    return [_scenario_out(t, names) for t in rows]


@router.post("/api/projects/{project_id}/test-scenarios", status_code=status.HTTP_201_CREATED)
async def create_scenario(
    project_id: uuid.UUID, body: ScenarioIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Adds a scenario (manual, or saved from the AI test synthesiser). Starts as not run."""
    project = await _project_for(session, user, project_id, "qa")
    scenario = TestScenario(
        id=uuid.uuid4(),
        project_id=project_id,
        workspace_id=project.workspace_id,
        issue_id=body.issue_id,
        title=body.title.strip(),
        type=body.type,
        priority=body.priority,
        steps=body.steps,
        expected_result=body.expected_result,
        automation_script=body.automation_script,
        status="not_run",
        created_by=user.id,
    )
    session.add(scenario)
    await session.flush()
    await session.refresh(scenario)
    await _log(
        session, user, kind="test_scenario", created=True, row=scenario, changes={},
        extra={"title": scenario.title, "type": scenario.type, "priority": scenario.priority},
    )
    return _scenario_out(scenario, await _names(session, [scenario]))


@router.get("/api/projects/{project_id}/qa-queue")
async def qa_queue(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Stories developers finished and QA has not signed off, with how many scenarios each has."""
    await _project_for(session, user, project_id, "qa")
    issues = (
        await session.scalars(
            select(Issue)
            .where(
                Issue.project_id == project_id,
                Issue.type != "epic",
                Issue.status.in_(("ready_for_qa", "in_qa", "done")),
            )
            .order_by(Issue.number)
        )
    ).all()
    counts = dict(
        (
            await session.execute(
                select(TestScenario.issue_id, func.count())
                .where(TestScenario.project_id == project_id, TestScenario.issue_id.is_not(None))
                .group_by(TestScenario.issue_id)
            )
        ).all()
    )
    return [
        {
            "id": str(i.id),
            "key": f"#{i.number}",
            "title": i.title,
            "status": i.status,
            "acceptanceCriteria": i.acceptance_criteria or [],
            "scenarios": counts.get(i.id, 0),
        }
        for i in issues
    ]


@router.post("/api/issues/{issue_id}/test-scenarios", status_code=status.HTTP_201_CREATED)
async def synthesize_scenarios(issue_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """AI drafts manual scenarios and an automation script for one finished story."""
    from app.ai.errors import ModelError
    from app.services import qa_synth

    issue = await _record_for(session, Issue, issue_id, "Issue")
    project = await _project_for(session, user, issue.project_id, "qa")
    try:
        made = await qa_synth.synthesize_for_issue(session, project, issue, user)
    except ModelError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"The model could not draft tests: {exc}") from exc
    names = await _names(session, made)
    for row in made:
        await _log(
            session, user, kind="test_scenario", created=True, row=row, changes={},
            extra={"title": row.title, "issue": issue.number, "by": "ai-qa-synthesiser"},
        )
    return [_scenario_out(t, names) for t in made]


@router.patch("/api/test-scenarios/{scenario_id}")
async def update_scenario(
    scenario_id: uuid.UUID, body: ScenarioPatch, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Edits a scenario or records a run result (passed, failed, blocked)."""
    scenario = await _record_for(session, TestScenario, scenario_id, "Test scenario")
    await _project_for(session, user, scenario.project_id, "qa")
    changes = _apply(
        scenario, body, SCENARIO_FIELDS,
        nullable=("automation_script", "actual_result", "evidence_uri"),
    )
    if changes:
        _stamp(scenario)
        # A run result is one event: the status plus the evidence that goes with it.
        await _log(
            session, user, kind="test_scenario", created=False, row=scenario, changes=changes,
            extra={"title": scenario.title},
            status_fields=frozenset({"status", "actual_result", "evidence_uri"}),
        )
        if "status" in changes and scenario.issue_id:
            await qa_gate.record_result(session, scenario, user)
    return _scenario_out(scenario, await _names(session, [scenario]))


@router.post("/api/issues/{issue_id}/qa-signoff")
async def qa_signoff(issue_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """QA signs a story off: every scenario for it has passed, so it is Done."""
    issue = await _record_for(session, Issue, issue_id, "Issue")
    await _project_for(session, user, issue.project_id, "qa")
    problem = await qa_gate.signoff_problem(session, issue)
    if problem:
        raise HTTPException(status.HTTP_409_CONFLICT, problem)
    issue.status, issue.closed_at = "done", dt.datetime.now(dt.UTC)
    issue.updated_at = issue.closed_at
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="qa.signed_off",
        subject_type="issue",
        subject_id=issue.id,
        project_id=issue.project_id,
        payload={"key": issue_rules.key(issue.number)},
    )
    return {"id": str(issue.id), "status": issue.status}


# ── Security findings ────────────────────────────────────────────────────────

FINDING_FIELDS = (
    "title", "cve_id", "cwe_category", "severity", "cvss_score", "affected_component",
    "remediation_advice", "sla_deadline", "status",
)


def _finding_out(f: SecurityFinding, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    days = (f.sla_deadline - dt.date.today()).days if f.sla_deadline else None
    return {
        "id": str(f.id),
        "projectId": str(f.project_id),
        "workspaceId": str(f.workspace_id) if f.workspace_id else None,
        "title": f.title,
        "cveId": f.cve_id,
        "cweCategory": f.cwe_category,
        "severity": f.severity,
        "cvssScore": float(f.cvss_score or 0),
        "status": f.status,
        "statusReason": f.status_reason,
        "affectedComponent": f.affected_component,
        "remediationAdvice": f.remediation_advice,
        "slaDeadline": _iso(f.sla_deadline),
        "slaDaysRemaining": days,
        "createdBy": str(f.created_by),
        "author": names.get(f.created_by, ""),
        "createdAt": _iso(f.created_at),
        "updatedAt": _iso(f.updated_at),
    }


@router.get("/api/projects/{project_id}/security-findings")
async def list_findings(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Security findings of a project, newest first."""
    await _project_for(session, user, project_id, "security")
    rows = list(
        (
            await session.scalars(
                select(SecurityFinding)
                .where(SecurityFinding.project_id == project_id)
                .order_by(SecurityFinding.created_at.desc())
                .limit(1000)
            )
        ).all()
    )
    names = await _names(session, rows)
    return [_finding_out(f, names) for f in rows]


@router.post("/api/projects/{project_id}/security-findings", status_code=status.HTTP_201_CREATED)
async def create_finding(
    project_id: uuid.UUID, body: FindingIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Raises a finding. It starts open."""
    project = await _project_for(session, user, project_id, "security")
    finding = SecurityFinding(
        id=uuid.uuid4(),
        project_id=project_id,
        workspace_id=project.workspace_id,
        title=body.title.strip(),
        cve_id=body.cve_id,
        cwe_category=body.cwe_category,
        severity=body.severity,
        cvss_score=body.cvss_score,
        affected_component=body.affected_component,
        remediation_advice=body.remediation_advice,
        sla_deadline=body.sla_deadline,
        status="open",
        created_by=user.id,
    )
    session.add(finding)
    await session.flush()
    await session.refresh(finding)
    await _log(
        session, user, kind="security_finding", created=True, row=finding, changes={},
        extra={"title": finding.title, "severity": finding.severity, "cve_id": finding.cve_id},
    )
    return _finding_out(finding, await _names(session, [finding]))


@router.patch("/api/security-findings/{finding_id}")
async def update_finding(
    finding_id: uuid.UUID, body: FindingPatch, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Edits a finding or moves its status.

    Waiving accepts a known risk, so it needs a written reason and someone who
    manages or leads the project. The reason goes on the record and the ledger.
    """
    finding = await _record_for(session, SecurityFinding, finding_id, "Security finding")
    project = await _project_for(session, user, finding.project_id, "security")
    if body.status == "waived" and finding.status != "waived":
        if not (body.reason or "").strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Waiving a finding needs a reason.")
        mine = await access.my_access(session, user, project)
        if not (mine["canManage"] or mine["isLead"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a project lead or manager can waive a finding.")
    changes = _apply(finding, body, FINDING_FIELDS, nullable=("cve_id", "sla_deadline"))
    if changes:
        _stamp(finding)
        extra: dict[str, Any] = {"title": finding.title}
        if "status" in changes:
            finding.status_reason = (body.reason or "").strip() or None
            if finding.status_reason:
                extra["reason"] = finding.status_reason
        await _log(session, user, kind="security_finding", created=False, row=finding, changes=changes, extra=extra)
    return _finding_out(finding, await _names(session, [finding]))
