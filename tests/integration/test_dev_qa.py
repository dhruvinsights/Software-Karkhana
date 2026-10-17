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

"""Developer and QA accountability: manual checks, the bug lifecycle, the dev board."""

from __future__ import annotations

import uuid

from sqlalchemy import update

from app import db
from app.models import Issue
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    PM,
    as_,
    client,
    fakes,
)
from tests.integration.test_idea_approvals import _approved_idea, _uid


async def _story(client):
    """A launched project with an approved plan; its story is assigned to DEV."""
    idea = await _approved_idea(client, f"Dev QA {uuid.uuid4().hex[:6]}")
    dev = await _uid(client, DEV)
    r = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={"leads": [{"user_id": dev, "role": "developer", "is_lead": True}]},
    )
    pid = r.json()["projectId"]
    assert (await client.post(f"/api/projects/{pid}/plan/approve", headers=as_(PM))).status_code == 200
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    [story] = board["stories"]
    assert story["layer"] == "backend" and story["run"] is None and story["devCheck"] is None
    r = await client.patch(f"/api/issues/{story['id']}", headers=as_(DEV), json={"assignee_id": dev})
    assert r.status_code == 200, r.text
    return pid, story


async def _set_status(issue_id, status):
    async with db.sessionmaker()() as s:
        await s.execute(update(Issue).where(Issue.id == uuid.UUID(issue_id)).values(status=status))
        await s.commit()


def _all_ticked(story):
    return [{"text": c, "ok": True} for c in story["acceptanceCriteria"]]


async def test_manual_check_is_required_before_qa_signs_off(client, fakes):
    pid, story = await _story(client)
    sid = story["id"]
    check = {"criteria": _all_ticked(story), "notes": "Ran the discount flow by hand on staging."}

    # No code yet: nothing to check.
    r = await client.post(f"/api/issues/{sid}/dev-check", headers=as_(DEV), json=check)
    assert r.status_code == 409

    await _set_status(sid, "ready_for_qa")
    r = await client.post(
        f"/api/projects/{pid}/test-scenarios",
        headers=as_(PM),
        json={"title": "Discount applies", "issue_id": sid, "expected_result": "90.00"},
    )
    scenario = r.json()["id"]
    await client.patch(f"/api/test-scenarios/{scenario}", headers=as_(PM), json={"status": "passed"})
    r = await client.post(f"/api/issues/{sid}/qa-signoff", headers=as_(PM))
    assert r.status_code == 409 and "manual check" in r.text

    # Every criterion must be confirmed, with real notes.
    partial = {"criteria": _all_ticked(story)[:-1], "notes": check["notes"]}
    assert (await client.post(f"/api/issues/{sid}/dev-check", headers=as_(DEV), json=partial)).status_code == 422
    short = {"criteria": _all_ticked(story), "notes": "ok"}
    assert (await client.post(f"/api/issues/{sid}/dev-check", headers=as_(DEV), json=short)).status_code == 422
    r = await client.post(f"/api/issues/{sid}/dev-check", headers=as_(DEV), json=check)
    assert r.status_code == 200, r.text
    assert r.json()["devCheck"]["notes"] == check["notes"]

    r = await client.post(f"/api/issues/{sid}/qa-signoff", headers=as_(PM))
    assert r.status_code == 200 and r.json()["status"] == "done"


async def test_qa_bug_goes_to_the_developer_and_back(client, fakes):
    pid, story = await _story(client)
    sid = story["id"]
    await _set_status(sid, "ready_for_qa")
    r = await client.post(
        f"/api/projects/{pid}/test-scenarios",
        headers=as_(PM),
        json={"title": "Negative discount rejected", "issue_id": sid, "expected_result": "400"},
    )
    await client.patch(
        f"/api/test-scenarios/{r.json()['id']}",
        headers=as_(PM),
        json={"status": "failed", "actual_result": "200 and a negative total"},
    )
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    [bug] = board["bugs"]
    assert bug["state"] == "new" and bug["assigneeId"] == await _uid(client, DEV)
    assert bug["storyKey"] == story["key"]
    assert board["stories"][0]["bugs"][0]["id"] == bug["id"]
    activity = (await client.get("/api/chat/activity", headers=as_(DEV))).json()
    assert any(a["type"] == "bug_filed" for a in activity)

    bid = bug["id"]
    # QA cannot verify what was never fixed.
    assert (await client.post(f"/api/issues/{bid}/verify", headers=as_(PM), json={"result": "pass"})).status_code == 409
    r = await client.post(f"/api/issues/{bid}/start-fix", headers=as_(DEV))
    assert r.json()["state"] == "fixing"
    r = await client.post(f"/api/issues/{bid}/mark-fixed", headers=as_(DEV), json={"notes": "done"})
    assert r.status_code == 422
    fixed = {"notes": "Rejected negative percent; retried by hand, got 400."}
    r = await client.post(f"/api/issues/{bid}/mark-fixed", headers=as_(DEV), json=fixed)
    assert r.json()["state"] == "fixed"

    # Reopening needs a reason; then it goes back to the developer.
    assert (
        await client.post(f"/api/issues/{bid}/verify", headers=as_(PM), json={"result": "fail"})
    ).status_code == 422
    r = await client.post(
        f"/api/issues/{bid}/verify",
        headers=as_(PM),
        json={"result": "fail", "notes": "Still 200 for -0.5 percent."},
    )
    assert r.json()["state"] == "reopened"
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    assert board["bugs"][0]["reopenCount"] == 1

    await client.post(f"/api/issues/{bid}/mark-fixed", headers=as_(DEV), json=fixed)
    r = await client.post(f"/api/issues/{bid}/verify", headers=as_(PM), json={"result": "pass"})
    assert r.json()["state"] == "verified"


DIFF = """diff --git a/app/discounts.py b/app/discounts.py
--- a/app/discounts.py
+++ b/app/discounts.py
@@ -1,2 +1,4 @@
+def apply(total, percent):
+    return total - total * percent / 100
"""


def _suggestions():
    from app.services.qa_agent import Suggestions

    return Suggestions.model_validate(
        {
            "suggestions": [
                {
                    "title": "Negative percent increases the total",
                    "description": "apply() never validates percent; -10 adds 10%.",
                    "category": "edge_case",
                    "severity": "P1",
                    "steps": ["Apply -10 to 100.00"],
                    "expected": "Rejected with 400",
                    "evidence": [{"path": "app/discounts.py", "line": 2, "note": "no bounds check"}],
                },
                {
                    "title": "Invented problem",
                    "description": "Cites a file that does not exist.",
                    "category": "functional",
                    "severity": "P2",
                    "steps": ["x"],
                    "expected": "y",
                    "evidence": [{"path": "app/imaginary.py"}],
                },
            ]
        }
    )


async def test_qa_agent_suggests_and_qa_decides(client, fakes, monkeypatch):
    from app.ai import llm
    from app.services import qa_agent
    from app.services.qa_agent import Suggestions

    fake, _ = fakes

    async def generate(*, prompt, schema, system, model=None, temperature=0.3, timeout_s=90.0):
        if schema is Suggestions:
            assert "app/discounts.py" in prompt
            return _suggestions()
        return await fake.generate(prompt=prompt, schema=schema, system=system)

    async def change_for(session, story):
        return DIFF

    pid, story = await _story(client)
    sid = story["id"]
    # Not built yet: nothing to review.
    assert (await client.post(f"/api/issues/{sid}/qa-agent", headers=as_(PM))).status_code == 409
    await _set_status(sid, "ready_for_qa")

    board = (await client.get(f"/api/projects/{pid}/qa-board", headers=as_(PM))).json()
    assert board["stories"][0]["stage"] == "waiting_dev_check"

    monkeypatch.setattr(llm, "generate_structured", generate)
    monkeypatch.setattr(qa_agent, "_change_for", change_for)
    r = await client.post(f"/api/issues/{sid}/qa-agent", headers=as_(PM))
    assert r.status_code == 202, r.text

    board = (await client.get(f"/api/projects/{pid}/qa-board", headers=as_(PM))).json()
    row = board["stories"][0]
    assert row["qaAgent"]["state"] == "ready", row["qaAgent"]
    assert row["qaAgent"]["suggested"] == 1 and row["qaAgent"]["dropped"] == 1
    assert row["openSuggestions"] == 1
    # The agent filed nothing on its own.
    assert row["bugs"] == []

    [sugg] = (await client.get(f"/api/projects/{pid}/qa-suggestions?status=open", headers=as_(PM))).json()
    assert sugg["evidence"][0]["path"] == "app/discounts.py"
    r = await client.post(f"/api/qa-suggestions/{sugg['id']}/dismiss", headers=as_(PM), json={"reason": "no"})
    assert r.status_code == 422
    r = await client.post(
        f"/api/qa-suggestions/{sugg['id']}/accept", headers=as_(PM), json={"priority": "P0", "notes": "Reproduced."}
    )
    assert r.status_code == 200, r.text
    again = await client.post(f"/api/qa-suggestions/{sugg['id']}/accept", headers=as_(PM), json={})
    assert again.status_code == 409

    dev_board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    [bug] = dev_board["bugs"]
    assert bug["priority"] == "P0" and bug["assigneeId"] == await _uid(client, DEV)
    assert "confirmed by" in bug["description"]

    # Running again does not repeat what is already reported.
    await client.post(f"/api/issues/{sid}/qa-agent", headers=as_(PM))
    row = (await client.get(f"/api/projects/{pid}/qa-board", headers=as_(PM))).json()["stories"][0]
    assert row["qaAgent"]["suggested"] == 0


async def test_station_channels_and_linking_to_the_workspace(client, fakes):
    from tests.integration.test_golden_path import LEAD

    pid, _story_row = await _story(client)
    ws = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()["project"]["workspace_id"]

    def _in(who):
        return {**as_(who), "X-Workspace-Id": ws}

    def names(rows):
        return {c["name"] for c in rows}

    name = f"dev-{uuid.uuid4().hex[:6]}"
    bad = await client.post(
        "/api/chat/channels", headers=_in(DEV), json={"name": name, "audience": "team", "project_id": pid}
    )
    assert bad.status_code == 422
    r = await client.post(
        "/api/chat/channels",
        headers=_in(DEV),
        json={"name": name, "project_id": pid, "station": "developer", "audience": "team"},
    )
    assert r.status_code == 201, r.text
    ch = r.json()
    assert ch["station"] == "developer" and ch["visibility"] == "private"
    # The developer team (DEV, and PM who holds every station) is in; LEAD is not on the project.
    assert name in names((await client.get("/api/chat/channels", headers=_in(PM))).json())
    assert name not in names((await client.get("/api/chat/channels", headers=_in(LEAD))).json())

    # Linking (by its creator, or a project lead or manager) makes it a workspace
    # channel everyone can find.
    r = await client.post(f"/api/chat/channels/{ch['id']}/link", headers=_in(DEV))
    assert r.status_code == 200 and r.json()["visibility"] == "public"
    rows = (await client.get("/api/chat/channels", headers=_in(LEAD))).json()
    linked = next(c for c in rows if c["name"] == name)
    assert linked["projectId"] == pid and linked["station"] == "developer"


async def test_frontend_workspace_lists_stories_with_their_design(client, fakes):
    from app.models import ProjectDocument

    pid, story = await _story(client)
    r = (await client.get(f"/api/projects/{pid}/frontend", headers=as_(DEV))).json()
    assert r["design"] is None and r["stories"] == []  # a backend story, no screens yet

    async with db.sessionmaker()() as s:
        s.add(
            ProjectDocument(
                project_id=uuid.UUID(pid),
                kind="design",
                version=1,
                title="Design",
                content={
                    "overview": "Discount UI",
                    "principles": ["Clear totals"],
                    "api_contracts": [],
                    "screens": [
                        {"name": "Cart", "purpose": "Totals", "story_keys": [story["key"]], "states": ["empty"], "html": "<p>cart</p>"}
                    ],
                    "tokens": [],
                    "accessibility": [],
                    "handoff_notes": ["Use paise"],
                },
                model="test",
            )
        )
        await s.commit()
    r = (await client.get(f"/api/projects/{pid}/frontend", headers=as_(DEV))).json()
    assert r["design"]["handoffNotes"] == ["Use paise"]
    [row] = r["stories"]
    assert row["key"] == story["key"] and row["screens"][0]["name"] == "Cart"
