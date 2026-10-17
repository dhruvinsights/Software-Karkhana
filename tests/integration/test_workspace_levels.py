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

"""Workspace access levels, archiving and per-workspace scoping.

Levels (owner / admin / reviewer / guide / member) sit on top of the roles and
stations in ``app.access``: they decide who manages the workspace and who is
read-only. Deleting a project or product archives it for everyone.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app import db
from app.models import ActivityEvent, User
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
)

pytestmark = pytest.mark.usefixtures("database")


@pytest.fixture(autouse=True)
async def _leave_users_not_onboarded(client):
    """Creating a workspace marks its owner onboarded; other modules expect a fresh PM."""
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


async def _workspace(client, name, who=PM):
    r = await client.post(
        "/api/workspaces/create", headers=as_(who), json={"name": name}
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _join(client, ws, who, role="developer", inviter=PM):
    inv = await client.post(
        f"/api/workspaces/{ws}/invites", headers=as_(inviter), json={"role": role}
    )
    assert inv.status_code == 201, inv.text
    r = await client.post(
        "/api/invites/accept", headers=as_(who), json={"token": inv.json()["token"]}
    )
    assert r.status_code == 200, r.text


async def _uid(client, who) -> str:
    r = await client.get("/api/auth/me", headers=as_(who))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _in(ws, who):
    return {**as_(who), "X-Workspace-Id": ws}


async def _set_access(client, ws, target, level, who=PM):
    return await client.put(
        f"/api/workspaces/{ws}/members/{await _uid(client, target)}/access",
        headers=as_(who),
        json={"access": level},
    )


async def _product(client, ws, name="Core", who=PM, **extra):
    return await client.post(
        "/api/products",
        headers=as_(who),
        json={"name": name, "workspace_id": ws, **extra},
    )


async def _project(client, ws, name, product_id=None, who=PM):
    body = {
        "name": name,
        "idea_text": "A project used by the access-level tests.",
        "workspace_id": ws,
    }
    if product_id:
        body["product_id"] = product_id
    return await client.post("/api/projects", headers=as_(who), json=body)


# ── access levels ─────────────────────────────────────────────────────────────


async def test_owner_sets_levels_and_only_the_owner_makes_admins(client, fakes):
    ws = await _workspace(client, "Levels A")
    await _join(client, ws, DEV, "developer")
    await _join(client, ws, LEAD, "lead")

    # The owner can make someone a guide, reviewer, admin or member again.
    for level in ("guide", "reviewer", "admin", "member"):
        r = await _set_access(client, ws, DEV, level)
        assert r.status_code == 200, r.text
        assert r.json()["access"] == level

    # An admin manages guides and reviewers but cannot add or remove admins.
    assert (await _set_access(client, ws, LEAD, "admin")).status_code == 200
    assert (await _set_access(client, ws, DEV, "guide", who=LEAD)).status_code == 200
    assert (await _set_access(client, ws, DEV, "admin", who=LEAD)).status_code == 403

    # Nobody can touch the owner's level, and a plain member cannot change anything.
    owner_id = await _uid(client, PM)
    r = await client.put(
        f"/api/workspaces/{ws}/members/{owner_id}/access",
        headers=as_(LEAD),
        json={"access": "member"},
    )
    assert r.status_code == 400
    assert (await _set_access(client, ws, DEV, "member", who=DEV)).status_code == 403

    # The member list reports each person's level.
    members = (
        await client.get(f"/api/workspaces/{ws}/members", headers=as_(PM))
    ).json()
    by_email = {m["email"]: m["access"] for m in members}
    assert by_email[PM] == "owner"
    assert by_email[LEAD] == "admin"


async def test_guides_and_reviewers_see_everything_but_change_nothing(client, fakes):
    ws = await _workspace(client, "Levels B")
    await _join(client, ws, DEV, "developer")
    await _join(client, ws, DIR, "director")
    product = (await _product(client, ws)).json()
    project = (await _project(client, ws, "Secret Project", product["id"])).json()

    await _set_access(client, ws, DEV, "guide")
    await _set_access(client, ws, DIR, "reviewer")

    for who in (DEV, DIR):
        # They see the project in the workspace even though they are not on its team.
        listed = (await client.get("/api/projects", headers=_in(ws, who))).json()
        assert [p["name"] for p in listed] == ["Secret Project"]
        # But they cannot create projects, products or ideas, nor delete the project.
        assert (
            await _project(client, ws, "Nope", product["id"], who=who)
        ).status_code == 403
        assert (await _product(client, ws, "Nope", who=who)).status_code == 403
        idea = await client.post(
            "/api/ideas",
            headers=as_(who),
            json={"title": "Nope", "problem_statement": "x", "workspace_id": ws},
        )
        assert idea.status_code == 403
        assert (
            await client.delete(f"/api/projects/{project['id']}", headers=as_(who))
        ).status_code == 403


# ── archiving ─────────────────────────────────────────────────────────────────


async def test_deleting_a_project_archives_it_for_everyone(client, fakes):
    ws = await _workspace(client, "Levels C")
    await _join(client, ws, DEV, "developer")
    product = (await _product(client, ws)).json()
    project = (await _project(client, ws, "Doomed", product["id"])).json()
    assert [
        p["name"]
        for p in (await client.get("/api/projects", headers=_in(ws, PM))).json()
    ] == ["Doomed"]

    # A plain member who is neither lead nor creator cannot delete it.
    assert (
        await client.delete(f"/api/projects/{project['id']}", headers=as_(DEV))
    ).status_code == 403

    # The lead can; it then disappears from every list and cannot be opened.
    assert (
        await client.delete(f"/api/projects/{project['id']}", headers=as_(PM))
    ).status_code == 204
    assert (await client.get("/api/projects", headers=_in(ws, PM))).json() == []
    assert (
        await client.delete(f"/api/projects/{project['id']}", headers=as_(PM))
    ).status_code == 404


async def test_products_are_admin_only_scoped_and_archive_their_projects(client, fakes):
    ws = await _workspace(client, "Levels D")
    other = await _workspace(client, "Levels E", who=LEAD)
    await _join(client, ws, DEV, "developer")

    # Only the owner (or an admin) creates products.
    assert (await _product(client, ws, "Denied", who=DEV)).status_code == 403
    product = (await _product(client, ws, "Billing")).json()
    await _product(client, other, "Elsewhere", who=LEAD)

    # Each workspace lists only its own products.
    mine = {
        p["name"]
        for p in (await client.get("/api/products", headers=_in(ws, PM))).json()
    }
    assert "Billing" in mine and "Elsewhere" not in mine
    theirs = {
        p["name"]
        for p in (await client.get("/api/products", headers=_in(other, LEAD))).json()
    }
    assert "Elsewhere" in theirs and "Billing" not in theirs
    # A stranger cannot list another workspace's products by naming it.
    assert (await client.get("/api/products", headers=_in(ws, LEAD))).status_code == 403

    project = (await _project(client, ws, "Billing API", product["id"])).json()
    assert (
        await client.delete(f"/api/products/{product['id']}", headers=as_(DEV))
    ).status_code == 403
    assert (
        await client.delete(f"/api/products/{product['id']}", headers=as_(PM))
    ).status_code == 204
    left = {
        p["name"]
        for p in (await client.get("/api/products", headers=_in(ws, PM))).json()
    }
    assert "Billing" not in left
    assert (await client.get("/api/projects", headers=_in(ws, PM))).json() == []
    assert (
        await client.delete(f"/api/projects/{project['id']}", headers=as_(PM))
    ).status_code == 404


# ── product setup and reviewers ───────────────────────────────────────────────


async def test_product_setup_stores_details_and_notifies_reviewers(client, fakes):
    ws = await _workspace(client, "Levels F")
    await _join(client, ws, DIR, "director")
    director_id = await _uid(client, DIR)

    r = await _product(
        client,
        ws,
        "Telemetry",
        problem_statement="Events get lost.",
        target_users="SREs",
        tech_stack=["Python", "Postgres"],
        repository_url="github.com/acme/telemetry",
        team_spaces=["developer", "qa"],
        reviewer_ids=[director_id],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["problemStatement"] == "Events get lost."
    assert body["techStack"] == ["Python", "Postgres"]
    assert body["repositoryUrl"] == "github.com/acme/telemetry"
    assert body["teamSpaces"] == ["qa", "developer"] or sorted(body["teamSpaces"]) == [
        "developer",
        "qa",
    ]
    assert body["reviewerIds"] == [director_id]

    # The reviewer is flagged as one and told about it.
    members = (
        await client.get(f"/api/workspaces/{ws}/members", headers=as_(PM))
    ).json()
    assert {m["email"]: m["access"] for m in members}[DIR] == "reviewer"
    async with db.sessionmaker()() as s:
        events = (
            await s.scalars(
                select(ActivityEvent).where(ActivityEvent.type == "reviewer_added")
            )
        ).all()
    assert [str(e.recipient_id) for e in events] == [director_id]

    # Reviewers must belong to the workspace.
    outsider = await _uid(client, LEAD)
    bad = await _product(client, ws, "Other", reviewer_ids=[outsider])
    assert bad.status_code == 400


# ── ideas and documents stay inside their workspace ──────────────────────────


async def test_ideas_are_scoped_and_approval_status_is_not_editable(client, fakes):
    ws = await _workspace(client, "Levels G")
    other = await _workspace(client, "Levels H", who=LEAD)
    product = (await _product(client, ws)).json()
    idea = (
        await client.post(
            "/api/ideas",
            headers=as_(PM),
            json={
                "title": "Faster builds",
                "problem_statement": "Builds are slow.",
                "workspace_id": ws,
                "product_id": product["id"],
            },
        )
    ).json()

    # Another workspace's people neither see the idea nor can touch it.
    assert (await client.get("/api/ideas", headers=_in(other, LEAD))).json() == []
    assert (await client.get("/api/ideas", headers=_in(ws, LEAD))).status_code == 403
    r = await client.put(
        f"/api/ideas/{idea['id']}", headers=as_(LEAD), json={"title": "Hijacked"}
    )
    assert r.status_code == 404

    # Approval statuses can only be set by the reviewers' decisions, never by editing.
    for status in ("approved", "rejected", "promoted", "pending_approval"):
        r = await client.put(
            f"/api/ideas/{idea['id']}", headers=as_(PM), json={"status": status}
        )
        assert r.status_code == 409, (status, r.text)
    assert (
        await client.put(
            f"/api/ideas/{idea['id']}",
            headers=as_(PM),
            json={"title": "Much faster builds"},
        )
    ).status_code == 200


async def test_document_extraction_needs_membership_of_the_target_workspace(
    client, fakes
):
    ws = await _workspace(client, "Levels I")
    product = (await _product(client, ws)).json()
    body = {
        "filename": "brief.md",
        "text": "# Telemetry\nA platform for events.",
        "workspace_id": ws,
        "product_id": product["id"],
    }
    # Signed out, or signed in elsewhere: refused before anything is stored.
    assert (
        await client.post("/api/products/extract-from-doc", json=body)
    ).status_code in (401, 403)
    assert (
        await client.post(
            "/api/products/extract-from-doc", headers=as_(LEAD), json=body
        )
    ).status_code == 403
    # A product id without its workspace would skip the membership check.
    no_ws = {k: v for k, v in body.items() if k != "workspace_id"}
    assert (
        await client.post("/api/products/extract-from-doc", headers=as_(PM), json=no_ws)
    ).status_code == 400
