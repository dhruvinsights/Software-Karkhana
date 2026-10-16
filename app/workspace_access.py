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

"""Workspace access levels, layered on ``app.access``.

``app.access`` decides who may use which station of a project (open vs
restricted projects, per-workspace roles, station leads). This module adds the
*workspace access level* an owner hands out, independent of job title:

* ``owner``    created the workspace
* ``admin``    manages members, the product and every project
* ``reviewer`` decides ideas; sees every project's overview, read-only
* ``guide``    read-only advisor on everything; may comment
* ``member``   works on the projects they are invited to

Admins count as managers inside ``app.access`` (see ``_member_role``), so they
can open every project and manage its team. Guides and reviewers are read-only
on project work; a reviewer who is also a project member keeps that
membership's stations.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access as base
from app.auth import CurrentUser
from app.db import get_session
from app.idea_flow import ALL_STATIONS
from app.models import Project, ProjectMember, User, WorkspaceMember

STATIONS: tuple[str, ...] = tuple(ALL_STATIONS)
ACCESS_LEVELS: tuple[str, ...] = ("owner", "admin", "reviewer", "guide", "member")

# Older rows and our earlier builds used these ids.
_LEGACY_STATIONS = {"development": "developer"}


def normalize_stations(raw: list[str] | None) -> list[str]:
    """Canonical station ids in order, legacy names mapped, unknown ids dropped."""
    seen = {_LEGACY_STATIONS.get(s, s) for s in (raw or [])}
    return [s for s in STATIONS if s in seen]


@dataclass(frozen=True)
class WorkspaceAccess:
    """The caller's membership in one workspace."""

    workspace_id: uuid.UUID
    user: User
    title: str
    is_owner: bool
    access: str = "member"

    @property
    def is_admin(self) -> bool:
        """Owners and admins manage members and every project in the workspace."""
        return self.is_owner or self.access in ("owner", "admin")

    @property
    def is_guide(self) -> bool:
        """Guides are read-only advisors."""
        return self.access == "guide"

    @property
    def is_reviewer(self) -> bool:
        """Reviewers decide ideas and see project overviews read-only."""
        return self.access == "reviewer"

    @property
    def sees_all_projects(self) -> bool:
        """Admins, guides and reviewers see every project in the workspace."""
        return self.is_admin or self.is_guide or self.is_reviewer

    def require_admin(self) -> None:
        """Raises 403 unless the caller is the workspace owner or an admin."""
        if not self.is_admin:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only workspace admins can do this"
            )

    def require_write(self) -> None:
        """Raises 403 for guides and reviewers, who are read-only on project work."""
        if self.is_guide:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Guides have read-only access"
            )
        if self.is_reviewer:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Reviewers have read-only access to project work",
            )


@dataclass(frozen=True)
class ProjectAccess:
    """A project the caller may open, with the stations granted to them."""

    project: Project
    workspace: WorkspaceAccess | None
    stations: list[str]
    read_only: bool = False

    def require(self, station: str) -> None:
        """Raises 403 unless the caller holds ``station`` on this project."""
        if station not in self.stations:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"No access to the {station} workspace of this project",
            )

    def require_any(self, *stations: str) -> None:
        """Raises 403 unless the caller holds at least one of ``stations``."""
        if not any(s in self.stations for s in stations):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "No access to this part of the project"
            )

    def require_write(self, station: str | None = None) -> None:
        """Raises 403 for read-only viewers, and unless they hold ``station`` when given."""
        if self.read_only:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Guides and reviewers have read-only access"
            )
        if station:
            self.require(station)


async def workspace_access(
    session: AsyncSession, user: User, workspace_id: uuid.UUID
) -> WorkspaceAccess:
    """Raises 403 unless ``user`` is a member of the workspace."""
    member = await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this workspace")
    access = "owner" if member.is_owner else (member.access or "member")
    return WorkspaceAccess(workspace_id, user, member.role, member.is_owner, access)


async def default_workspace_id(session: AsyncSession, user: User) -> uuid.UUID:
    """The workspace shown by default: owned first, then the earliest joined."""
    ws_id = await base.primary_workspace_id(session, user)
    if ws_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of any workspace")
    return ws_id


async def current_workspace(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_workspace_id: Annotated[str | None, Header()] = None,
) -> WorkspaceAccess:
    """The workspace named by the ``X-Workspace-Id`` header, else the user's default."""
    if x_workspace_id:
        try:
            ws_id = uuid.UUID(x_workspace_id)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Invalid X-Workspace-Id"
            ) from exc
    else:
        ws_id = await default_workspace_id(session, user)
    return await workspace_access(session, user, ws_id)


CurrentWorkspace = Annotated[WorkspaceAccess, Depends(current_workspace)]


async def project_access(
    session: AsyncSession, user: User, project_id: uuid.UUID
) -> ProjectAccess:
    """The caller's rights on a project, or 404 when it is gone or not theirs to see.

    Guides see everything read-only; reviewers see the overview read-only;
    everyone else gets exactly what ``app.access`` grants (restricted projects
    only for their team and its managers, which includes admins).
    """
    project = await session.get(Project, project_id)
    if project is None or project.archived_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    ws: WorkspaceAccess | None = None
    if project.workspace_id:
        try:
            ws = await workspace_access(session, user, project.workspace_id)
        except HTTPException:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Project not found"
            ) from None

    if ws is not None and ws.is_guide:
        # Guides see everything and change nothing, whatever their project row says.
        return ProjectAccess(project, ws, list(STATIONS), read_only=True)

    member = await session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == user.id
        )
    )
    if ws is not None and ws.is_reviewer and member is None:
        # Overview only: status, epics and progress; no station work areas.
        return ProjectAccess(project, ws, [], read_only=True)

    try:
        await base.ensure_station(session, user, project)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_403_FORBIDDEN:
            # 404, not 403: a project you may not open must not reveal that it exists.
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Project not found"
            ) from None
        raise
    mine = await base.my_access(session, user, project)
    return ProjectAccess(project, ws, normalize_stations(mine["stations"]))


async def visible_project_ids(
    session: AsyncSession, ws: WorkspaceAccess
) -> list[uuid.UUID] | None:
    """Live projects in the workspace the user may open; ``None`` means all of them."""
    if ws.sees_all_projects:
        return None
    rows = await session.scalars(
        select(Project.id).where(
            Project.workspace_id == ws.workspace_id,
            Project.archived_at.is_(None),
            base.visible_projects(ws.user),
        )
    )
    return list(rows.all())


async def forbid_read_only(
    session: AsyncSession, user: User, workspace_id: uuid.UUID | None
) -> None:
    """403 for guides and reviewers on a write action; a no-op outside a workspace.

    Other access rules (roles, stations) are enforced by ``app.access``; this only
    adds the read-only access levels on top.
    """
    if workspace_id is None:
        return
    try:
        ws = await workspace_access(session, user, workspace_id)
    except HTTPException:
        return  # not a member: app.access rejects it with a precise message
    ws.require_write()
