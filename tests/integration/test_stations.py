# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Server-backed stations (ADRs, QA scenarios, security findings) on real Postgres."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, update

from app import db
from app.models import LedgerEntry, User
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


async def _project(client, name="Stations Co"):
    ws = (await client.post("/api/workspaces/create", headers=as_(PM), json={"name": name})).json()["id"]
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={"name": name, "idea_text": "Govern every station", "workspace_id": ws},
    )
    assert r.status_code == 202, r.text
    return ws, r.json()["id"]


async def _join(client, ws, who, pid, role="developer"):
    inv = (
        await client.post(f"/api/workspaces/{ws}/invites", headers=as_(PM), json={"role": role, "project_id": pid})
    ).json()
    r = await client.post("/api/invites/accept", headers=as_(who), json={"token": inv["token"]})
    assert r.status_code == 200, r.text


async def _events(subject_id: str) -> list[LedgerEntry]:
    async with db.sessionmaker()() as s:
        rows = await s.scalars(
            select(LedgerEntry).where(LedgerEntry.subject_id == subject_id).order_by(LedgerEntry.seq)
        )
        return list(rows.all())


async def test_adr_crud_numbers_and_ledger(client):
    ws, pid = await _project(client, "ADR Co")
    r = await client.post(
        f"/api/projects/{pid}/adrs",
        headers=as_(PM),
        json={"title": "Use Postgres RLS", "decision": "Add RLS on tenant tables", "consequences": ["More SQL"]},
    )
    assert r.status_code == 201, r.text
    adr = r.json()
    assert adr["number"] == 1 and adr["key"] == "ADR-001" and adr["status"] == "proposed"
    assert adr["workspaceId"] == ws and adr["author"]
    second = (await client.post(f"/api/projects/{pid}/adrs", headers=as_(PM), json={"title": "Split JWT keys"})).json()
    assert second["number"] == 2

    r = await client.patch(f"/api/adrs/{adr['id']}", headers=as_(PM), json={"status": "accepted"})
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    r = await client.patch(f"/api/adrs/{adr['id']}", headers=as_(PM), json={"rationale": "Defence in depth"})
    assert r.json()["rationale"] == "Defence in depth"
    # No-op patch writes nothing.
    await client.patch(f"/api/adrs/{adr['id']}", headers=as_(PM), json={"status": "accepted"})

    listed = (await client.get(f"/api/projects/{pid}/adrs", headers=as_(PM))).json()
    assert [a["number"] for a in listed] == [2, 1]

    events = await _events(adr["id"])
    assert [e.action for e in events] == ["adr.created", "adr.status_changed", "adr.updated"]
    assert all(str(e.project_id) == pid for e in events)
    assert events[1].payload["status"] == "accepted"

    bad = await client.patch(f"/api/adrs/{adr['id']}", headers=as_(PM), json={"status": "maybe"})
    assert bad.status_code == 422


async def test_scenario_result_is_one_status_event(client):
    ws, pid = await _project(client, "QA Co")
    await _join(client, ws, DEV, pid)
    r = await client.post(
        f"/api/projects/{pid}/test-scenarios",
        headers=as_(DEV),
        json={"title": "Expired token returns 401", "type": "Security / Negative", "priority": "P0",
              "steps": ["Expire token", "Call API"], "expected_result": "401"},
    )
    assert r.status_code == 201, r.text
    tc = r.json()
    assert tc["status"] == "not_run" and tc["steps"] == ["Expire token", "Call API"]

    r = await client.patch(
        f"/api/test-scenarios/{tc['id']}",
        headers=as_(DEV),
        json={"status": "failed", "actual_result": "Got 500"},
    )
    assert r.status_code == 200 and r.json()["status"] == "failed" and r.json()["actualResult"] == "Got 500"
    events = await _events(tc["id"])
    assert [e.action for e in events] == ["test_scenario.created", "test_scenario.status_changed"]
    assert events[1].payload["actual_result"] == "Got 500"

    listed = (await client.get(f"/api/projects/{pid}/test-scenarios", headers=as_(PM))).json()
    assert [t["id"] for t in listed] == [tc["id"]]


async def test_waiving_a_finding_needs_reason_and_a_lead(client):
    ws, pid = await _project(client, "Sec Co")
    await _join(client, ws, DEV, pid)
    r = await client.post(
        f"/api/projects/{pid}/security-findings",
        headers=as_(DEV),
        json={"title": "SQL injection in search", "severity": "HIGH", "cvss_score": 8.1,
              "cwe_category": "CWE-89", "sla_deadline": "2026-11-01"},
    )
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["status"] == "open" and f["cvssScore"] == 8.1 and f["slaDeadline"] == "2026-11-01"

    no_reason = await client.patch(f"/api/security-findings/{f['id']}", headers=as_(PM), json={"status": "waived"})
    assert no_reason.status_code == 422
    not_lead = await client.patch(
        f"/api/security-findings/{f['id']}", headers=as_(DEV), json={"status": "waived", "reason": "Low risk"}
    )
    assert not_lead.status_code == 403
    ok = await client.patch(
        f"/api/security-findings/{f['id']}", headers=as_(PM), json={"status": "waived", "reason": "Internal only"}
    )
    assert ok.status_code == 200 and ok.json()["statusReason"] == "Internal only"

    events = await _events(f["id"])
    assert [e.action for e in events] == ["security_finding.created", "security_finding.status_changed"]
    assert events[1].payload["reason"] == "Internal only"


async def test_other_workspace_cannot_list_create_or_update(client):
    _, pid = await _project(client, "Tenant A")
    adr = (await client.post(f"/api/projects/{pid}/adrs", headers=as_(PM), json={"title": "Private decision"})).json()
    tc = (await client.post(f"/api/projects/{pid}/test-scenarios", headers=as_(PM), json={"title": "Private test"})).json()
    fnd = (
        await client.post(f"/api/projects/{pid}/security-findings", headers=as_(PM), json={"title": "Private CVE"})
    ).json()

    # DIR is a director, but not in this workspace.
    for path in ("adrs", "test-scenarios", "security-findings"):
        assert (await client.get(f"/api/projects/{pid}/{path}", headers=as_(DIR))).status_code == 404
        r = await client.post(f"/api/projects/{pid}/{path}", headers=as_(DIR), json={"title": "Sneaky write"})
        assert r.status_code == 404
    assert (await client.patch(f"/api/adrs/{adr['id']}", headers=as_(DIR), json={"title": "Hijack"})).status_code == 404
    r = await client.patch(f"/api/test-scenarios/{tc['id']}", headers=as_(DIR), json={"status": "passed"})
    assert r.status_code == 404
    r = await client.patch(f"/api/security-findings/{fnd['id']}", headers=as_(DIR), json={"status": "verified_fixed"})
    assert r.status_code == 404

    # Nothing was written by the outsider.
    assert len(await _events(adr["id"])) == 1
    assert (await client.patch(f"/api/adrs/{uuid.uuid4()}", headers=as_(PM), json={"title": "Nope"})).status_code == 404


async def test_restricted_project_needs_the_station(client):
    ws, pid = await _project(client, "Restricted Co")
    inv = (
        await client.post(
            f"/api/workspaces/{ws}/invites",
            headers=as_(PM),
            json={"role": "developer", "project_id": pid, "stations": ["qa"]},
        )
    ).json()
    assert (await client.post("/api/invites/accept", headers=as_(LEAD), json={"token": inv["token"]})).status_code == 200
    r = await client.patch(f"/api/projects/{pid}/access", headers=as_(PM), json={"access": "restricted"})
    assert r.status_code == 200

    assert (await client.get(f"/api/projects/{pid}/test-scenarios", headers=as_(LEAD))).status_code == 200
    assert (await client.get(f"/api/projects/{pid}/security-findings", headers=as_(LEAD))).status_code == 403
    r = await client.post(f"/api/projects/{pid}/adrs", headers=as_(LEAD), json={"title": "Not my station"})
    assert r.status_code == 403


async def test_qa_queue_and_ai_scenarios_for_finished_story(client, monkeypatch):
    from app.services import qa_synth

    real_structured = qa_synth.llm.generate_structured

    async def fake_structured(**kw):
        if kw.get("schema") is not qa_synth.DraftScenarios:
            return await real_structured(**kw)
        return qa_synth.DraftScenarios(
            scenarios=[
                qa_synth.DraftScenario(
                    title="Valid code lowers total", steps=["Open cart", "Apply SAVE10"],
                    expected_result="Total drops 10%",
                ),
                qa_synth.DraftScenario(
                    title="Expired code rejected", type="Boundary", priority="P0",
                    steps=["Apply OLD10"], expected_result="Code expired",
                ),
            ]
        )

    async def fake_text(**_kw):
        return "def test_x():\n    r = requests.get(BASE_URL)\n    assert r.status_code == 200"

    monkeypatch.setattr(qa_synth.llm, "generate_structured", fake_structured)
    monkeypatch.setattr(qa_synth.llm, "generate_text", fake_text)

    _ws, pid = await _project(client, "QA Queue Co")
    done = (
        await client.post(
            f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Discount codes", "type": "task"}
        )
    ).json()
    await client.post(
        f"/api/projects/{pid}/issues", headers=as_(PM), json={"title": "Not built yet", "type": "task"}
    )
    moved = await client.patch(f"/api/issues/{done['id']}", headers=as_(PM), json={"status": "ready_for_qa"})
    assert moved.status_code == 200, moved.text

    queue = (await client.get(f"/api/projects/{pid}/qa-queue", headers=as_(PM))).json()
    assert [q["title"] for q in queue] == ["Discount codes"]
    assert queue[0]["scenarios"] == 0

    r = await client.post(f"/api/issues/{done['id']}/test-scenarios", headers=as_(PM))
    assert r.status_code == 201, r.text
    made = r.json()
    assert [m["title"] for m in made] == ["Valid code lowers total", "Expired code rejected"]
    assert made[1]["priority"] == "P0" and made[1]["type"] == "Boundary"
    assert "assert" in made[0]["automationScript"]
    assert made[0]["issueId"] == done["id"] and made[0]["status"] == "not_run"

    again = await client.post(f"/api/issues/{done['id']}/test-scenarios", headers=as_(PM))
    assert again.json() == []  # same titles are not duplicated
    queue = (await client.get(f"/api/projects/{pid}/qa-queue", headers=as_(PM))).json()
    assert queue[0]["scenarios"] == 2
