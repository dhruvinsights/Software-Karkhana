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

"""Chat retention purge (migration 023) and cross-instance fan-out via the broker."""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

from app.config import get_settings
from app.services import chat_retention
from app.services.realtime import ConnectionManager
from tests.integration.test_chat_and_notifications import (
    _in,
    _leave_users_not_onboarded,  # noqa: F401
    _workspace,
)
from tests.integration.test_golden_path import PM, client, fakes  # noqa: F401

pytestmark = pytest.mark.usefixtures("database")


async def test_messages_older_than_retention_are_purged(client, fakes, database):
    ws = await _workspace(client, "Retention")
    general = next(
        c for c in (await client.get("/api/chat/channels", headers=_in(ws, PM))).json()
        if c["name"] == "general"
    )
    url = f"/api/chat/channels/{general['id']}/messages"
    for body in ("old", "new"):
        r = await client.post(url, headers=_in(ws, PM), json={"body": body})
        assert r.status_code == 201, r.text

    owner = await asyncpg.connect(database.replace("postgresql+asyncpg://", "postgresql://"))
    await owner.execute(
        "UPDATE chat_messages SET created_at = now() - interval '91 days' WHERE body = 'old'"
    )
    await owner.close()

    assert await chat_retention.purge_once() >= 1
    left = [m["body"] for m in (await client.get(url, headers=_in(ws, PM))).json()]
    assert left == ["new"]


class _Sock:
    def __init__(self) -> None:
        self.frames: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.frames.append(data)


async def test_broker_fans_out_to_sockets_on_another_instance(monkeypatch):
    from app.services.realtime import Conn

    monkeypatch.setenv("REALTIME_BROKER_URL", "memory://")
    get_settings.cache_clear()
    a, b = ConnectionManager(), ConnectionManager()
    try:
        await a.start_broker()
        # memory:// is per-process; share one bus so a and b act like two instances.
        b._broker, b._topic = a._broker, a._topic
        ready = asyncio.Event()
        b._consumer = asyncio.create_task(b._consume(ready))
        await ready.wait()

        alice, bob, carol = _Sock(), _Sock(), _Sock()
        a.connect(Conn(alice, "alice", "w1", "Alice"))
        b.connect(Conn(bob, "bob", "w1", "Bob"))
        b.connect(Conn(carol, "carol", "w1", "Carol"))

        await a.send_to_users("w1", {"bob"}, {"type": "message", "body": "hi"})
        await a.broadcast("w1", {"type": "presence"}, exclude_user="alice")
        for _ in range(50):
            if len(bob.frames) == 2 and carol.frames:
                break
            await asyncio.sleep(0.01)

        assert bob.frames == [{"type": "message", "body": "hi"}, {"type": "presence"}]
        assert carol.frames == [{"type": "presence"}]
        assert alice.frames == []
    finally:
        b._consumer.cancel()
        await asyncio.gather(b._consumer, return_exceptions=True)
        b._broker = None
        await a.stop_broker()
        get_settings.cache_clear()


async def test_attachments_upload_send_list_and_download(client, fakes):
    from tests.integration.test_chat_and_notifications import _join, _uid
    from tests.integration.test_golden_path import DEV, DIR

    ws = await _workspace(client, "Files")
    await _join(client, ws, DEV)
    await _join(client, ws, DIR, "director")
    ch = (await client.post(
        "/api/chat/channels", headers=_in(ws, PM),
        json={"name": "files", "member_ids": [await _uid(client, DEV)]},
    )).json()
    base = f"/api/chat/channels/{ch['id']}"

    png = await client.post(
        f"{base}/attachments", headers=_in(ws, PM),
        files={"file": ("shot.png", b"\x89PNG fake", "image/png")},
    )
    assert png.status_code == 201, png.text
    svg = (await client.post(
        f"{base}/attachments", headers=_in(ws, PM),
        files={"file": ("x.svg", b"<svg onload=alert(1)>", "image/svg+xml")},
    )).json()
    assert png.json()["kind"] == "image" and svg["kind"] == "file"

    sent = await client.post(
        f"{base}/messages", headers=_in(ws, PM),
        json={"body": "", "attachments": [png.json()["id"], svg["id"]]},
    )
    assert sent.status_code == 201, sent.text
    assert {a["filename"] for a in sent.json()["attachments"]} == {"shot.png", "x.svg"}

    listed = (await client.get(f"{base}/messages", headers=_in(ws, DEV))).json()
    assert len(listed[-1]["attachments"]) == 2

    got = await client.get(f"/api/chat/attachments/{png.json()['id']}", headers=_in(ws, DEV))
    assert got.status_code == 200 and got.content == b"\x89PNG fake"
    assert got.headers["content-type"] == "image/png"
    risky = await client.get(f"/api/chat/attachments/{svg['id']}", headers=_in(ws, DEV))
    assert risky.headers["content-type"] == "application/octet-stream"
    assert risky.headers["content-disposition"].startswith("attachment")

    # A workspace member outside the private channel cannot fetch it.
    hidden = await client.get(f"/api/chat/attachments/{png.json()['id']}", headers=_in(ws, DIR))
    assert hidden.status_code == 404
    # Empty message with no files is rejected.
    assert (await client.post(f"{base}/messages", headers=_in(ws, PM), json={"body": " "})).status_code == 422
