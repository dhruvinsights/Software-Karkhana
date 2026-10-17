# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Issues and bugs through the HTTP API on real Postgres."""

from __future__ import annotations

import pytest
from sqlalchemy import update

from app import db
from app.models import User
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
)


@pytest.fixture(autouse=True)
async def _leave_users_not_onboarded(client):
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


async def _uid(client, who):
    return (await client.get("/api/me", headers=as_(who))).json()["id"]


async def _team_project(client):
    ws = (await client.post("/api/workspaces/create", headers=as_(PM), json={"name": "Issue Co"})).json()["id"]
    pid = (
        await client.post(
            "/api/projects",
            headers=as_(PM),
            json={"name": "Tracker", "idea_text": "Track bugs", "workspace_id": ws},
        )
    ).json()["id"]
    inv = (
        await client.post(
            f"/api/workspaces/{ws}/invites",
            headers=as_(PM),
            json={"role": "developer", "project_id": pid},
        )
    ).json()
    r = await client.post("/api/invites/accept", headers=as_(DEV), json={"token": inv["token"]})
    assert r.status_code == 200, r.text
    return ws, pid


async def test_raise_number_assign_and_close_a_bug(client):
    _, pid = await _team_project(client)
    dev = await _uid(client, DEV)

    r = await client.post(
        f"/api/projects/{pid}/issues",
        headers=as_(PM),
        json={"title": "Total off by one cent", "type": "bug", "priority": "P1", "source": "qa", "assignee_id": dev},
    )
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["key"] == "ISS-1" and first["assigneeName"] and first["status"] == "todo"
    second = (
        await client.post(f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Add export button"})
    ).json()
    assert second["key"] == "ISS-2"  # numbers never repeat within a project

    # It shows up on the assignee's own list.
    # Other tests leave work assigned to DEV in other projects; look at this one.
    mine = [i for i in (await client.get("/api/issues/mine", headers=as_(DEV))).json() if i["projectId"] == pid]
    assert [i["key"] for i in mine] == ["ISS-1"]

    # The assignee moves it along; closing stamps closedAt and clears it from "mine".
    r = await client.patch(f"/api/issues/{first['id']}", headers=as_(DEV), json={"status": "in_progress"})
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    r = await client.patch(f"/api/issues/{first['id']}", headers=as_(DEV), json={"status": "done"})
    assert r.json()["closedAt"] is not None
    mine = (await client.get("/api/issues/mine", headers=as_(DEV))).json()
    assert [i for i in mine if i["projectId"] == pid] == []

    listed = (await client.get(f"/api/projects/{pid}/issues?status=todo", headers=as_(PM))).json()
    assert [i["key"] for i in listed] == ["ISS-2"]


async def test_only_leads_assign_to_other_people(client):
    _, pid = await _team_project(client)
    pm = await _uid(client, PM)
    dev = await _uid(client, DEV)

    # A developer cannot hand work to the PM, but can take work for themselves.
    r = await client.post(
        f"/api/projects/{pid}/issues", headers=as_(DEV), json={"title": "Fix flaky test", "assignee_id": pm}
    )
    assert r.status_code == 403 and "lead" in r.text
    r = await client.post(
        f"/api/projects/{pid}/issues", headers=as_(DEV), json={"title": "Fix flaky test", "assignee_id": dev}
    )
    assert r.status_code == 201
    issue_id = r.json()["id"]

    # The PM (project owner) can reassign it; unassign with an explicit null.
    r = await client.patch(f"/api/issues/{issue_id}", headers=as_(PM), json={"assignee_id": pm})
    assert r.status_code == 200 and r.json()["assigneeId"] == pm
    r = await client.patch(f"/api/issues/{issue_id}", headers=as_(PM), json={"assignee_id": None})
    assert r.json()["assigneeId"] is None

    # An unassigned issue can be taken by anyone on the team.
    r = await client.patch(f"/api/issues/{issue_id}", headers=as_(DEV), json={"assignee_id": dev})
    assert r.status_code == 200 and r.json()["assigneeId"] == dev


async def test_cannot_assign_to_someone_outside_the_project(client):
    _, pid = await _team_project(client)
    outsider = await _uid(client, DIR)  # not in this workspace
    r = await client.post(
        f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Wrong person", "assignee_id": outsider}
    )
    assert r.status_code == 422 and "not on this project" in r.text


async def test_outsiders_cannot_see_or_raise_issues_and_bad_values_are_rejected(client):
    _, pid = await _team_project(client)
    assert (await client.get(f"/api/projects/{pid}/issues", headers=as_(DIR))).status_code == 404
    assert (
        await client.post(f"/api/projects/{pid}/issues", headers=as_(DIR), json={"title": "Sneaky issue"})
    ).status_code == 404
    r = await client.post(
        f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Bad type", "type": "saga"}
    )
    assert r.status_code == 422
    r = await client.post(f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "ok issue"})
    iid = r.json()["id"]
    r = await client.patch(f"/api/issues/{iid}", headers=as_(PM), json={"status": "blocked"})
    assert r.status_code == 422
    # A teammate with no stake in the issue cannot edit it.
    r = await client.patch(f"/api/issues/{iid}", headers=as_(DEV), json={"title": "Hijacked title"})
    assert r.status_code == 403
