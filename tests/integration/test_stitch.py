# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Google Stitch on the designer dashboard, end to end with a fake Stitch."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy import func, select, update

from app import db
from app.config import get_settings
from app.integrations import stitch
from app.models import LedgerEntry, StitchJob, User
from app.services import stitch_design
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
)
from tests.integration.test_project_access import _join, _project

DESIGNER = LEAD
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
HTML = '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body>Checkout</body></html>'


class FakeStitch:
    """In-memory Stitch: one project, screens numbered s1, s2, ..."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.screens: list[stitch.StitchScreen] = []
        self.fail: stitch.StitchError | None = None

    def _new(self, title: str) -> stitch.StitchScreen:
        n = len(self.screens) + 1
        s = stitch.StitchScreen(
            screen_id=f"s{n}",
            title=title,
            html_url=f"https://contribution.usercontent.google.com/h{n}",
            screenshot_url=f"https://lh3.googleusercontent.com/i{n}",
            device_type="DESKTOP",
            width=1280,
            height=900,
        )
        self.screens.append(s)
        return s

    async def create_project(self, title):
        self.calls.append(("create_project", title))
        return "4044680601076201931"

    async def generate(self, pid, prompt, device, model):
        self.calls.append(("generate", pid, prompt, device, model))
        if self.fail:
            # The connection drops, but Stitch finishes the screen anyway.
            self._new("Recovered screen")
            raise self.fail
        return stitch.GenerationResult(
            screens=[self._new("Checkout")], messages=["Done."]
        )

    async def edit(self, pid, ids, prompt, device, model):
        self.calls.append(("edit", pid, ids, prompt))
        return stitch.GenerationResult(screens=[self._new("Checkout (dark)")])

    async def variants(self, pid, ids, prompt, **kw):
        self.calls.append(("variants", pid, ids, prompt, kw))
        return stitch.GenerationResult(
            screens=[self._new(f"Variant {i}") for i in range(kw["count"])]
        )

    async def list_screens(self, pid):
        return list(self.screens)

    async def get_screen(self, pid, sid):
        return next((s for s in self.screens if s.screen_id == sid), None)


@pytest.fixture
def fake_stitch(monkeypatch):
    monkeypatch.setenv("STITCH_ENABLED", "true")
    monkeypatch.setenv("STITCH_API_KEY", "test-stitch-key")
    monkeypatch.setenv("STITCH_DAILY_LIMIT_PER_WORKSPACE", "3")
    get_settings.cache_clear()
    fake = FakeStitch()
    monkeypatch.setattr(stitch_design, "make_client", lambda: fake)

    async def fetch(url, *, max_bytes):
        return (PNG, "image/png") if "lh3" in url else (HTML.encode(), "text/html")

    monkeypatch.setattr(stitch_design, "fetch_asset", fetch)
    yield fake
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
async def _reset_onboarding(client):
    yield
    async with db.sessionmaker()() as s:
        await s.execute(update(User).values(onboarded_at=None))
        await s.commit()


async def _team(client, name):
    ws, pid = await _project(client, name)
    await _join(client, ws, DESIGNER, pid, "designer", ["design"])
    await _join(client, ws, DEV, pid, "developer", ["developer"])
    return ws, pid


async def test_only_designers_reach_stitch(client, fake_stitch):
    _, pid = await _team(client, "Stitch Access")
    base = f"/api/projects/{pid}/stitch"

    # A developer on the team, and the project's own creator/manager, see no studio...
    for who in (DEV, PM):
        home = (await client.get(base, headers=as_(who))).json()
        assert (
            home["canUse"] is False
            and home["isDesigner"] is False
            and "screens" not in home
            and "designers only" in home["reason"]
        )
        r = await client.post(
            f"{base}/generate", headers=as_(who), json={"prompt": "A checkout page"}
        )
        assert r.status_code == 403, r.text
        assert (await client.post(f"{base}/sync", headers=as_(who))).status_code == 403
    # ...and someone outside the workspace cannot even see the project.
    assert (await client.get(base, headers=as_(DIR))).status_code == 404

    home = (await client.get(base, headers=as_(DESIGNER))).json()
    assert (
        home["canUse"] is True
        and home["screens"] == []
        and home["quota"] == {"used": 0, "limit": 3}
    )
    assert fake_stitch.calls == []


async def test_designer_generates_edits_pins_and_archives(client, fake_stitch):
    _, pid = await _team(client, "Stitch Flow")
    base = f"/api/projects/{pid}/stitch"
    h = as_(DESIGNER)

    r = await client.post(
        f"{base}/generate",
        headers=h,
        json={"prompt": "A checkout page", "device_type": "MOBILE"},
    )
    assert r.status_code == 202, r.text
    job = (await client.get(f"{base}/jobs/{r.json()['id']}", headers=h)).json()
    assert job["status"] == "succeeded", job
    assert job["result"]["messages"] == ["Done."]
    assert fake_stitch.calls[0] == ("create_project", "Karkhana · Stitch Flow")
    assert fake_stitch.calls[1][3:] == ("MOBILE", "GEMINI_3_FLASH")

    home = (await client.get(base, headers=h)).json()
    assert home["stitchProjectId"] == "4044680601076201931"
    [screen] = home["screens"]
    assert screen["title"] == "Checkout" and screen["hasScreenshot"]
    sid = screen["id"]

    shot = await client.get(f"{base}/screens/{sid}/screenshot", headers=h)
    assert (
        shot.status_code == 200
        and shot.headers["content-type"] == "image/png"
        and shot.content == PNG
    )
    assert shot.headers["x-content-type-options"] == "nosniff"
    pv = (await client.get(f"{base}/screens/{sid}/preview", headers=h)).json()
    assert pv["srcdoc"].index("Content-Security-Policy") < pv["srcdoc"].index(
        "cdn.tailwindcss.com"
    )
    raw = await client.get(f"{base}/screens/{sid}/html", headers=h)
    assert (
        raw.headers["content-disposition"].startswith("attachment")
        and "sandbox" in raw.headers["content-security-policy"]
    )
    assert raw.headers["content-type"].startswith("text/plain")

    # Developers cannot read designs through the Stitch routes either.
    assert (
        await client.get(f"{base}/screens/{sid}/preview", headers=as_(DEV))
    ).status_code == 403

    r = await client.post(
        f"{base}/screens/{sid}/edit", headers=h, json={"prompt": "Make it dark"}
    )
    assert r.status_code == 202
    r = await client.post(
        f"{base}/screens/{sid}/variants",
        headers=h,
        json={"prompt": "Try layouts", "count": 2, "aspects": ["LAYOUT"]},
    )
    assert r.status_code == 202
    assert fake_stitch.calls[-1][4] == {
        "count": 2,
        "creative_range": "EXPLORE",
        "aspects": ["LAYOUT"],
        "device_type": "DESKTOP",
        "model_id": "GEMINI_3_FLASH",
    }
    screens = (await client.get(base, headers=h)).json()["screens"]
    assert len(screens) == 4 and all(
        s["parentId"] == sid for s in screens if s["id"] != sid
    )

    assert (
        await client.patch(f"{base}/screens/{sid}", headers=h, json={"pinned": True})
    ).json()["pinned"]
    async with db.sessionmaker()() as s:
        pinned = await stitch_design.pinned_for_handoff(s, uuid.UUID(pid))
        assert [str(x.id) for x in pinned] == [sid]
        actions = set(
            (
                await s.scalars(
                    select(LedgerEntry.action).where(
                        LedgerEntry.project_id == uuid.UUID(pid)
                    )
                )
            ).all()
        )
    assert {
        "stitch.generate.requested",
        "stitch.generate.succeeded",
        "stitch.screen.pinned",
    } <= actions

    assert (await client.delete(f"{base}/screens/{sid}", headers=h)).status_code == 204
    assert sid not in {
        s["id"] for s in (await client.get(base, headers=h)).json()["screens"]
    }
    assert (
        await client.get(f"{base}/screens/{sid}/preview", headers=h)
    ).status_code == 404


async def test_quota_and_one_job_at_a_time(client, fake_stitch):
    _, pid = await _team(client, "Stitch Limits")
    base = f"/api/projects/{pid}/stitch"
    h = as_(DESIGNER)

    # A job left running by a dead instance blocks new work until it goes stale.
    async with db.sessionmaker()() as s:
        proj_uuid = uuid.UUID(pid)
        s.add(StitchJob(project_id=proj_uuid, kind="sync", status="running"))
        await s.commit()
    r = await client.post(f"{base}/generate", headers=h, json={"prompt": "Blocked"})
    assert r.status_code == 409
    async with db.sessionmaker()() as s:
        await s.execute(
            update(StitchJob)
            .where(StitchJob.project_id == proj_uuid, StitchJob.status == "running")
            .values(created_at=func.now() - dt.timedelta(hours=1))
        )
        await s.commit()

    for _ in range(3):
        assert (
            await client.post(f"{base}/generate", headers=h, json={"prompt": "A page"})
        ).status_code == 202
    r = await client.post(
        f"{base}/generate", headers=h, json={"prompt": "One too many"}
    )
    assert r.status_code == 429 and "3 Stitch generations" in r.json()["detail"]
    # Sync does not spend generation budget.
    assert (await client.post(f"{base}/sync", headers=h)).status_code == 202


async def test_dropped_generation_is_recovered_from_stitch(client, fake_stitch):
    _, pid = await _team(client, "Stitch Recovery")
    base = f"/api/projects/{pid}/stitch"
    fake_stitch.fail = stitch.StitchError("TIMEOUT", "slow", recoverable=True)
    r = await client.post(
        f"{base}/generate", headers=as_(DESIGNER), json={"prompt": "A dashboard"}
    )
    job = (
        await client.get(f"{base}/jobs/{r.json()['id']}", headers=as_(DESIGNER))
    ).json()
    assert job["status"] == "succeeded" and any(
        "recovered" in w for w in job["result"]["warnings"]
    )
    assert [
        s["title"]
        for s in (await client.get(base, headers=as_(DESIGNER))).json()["screens"]
    ] == ["Recovered screen"]


async def test_story_keys_must_exist(client, fake_stitch):
    _, pid = await _team(client, "Stitch Stories")
    r = await client.post(
        f"/api/projects/{pid}/stitch/generate",
        headers=as_(DESIGNER),
        json={"prompt": "A page", "story_keys": ["KAR-999"]},
    )
    assert r.status_code == 422 and "KAR-999" in r.json()["detail"]


async def test_disabled_server_hides_the_studio(client, monkeypatch):
    monkeypatch.setenv("STITCH_ENABLED", "false")
    get_settings.cache_clear()
    try:
        _, pid = await _team(client, "Stitch Off")
        home = (
            await client.get(f"/api/projects/{pid}/stitch", headers=as_(DESIGNER))
        ).json()
        assert home["canUse"] is False and home["configured"] is False
        assert home["isDesigner"] is True
        r = await client.post(
            f"/api/projects/{pid}/stitch/generate",
            headers=as_(DESIGNER),
            json={"prompt": "x y z"},
        )
        assert r.status_code == 503
    finally:
        get_settings.cache_clear()


async def test_pinned_screens_travel_with_the_design_handoff(client, fake_stitch):
    from app.models import ContextEntry, ProjectDocument

    _, pid = await _team(client, "Stitch Handoff")
    base = f"/api/projects/{pid}/stitch"
    h = as_(DESIGNER)
    await client.post(f"{base}/generate", headers=h, json={"prompt": "A checkout page"})
    sid = (await client.get(base, headers=h)).json()["screens"][0]["id"]
    await client.patch(f"{base}/screens/{sid}", headers=h, json={"pinned": True})

    spec = {
        "overview": "Checkout redesign.",
        "principles": ["Fast"],
        "api_contracts": [],
        "screens": [],
        "tokens": [],
        "accessibility": [],
        "handoff_notes": ["Start with the cart."],
    }
    async with db.sessionmaker()() as s:
        s.add(
            ProjectDocument(
                project_id=uuid.UUID(pid),
                kind="design",
                version=1,
                title="Design",
                content=spec,
                model="test",
            )
        )
        await s.commit()
    r = await client.post(f"/api/projects/{pid}/documents/design/approve", headers=h)
    assert r.status_code == 200, r.text
    async with db.sessionmaker()() as s:
        body = await s.scalar(
            select(ContextEntry.body).where(
                ContextEntry.project_id == uuid.UUID(pid),
                ContextEntry.kind == "handoff",
            )
        )
        payload = await s.scalar(
            select(LedgerEntry.payload).where(
                LedgerEntry.project_id == uuid.UUID(pid),
                LedgerEntry.action == "design.approved",
            )
        )
    assert "Google Stitch screens (designer dashboard): Checkout [DESKTOP]." in body
    assert payload["stitch_screens"] == [sid]
