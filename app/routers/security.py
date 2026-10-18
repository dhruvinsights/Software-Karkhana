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

"""Security station: OSV-Scanner dependency scans, gate, fixes and reports.

Findings themselves are listed and edited in ``stations.py`` (one register for
scanner and hand-raised findings). This router adds what is specific to scans:
starting one (a background job), its status and history, the gate, assignment
with a remediation issue, AI fix suggestions, rescans and the report.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, issue_rules, ledger
from app import security_rules as rules
from app.auth import CurrentUser
from app.models import (
    ActivityEvent,
    Issue,
    Project,
    PullRequest,
    SecurityFinding,
    SecurityScan,
    Task,
    User,
)
from app.routers.stations import _finding_out, _names, _project_for, _record_for
from app.services import osv_scan, realtime, security_fix

router = APIRouter(tags=["security"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def _scan_out(s: SecurityScan) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "projectId": str(s.project_id),
        "trigger": s.trigger,
        "status": s.status,
        "ref": s.ref,
        "commitSha": s.commit_sha,
        "prId": str(s.pr_id) if s.pr_id else None,
        "startedBy": str(s.started_by) if s.started_by else None,
        "createdAt": _iso(s.created_at),
        "startedAt": _iso(s.started_at),
        "finishedAt": _iso(s.finished_at),
        "counts": s.counts or rules.count_by_severity([]),
        "packagesAffected": s.packages_affected,
        "newFindings": s.new_findings,
        "resolvedFindings": s.resolved_findings,
        "gate": s.gate,
        "error": s.error,
        "scannerVersion": s.scanner_version,
    }


async def _is_lead(session: AsyncSession, user: User, project: Project) -> bool:
    mine = await access.my_access(session, user, project)
    return bool(mine["canManage"] or mine["isLead"])


# ── Scans ────────────────────────────────────────────────────────────────────


class ScanIn(BaseModel):
    """Start a scan of the base branch, or of one pull request's branch."""

    pr_id: uuid.UUID | None = None


async def start_scan(
    session: AsyncSession,
    project: Project,
    user: User,
    background: BackgroundTasks,
    *,
    trigger: str,
    pr: PullRequest | None = None,
) -> tuple[dict[str, Any], int]:
    """Queues a scan and schedules it; returns ``(body, http_status)``."""
    if not await osv_scan.has_source(session, project):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No repository is configured for this project. Connect one in Product Setup first.",
        )
    scan, created = await osv_scan.enqueue(
        session, project, trigger=trigger, user_id=user.id, actor=ledger.Actor.human(user), pr=pr
    )
    await session.commit()
    if created:
        background.add_task(osv_scan.execute, scan.id)
        if project.workspace_id:
            await realtime.notify_workspace(project.workspace_id, "projects")
        return _scan_out(scan), status.HTTP_202_ACCEPTED
    # The same target is already queued or running: hand back that scan.
    return {**_scan_out(scan), "alreadyRunning": True}, status.HTTP_200_OK


@router.post("/api/projects/{project_id}/security-scans", status_code=status.HTTP_202_ACCEPTED)
async def create_scan(
    project_id: uuid.UUID,
    body: ScanIn,
    session: Session,
    user: CurrentUser,
    background: BackgroundTasks,
) -> dict[str, Any]:
    """Starts a dependency scan in the background. Poll ``GET /api/security-scans/{id}``."""
    project = await _project_for(session, user, project_id, "security")
    pr = None
    if body.pr_id:
        pr = await session.get(PullRequest, body.pr_id)
        task = await _task_project(session, pr)
        if pr is None or task != project.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pull request not found on this project.")
    trigger = "pr" if pr else "manual"
    out, _ = await start_scan(session, project, user, background, trigger=trigger, pr=pr)
    return out


async def _task_project(session: AsyncSession, pr: PullRequest | None) -> uuid.UUID | None:
    if pr is None:
        return None
    task = await session.get(Task, pr.task_id)
    return task.project_id if task else None


@router.post("/api/projects/{project_id}/security-scans/rescan", status_code=status.HTTP_202_ACCEPTED)
async def rescan(
    project_id: uuid.UUID, session: Session, user: CurrentUser, background: BackgroundTasks
) -> dict[str, Any]:
    """Scans again after fixes. Findings that are gone are closed as verified fixed."""
    project = await _project_for(session, user, project_id, "security")
    out, _ = await start_scan(session, project, user, background, trigger="rescan")
    return out


@router.get("/api/projects/{project_id}/security-scans")
async def list_scans(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Scan history, newest first."""
    await _project_for(session, user, project_id, "security")
    rows = (
        await session.scalars(
            select(SecurityScan)
            .where(SecurityScan.project_id == project_id)
            .order_by(SecurityScan.created_at.desc())
            .limit(50)
        )
    ).all()
    return [_scan_out(s) for s in rows]


@router.get("/api/security-scans/{scan_id}")
async def get_scan(scan_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """One scan's status; poll this after starting a scan."""
    scan = await session.get(SecurityScan, scan_id)
    if scan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scan not found.")
    await _project_for(session, user, scan.project_id, "security")
    return _scan_out(scan)


# ── Summary and gate ─────────────────────────────────────────────────────────


@router.get("/api/projects/{project_id}/security-summary")
async def summary(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Counts, the gate and the latest scan: everything the dashboard header shows."""
    project = await _project_for(session, user, project_id, "security")
    rows = (
        await session.execute(
            select(SecurityFinding.severity, SecurityFinding.status, SecurityFinding.sla_deadline).where(
                SecurityFinding.project_id == project_id
            )
        )
    ).all()
    open_rows = [r for r in rows if r[1] in rules.OPEN_STATUSES]
    today = dt.date.today()
    policy = rules.read_policy(project.settings)
    blockers = await osv_scan.gate_blockers(session, project)
    last = await osv_scan.latest_scan(session, project_id)
    return {
        "open": rules.count_by_severity(r[0] for r in open_rows),
        "total": len(rows),
        "fixed": sum(1 for r in rows if r[1] == "verified_fixed"),
        "waived": sum(1 for r in rows if r[1] == "waived"),
        "overdue": sum(1 for r in open_rows if r[2] and r[2] < today),
        "gate": {"open": not blockers, "blockers": blockers},
        "policy": {
            "blockSeverities": sorted(policy.block_severities, key=rules.SEVERITIES.index),
            "requireScan": policy.require_scan,
            "autoScan": policy.auto_scan,
        },
        "lastScan": _scan_out(last) if last else None,
        "scannerReady": await osv_scan.has_source(session, project),
    }


class PolicyIn(BaseModel):
    """Gate settings for a project."""

    block_severities: list[str] = Field(default_factory=lambda: ["CRITICAL"], min_length=1)
    require_scan: bool = False
    auto_scan: bool = True


@router.put("/api/projects/{project_id}/security-policy")
async def set_policy(
    project_id: uuid.UUID, body: PolicyIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Sets which severities block merge and QA, and whether a scan is required. Leads only."""
    project = await _project_for(session, user, project_id, "security")
    if not await _is_lead(session, user, project):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a project lead or manager can change the security gate.")
    bad = [s for s in body.block_severities if s not in rules.SEVERITIES]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown severity: {bad[0]}.")
    if "CRITICAL" not in body.block_severities:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "CRITICAL findings must always block.")
    value = {
        "blockSeverities": sorted(set(body.block_severities), key=rules.SEVERITIES.index),
        "requireScan": body.require_scan,
        "autoScan": body.auto_scan,
    }
    before = (project.settings or {}).get("security")
    project.settings = {**(project.settings or {}), "security": value}
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="security_policy.updated",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"before": before, "after": value},
    )
    return value


# ── Findings: assignment, fix suggestion, remediation issue ───────────────────


class AssignIn(BaseModel):
    """Who should fix a finding; ``null`` unassigns."""

    assignee_id: uuid.UUID | None = None


async def _finding(session: AsyncSession, user: User, finding_id: uuid.UUID) -> tuple[SecurityFinding, Project]:
    finding = await _record_for(session, SecurityFinding, finding_id, "Security finding")
    project = await _project_for(session, user, finding.project_id, "security")
    return finding, project


@router.post("/api/security-findings/{finding_id}/assign")
async def assign(
    finding_id: uuid.UUID, body: AssignIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Assigns a finding to a developer, files a remediation issue for them and tells them.

    Leads assign anyone; everyone else can only take a finding themselves.
    """
    finding, project = await _finding(session, user, finding_id)
    ok, why = issue_rules.can_assign(
        actor_id=user.id, assignee_id=body.assignee_id, actor_is_lead=await _is_lead(session, user, project)
    )
    if not ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, why)
    person = None
    if body.assignee_id:
        person = await session.get(User, body.assignee_id)
        if person is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Assignee not found.")
        try:
            await access.ensure_station(session, person, project)
        except HTTPException as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{person.display_name} is not on this project."
            ) from exc
    finding.assignee_id = body.assignee_id
    finding.updated_at = dt.datetime.now(dt.UTC)
    issue = await _remediation_issue(session, project, finding, user)
    if issue is not None:
        issue.assignee_id = body.assignee_id
        issue.updated_at = finding.updated_at
    if body.assignee_id and finding.status == "open":
        finding.status = "in_remediation"
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="security_finding.assigned",
        subject_type="security_finding",
        subject_id=finding.id,
        project_id=project.id,
        payload={
            "assignee": person.display_name if person else None,
            "issue": issue_rules.key(issue.number) if issue else None,
            "package": finding.affected_component,
        },
    )
    if person and person.id != user.id and project.workspace_id:
        session.add(
            ActivityEvent(
                workspace_id=project.workspace_id,
                actor_id=user.id,
                recipient_id=person.id,
                type="security_assigned",
                summary=(
                    f"{user.display_name} assigned you a {finding.severity} vulnerability: "
                    f"{finding.affected_component}. {finding.remediation_advice}"
                )[:500],
                target_type="security_finding",
                target_id=str(finding.id),
                project_id=project.id,
            )
        )
    await session.commit()
    if person and person.id != user.id and project.workspace_id:
        await realtime.notify_activity(project.workspace_id, {person.id})
    if project.workspace_id:
        await realtime.notify_workspace(project.workspace_id, "projects")
    return _finding_out(finding, await _names(session, [finding]))


async def _remediation_issue(
    session: AsyncSession, project: Project, finding: SecurityFinding, user: User
) -> Issue | None:
    """The board issue that tracks this finding's fix; created once, on first assignment."""
    if finding.issue_id:
        return await session.get(Issue, finding.issue_id)
    number = (
        await session.scalar(select(func.coalesce(func.max(Issue.number), 0)).where(Issue.project_id == project.id))
    ) + 1
    await session.execute(select(Project.id).where(Project.id == project.id).with_for_update())
    sev_priority = {"CRITICAL": "P0", "HIGH": "P1", "MEDIUM": "P2", "LOW": "P3"}
    issue = Issue(
        id=uuid.uuid4(),
        project_id=project.id,
        number=number,
        title=f"Fix {finding.severity} vulnerability in {finding.affected_component}"[:200],
        description=(
            f"{finding.title}\n\n{finding.remediation_advice}\n\n"
            f"Advisory: {finding.osv_id or finding.cve_id or 'n/a'}\n"
            f"Manifest: {finding.manifest_path or 'n/a'}\n\n"
            "After upgrading, run a rescan in the Security station to close the finding."
        ),
        type="security",
        priority=sev_priority.get(finding.severity, "P2"),
        status="todo",
        source="security",
        labels=["security", f"finding:{finding.id}"],
        reporter_id=user.id,
    )
    session.add(issue)
    await session.flush()
    finding.issue_id = issue.id
    return issue


@router.post("/api/security-findings/{finding_id}/fix-suggestion")
async def fix_suggestion(finding_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Asks the AI for a fix plan and saves it on the finding (labelled AI-generated)."""
    finding, project = await _finding(session, user, finding_id)
    suggestion = await security_fix.suggest(finding)
    finding.ai_fix = suggestion
    await ledger.append(
        session,
        actor=ledger.Actor.ai("security-fix-agent") if suggestion["source"] == "ai" else ledger.Actor.human(user),
        action="security_finding.fix_suggested",
        subject_type="security_finding",
        subject_id=finding.id,
        project_id=project.id,
        payload={"source": suggestion["source"], "model": suggestion.get("model"), "requested_by": user.email},
    )
    return suggestion


# ── Report ───────────────────────────────────────────────────────────────────


@router.get("/api/projects/{project_id}/security-report")
async def report(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """A vulnerability report: counts, gate, and every open finding with its fix."""
    project = await _project_for(session, user, project_id, "security")
    findings = (
        await session.scalars(
            select(SecurityFinding)
            .where(SecurityFinding.project_id == project_id)
            .order_by(SecurityFinding.cvss_score.desc(), SecurityFinding.created_at)
        )
    ).all()
    head = await summary(project_id, session, user)
    return {
        "project": {"id": str(project.id), "name": project.name},
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
        **head,
        "markdown": render_markdown(project.name, head, list(findings)),
    }


def render_markdown(name: str, head: dict[str, Any], findings: list[SecurityFinding]) -> str:
    """The report as Markdown, for download and for pasting into a PR or ticket."""
    lines = [f"# Security report: {name}", ""]
    gate = head["gate"]
    lines.append("**Gate: OPEN**" if gate["open"] else "**Gate: BLOCKED** - " + "; ".join(gate["blockers"]))
    open_counts = head["open"]
    lines += [
        "",
        "| Critical | High | Medium | Low | Fixed | Waived |",
        "|---|---|---|---|---|---|",
        f"| {open_counts['CRITICAL']} | {open_counts['HIGH']} | {open_counts['MEDIUM']} | {open_counts['LOW']} "
        f"| {head['fixed']} | {head['waived']} |",
        "",
    ]
    last = head["lastScan"]
    if last:
        lines.append(f"Last scan: {last['status']} at {last['finishedAt'] or last['createdAt']} (OSV-Scanner {last['scannerVersion'] or 'n/a'})")
    else:
        lines.append("No dependency scan has run yet.")
    open_findings = [f for f in findings if f.status in rules.OPEN_STATUSES]
    lines += ["", "## Open findings", ""]
    if not open_findings:
        lines.append("None.")
    for f in open_findings:
        lines += [
            f"### [{f.severity}] {f.affected_component} - {f.osv_id or f.cve_id or f.title}",
            f"- CVSS {float(f.cvss_score or 0):.1f}, status {f.status}, SLA {f.sla_deadline or 'n/a'}",
            f"- {f.title}",
            f"- Fix: {f.remediation_advice}",
            "",
        ]
    return "\n".join(lines)
