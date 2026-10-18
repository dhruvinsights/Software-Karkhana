"""Launch Demo: lifecycle, claim, isolation and guest guards."""

from __future__ import annotations

import pytest

from tests.integration.test_golden_path import PM, as_, client  # noqa: F401

pytestmark = pytest.mark.usefixtures("database")


@pytest.fixture(autouse=True)
def _roomy_limit(monkeypatch):
    monkeypatch.setenv("DEMO_MAX_PER_HOUR", "1000")


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _start(client):
    r = await client.post("/api/demo/sessions")
    assert r.status_code == 201, r.text
    return r.json()


async def test_demo_opens_without_account_and_is_seeded(client):
    d = await _start(client)
    assert d["user"]["is_guest"] and d["workspace"]["is_sandbox"]
    h = bearer(d["token"])
    ws = (await client.get("/api/workspaces/list", headers=h)).json()
    assert [w["id"] for w in ws] == [d["workspace"]["id"]]
    prods = (await client.get("/api/products", headers=h)).json()
    assert prods
    assert (await client.get("/api/demo/session", headers=h)).json()["tourMinutes"] == 5


async def test_guest_cannot_use_password_login_or_outside_actions(client):
    d = await _start(client)
    h = bearer(d["token"])
    r = await client.post("/api/auth/login", json={"email": d["user"]["email"], "password": "x"})
    assert r.status_code == 401
    r = await client.post("/api/workspaces/create", headers=h, json={"name": "Mine"})
    assert r.status_code == 403 and r.headers.get("x-karkhana-signup-required") == "1"
    r = await client.post(f"/api/workspaces/{d['workspace']['id']}/invites", headers=h, json={})
    assert r.status_code == 403 and r.headers.get("x-karkhana-signup-required") == "1"


async def test_real_user_cannot_see_the_sandbox(client):
    d = await _start(client)
    mine = (await client.post("/api/workspaces/create", headers=as_(PM), json={"name": "Real Co"})).json()
    assert mine["plan"] == "free"
    ids = [w["id"] for w in (await client.get("/api/workspaces/list", headers=as_(PM))).json()]
    assert d["workspace"]["id"] not in ids
    r = await client.get("/api/products", headers={**as_(PM), "X-Workspace-Id": d["workspace"]["id"]})
    assert r.status_code in (200, 403, 404)
    if r.status_code == 200:
        assert r.json() == []


async def test_claim_is_idempotent_and_ends_the_guest(client):
    d = await _start(client)
    body = {"demo_token": d["token"], "tour": {"completed": ["a", "b"], "lastStep": "b"}}
    r = await client.post("/api/demo/claim", headers=as_(PM), json=body)
    assert r.status_code == 200 and r.json()["claimed"] is True
    assert r.json()["tour"]["completed"] == ["a", "b"]
    r = await client.post("/api/demo/claim", headers=as_(PM), json=body)
    assert r.status_code == 200 and r.json()["claimed"] is False
    other = await client.post("/api/demo/claim", headers=as_("someone.else@example.com"), json=body)
    assert other.status_code in (403, 409)
    # The sandbox is not joined to the real account and the guest session is over.
    assert (await client.get("/api/demo/session", headers=bearer(d["token"]))).status_code == 401
    ids = [w["id"] for w in (await client.get("/api/workspaces/list", headers=as_(PM))).json()]
    assert d["workspace"]["id"] not in ids


async def test_guest_cannot_claim_and_bad_token_rejected(client):
    d = await _start(client)
    r = await client.post("/api/demo/claim", headers=bearer(d["token"]), json={"demo_token": d["token"]})
    assert r.status_code == 403
    r = await client.post("/api/demo/claim", headers=as_(PM), json={"demo_token": "x" * 40})
    assert r.status_code == 400


async def test_rate_limit(client, monkeypatch):
    # With a limit of 1, the second request from one network is always refused,
    # whatever earlier tests already started.
    monkeypatch.setenv("DEMO_MAX_PER_HOUR", "1")
    await client.post("/api/demo/sessions")
    assert (await client.post("/api/demo/sessions")).status_code == 429


async def test_exit_demo_ends_session(client):
    d = await _start(client)
    h = bearer(d["token"])
    assert (await client.post("/api/demo/session/end", headers=h)).status_code == 204
    assert (await client.get("/api/demo/session", headers=h)).status_code == 401
