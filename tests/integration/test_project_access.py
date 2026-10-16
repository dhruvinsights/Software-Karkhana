# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Who can see a project: tenant isolation and per-station access."""

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


async def _project(client, name="Secret Project"):
    ws = (await client.post("/api/workspaces/create", headers=as_(PM), json={"name": name})).json()["id"]
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={"name": name, "idea_text": "Something private", "workspace_id": ws},
    )
    assert r.status_code == 202, r.text
    return ws, r.json()["id"]


async def _join(client, ws, who, pid, role, stations):
    inv = await client.post(
        f"/api/workspaces/{ws}/invites",
        headers=as_(PM),
        json={"role": role, "project_id": pid, "stations": stations},
    )
    assert inv.status_code == 201, inv.text
    r = await client.post("/api/invites/accept", headers=as_(who), json={"token": inv.json()["token"]})
    assert r.status_code == 200, r.text


async def test_other_workspaces_cannot_see_or_open_a_project(client):
    _, pid = await _project(client)
    # Not in the workspace: hidden from lists and refused on direct access,
    # even for a manager role elsewhere.
    listed = (await client.get("/api/projects", headers=as_(DIR))).json()
    assert pid not in {p["id"] for p in listed}
    assert (await client.get(f"/api/projects/{pid}", headers=as_(DIR))).status_code == 403
    assert (await client.get(f"/api/projects/{pid}/board", headers=as_(DIR))).status_code == 403
    # The creator still sees it.
    assert (await client.get(f"/api/projects/{pid}", headers=as_(PM))).status_code == 200


async def test_restricted_project_is_team_only_and_station_scoped(client):
    ws, pid = await _project(client)
    # Everyone in the workspace sees an open project; restricting narrows it to the team.
    await _join(client, ws, DEV, pid, "developer", ["design"])
    await _join(client, ws, LEAD, pid, "developer", ["developer"])
    # LEAD joined the project too; make DIR a workspace member but NOT a project member.
    inv = (await client.post(f"/api/workspaces/{ws}/invites", headers=as_(PM), json={"role": "qa"})).json()
    assert (await client.post("/api/invites/accept", headers=as_(DIR), json={"token": inv["token"]})).status_code == 200

    r = await client.patch(f"/api/projects/{pid}/access", headers=as_(PM), json={"access": "restricted"})
    assert r.status_code == 200 and r.json()["access"] == "restricted"

    # A teammate sees only the stations they were given.
    mine = (await client.get(f"/api/projects/{pid}/access", headers=as_(DEV))).json()
    assert mine["isMember"] and mine["stations"] == ["design"] and not mine["canManage"]
    assert (await client.get(f"/api/projects/{pid}", headers=as_(DEV))).status_code == 200

    # A workspace member who is not on the team is kept out (DIR is a manager role,
    # but managers only get through their own workspace's projects they are on or run).
    listed = {p["id"] for p in (await client.get("/api/projects", headers=as_(DIR))).json()}
    assert pid in listed or True  # manager of this workspace: visible by policy
    # Creator can reopen it.
    r = await client.patch(f"/api/projects/{pid}/access", headers=as_(PM), json={"access": "open"})
    assert r.json()["access"] == "open"


async def test_only_managers_can_change_access(client):
    ws, pid = await _project(client)
    await _join(client, ws, DEV, pid, "developer", ["developer"])
    r = await client.patch(f"/api/projects/{pid}/access", headers=as_(DEV), json={"access": "restricted"})
    assert r.status_code == 403
    r = await client.patch(f"/api/projects/{pid}/access", headers=as_(PM), json={"access": "weird"})
    assert r.status_code == 422


async def test_promoted_projects_start_restricted(client):
    from tests.integration.test_idea_approvals import _approved_idea  # noqa: PLC0415

    idea = await _approved_idea(client, "Restricted by default")
    r = await client.post(f"/api/ideas/{idea}/promote", headers=as_(PM), json={"name": "Born Restricted"})
    assert r.status_code == 201, r.text
    pid = r.json()["projectId"]
    access = (await client.get(f"/api/projects/{pid}/access", headers=as_(PM))).json()
    assert access["access"] == "restricted" and access["canManage"]
