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

"""Authority is per workspace: a role held in one workspace grants nothing in another.

``User.role`` is an account label only. Every gate checks the caller's
``WorkspaceMember.role`` in the workspace of the project being acted on.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, update

from app import db
from app.models import User, WorkspaceMember
from tests.fakes import IDEAS
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
    wait_for_stage,
)

pytestmark = pytest.mark.usefixtures("database")


@pytest.fixture(autouse=True)
async def _leave_users_not_onboarded(client):
    """Creating a workspace marks its owner onboarded; other modules expect a fresh PM."""
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


async def _workspace(client, name, who=PM, **extra):
    r = await client.post(
        "/api/workspaces/create", headers=as_(who), json={"name": name, **extra}
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _join(client, ws, who, role, *, project_id=None, inviter=PM):
    body = {"role": role, **({"project_id": project_id} if project_id else {})}
    inv = await client.post(
        f"/api/workspaces/{ws}/invites", headers=as_(inviter), json=body
    )
    assert inv.status_code == 201, inv.text
    r = await client.post(
        "/api/invites/accept", headers=as_(who), json={"token": inv.json()["token"]}
    )
    assert r.status_code == 200, r.text


async def _evaluated_project(client, ws, name):
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={
            "name": name,
            "idea_text": IDEAS["discounts"]["idea_text"],
            "workspace_id": ws,
        },
    )
    assert r.status_code == 202, r.text
    pid = r.json()["id"]
    await wait_for_stage(client, pid, "evaluated")
    return pid


async def _role_in(ws_id, email):
    async with db.sessionmaker()() as s:
        user = await s.scalar(select(User).where(User.email == email))
        return await s.scalar(
            select(WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == uuid.UUID(ws_id),
                WorkspaceMember.user_id == user.id,
            )
        )


async def test_director_elsewhere_is_only_a_developer_here(client):
    # DIR is director in the seeded demo workspace (A) but a developer in B.
    ws_b = await _workspace(client, "Roles B")
    await _join(client, ws_b, DIR, "developer")
    assert await _role_in(ws_b, DIR) == "developer"
    pid = await _evaluated_project(client, ws_b, "Gate in B")

    r = await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(DIR)
    )
    assert r.status_code == 403, r.text
    # The batch gate skips it too, so nothing is approved by the back door.
    r = await client.post(
        "/api/projects/batch-approve",
        json={"project_ids": [pid], "decision": "approved"},
        headers=as_(DIR),
    )
    assert r.status_code == 200 and r.json()["approved_count"] == 0
    detail = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()
    assert detail["project"]["stage_status"] == "evaluated" and not detail["approvals"]


async def test_owner_of_a_new_workspace_gains_nothing_elsewhere(client):
    # LEAD creates a workspace asking to be "director" there...
    me_before = (await client.get("/api/auth/me", headers=as_(LEAD))).json()["role"]
    ws_own = await _workspace(client, "Lead Co", who=LEAD, user_role="director")
    me_after = (await client.get("/api/auth/me", headers=as_(LEAD))).json()["role"]
    # ...the account label is untouched and the role lives only on the membership.
    assert me_before == me_after == "lead"
    assert await _role_in(ws_own, LEAD) == "pm"

    # In a workspace where LEAD is a developer, no director gate opens for them.
    ws_b = await _workspace(client, "Roles C")
    await _join(client, ws_b, LEAD, "developer")
    pid = await _evaluated_project(client, ws_b, "Gate in C")
    r = await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=as_(LEAD)
    )
    assert r.status_code == 403


async def test_new_otp_user_has_no_manager_power(client, monkeypatch):
    monkeypatch.setenv("DEV_OTP_CODE", "246810")
    email = f"newbie-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post(
        "/api/auth/verify-otp", json={"email": email, "code": "246810"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "developer"  # lowest privilege, never a manager
    bearer = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # PM's workspace has a restricted project the newcomer is not on.
    ws = await _workspace(client, "Restricted Co")
    pid = await _evaluated_project(client, ws, "Private roadmap")
    r = await client.patch(
        f"/api/projects/{pid}/access", json={"access": "restricted"}, headers=as_(PM)
    )
    assert r.status_code == 200, r.text

    # Joining the workspace (default developer invite) does not reveal it.
    inv = await client.post(
        f"/api/workspaces/{ws}/invites", headers=as_(PM), json={"role": "developer"}
    )
    assert inv.status_code == 201, inv.text
    r = await client.post(
        "/api/invites/accept", headers=bearer, json={"token": inv.json()["token"]}
    )
    assert r.status_code == 200, r.text

    listed = (await client.get("/api/projects", headers=bearer)).json()
    assert pid not in {p["id"] for p in listed}
    assert (await client.get(f"/api/projects/{pid}", headers=bearer)).status_code == 403
    r = await client.post(
        f"/api/projects/{pid}/approve", json={"decision": "approved"}, headers=bearer
    )
    assert r.status_code == 403


async def test_workspace_members_are_private_to_the_workspace(client):
    ws = await _workspace(client, "Members Co")
    assert (
        await client.get(f"/api/workspaces/{ws}/members", headers=as_(PM))
    ).status_code == 200
    # Non-members are refused (404 or 403, never the member list).
    r = await client.get(f"/api/workspaces/{ws}/members", headers=as_(DEV))
    assert r.status_code in (403, 404)


async def test_projects_cannot_be_filed_into_someone_elses_workspace(client):
    ws = await _workspace(client, "Not yours")
    r = await client.post(
        "/api/projects",
        headers=as_(DEV),
        json={"name": "Squatter", "idea_text": "x" * 40, "workspace_id": ws},
    )
    assert r.status_code == 403
