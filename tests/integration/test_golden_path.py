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

"""Drives the whole demo through the HTTP API against real Postgres.

Covers the "Done when" checks for A1-A7, A9 (records), A10, B1-B3 and B5.
Gemini is replaced with FakeGemini; the worker is replaced by posting its
HMAC-authenticated callback, exactly as the real worker does.
"""

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from app.ai import llm
from app.runner import base as runner_base
from app.runner.base import BackendStatus, StartedRun, run_token
from tests.fakes import IDEAS, FakeGemini

pytestmark = pytest.mark.usefixtures("database")

PM, DIR, DEV, LEAD = (
    f"{r}@karkhana.dev" for r in ("pm", "director", "developer", "lead")
)


class RecordingBackend:
    name = "test"

    def __init__(self):
        self.started: list[uuid.UUID] = []

    async def start(self, run_id, env_class):
        self.started.append(run_id)
        return StartedRun(external_id=f"test-{run_id}")

    async def status(self, external_id):
        return BackendStatus("running")

    async def cancel(self, external_id):
        pass

    def describe(self):
        return {"backend": "test"}


@pytest.fixture(scope="module")
async def client(database):
    from app.config import get_settings

    get_settings.cache_clear()
    from app import db
    from app.fast_api_app import create_app
    from app.scripts.seed import seed

    await db.dispose()
    await seed("karkhana.dev", firebase=False, history=False)
    app = create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as c:
        yield c
    await db.dispose()


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    fake = FakeGemini()
    monkeypatch.setattr(llm, "generate_structured", fake.generate)
    monkeypatch.setattr(llm, "embed", fake.embed)
    backend = RecordingBackend()
    monkeypatch.setattr(runner_base, "get_backend", lambda: backend)
    import app.routers.runs as runs_router

    monkeypatch.setattr(runs_router, "get_backend", lambda: backend)
    return fake, backend


def as_(email):
    return {"X-Dev-User": email}


async def wait_for_stage(client, pid, status, tries=50):
    for _ in range(tries):
        r = await client.get(f"/api/projects/{pid}", headers=as_(PM))
        if r.json()["project"]["stage_status"] == status:
            return r.json()
        await asyncio.sleep(0.05)
    raise AssertionError(f"project never reached {status}: {r.json()['project']}")


async def test_unknown_or_missing_user_is_rejected(client):
    assert (await client.get("/api/me")).status_code == 401
    assert (
        await client.get("/api/me", headers=as_("stranger@example.com"))
    ).status_code == 403
    assert (await client.get("/api/me", headers=as_(DIR))).json()["role"] == "director"


async def test_golden_path(client, fakes):
    _fake, backend = fakes
    idea = IDEAS["discounts"]

    # A2: any signed-in team member may submit (access to the result is governed
    # by workspace membership and project stations, see test_project_access).
    r = await client.post(
        "/api/projects",
        json={"name": idea["name"], "idea_text": idea["idea_text"]},
        headers=as_(PM),
    )
    assert r.status_code == 202, r.text
    pid = r.json()["id"]

    # A3: validated evaluation with real fields and verbatim source quotes.
    detail = await wait_for_stage(client, pid, "evaluated")
    ev = detail["evaluation"]["result"]
    assert 3 <= len(ev["epics"]) <= 5
    assert all(
        e["source_quote"].lower()[:20] in idea["idea_text"].lower() for e in ev["epics"]
    )
    assert ev["memory_note"] == "no relevant memory"
    assert all(t["status"] == "draft" for t in detail["tasks"])

    # A1/A4: /approve is 403 for every non-director, even called directly.
    for who in (PM, DEV, LEAD):
        r = await client.post(
            f"/api/projects/{pid}/approve",
            json={"decision": "approved"},
            headers=as_(who),
        )
        assert r.status_code == 403
    # A developer cannot start a run on a Draft task either.
    tid = detail["tasks"][0]["id"]
    assert (
        await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))
    ).status_code == 409

    r = await client.post(
        f"/api/projects/{pid}/approve",
        json={"decision": "approved", "reason": "Narrow scope"},
        headers=as_(DIR),
    )
    assert r.status_code == 200 and r.json()["decision"] == "approved"
    # Approving twice is refused by the transition table.
    r = await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(DIR)
    )
    assert r.status_code == 409

    # A7: tasks became Ready only after approval.
    board = (await client.get(f"/api/projects/{pid}/board", headers=as_(DEV))).json()[
        "columns"
    ]
    assert not board["draft"] and len(board["ready"]) == len(detail["tasks"])

    # A8: developer assigns to agent; a PM may not.
    assert (
        await client.post(f"/api/tasks/{tid}/runs", headers=as_(PM))
    ).status_code == 403
    r = await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    assert backend.started == [uuid.UUID(run_id)]

    # Worker callbacks need the per-run HMAC token.
    assert (
        await client.get(
            f"/internal/runs/{run_id}/spec", headers={"Authorization": "Run nope"}
        )
    ).status_code == 401
    auth = {"Authorization": f"Run {run_token(run_id)}"}
    spec = (await client.get(f"/internal/runs/{run_id}/spec", headers=auth)).json()
    assert spec["task_key"].startswith("KAR-") and spec["acceptance_criteria"]
    await client.post(
        f"/internal/runs/{run_id}/progress", json={"phase": "coding"}, headers=auth
    )

    review = [
        {
            "path": "invoicekit/discounts.py",
            "severity": "high",
            "body": "Validate percent at creation.",
        },
        {
            "path": "invoicekit/invoice.py",
            "severity": "medium",
            "body": "Quantize the discount before subtracting.",
        },
        {
            "path": "tests/test_discounts.py",
            "severity": "low",
            "body": "Test the expiry boundary.",
        },
    ]
    result = {
        "ok": True,
        "patch": "diff --git a b",
        "test_command": "pytest -q",
        "test_exit_code": 0,
        "test_output": "19 passed",
        "review": review,
        "reviewed": True,
    }
    assert (
        await client.post(
            f"/internal/runs/{run_id}/complete", json=result, headers=auth
        )
    ).status_code == 200
    # Idempotent: a late duplicate callback changes nothing.
    r = await client.post(
        f"/internal/runs/{run_id}/complete",
        json={**result, "test_exit_code": 1},
        headers=auth,
    )
    assert r.json()["note"] == "already final"
    run = (await client.get(f"/api/runs/{run_id}", headers=as_(DEV))).json()
    assert run["status"] == "succeeded" and run["test_exit_code"] == 0

    # A10: merge is blocked until every AI comment is triaged.
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert pr["tests_passed"] and len(pr["comments"]) == 3 and not pr["can_merge"]
    assert (
        await client.post(f"/api/prs/{pr['id']}/merge", headers=as_(DEV))
    ).status_code == 409
    c1, c2, c3 = pr["comments"]
    assert (
        await client.post(
            f"/api/comments/{c1['id']}/triage",
            json={"triage": "dismissed"},
            headers=as_(DEV),
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/comments/{c1['id']}/triage",
            json={"triage": "valid"},
            headers=as_(PM),
        )
    ).status_code == 403
    await client.post(
        f"/api/comments/{c1['id']}/triage", json={"triage": "valid"}, headers=as_(DEV)
    )
    await client.post(
        f"/api/comments/{c2['id']}/triage", json={"triage": "valid"}, headers=as_(DEV)
    )
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert pr["merge_blockers"] == ["1 AI comment(s) not triaged"]
    await client.post(
        f"/api/comments/{c3['id']}/triage",
        json={"triage": "dismissed", "reason": "Covered by an existing test"},
        headers=as_(DEV),
    )
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert pr["can_merge"]

    # B1: merge captures an unverified learning linked to the PR and comments.
    r = await client.post(f"/api/prs/{pr['id']}/merge", headers=as_(DEV))
    assert r.status_code == 200, r.text
    learning = r.json()
    assert learning["status"] == "unverified"
    assert learning["source"]["pr_number"] == pr["number"]
    assert len(learning["source"]["comment_ids"]) == 3

    # B2: only a lead (or director) verifies; it records who and when.
    assert (
        await client.post(f"/api/learnings/{learning['id']}/verify", headers=as_(DEV))
    ).status_code == 403
    r = await client.post(f"/api/learnings/{learning['id']}/verify", headers=as_(LEAD))
    assert r.json()["status"] == "verified" and r.json()["verified_at"]

    # B3: project #2 cites the verified learning, enriched from the database.
    idea2 = IDEAS["refunds"]
    r = await client.post(
        "/api/projects",
        json={"name": idea2["name"], "idea_text": idea2["idea_text"]},
        headers=as_(PM),
    )
    pid2 = r.json()["id"]
    detail2 = await wait_for_stage(client, pid2, "evaluated")
    cites = detail2["evaluation"]["citations"]
    assert len(cites) == 1 and cites[0]["learning_id"] == learning["id"]
    assert (
        cites[0]["source_project"] == idea["name"] and cites[0]["verified_by"] == LEAD
    )

    # A6/B5: stage tracker and portfolio reflect DB state; nothing claims production-ready.
    p1 = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()["project"]
    assert (p1["stage"], p1["stage_status"]) == ("qa", "pending")
    rows = {
        r["id"]: r
        for r in (await client.get("/api/portfolio", headers=as_(DIR))).json()
    }
    gates = {g["stage"]: g["state"] for g in rows[pid]["gates"]}
    assert gates["evaluate"] == "passed" and gates["review"] == "passed"
    assert gates["qa"] == "pending" and gates["security"] == "pending"
    assert rows[pid]["production_ready"] is False

    # A5: the ledger recorded everything and the chain verifies.
    entries = (
        await client.get(f"/api/ledger?project_id={pid}&limit=500", headers=as_(DIR))
    ).json()
    actions = {e["action"] for e in entries}
    for expected in [
        "project.created",
        "stage.evaluated",
        "approval.approved",
        "tasks.ready",
        "run.requested",
        "run.completed",
        "pr.opened",
        "review.posted",
        "comment.valid",
        "comment.dismissed",
        "pr.merged",
        "learning.captured",
        "learning.verified",
        "stage.merged",
    ]:
        assert expected in actions, expected
    skipped = next(e for e in entries if e["action"] == "stage.approve")["payload"][
        "skipped_planned_stages"
    ]
    assert skipped == ["onboard", "design", "architecture"]
    chain = (await client.get("/api/ledger/verify", headers=as_(PM))).json()
    assert chain["ok"] and chain["entries"] >= len(entries)


async def test_failed_run_returns_task_to_ready(client, fakes):
    idea = IDEAS["discounts"]
    pid = (
        await client.post(
            "/api/projects",
            json={"name": "Retry", "idea_text": idea["idea_text"]},
            headers=as_(PM),
        )
    ).json()["id"]
    detail = await wait_for_stage(client, pid, "evaluated")
    await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(DIR)
    )
    tid = detail["tasks"][0]["id"]
    run_id = (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).json()[
        "id"
    ]
    auth = {"Authorization": f"Run {run_token(run_id)}"}
    r = await client.post(
        f"/internal/runs/{run_id}/complete",
        json={"ok": False, "error": "tests failed", "test_exit_code": 1},
        headers=auth,
    )
    assert r.json()["status"] == "failed"
    board = (await client.get(f"/api/projects/{pid}/board", headers=as_(DEV))).json()[
        "columns"
    ]
    assert tid in {t["id"] for t in board["ready"]}
    p = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()["project"]
    assert (p["stage"], p["stage_status"]) == ("implement", "failed")
    # The developer can try again.
    assert (
        await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))
    ).status_code == 202


async def test_rejection_and_resubmit(client, fakes):
    idea = IDEAS["refunds"]
    pid = (
        await client.post(
            "/api/projects",
            json={"name": "Reject me", "idea_text": idea["idea_text"]},
            headers=as_(PM),
        )
    ).json()["id"]
    await wait_for_stage(client, pid, "evaluated")
    r = await client.post(
        f"/api/projects/{pid}/approve",
        json={"decision": "rejected", "reason": "Tax rules unclear"},
        headers=as_(DIR),
    )
    assert r.json()["decision"] == "rejected"
    assert (
        await client.post(f"/api/projects/{pid}/evaluate", headers=as_(DEV))
    ).status_code == 403
    assert (
        await client.post(f"/api/projects/{pid}/evaluate", headers=as_(PM))
    ).status_code == 202
    await wait_for_stage(client, pid, "evaluated")


async def _approved_project(client, name):
    idea = IDEAS["discounts"]
    pid = (
        await client.post(
            "/api/projects",
            json={"name": name, "idea_text": idea["idea_text"]},
            headers=as_(PM),
        )
    ).json()["id"]
    detail = await wait_for_stage(client, pid, "evaluated")
    await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(DIR)
    )
    return pid, detail["tasks"]


async def test_concurrent_runs_keep_project_and_tasks_consistent(client, fakes):
    pid, tasks = await _approved_project(client, "Concurrent")
    t1, t2 = tasks[0]["id"], tasks[1]["id"]
    r1 = (await client.post(f"/api/tasks/{t1}/runs", headers=as_(DEV))).json()["id"]
    r2 = (await client.post(f"/api/tasks/{t2}/runs", headers=as_(DEV))).json()["id"]
    ok = {
        "ok": True,
        "patch": "d",
        "test_command": "pytest",
        "test_exit_code": 0,
        "test_output": "ok",
        "review": [],
        "reviewed": True,
    }
    await client.post(
        f"/internal/runs/{r1}/complete",
        json=ok,
        headers={"Authorization": f"Run {run_token(r1)}"},
    )
    # Run 2 fails after the project already moved to PR: recorded, task back to Ready.
    await client.post(
        f"/internal/runs/{r2}/complete",
        json={"ok": False, "error": "boom"},
        headers={"Authorization": f"Run {run_token(r2)}"},
    )
    board = (await client.get(f"/api/projects/{pid}/board", headers=as_(DEV))).json()[
        "columns"
    ]
    assert t2 in {t["id"] for t in board["ready"]} and t1 in {
        t["id"] for t in board["review"]
    }
    p = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()["project"]
    assert (p["stage"], p["stage_status"]) == (
        "review",
        "triage",
    )  # Run 2 did not roll it back.
    actions = [
        e["action"]
        for e in (
            await client.get(f"/api/ledger?project_id={pid}", headers=as_(PM))
        ).json()
    ]
    assert "run.failed" in actions and "stage.run_failed" in actions
    assert "stage.event_not_applied" not in actions


async def test_missing_review_can_be_retried(client, fakes):
    _pid, tasks = await _approved_project(client, "Reviewer outage")
    tid = tasks[0]["id"]
    rid = (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).json()["id"]
    res = {
        "ok": True,
        "patch": "diff --git a/x b/x",
        "test_command": "pytest",
        "test_exit_code": 0,
        "test_output": "ok",
        "review": [],
    }
    await client.post(
        f"/internal/runs/{rid}/complete",
        json=res,
        headers={"Authorization": f"Run {run_token(rid)}"},
    )
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert "No AI review recorded" in pr["merge_blockers"]

    from app.review import engine as review_engine
    from app.review.types import ReviewResult
    from tests import fixtures as fallbacks

    async def fake_reviewer(diff, **kw):
        return ReviewResult("test", "test", list(fallbacks.review().comments))

    coder_run = review_engine.review_diff
    review_engine.review_diff = fake_reviewer
    try:
        r = await client.post(f"/api/prs/{pr['id']}/review", headers=as_(DEV))
    finally:
        review_engine.review_diff = coder_run
    assert r.status_code == 200 and len(r.json()["comments"]) == 4
    assert (
        await client.post(f"/api/prs/{pr['id']}/review", headers=as_(DEV))
    ).status_code == 409


async def test_run_limit_blocks_a_second_concurrent_run(client, fakes, monkeypatch):
    from app.config import get_settings

    _pid, tasks = await _approved_project(client, "Run limit")
    monkeypatch.setattr(get_settings(), "max_active_runs_per_project", 1)
    assert (
        await client.post(f"/api/tasks/{tasks[0]['id']}/runs", headers=as_(DEV))
    ).status_code == 202
    r = await client.post(f"/api/tasks/{tasks[1]['id']}/runs", headers=as_(DEV))
    assert r.status_code == 429


async def test_failing_tests_are_never_reported_as_success(client, fakes):
    _pid, tasks = await _approved_project(client, "Red tests")
    tid = tasks[0]["id"]
    rid = (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).json()["id"]
    res = {
        "ok": True,
        "patch": "diff --git a/x b/x",
        "test_command": "python -m pytest",
        "test_exit_code": 1,
        "test_output": "1 failed",
        "review": [],
    }
    r = await client.post(
        f"/internal/runs/{rid}/complete",
        json=res,
        headers={"Authorization": f"Run {run_token(rid)}"},
    )
    assert r.json() == {"status": "succeeded", "validation": "failed"}
    run = (await client.get(f"/api/runs/{rid}", headers=as_(DEV))).json()
    assert run["status"] == "succeeded" and run["validation_status"] == "failed"
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert (
        not pr["tests_passed"]
        and "Tests failed in the worker run" in pr["merge_blockers"]
    )


async def test_concurrent_review_retries_post_one_review(client, fakes):
    import asyncio as aio

    from app.review import engine as review_engine
    from app.review.types import ReviewResult
    from tests import fixtures as fallbacks

    _pid, tasks = await _approved_project(client, "Retry race")
    tid = tasks[0]["id"]
    rid = (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).json()["id"]
    res = {
        "ok": True,
        "patch": "diff --git a/x b/x",
        "test_command": "python -m pytest",
        "test_exit_code": 0,
        "test_output": "ok",
        "review": [],
    }
    await client.post(
        f"/internal/runs/{rid}/complete",
        json=res,
        headers={"Authorization": f"Run {run_token(rid)}"},
    )
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()

    async def slow_reviewer(diff, **kw):
        await aio.sleep(0.3)  # Both requests are in flight at once.
        return ReviewResult("test", "test", list(fallbacks.review().comments))

    original = review_engine.review_diff
    review_engine.review_diff = slow_reviewer
    try:
        r1, r2 = await aio.gather(
            client.post(f"/api/prs/{pr['id']}/review", headers=as_(DEV)),
            client.post(f"/api/prs/{pr['id']}/review", headers=as_(DEV)),
        )
    finally:
        review_engine.review_diff = original
    assert sorted([r1.status_code, r2.status_code]) == [200, 409]
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert len(pr["comments"]) == 4  # Not 8.
