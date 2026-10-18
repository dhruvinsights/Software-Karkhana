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

"""Dependency scans with Google's OSV-Scanner, wired into the Security station.

A scan clones the project's repository (or a pull request's branch, which is
where code built on a developer's machine lands), runs ``osv-scanner`` over it
and turns what it reports into ``security_findings``:

* A vulnerability seen for the first time becomes an open finding with an SLA.
* One seen again is updated, not duplicated.
* One that a rescan no longer reports is marked ``verified_fixed``; one that
  comes back is reopened. Waived findings stay waived.

Every change is written to the ledger and the people involved are notified.
Scans run as background jobs and are tracked in ``security_scans``; a scan that
cannot run is recorded as ``failed`` with the reason, never silently skipped.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db, ledger
from app import security_rules as rules
from app.config import get_settings
from app.models import (
    ActivityEvent,
    Project,
    PullRequest,
    SecurityFinding,
    SecurityScan,
    Task,
)
from app.notifications import email_people
from app.services import realtime, repo_context, repos

logger = logging.getLogger(__name__)

SCANNER = ledger.Actor(label="osv-scanner", kind="system")
ACTIVE = ("queued", "running")
LOOP_EVERY_SEC = 3600


class ScanError(RuntimeError):
    """The scan could not run; the message is shown to the team."""


@dataclass(frozen=True)
class Source:
    """What to scan: where the code is and which branch."""

    url: str
    token: str | None
    branch: str | None


# ── Running the scanner ──────────────────────────────────────────────────────


async def run_scanner(path: str) -> tuple[dict[str, Any], str]:
    """Runs ``osv-scanner`` over ``path`` and returns ``(report, version)``.

    Exit 0 (clean) and 1 (vulnerabilities found) both carry a JSON report. A
    repository with no manifests is a clean result, not an error. Anything else
    (binary missing, network down, crash) raises :class:`ScanError`.
    """
    s = get_settings()
    argv = [
        s.osv_scanner_bin,
        "scan",
        "source",
        "--format",
        "json",
        "--recursive",
        "--allow-no-lockfiles",
        path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except FileNotFoundError as exc:
        raise ScanError(f"osv-scanner is not installed ({s.osv_scanner_bin}).") from exc
    try:
        out, err = await asyncio.wait_for(proc.communicate(), s.osv_scan_timeout_s)
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise ScanError(f"osv-scanner timed out after {s.osv_scan_timeout_s}s.") from exc
    if proc.returncode not in (0, 1):
        tail = err.decode(errors="replace").strip()[-400:]
        raise ScanError(f"osv-scanner failed (exit {proc.returncode}): {tail}")
    try:
        report = json.loads(out.decode(errors="replace") or "{}")
    except json.JSONDecodeError as exc:
        raise ScanError("osv-scanner returned output that is not JSON.") from exc
    return report, await scanner_version()


async def scanner_version() -> str:
    """The installed scanner's version string, or ``unknown``."""
    try:
        proc = await asyncio.create_subprocess_exec(
            get_settings().osv_scanner_bin,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), 10)
    except (OSError, TimeoutError):
        return "unknown"
    first = out.decode(errors="replace").splitlines()[:1]
    return first[0].split(":")[-1].strip() if first else "unknown"


# ── Scan lifecycle ───────────────────────────────────────────────────────────


async def resolve_source(
    session: AsyncSession, project: Project, user_id: uuid.UUID | None, branch: str | None
) -> Source:
    """Where this project's code lives (the same repository runs publish to)."""
    s = get_settings()
    target = await repos.for_project(session, project.id)
    url = s.demo_repo_url or (target.clone_url if target else None)
    if url is None:
        raise ScanError("No repository is configured for this project.")
    token = await repos.write_token(session, project.id, user_id)
    return Source(url, token, branch)


async def has_source(session: AsyncSession, project: Project) -> bool:
    """True when a scan could find the code to scan."""
    return get_settings().demo_repo_url is not None or await repos.for_project(session, project.id) is not None


async def enqueue(
    session: AsyncSession,
    project: Project,
    *,
    trigger: str,
    user_id: uuid.UUID | None = None,
    actor: ledger.Actor = ledger.SYSTEM,
    pr: PullRequest | None = None,
) -> tuple[SecurityScan, bool]:
    """Creates a queued scan, or returns the one already waiting for the same target.

    Returns ``(scan, created)``. The caller commits, then runs :func:`execute`
    in the background.
    """
    ref = pr.branch if pr else None
    pending = await session.scalar(
        select(SecurityScan).where(
            SecurityScan.project_id == project.id,
            SecurityScan.status.in_(ACTIVE),
            SecurityScan.ref.is_not_distinct_from(ref),
        )
    )
    if pending is not None:
        return pending, False
    scan = SecurityScan(
        id=uuid.uuid4(),
        project_id=project.id,
        workspace_id=project.workspace_id,
        trigger=trigger,
        status="queued",
        ref=ref,
        commit_sha=pr.head_sha if pr and pr.head_sha else None,
        pr_id=pr.id if pr else None,
        started_by=user_id,
    )
    session.add(scan)
    await session.flush()
    await ledger.append(
        session,
        actor=actor,
        action="security_scan.queued",
        subject_type="security_scan",
        subject_id=scan.id,
        project_id=project.id,
        payload={"trigger": trigger, "ref": ref, "started_by": str(user_id) if user_id else None},
    )
    return scan, True


async def execute(scan_id: uuid.UUID) -> None:
    """Background job: runs one scan to completion and records the outcome."""
    async with db.sessionmaker()() as session:
        scan = await session.get(SecurityScan, scan_id)
        if scan is None or scan.status != "queued":
            return
        scan.status, scan.started_at = "running", dt.datetime.now(dt.UTC)
        await session.commit()
        project = await session.get(Project, scan.project_id)
        assert project is not None
        try:
            source = await resolve_source(session, project, scan.started_by, scan.ref)
            async with repo_context.checkout(source.url, source.token, source.branch) as repo:
                report, version = await run_scanner(str(repo))
                sha = await _head_sha(repo)
            parsed, affected = rules.parse_report(_relative(report, str(repo)), str(project.id))
        except (ScanError, repo_context.RepoContextError, ValueError) as exc:
            await _fail(session, scan, project, str(exc))
            return
        except Exception as exc:
            logger.exception("Security scan %s crashed", scan_id)
            await _fail(session, scan, project, f"Unexpected error: {type(exc).__name__}")
            return
        await _finish(session, scan, project, parsed, affected, version, sha)


async def _head_sha(repo: Any) -> str | None:
    try:
        return (await repo_context._run("git", "rev-parse", "HEAD", cwd=repo, timeout=30)).strip() or None
    except repo_context.RepoContextError:
        return None


def _relative(report: dict[str, Any], root: str) -> dict[str, Any]:
    """Manifest paths relative to the repository, so they match across scans."""
    for result in report.get("results") or []:
        source = result.get("source") or {}
        path = str(source.get("path", ""))
        if path.startswith(root):
            source["path"] = path[len(root) :].lstrip("/")
    return report


# ── Recording results ────────────────────────────────────────────────────────


async def _fail(session: AsyncSession, scan: SecurityScan, project: Project, reason: str) -> None:
    scan_id, project_id = scan.id, project.id
    await session.rollback()
    scan = await session.get(SecurityScan, scan_id)  # type: ignore[assignment]
    project = await session.get(Project, project_id)  # type: ignore[assignment]
    assert scan is not None and project is not None
    scan.status, scan.error = "failed", reason[:1000]
    scan.finished_at = dt.datetime.now(dt.UTC)
    scan.gate = None
    await ledger.append(
        session,
        actor=SCANNER,
        action="security_scan.failed",
        subject_type="security_scan",
        subject_id=scan.id,
        project_id=project.id,
        payload={"error": scan.error},
    )
    await session.commit()
    await _tell(
        session,
        project,
        scan,
        kind="security_scan_failed",
        summary=f"Dependency scan failed: {scan.error}",
    )


async def _finish(
    session: AsyncSession,
    scan: SecurityScan,
    project: Project,
    parsed: list[rules.ParsedFinding],
    affected: int,
    version: str,
    sha: str | None,
) -> None:
    now = dt.datetime.now(dt.UTC)
    existing = {
        f.fingerprint: f
        for f in (
            await session.scalars(
                select(SecurityFinding)
                .where(SecurityFinding.project_id == project.id, SecurityFinding.fingerprint.is_not(None))
                .with_for_update()
            )
        ).all()
    }
    seen: set[str] = set()
    new: list[SecurityFinding] = []
    reopened = 0
    for p in parsed:
        seen.add(p.fingerprint)
        row = existing.get(p.fingerprint)
        if row is None:
            row = _new_finding(project, scan, p, now)
            session.add(row)
            new.append(row)
            continue
        row.last_seen_at, row.scan_id, row.updated_at = now, scan.id, now
        row.severity, row.cvss_score = p.severity, p.cvss_score
        row.package_version, row.fixed_version = p.package_version, p.fixed_version
        row.affected_component, row.references_urls = p.component, p.references
        if scan.ref is None:
            row.ref = None  # Now on the base branch.
        if row.status == "verified_fixed":
            row.status, row.status_reason, row.resolved_by_scan_id = "open", "Seen again by a scan.", None
            reopened += 1
            await _audit(session, project, row, "security_finding.reopened", {"scan": str(scan.id)})
    resolved = 0
    for fp, row in existing.items():
        # A scan only vouches for findings on the branch it looked at.
        if fp in seen or row.ref != scan.ref or row.status not in rules.OPEN_STATUSES:
            continue
        row.status, row.resolved_by_scan_id, row.updated_at = "verified_fixed", scan.id, now
        row.status_reason = "No longer reported by the dependency scan."
        resolved += 1
        await _audit(session, project, row, "security_finding.auto_resolved", {"scan": str(scan.id)})
    await session.flush()
    for row in new:
        await _audit(
            session, project, row, "security_finding.created",
            {"severity": row.severity, "package": row.affected_component, "osv": row.osv_id, "scan": str(scan.id)},
        )

    scan_rows = [r for r in (existing.get(p.fingerprint) for p in parsed) if r] + new
    scan.status, scan.finished_at = "succeeded", now
    scan.scanner_version, scan.commit_sha = version, sha or scan.commit_sha
    scan.counts = rules.count_by_severity(p.severity for p in parsed)
    scan.finding_ids = [str(r.id) for r in scan_rows]
    scan.packages_affected, scan.new_findings, scan.resolved_findings = affected, len(new), resolved
    policy = rules.read_policy(project.settings)
    scan.gate = "blocked" if _blocking(scan_rows, policy) else "passed"
    await ledger.append(
        session,
        actor=SCANNER,
        action="security_scan.completed",
        subject_type="security_scan",
        subject_id=scan.id,
        project_id=project.id,
        payload={
            "ref": scan.ref, "commit": scan.commit_sha, "counts": scan.counts, "gate": scan.gate,
            "new": len(new), "resolved": resolved, "reopened": reopened, "scanner": version,
        },
    )
    await session.commit()

    # Tell people when the gate closes on something new; otherwise only when the picture changed.
    blocking_new = [r for r in new if r.severity in policy.block_severities]
    if blocking_new:
        top = ", ".join(f"{r.affected_component} ({r.severity})" for r in blocking_new[:3])
        await _tell(
            session, project, scan, kind="security_scan",
            summary=f"Security gate blocked by new findings: {top}",
            email=True, extra=[f"{r.affected_component}: {r.remediation_advice}" for r in blocking_new[:5]],
        )
    elif new or resolved:
        await _tell(
            session, project, scan, kind="security_scan",
            summary=f"Dependency scan: {len(new)} new, {resolved} fixed finding(s)",
        )


def _blocking(rows: list[SecurityFinding], policy: rules.SecurityPolicy) -> bool:
    return bool(rules.gate_blockers(((r.severity, r.status) for r in rows), policy, "succeeded"))


def _new_finding(project: Project, scan: SecurityScan, p: rules.ParsedFinding, now: dt.datetime) -> SecurityFinding:
    return SecurityFinding(
        id=uuid.uuid4(),
        project_id=project.id,
        workspace_id=project.workspace_id,
        title=p.title,
        cve_id=p.cve_id,
        cwe_category=p.cwe_category,
        severity=p.severity,
        cvss_score=p.cvss_score,
        status="open",
        affected_component=p.component,
        remediation_advice=p.advice,
        sla_deadline=now.date() + dt.timedelta(days=rules.SLA_DAYS[p.severity]),
        created_by=None,
        source="osv",
        fingerprint=p.fingerprint,
        ref=scan.ref,
        scan_id=scan.id,
        osv_id=p.osv_id,
        aliases=p.aliases,
        package_name=p.package_name,
        package_version=p.package_version,
        ecosystem=p.ecosystem,
        fixed_version=p.fixed_version,
        manifest_path=p.manifest_path,
        references_urls=p.references,
        first_seen_at=now,
        last_seen_at=now,
    )


async def _audit(
    session: AsyncSession, project: Project, row: SecurityFinding, action: str, payload: dict[str, Any]
) -> None:
    await ledger.append(
        session,
        actor=SCANNER,
        action=action,
        subject_type="security_finding",
        subject_id=row.id,
        project_id=project.id,
        payload={"title": row.title[:120], **payload},
    )


# ── Who hears about it ───────────────────────────────────────────────────────


async def _recipients(session: AsyncSession, project: Project, scan: SecurityScan) -> set[uuid.UUID]:
    people: set[uuid.UUID | None] = {project.lead_id, scan.started_by}
    if scan.pr_id:
        pr = await session.get(PullRequest, scan.pr_id)
        task = await session.get(Task, pr.task_id) if pr else None
        people.add(task.assignee_id if task else None)
    return {p for p in people if p}


async def _tell(
    session: AsyncSession,
    project: Project,
    scan: SecurityScan,
    *,
    kind: str,
    summary: str,
    email: bool = False,
    extra: list[str] | None = None,
) -> None:
    """In-app notice (and an email for blocking findings) to the lead, the starter and the PR's developer."""
    people = await _recipients(session, project, scan)
    if not people or project.workspace_id is None:
        return
    for rid in people:
        session.add(
            ActivityEvent(
                workspace_id=project.workspace_id,
                actor_id=None,
                recipient_id=rid,
                type=kind,
                summary=summary[:500],
                target_type="security_scan",
                target_id=str(scan.id),
                project_id=project.id,
            )
        )
    await session.commit()
    await realtime.notify_activity(project.workspace_id, people)
    await realtime.notify_workspace(project.workspace_id, "projects")
    if email:
        await email_people(
            session,
            people,
            subject=f"Security gate blocked: {project.name}",
            heading=summary,
            lines=extra or ["Open the Security station to see the findings and suggested fixes."],
        )


# ── Gate ─────────────────────────────────────────────────────────────────────


async def latest_scan(session: AsyncSession, project_id: uuid.UUID, *, pr_id: uuid.UUID | None = None) -> SecurityScan | None:
    """The most recent scan, of the base branch or of one pull request."""
    q = select(SecurityScan).where(SecurityScan.project_id == project_id)
    q = q.where(SecurityScan.pr_id == pr_id) if pr_id else q.where(SecurityScan.pr_id.is_(None))
    return await session.scalar(q.order_by(SecurityScan.created_at.desc()).limit(1))


async def gate_blockers(session: AsyncSession, project: Project, *, pr: PullRequest | None = None) -> list[str]:
    """Why the security gate is closed for the project, or for one pull request.

    A project is gated on the open findings of its base branch; a pull request on
    the findings of its own scan. Either way, one branch's problems do not block
    work on another; a merge queues a base-branch rescan so merged code is judged.
    """
    policy = rules.read_policy(project.settings)
    scan = await latest_scan(session, project.id, pr_id=pr.id if pr else None)
    if pr is not None:
        ids = [uuid.UUID(i) for i in (scan.finding_ids if scan else [])]
        rows = (await session.execute(select(SecurityFinding.severity, SecurityFinding.status).where(SecurityFinding.id.in_(ids)))).all() if ids else []
    else:
        rows = (await session.execute(select(SecurityFinding.severity, SecurityFinding.status).where(SecurityFinding.project_id == project.id, SecurityFinding.ref.is_(None)))).all()
    return rules.gate_blockers([(r[0], r[1]) for r in rows], policy, scan.status if scan else None)


# ── Background loop ──────────────────────────────────────────────────────────


async def recover_stale() -> int:
    """Fails scans left ``queued``/``running`` by a restart, so nobody waits on them forever."""
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=get_settings().osv_scan_timeout_s + 120)
    async with db.sessionmaker()() as session:
        stale = (
            await session.scalars(
                select(SecurityScan).where(SecurityScan.status.in_(ACTIVE), SecurityScan.created_at < cutoff)
            )
        ).all()
        for scan in stale:
            scan.status, scan.finished_at = "failed", dt.datetime.now(dt.UTC)
            scan.error = "Interrupted by a server restart. Run the scan again."
        await session.commit()
        return len(stale)


async def rescan_due() -> int:
    """Queues a scheduled rescan for projects whose last base-branch scan is older than the interval."""
    hours = get_settings().osv_rescan_interval_hours
    if hours <= 0:
        return 0
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(hours=hours)
    started: list[uuid.UUID] = []
    async with db.sessionmaker()() as session:
        last = (
            select(SecurityScan.project_id, func.max(SecurityScan.created_at).label("at"))
            .where(SecurityScan.pr_id.is_(None))
            .group_by(SecurityScan.project_id)
            .subquery()
        )
        due = (await session.scalars(select(Project).join(last, last.c.project_id == Project.id).where(last.c.at < cutoff, Project.archived_at.is_(None)))).all()
        for project in due:
            if not rules.read_policy(project.settings).auto_scan:
                continue
            scan, created = await enqueue(session, project, trigger="schedule")
            if created:
                started.append(scan.id)
        await session.commit()
    for scan_id in started:
        await execute(scan_id)
    return len(started)


async def run_forever() -> None:
    """Recovers interrupted scans, then rescans due projects every hour until cancelled."""
    while True:
        try:
            if n := await recover_stale():
                logger.warning("Marked %d interrupted security scan(s) as failed", n)
            await rescan_due()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Security rescan round failed", exc_info=True)
        await asyncio.sleep(LOOP_EVERY_SEC)
