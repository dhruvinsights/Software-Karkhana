# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Postgres row-level security (017): the database itself hides other tenants.

These tests query as the least-privilege app role with *no* application
WHERE clause, so only the RLS policies stand between tenants.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, text

from app import db
from app.models import Learning, Project, User, Workspace, WorkspaceMember
from tests.integration.test_golden_path import client, fakes  # noqa: F401


async def _tenant(s, name: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    user = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:8]}@{name}.dev", display_name=name, role="developer")
    ws = Workspace(id=uuid.uuid4(), name=name, slug=f"{name}-{uuid.uuid4().hex[:6]}", created_by=user.id)
    s.add_all([user, ws])
    await s.flush()
    s.add(WorkspaceMember(id=uuid.uuid4(), workspace_id=ws.id, user_id=user.id, role="pm", is_owner=True))
    project = Project(id=uuid.uuid4(), name=f"{name} project", idea_text="x", workspace_id=ws.id, created_by=user.id)
    s.add(project)
    await s.flush()
    s.add(Learning(id=uuid.uuid4(), project_id=project.id, text=f"{name} secret", status="verified", source={}))
    await s.flush()
    return user.id, ws.id, project.id


async def test_rls_hides_other_tenants_without_any_where_clause(client):
    async with db.sessionmaker()() as s:
        ua, _, pa = await _tenant(s, "acme")
        ub, _, pb = await _tenant(s, "globex")
        await s.commit()

    async with db.sessionmaker()() as s:
        await db.bind_rls_user(s, ua)
        projects = set((await s.scalars(select(Project.id))).all())
        learnings = {lr.text for lr in (await s.scalars(select(Learning))).all()}
        assert pa in projects and pb not in projects
        assert "acme secret" in learnings and "globex secret" not in learnings
        # Survives a commit inside the request (re-applied per transaction).
        await s.commit()
        assert pb not in set((await s.scalars(select(Project.id))).all())
        assert pa in set((await s.scalars(select(Project.id))).all())


async def test_system_context_and_pooled_connections_are_unaffected(client):
    async with db.sessionmaker()() as s:
        ua, _, pa = await _tenant(s, "initech")
        _, _, pb = await _tenant(s, "hooli")
        await s.commit()

    async with db.sessionmaker()() as s:
        await db.bind_rls_user(s, ua)
        assert pb not in set((await s.scalars(select(Project.id))).all())

    # A fresh session (background job, worker callback) is a system context,
    # even if it reuses the same pooled connection.
    async with db.sessionmaker()() as s:
        assert await s.scalar(text("SELECT current_setting('karkhana.user_id', true)")) in (None, "")
        ids = set((await s.scalars(select(Project.id))).all())
        assert {pa, pb} <= ids
