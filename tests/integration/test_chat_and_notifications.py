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

"""Chat is private where it should be, and people hear about what concerns them.

Public channels (#general) are for the whole workspace; team channels and DMs
only for the people in them. Review requests, mentions and channel invites land
in the recipient's activity feed (and push a live signal; see ``notify_activity``).
"""

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


async def _join(client, ws, who, role="developer"):
    inv = await client.post(
        f"/api/workspaces/{ws}/invites", headers=as_(PM), json={"role": role}
    )
    assert inv.status_code == 201, inv.text
    r = await client.post(
        "/api/invites/accept", headers=as_(who), json={"token": inv.json()["token"]}
    )
    assert r.status_code == 200, r.text


async def _uid(client, who) -> str:
    return (await client.get("/api/auth/me", headers=as_(who))).json()["id"]


def _in(ws, who):
    return {**as_(who), "X-Workspace-Id": ws}


async def test_team_channels_and_dms_are_private_to_their_people(client, fakes):
    ws = await _workspace(client, "Chat A")
    await _join(client, ws, DEV)
    await _join(client, ws, DIR, "director")
    dev = await _uid(client, DEV)

    made = await client.post(
        "/api/chat/channels",
        headers=_in(ws, PM),
        json={"name": "Build Team", "member_ids": [dev]},
    )
    assert made.status_code == 201, made.text
    channel = made.json()
    assert channel["name"] == "build-team"
    assert channel["visibility"] == "private"

    def names(rows):
        return {c["name"] for c in rows}

    # Members of the channel list it; another workspace member does not, and cannot read or post.
    assert "build-team" in names(
        (await client.get("/api/chat/channels", headers=_in(ws, DEV))).json()
    )
    assert "build-team" not in names(
        (await client.get("/api/chat/channels", headers=_in(ws, DIR))).json()
    )
    assert (
        await client.get(
            f"/api/chat/channels/{channel['id']}/messages", headers=_in(ws, DIR)
        )
    ).status_code == 404
    post = await client.post(
        f"/api/chat/channels/{channel['id']}/messages",
        headers=_in(ws, DIR),
        json={"body": "hi"},
    )
    assert post.status_code == 404
    # Everyone in the workspace shares #general.
    assert "general" in names(
        (await client.get("/api/chat/channels", headers=_in(ws, DIR))).json()
    )

    # A DM between two people is invisible to a third, who cannot read it.
    dm = (
        await client.post(
            "/api/chat/dms", headers=_in(ws, PM), json={"target_user_id": dev}
        )
    ).json()
    sent = await client.post(
        f"/api/chat/channels/{dm['id']}/messages",
        headers=_in(ws, PM),
        json={"body": "psst"},
    )
    assert sent.status_code == 201
    assert (
        await client.get(
            f"/api/chat/channels/{dm['id']}/messages", headers=_in(ws, DIR)
        )
    ).status_code == 404
    assert (
        await client.get(
            f"/api/chat/channels/{dm['id']}/messages", headers=_in(ws, DEV)
        )
    ).status_code == 200

    # Strangers from another workspace cannot be added, nor DM'd.
    outsider = await _uid(client, LEAD)
    assert (
        await client.post(
            "/api/chat/dms", headers=_in(ws, PM), json={"target_user_id": outsider}
        )
    ).status_code == 404
    bad = await client.post(
        "/api/chat/channels",
        headers=_in(ws, PM),
        json={"name": "leaky", "member_ids": [outsider]},
    )
    assert bad.status_code == 400


async def test_invites_mentions_and_review_requests_reach_the_recipients_feed(
    client, fakes
):
    ws = await _workspace(client, "Chat B")
    await _join(client, ws, DEV)
    await _join(client, ws, DIR, "director")
    dev, director = await _uid(client, DEV), await _uid(client, DIR)

    async def feed(who):
        return [
            e["summary"]
            for e in (
                await client.get("/api/chat/activity", headers=_in(ws, who))
            ).json()
        ]

    # Being added to a team channel is news.
    ch = (
        await client.post(
            "/api/chat/channels",
            headers=_in(ws, PM),
            json={"name": "ops", "member_ids": [dev]},
        )
    ).json()
    assert any("added you to #ops" in s for s in await feed(DEV))

    # A mention in a message is too.
    msg = await client.post(
        f"/api/chat/channels/{ch['id']}/messages",
        headers=_in(ws, PM),
        json={"body": "@dev please look", "mentions": [dev]},
    )
    assert msg.status_code == 201
    assert any("mentioned you" in s for s in await feed(DEV))

    # A review request shows up for the reviewer, and the verdict for the person who asked.
    idea = (
        await client.post(
            "/api/ideas",
            headers=as_(PM),
            json={
                "title": "Dark mode",
                "problem_statement": "Eyes hurt.",
                "workspace_id": ws,
            },
        )
    ).json()
    asked = await client.post(
        f"/api/ideas/{idea['id']}/request-approval",
        headers=as_(PM),
        json={"reviewer_ids": [director]},
    )
    assert asked.status_code == 200, asked.text
    assert any("review the idea" in s and "Dark mode" in s for s in await feed(DIR))
    inbox = (await client.get("/api/idea-approvals/inbox", headers=as_(DIR))).json()
    assert [i["title"] for i in inbox] == ["Dark mode"]

    verdict = await client.post(
        f"/api/ideas/{idea['id']}/decision",
        headers=as_(DIR),
        json={"decision": "approve"},
    )
    assert verdict.status_code == 200, verdict.text
    assert any("approved the idea" in s for s in await feed(PM))
    # Decided items leave the default inbox but remain in the full history.
    assert (
        await client.get("/api/idea-approvals/inbox", headers=as_(DIR))
    ).json() == []
    history = (
        await client.get("/api/idea-approvals/inbox?scope=all", headers=as_(DIR))
    ).json()
    assert [(i["title"], i["decision"]) for i in history] == [("Dark mode", "approved")]
