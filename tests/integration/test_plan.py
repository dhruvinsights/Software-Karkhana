# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Plan: drafted epics and stories become issues, a lead approves them."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app import db
from app.models import Epic, Project, Task
from tests.integration.test_golden_path import DEV, PM, as_, client, fakes  # noqa: F401
from tests.integration.test_issues import (  # noqa: F401
    _leave_users_not_onboarded,
    _team_project,
)


async def _seed_epics(pid: str, epics: int = 2, stories: int = 2) -> None:
    """Writes what the evaluation would have drafted."""
    async with db.sessionmaker()() as s:
        n = 0
        for pos in range(epics):
            e = Epic(
                id=uuid.uuid4(),
                project_id=uuid.UUID(pid),
                title=f"Epic {pos}",
                description="why",
                source_quote="quote",
                position=pos,
            )
            s.add(e)
            await s.flush()
            for _ in range(stories):
                n += 1
                s.add(
                    Task(
                        project_id=uuid.UUID(pid),
                        epic_id=e.id,
                        key=f"KAR-{n}",
                        title=f"Story {n}",
                        description="d",
                        acceptance_criteria=["it works"],
                        status="draft",
                    )
                )
        await s.commit()


async def test_plan_needs_epics_first(client):
    _, pid = await _team_project(client)
    async with db.sessionmaker()() as s:  # the background evaluation may have written some
        project = await s.get(Project, uuid.UUID(pid))
        for e in (await s.scalars(select(Epic).where(Epic.project_id == project.id))).all():
            await s.delete(e)
        for t in (await s.scalars(select(Task).where(Task.project_id == project.id))).all():
            await s.delete(t)
        await s.commit()
    r = await client.post(f"/api/projects/{pid}/plan", headers=as_(PM))
    assert r.status_code == 409


async def test_plan_creates_drafts_once_and_a_lead_approves(client):
    _, pid = await _team_project(client)
    async with db.sessionmaker()() as s:
        for e in (await s.scalars(select(Epic).where(Epic.project_id == uuid.UUID(pid)))).all():
            await s.delete(e)
        for t in (await s.scalars(select(Task).where(Task.project_id == uuid.UUID(pid)))).all():
            await s.delete(t)
        await s.commit()
    await _seed_epics(pid)

    r = await client.post(f"/api/projects/{pid}/plan", headers=as_(PM))
    assert r.status_code == 200, r.text
    assert r.json() == {"epics": 2, "stories": 4, "created": 6, "removed": 0}

    # Running it again changes nothing.
    again = (await client.post(f"/api/projects/{pid}/plan", headers=as_(PM))).json()
    assert again["created"] == 0

    plan = (await client.get(f"/api/projects/{pid}/plan", headers=as_(DEV))).json()
    assert plan["draft"] == 6 and plan["total"] == 6
    first = plan["epics"][0]
    assert first["type"] == "epic" and first["status"] == "draft" and len(first["stories"]) == 2
    story = first["stories"][0]
    assert story["parentId"] == first["id"] and story["acceptanceCriteria"] == ["it works"]

    # A developer can read the plan but not approve it.
    assert (await client.post(f"/api/projects/{pid}/plan/approve", headers=as_(DEV))).status_code == 403

    # A project that did not come from a reviewed idea needs the director first.
    r = await client.post(f"/api/projects/{pid}/plan/approve", headers=as_(PM))
    assert r.status_code == 409 and "director" in r.text
    async with db.sessionmaker()() as s:
        project = await s.get(Project, uuid.UUID(pid))
        project.stage, project.stage_status = "plan", "ready"
        await s.commit()

    r = await client.post(f"/api/projects/{pid}/plan/approve", headers=as_(PM))
    assert r.status_code == 200 and r.json() == {"approved": 6}
    plan = (await client.get(f"/api/projects/{pid}/plan", headers=as_(PM))).json()
    assert plan["draft"] == 0 and plan["epics"][0]["status"] == "backlog"

    # Nothing left to approve.
    assert (await client.post(f"/api/projects/{pid}/plan/approve", headers=as_(PM))).status_code == 409

    # Approved work survives a re-sync.
    again = (await client.post(f"/api/projects/{pid}/plan", headers=as_(PM))).json()
    assert again["created"] == 0 and again["removed"] == 0
