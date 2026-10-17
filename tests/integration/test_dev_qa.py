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
