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

"""Idea -> approval -> staffed project, through the HTTP API on real Postgres."""

from __future__ import annotations

from tests.fakes import IDEAS
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
)

IDEA_TEXT = IDEAS["discounts"]["idea_text"]


async def _uid(client, email):
    return (await client.get("/api/me", headers=as_(email))).json()["id"]


async def _new_idea(client, title="Cart discounts"):
    r = await client.post(
        "/api/ideas",
        headers=as_(PM),
        json={"title": title, "problem_statement": IDEA_TEXT},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _approved_idea(client, title="Cart discounts"):
    """An idea that its single reviewer (the director) has approved."""
    idea = await _new_idea(client, title)
    director = await _uid(client, DIR)
    r = await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director]},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/ideas/{idea}/decision", headers=as_(DIR), json={"decision": "approve"}
    )
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    return idea


async def test_all_reviewers_must_approve_and_one_rejection_stops_the_idea(client):
    idea = await _new_idea(client)
    director = await _uid(client, DIR)
    lead = await _uid(client, LEAD)
    pm = await _uid(client, PM)

    # Only the author or a manager may request approval; nobody reviews themselves.
    r = await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(DEV),
        json={"reviewer_ids": [director]},
    )
    assert r.status_code == 403
    r = await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director, pm]},
    )
    assert r.status_code == 422 and "own reviewer" in r.text

    r = await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director, lead], "note": "Q1 priority"},
    )
    body = r.json()
    assert r.status_code == 200 and body["status"] == "pending_approval"
    assert body["totalReviewers"] == 2 and body["approvedCount"] == 0

    # Not assigned -> cannot decide.
    r = await client.post(
        f"/api/ideas/{idea}/decision", headers=as_(DEV), json={"decision": "approve"}
    )
    assert r.status_code == 403

    # Director approves: still waiting on the lead, so no project yet.
    r = await client.post(
        f"/api/ideas/{idea}/decision", headers=as_(DIR), json={"decision": "approve"}
    )
    assert r.json()["status"] == "pending_approval" and r.json()["approvedCount"] == 1
    r = await client.post(f"/api/ideas/{idea}/promote", headers=as_(PM))
    assert r.status_code == 409 and "approve" in r.text.lower()
    # A decision is final for that reviewer.
    r = await client.post(
        f"/api/ideas/{idea}/decision", headers=as_(DIR), json={"decision": "approve"}
    )
    assert r.status_code == 409

    # Rejecting needs a reason, then one rejection ends it.
    r = await client.post(
        f"/api/ideas/{idea}/decision", headers=as_(LEAD), json={"decision": "reject"}
    )
    assert r.status_code == 422
    r = await client.post(
        f"/api/ideas/{idea}/decision",
        headers=as_(LEAD),
        json={"decision": "reject", "reason": "Overlaps with the pricing project"},
    )
    assert r.json()["status"] == "rejected"
    r = await client.post(f"/api/ideas/{idea}/promote", headers=as_(PM))
    assert r.status_code == 409

    # Re-requesting starts the decisions again from scratch.
    r = await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director]},
    )
    assert r.json()["status"] == "pending_approval"
    assert [a["status"] for a in r.json()["approvals"]] == ["pending"]


async def test_inbox_lists_only_what_waits_for_me(client):
    idea = await _new_idea(client, "Inbox idea")
    director = await _uid(client, DIR)
    await client.post(
        f"/api/ideas/{idea}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director], "note": "please look"},
    )
    mine = (await client.get("/api/idea-approvals/inbox", headers=as_(DIR))).json()
    assert idea in {i["ideaId"] for i in mine}
    item = next(i for i in mine if i["ideaId"] == idea)
    assert item["note"] == "please look" and item["requestedBy"]
    other = (await client.get("/api/idea-approvals/inbox", headers=as_(DEV))).json()
    assert idea not in {i["ideaId"] for i in other}


async def test_promote_creates_a_staffed_project_once(client):
    idea = await _approved_idea(client, "Staffed project")
    developer = await _uid(client, DEV)

    # A developer is not a manager, so cannot create the project.
    r = await client.post(f"/api/ideas/{idea}/promote", headers=as_(DEV))
    assert r.status_code == 403

    bad = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={"leads": [{"user_id": developer, "role": "wizard"}]},
    )
    assert bad.status_code == 422 and "Unknown role" in bad.text

    r = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={
            "name": "Discount engine",
            "leads": [{"user_id": developer, "role": "developer", "is_lead": True}],
        },
    )
    assert r.status_code == 201, r.text
    out = r.json()
    pid = out["projectId"]
    assert out["projectName"] == "Discount engine"
    by_role = {m["role"]: m for m in out["members"]}
    assert (
        by_role["developer"]["isLead"]
        and "devops" not in by_role["developer"]["stations"]
    )
    assert by_role["pm"]["stations"] and by_role["pm"]["isLead"]

    members = (await client.get(f"/api/projects/{pid}/members", headers=as_(PM))).json()
    assert {m["email"] for m in members} == {PM, DEV}
    assert next(m for m in members if m["email"] == DEV)["isLead"] is True

    ideas = (await client.get("/api/ideas", headers=as_(PM))).json()
    row = next(i for i in ideas if i["id"] == idea)
    assert row["status"] == "promoted" and row["promotedProjectId"] == pid

    # Once only.
    again = await client.post(f"/api/ideas/{idea}/promote", headers=as_(PM))
    assert again.status_code == 409 and pid in again.text

    # Every step is on the tamper-evident ledger, and the chain still verifies.
    chain = (await client.get("/api/ledger/verify", headers=as_(PM))).json()
    assert chain["ok"] is True


async def test_station_leads_grow_only_their_own_team(client):
    idea = await _approved_idea(client, "Delegation")
    developer, director = await _uid(client, DEV), await _uid(client, DIR)
    r = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={"leads": [{"user_id": developer, "role": "developer", "is_lead": True}]},
    )
    pid = r.json()["projectId"]
    add = f"/api/projects/{pid}/members"

    # The developer lead can add another developer within their own stations...
    ok = await client.post(
        add,
        headers=as_(DEV),
        json={"user_id": director, "role": "developer", "stations": ["developer"]},
    )
    assert ok.status_code == 200, ok.text
    # ...but cannot change roles, widen access, or create more leads.
    wrong_role = await client.post(
        add,
        headers=as_(DEV),
        json={"user_id": director, "role": "qa", "stations": ["qa"]},
    )
    assert wrong_role.status_code == 403
    too_wide = await client.post(
        add,
        headers=as_(DEV),
        json={
            "user_id": director,
            "role": "developer",
            "stations": ["developer", "devops"],
        },
    )
    assert too_wide.status_code == 403 and "devops" in too_wide.text
    sneaky = await client.post(
        add,
        headers=as_(DEV),
        json={
            "user_id": director,
            "role": "developer",
            "stations": ["developer"],
            "is_lead": True,
        },
    )
    assert sneaky.status_code == 200 and sneaky.json()["isLead"] is False


async def test_a_plain_member_cannot_add_people(client):
    idea = await _approved_idea(client, "No delegation")
    developer, director = await _uid(client, DEV), await _uid(client, DIR)
    r = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={"leads": [{"user_id": developer, "role": "developer", "is_lead": False}]},
    )
    pid = r.json()["projectId"]
    denied = await client.post(
        f"/api/projects/{pid}/members",
        headers=as_(DEV),
        json={"user_id": director, "role": "developer", "stations": ["developer"]},
    )
    assert denied.status_code == 403
