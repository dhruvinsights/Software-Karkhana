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

"""OSV-Scanner integration: scans, findings, the gate, assignment, rescan, the report.

Postgres, the API, the ledger and notifications are real. Only the two things
that need the network are replaced: the git checkout and the scanner binary,
which returns a trimmed copy of real OSV-Scanner output.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select, update

from app import db
from app.config import get_settings
from app.models import (
    ActivityEvent,
    Epic,
    Issue,
    LedgerEntry,
    Project,
    PullRequest,
    Run,
    SecurityFinding,
    SecurityScan,
    Task,
    User,
)
from app.services import osv_scan, repo_context
from tests.integration.test_golden_path import DEV, LEAD, PM, as_, client, fakes  # noqa: F401
from tests.integration.test_idea_approvals import _uid

SAMPLE = json.loads((Path(__file__).parents[1] / "fixtures" / "osv_sample.json").read_text())


def _with_critical(report: dict) -> dict:
    """The sample plus one CRITICAL advisory on requests."""
    out = copy.deepcopy(report)
    pkg = out["results"][0]["packages"][0]
    pkg["groups"].append(
        {"ids": ["GHSA-test-crit-0001"], "aliases": ["CVE-2099-0001"], "max_severity": "9.8"}
    )
    pkg["vulnerabilities"].append(
        {
            "id": "GHSA-test-crit-0001",
            "aliases": ["CVE-2099-0001"],
            "summary": "Remote code execution in a test advisory",
            "database_specific": {"severity": "CRITICAL"},
            "affected": [
                {
                    "package": {"name": pkg["package"]["name"], "ecosystem": pkg["package"]["ecosystem"]},
                    "ranges": [{"type": "ECOSYSTEM", "events": [{"introduced": "0"}, {"fixed": "9.9.9"}]}],
                }
            ],
        }
    )
    return out


class Scanner:
    """Stands in for the OSV-Scanner binary; tests choose what it reports."""

    def __init__(self) -> None:
        self.report: dict = SAMPLE
        self.error: Exception | None = None
        self.calls: list[str | None] = []


@pytest.fixture
def scanner(monkeypatch):
    s = Scanner()
    monkeypatch.setenv("DEMO_REPO_URL", "https://example.invalid/acme/app.git")
    get_settings.cache_clear()

    @contextlib.asynccontextmanager
    async def fake_checkout(url, token, branch=None):
        s.calls.append(branch)
        yield Path("/tmp/osv-test-repo")

    async def fake_run(path):
        if s.error:
            raise s.error
        return copy.deepcopy(s.report), "2.7.0-test"

    async def fake_sha(repo):
        return "a" * 40

    monkeypatch.setattr(repo_context, "checkout", fake_checkout)
    monkeypatch.setattr(osv_scan, "run_scanner", fake_run)
    monkeypatch.setattr(osv_scan, "_head_sha", fake_sha)
    yield s
    get_settings.cache_clear()


async def _story(client):
    """A project with one story the PM owns; returns ``(project_id, story)``."""
    name = f"Security {uuid.uuid4().hex[:6]}"
    ws = (await client.post("/api/workspaces/create", headers=as_(PM), json={"name": name})).json()["id"]
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={"name": name, "idea_text": "Scan dependencies", "workspace_id": ws},
    )
    assert r.status_code == 202, r.text
    pid = r.json()["id"]
    for who, role in ((DEV, "developer"), (LEAD, "developer")):
        inv = (
            await client.post(
                f"/api/workspaces/{ws}/invites", headers=as_(PM), json={"role": role, "project_id": pid}
            )
        ).json()
        r = await client.post("/api/invites/accept", headers=as_(who), json={"token": inv["token"]})
        assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Apply discount", "type": "story"}
    )
    assert r.status_code == 201, r.text
    return pid, r.json()


async def _set_status(issue_id, status):
    async with db.sessionmaker()() as s:
        await s.execute(update(Issue).where(Issue.id == uuid.UUID(issue_id)).values(status=status))
        await s.commit()


async def _wait(client, scan_id, who=PM, tries=100):
    for _ in range(tries):
        r = await client.get(f"/api/security-scans/{scan_id}", headers=as_(who))
        if r.json()["status"] in ("succeeded", "failed"):
            return r.json()
        await asyncio.sleep(0.05)
    raise AssertionError(f"scan never finished: {r.json()}")


async def _scan(client, pid, who=PM):
    r = await client.post(f"/api/projects/{pid}/security-scans", headers=as_(who), json={})
    assert r.status_code == 202, r.text
    return await _wait(client, r.json()["id"], who)


async def _findings(client, pid):
    r = await client.get(f"/api/projects/{pid}/security-findings", headers=as_(PM))
    assert r.status_code == 200, r.text
    return r.json()


async def _ledger(subject_id: str) -> list[str]:
    async with db.sessionmaker()() as s:
        rows = await s.scalars(
            select(LedgerEntry).where(LedgerEntry.subject_id == subject_id).order_by(LedgerEntry.seq)
        )
        return [r.action for r in rows.all()]


async def test_scan_records_findings_counts_and_ledger(client, fakes, scanner):
    pid, _ = await _story(client)
    scan = await _scan(client, pid)

    assert scan["status"] == "succeeded" and scan["scannerVersion"] == "2.7.0-test"
    assert scan["counts"]["HIGH"] == 4 and scan["counts"]["MEDIUM"] == 7
    assert scan["packagesAffected"] == 4 and scan["newFindings"] == 11
    assert scan["gate"] == "passed"  # Only CRITICAL blocks by default.

    rows = await _findings(client, pid)
    assert len(rows) == 11
    one = next(f for f in rows if f["packageName"] == "requests")
    assert one["source"] == "osv" and one["fixedVersion"] and one["status"] == "open"
    assert one["author"] == "OSV-Scanner" and one["createdBy"] is None

    assert await _ledger(scan["id"]) == ["security_scan.queued", "security_scan.completed"]


async def test_second_scan_dedupes_instead_of_duplicating(client, fakes, scanner):
    pid, _ = await _story(client)
    await _scan(client, pid)
    again = await _scan(client, pid)
    assert again["newFindings"] == 0 and again["resolvedFindings"] == 0
    assert len(await _findings(client, pid)) == 11


async def test_critical_finding_closes_the_gate_and_blocks_qa_signoff(client, fakes, scanner):
    pid, story = await _story(client)
    sid = story["id"]
    await _set_status(sid, "ready_for_qa")
    r = await client.post(
        f"/api/projects/{pid}/test-scenarios",
        headers=as_(PM),
        json={"title": "Discount applies", "issue_id": sid, "expected_result": "90.00"},
    )
    await client.patch(f"/api/test-scenarios/{r.json()['id']}", headers=as_(PM), json={"status": "passed"})

    scanner.report = _with_critical(SAMPLE)
    scan = await _scan(client, pid)
    assert scan["counts"]["CRITICAL"] == 1 and scan["gate"] == "blocked"

    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["gate"]["open"] is False
    assert "CRITICAL" in summary["gate"]["blockers"][0]

    r = await client.post(f"/api/issues/{sid}/qa-signoff", headers=as_(PM))
    assert r.status_code == 409 and "Security gate closed" in r.text

    # Fix it upstream, rescan: the finding is verified fixed and QA can proceed.
    scanner.report = SAMPLE
    fixed = await _scan(client, pid)
    assert fixed["resolvedFindings"] == 1 and fixed["gate"] == "passed"
    crit = next(f for f in await _findings(client, pid) if f["osvId"] == "CVE-2099-0001")
    assert crit["status"] == "verified_fixed"

    r = await client.post(f"/api/issues/{sid}/qa-signoff", headers=as_(PM))
    assert r.status_code == 200 and r.json()["status"] == "done"


async def test_reappearing_finding_is_reopened_and_waiver_is_respected(client, fakes, scanner):
    pid, _ = await _story(client)
    scanner.report = _with_critical(SAMPLE)
    await _scan(client, pid)
    crit = next(f for f in await _findings(client, pid) if f["osvId"] == "CVE-2099-0001")

    scanner.report = SAMPLE
    await _scan(client, pid)
    after = next(f for f in await _findings(client, pid) if f["id"] == crit["id"])
    assert after["status"] == "verified_fixed"

    scanner.report = _with_critical(SAMPLE)
    again = await _scan(client, pid)
    assert again["newFindings"] == 0
    back = next(f for f in await _findings(client, pid) if f["id"] == crit["id"])
    assert back["status"] == "open"
    assert "security_finding.reopened" in await _ledger(crit["id"])

    # A waiver needs a reason; once granted the gate opens and a rescan leaves it alone.
    r = await client.patch(f"/api/security-findings/{crit['id']}", headers=as_(PM), json={"status": "waived"})
    assert r.status_code == 422
    r = await client.patch(
        f"/api/security-findings/{crit['id']}",
        headers=as_(PM),
        json={"status": "waived", "reason": "Not reachable: the vulnerable code path is unused."},
    )
    assert r.status_code == 200
    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["gate"]["open"] is True and summary["waived"] == 1
    await _scan(client, pid)
    kept = next(f for f in await _findings(client, pid) if f["id"] == crit["id"])
    assert kept["status"] == "waived"


async def test_assign_files_an_issue_and_notifies_the_developer(client, fakes, scanner):
    pid, _ = await _story(client)
    await _scan(client, pid)
    finding = (await _findings(client, pid))[0]
    dev = await _uid(client, DEV)

    r = await client.post(
        f"/api/security-findings/{finding['id']}/assign", headers=as_(PM), json={"assignee_id": dev}
    )
    assert r.status_code == 200, r.text
    assert r.json()["assigneeId"] == dev and r.json()["status"] == "in_remediation"

    async with db.sessionmaker()() as s:
        issue = await s.scalar(select(Issue).where(Issue.labels.contains([f"finding:{finding['id']}"])))
        assert issue is not None and issue.type == "security" and str(issue.assignee_id) == dev
        ev = await s.scalar(
            select(ActivityEvent).where(
                ActivityEvent.type == "security_assigned", ActivityEvent.target_id == finding["id"]
            )
        )
        assert ev is not None and str(ev.recipient_id) == dev and "vulnerability" in ev.summary
    assert "security_finding.assigned" in await _ledger(finding["id"])

    # Assigning again reuses the same issue.
    await client.post(f"/api/security-findings/{finding['id']}/assign", headers=as_(PM), json={"assignee_id": dev})
    async with db.sessionmaker()() as s:
        n = len((await s.scalars(select(Issue).where(Issue.labels.contains([f"finding:{finding['id']}"])))).all())
    assert n == 1


async def test_fix_suggestion_falls_back_to_labelled_advice_without_an_llm(client, fakes, scanner, monkeypatch):
    from app.ai import llm

    monkeypatch.setattr(llm, "text_configured", lambda: False)
    pid, _ = await _story(client)
    await _scan(client, pid)
    finding = (await _findings(client, pid))[0]
    r = await client.post(f"/api/security-findings/{finding['id']}/fix-suggestion", headers=as_(PM))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "scanner" and "No AI model" in body["note"] and body["markdown"]
    saved = next(f for f in await _findings(client, pid) if f["id"] == finding["id"])
    assert saved["aiFix"]["source"] == "scanner"
    assert "security_finding.fix_suggested" in await _ledger(finding["id"])


async def test_fix_suggestion_from_the_model_is_labelled_ai_generated(client, fakes, scanner, monkeypatch):
    from app.ai import llm

    async def fake_text(**kwargs):
        return "Upgrade requests to 2.32.4 and rerun the tests."

    monkeypatch.setattr(llm, "text_configured", lambda: True)
    monkeypatch.setattr(llm, "generate_text", fake_text)
    pid, _ = await _story(client)
    await _scan(client, pid)
    finding = (await _findings(client, pid))[0]
    body = (await client.post(f"/api/security-findings/{finding['id']}/fix-suggestion", headers=as_(PM))).json()
    assert body["source"] == "ai" and body["label"] == "AI-generated, unverified"
    assert "Upgrade requests" in body["markdown"]


async def test_policy_is_for_leads_and_critical_always_blocks(client, fakes, scanner):
    pid, _ = await _story(client)
    body = {"block_severities": ["CRITICAL", "HIGH"], "require_scan": True, "auto_scan": True}
    r = await client.put(f"/api/projects/{pid}/security-policy", headers=as_(PM), json=body)
    assert r.status_code == 200 and r.json()["blockSeverities"] == ["CRITICAL", "HIGH"]
    r = await client.put(
        f"/api/projects/{pid}/security-policy", headers=as_(PM), json={**body, "block_severities": ["HIGH"]}
    )
    assert r.status_code == 422

    # With HIGH blocking, the sample's four HIGH findings close the gate.
    scan = await _scan(client, pid)
    assert scan["gate"] == "blocked"
    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["policy"]["requireScan"] is True and summary["gate"]["open"] is False
    assert "security_policy.updated" in await _ledger(pid)


async def test_require_scan_closes_the_gate_until_a_scan_has_run(client, fakes, scanner):
    pid, _ = await _story(client)
    body = {"block_severities": ["CRITICAL"], "require_scan": True, "auto_scan": True}
    await client.put(f"/api/projects/{pid}/security-policy", headers=as_(PM), json=body)
    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["gate"]["open"] is False and "no dependency scan" in summary["gate"]["blockers"][0]
    await _scan(client, pid)
    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["gate"]["open"] is True


async def test_failed_scan_is_recorded_and_never_passes_the_gate(client, fakes, scanner):
    pid, _ = await _story(client)
    await client.put(
        f"/api/projects/{pid}/security-policy",
        headers=as_(PM),
        json={"block_severities": ["CRITICAL"], "require_scan": True, "auto_scan": True},
    )
    scanner.error = osv_scan.ScanError("OSV-Scanner could not reach osv.dev.")
    scan = await _scan(client, pid)
    assert scan["status"] == "failed" and "osv.dev" in scan["error"]
    summary = (await client.get(f"/api/projects/{pid}/security-summary", headers=as_(PM))).json()
    assert summary["gate"]["open"] is False and "failed" in summary["gate"]["blockers"][0]
    assert "security_scan.failed" in await _ledger(scan["id"])

    scanner.error = None
    assert (await _scan(client, pid))["status"] == "succeeded"


async def test_scan_needs_a_repository(client, fakes, scanner, monkeypatch):
    monkeypatch.delenv("DEMO_REPO_URL")
    get_settings.cache_clear()
    pid, _ = await _story(client)
    r = await client.post(f"/api/projects/{pid}/security-scans", headers=as_(PM), json={})
    assert r.status_code == 409 and "repository" in r.text


async def test_scan_of_a_pull_request_branch_and_its_own_gate(client, fakes, scanner):
    """A PR is judged on its own scan, not on the project's backlog."""
    pid, _ = await _story(client)
    async with db.sessionmaker()() as s:
        epic = Epic(
            id=uuid.uuid4(), project_id=uuid.UUID(pid), title="Discounts", description="d",
            source_quote="q", position=1,
        )
        s.add(epic)
        await s.flush()
        task = Task(
            id=uuid.uuid4(), project_id=uuid.UUID(pid), epic_id=epic.id, key="T-1", title="Apply discount",
        )
        s.add(task)
        await s.flush()
        run = Run(
            id=uuid.uuid4(), task_id=task.id, project_id=task.project_id, backend="test",
            requested_by=await s.scalar(select(User.id).limit(1)),
        )
        s.add(run)
        await s.flush()
        pr = PullRequest(
            id=uuid.uuid4(), task_id=task.id, run_id=run.id, number=7, url="https://example.invalid/pr/7",
            branch="karkhana/t-1-abc12345", head_sha="b" * 40, tests_passed=True,
        )
        s.add(pr)
        await s.commit()
        pr_id = str(pr.id)

    scanner.report = _with_critical(SAMPLE)
    r = await client.post(f"/api/projects/{pid}/security-scans", headers=as_(PM), json={"pr_id": pr_id})
    assert r.status_code == 202, r.text
    scan = await _wait(client, r.json()["id"])
    assert scanner.calls[-1] == "karkhana/t-1-abc12345"
    assert scan["prId"] == pr_id and scan["ref"] == "karkhana/t-1-abc12345" and scan["gate"] == "blocked"

    async with db.sessionmaker()() as s:
        project = await s.get(Project, uuid.UUID(pid))
        pull = await s.get(PullRequest, uuid.UUID(pr_id))
        assert await osv_scan.gate_blockers(s, project, pr=pull)  # PR is blocked.
        assert await osv_scan.gate_blockers(s, project) == []  # Base branch was never scanned.

    # Another project's PR cannot be scanned through this project.
    other, _ = await _story(client)
    r = await client.post(f"/api/projects/{other}/security-scans", headers=as_(PM), json={"pr_id": pr_id})
    assert r.status_code == 404


async def test_report_has_counts_gate_and_markdown(client, fakes, scanner):
    pid, _ = await _story(client)
    scanner.report = _with_critical(SAMPLE)
    await _scan(client, pid)
    r = await client.get(f"/api/projects/{pid}/security-report", headers=as_(PM))
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["open"]["CRITICAL"] == 1 and rep["gate"]["open"] is False
    md = rep["markdown"]
    assert "# Security report" in md and "Gate: BLOCKED" in md and "CVE-2099-0001" in md


async def test_scan_history_lists_newest_first(client, fakes, scanner):
    pid, _ = await _story(client)
    first = await _scan(client, pid)
    second = await _scan(client, pid)
    rows = (await client.get(f"/api/projects/{pid}/security-scans", headers=as_(PM))).json()
    assert [r["id"] for r in rows][:2] == [second["id"], first["id"]]


async def test_recover_stale_fails_scans_left_running_by_a_restart(client, fakes, scanner):
    pid, _ = await _story(client)
    async with db.sessionmaker()() as s:
        project = await s.get(Project, uuid.UUID(pid))
        scan, _ = await osv_scan.enqueue(s, project, trigger="manual")
        scan.status = "running"
        scan.created_at = scan.created_at.replace(year=2020)
        await s.commit()
        sid = scan.id
    assert await osv_scan.recover_stale() >= 1
    async with db.sessionmaker()() as s:
        got = await s.get(SecurityScan, sid)
        assert got.status == "failed" and got.error


async def test_findings_from_the_scanner_have_no_human_author(client, fakes, scanner):
    pid, _ = await _story(client)
    await _scan(client, pid)
    async with db.sessionmaker()() as s:
        rows = (await s.scalars(select(SecurityFinding).where(SecurityFinding.project_id == uuid.UUID(pid)))).all()
        assert rows and all(r.created_by is None and r.source == "osv" for r in rows)


# ── Wired into the build and review flow ─────────────────────────────────────


@pytest.fixture
def published(monkeypatch):
    """The control plane "pushes" the patch: a branch exists, no network is touched."""
    from app import publisher

    async def fake_publish(**kw):
        branch = f"karkhana/{kw['task_key'].lower()}-{kw['run_id'].hex[:8]}"
        return publisher.Published(branch, int(kw["run_id"].int % 900_000) + 100_000, f"local://{branch}", "c" * 40, False)

    monkeypatch.setattr(publisher, "publish", fake_publish)


async def _finished_run(client, name):
    """A project whose first task finished a run, so it has a pull request."""
    from app.runner.base import run_token
    from tests.integration.test_golden_path import _approved_project

    pid, tasks = await _approved_project(client, name)
    tid = tasks[0]["id"]
    run_id = (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).json()["id"]
    result = {
        "ok": True,
        "patch": "diff --git a b",
        "test_command": "pytest -q",
        "test_exit_code": 0,
        "test_output": "3 passed",
        "review": [],
        "reviewed": True,
    }
    r = await client.post(
        f"/internal/runs/{run_id}/complete",
        json=result,
        headers={"Authorization": f"Run {run_token(run_id)}"},
    )
    assert r.status_code == 200, r.text
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    return pid, tid, pr


async def _review_cleared(client, pid, pr):
    """Everything but security is satisfied: a second reviewer approves."""
    lead = (await client.get("/api/me", headers=as_(LEAD))).json()["id"]
    r = await client.post(
        f"/api/projects/{pid}/members",
        json={"user_id": lead, "role": "lead", "stations": ["developer"]},
        headers=as_(PM),
    )
    assert r.status_code in (200, 201), r.text
    r = await client.post(f"/api/prs/{pr['id']}/approve", json={"note": "Reads well"}, headers=as_(LEAD))
    assert r.status_code == 200, r.text


async def _wait_for_pr_scan(client, pid, tries=100):
    for _ in range(tries):
        rows = (await client.get(f"/api/projects/{pid}/security-scans", headers=as_(PM))).json()
        done = [r for r in rows if r["status"] in ("succeeded", "failed")]
        if done:
            return done[0]
        await asyncio.sleep(0.05)
    raise AssertionError("no pull request scan finished")


async def test_finishing_a_run_scans_the_pull_request_automatically(client, fakes, scanner, published):
    scanner.report = _with_critical(SAMPLE)
    pid, _, pr = await _finished_run(client, "Auto scan")
    scan = await _wait_for_pr_scan(client, pid)
    assert scan["trigger"] == "pr" and scan["prId"] == pr["id"] and scan["gate"] == "blocked"
    assert scanner.calls and scanner.calls[0] == scan["ref"] and scan["ref"].startswith("karkhana/")
    # The developer who built it is told, and the lead too.
    async with db.sessionmaker()() as s:
        n = await s.scalar(
            select(func.count()).select_from(ActivityEvent).where(
                ActivityEvent.type == "security_scan", ActivityEvent.target_id == scan["id"]
            )
        )
    assert n >= 1


async def test_a_blocked_pull_request_cannot_be_merged_until_it_is_fixed(client, fakes, scanner, published):
    scanner.report = _with_critical(SAMPLE)
    pid, _, pr = await _finished_run(client, "Merge gate")
    scan = await _wait_for_pr_scan(client, pid)
    assert scan["gate"] == "blocked"
    await _review_cleared(client, pid, pr)

    r = await client.post(f"/api/prs/{pr['id']}/merge", headers=as_(DEV))
    assert r.status_code == 409 and "security gate closed" in r.text

    # The developer upgrades the dependency; a rescan of the same PR clears it.
    scanner.report = SAMPLE
    r = await client.post(f"/api/projects/{pid}/security-scans", headers=as_(DEV), json={"pr_id": pr["id"]})
    assert r.status_code == 202, r.text
    assert (await _wait(client, r.json()["id"], DEV))["gate"] == "passed"
    r = await client.post(f"/api/prs/{pr['id']}/merge", headers=as_(DEV))
    assert r.status_code == 200, r.text

    # Merging queues a rescan of the base branch so the merged code is judged.
    for _ in range(100):
        rows = (await client.get(f"/api/projects/{pid}/security-scans", headers=as_(PM))).json()
        if any(x["trigger"] == "merge" and x["status"] == "succeeded" for x in rows):
            break
        await asyncio.sleep(0.05)
    else:
        raise AssertionError("no post-merge scan ran")


async def test_auto_scan_can_be_turned_off_per_project(client, fakes, scanner, published):
    from app.runner.base import run_token
    from tests.integration.test_golden_path import _approved_project

    pid, tasks = await _approved_project(client, "No auto scan")
    r = await client.put(
        f"/api/projects/{pid}/security-policy",
        headers=as_(PM),
        json={"block_severities": ["CRITICAL"], "require_scan": False, "auto_scan": False},
    )
    assert r.status_code == 200
    run_id = (await client.post(f"/api/tasks/{tasks[0]['id']}/runs", headers=as_(DEV))).json()["id"]
    r = await client.post(
        f"/internal/runs/{run_id}/complete",
        json={"ok": True, "patch": "diff --git a b", "test_exit_code": 0, "reviewed": True, "review": []},
        headers={"Authorization": f"Run {run_token(run_id)}"},
    )
    assert r.status_code == 200
    await asyncio.sleep(0.3)
    assert (await client.get(f"/api/projects/{pid}/security-scans", headers=as_(PM))).json() == []
    assert scanner.calls == []
