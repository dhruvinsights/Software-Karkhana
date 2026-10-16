# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Invitations through the HTTP API on real Postgres."""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import update

from app import db
from app.models import User, WorkspaceInvite
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
)

NEWCOMER = DIR
OTHER = LEAD


@pytest.fixture(autouse=True)
async def _leave_users_not_onboarded(client):
    """Creating a workspace marks its owner onboarded; other modules expect a fresh PM."""
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


async def _workspace(client):
    r = await client.post("/api/workspaces/create", headers=as_(PM), json={"name": "Acme Invites"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _invite(client, ws, who=PM, **body):
    r = await client.post(f"/api/workspaces/{ws}/invites", headers=as_(who), json=body)
    return r


async def test_addressed_invite_joins_once_and_only_for_that_email(client):
    ws = await _workspace(client)
    r = await _invite(client, ws, email=NEWCOMER, role="qa")
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["inviteLink"].endswith(f"/?invite={inv['token']}")
    assert inv["emailSent"] is False  # no mail provider in tests; the invite still exists

    # Public preview tells the sign-in page what this is.
    p = await client.get(f"/api/invites/{inv['token']}")
    assert p.status_code == 200 and p.json()["workspace"]["name"] == "Acme Invites"

    # Another account cannot use someone else's invitation.
    r = await client.post("/api/invites/accept", headers=as_(OTHER), json={"token": inv["token"]})
    assert r.status_code == 403 and NEWCOMER in r.text

    r = await client.post("/api/invites/accept", headers=as_(NEWCOMER), json={"token": inv["token"]})
    assert r.status_code == 200 and r.json()["workspace"]["role"] == "qa"

    # Single use.
    r = await client.post("/api/invites/accept", headers=as_(NEWCOMER), json={"token": inv["token"]})
    assert r.status_code == 410

    members = await client.get(f"/api/workspaces/{ws}/members", headers=as_(PM))
    assert NEWCOMER in {m["email"] for m in members.json()}


async def test_open_link_is_reusable_until_expiry(client):
    ws = await _workspace(client)
    inv = (await _invite(client, ws, role="developer")).json()
    for who in (NEWCOMER, OTHER):
        r = await client.post("/api/invites/accept", headers=as_(who), json={"token": inv["token"]})
        assert r.status_code == 200, r.text
    third = DEV

    async with db.sessionmaker()() as s:
        await s.execute(
            update(WorkspaceInvite)
            .where(WorkspaceInvite.token == inv["token"])
            .values(expires_at=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1))
        )
        await s.commit()
    r = await client.post("/api/invites/accept", headers=as_(third), json={"token": inv["token"]})
    assert r.status_code == 410 and "expired" in r.text
    assert (await client.get(f"/api/invites/{inv['token']}")).status_code == 410


async def test_joining_by_workspace_id_alone_is_no_longer_possible(client):
    ws = await _workspace(client)
    r = await client.post("/api/workspaces/join", headers=as_(OTHER), json={"workspace_id": ws})
    assert r.status_code == 422  # a token is required


async def test_nobody_can_invite_above_their_station(client):
    ws = await _workspace(client)
    inv = (await _invite(client, ws, role="developer")).json()
    await client.post("/api/invites/accept", headers=as_(DEV), json={"token": inv["token"]})

    r = await _invite(client, ws, who=DEV, role="executive")
    assert r.status_code == 403
    assert (await _invite(client, ws, who=DEV, role="developer")).status_code == 201
    assert (await _invite(client, ws, role="not-a-role")).status_code == 403

    # An outsider cannot create invites at all.
    assert (await _invite(client, ws, who=DIR, role="developer")).status_code == 403


async def test_revoked_invite_stops_working(client):
    ws = await _workspace(client)
    inv = (await _invite(client, ws, role="qa")).json()
    r = await client.delete(f"/api/workspaces/{ws}/invites/{inv['id']}", headers=as_(PM))
    assert r.status_code == 200
    r = await client.post("/api/invites/accept", headers=as_(LEAD), json={"token": inv["token"]})
    assert r.status_code == 410 and "cancelled" in r.text


async def test_project_invite_enrols_with_role_and_stations(client):
    ws = await _workspace(client)
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={"name": "Checkout", "idea_text": "Faster checkout", "workspace_id": ws},
    )
    assert r.status_code in (200, 201, 202), r.text
    pid = r.json()["id"]

    inv = (
        await _invite(client, ws, role="designer", project_id=pid, stations=["design", "product"])
    ).json()
    assert inv["projectId"] == pid
    r = await client.post("/api/invites/accept", headers=as_(NEWCOMER), json={"token": inv["token"]})
    assert r.status_code == 200 and r.json()["projectId"] == pid

    detail = await client.get(f"/api/projects/{pid}/members", headers=as_(PM))
    mine = [m for m in detail.json() if m.get("email") == NEWCOMER]
    assert mine and mine[0]["role"] == "designer"
    assert set(mine[0]["stations"]) == {"design", "product"}
