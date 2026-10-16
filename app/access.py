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

"""Who may see and use which part of a project.

A project is either *open* (everyone in its workspace, the historical default)
or *restricted* (``settings.access == "restricted"``): only its team, and each
teammate only the stations (design, developer, qa, ...) they were given.
Projects created through idea approval are restricted.

``decide`` is pure and unit-tested; the async helpers load the facts and apply it.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.idea_flow import ALL_STATIONS, MANAGER_ROLES
from app.models import Project, ProjectMember, WorkspaceMember

RESTRICTED = "restricted"
OPEN = "open"


def is_restricted(project: Project) -> bool:
    """Return True when the project's settings mark it as restricted-access."""
    return (project.settings or {}).get("access") == RESTRICTED


def decide(
    *,
    restricted: bool,
    privileged: bool,
    member_stations: Iterable[str] | None,
    wanted: Iterable[str] = (),
) -> tuple[bool, str]:
    """Whether a person may use the ``wanted`` station(s) of a project.

    Args:
        restricted: The project is limited to its team.
        privileged: The person leads/created the project or is a manager of its workspace.
        member_stations: Their stations on the project, or ``None`` if not a member.
        wanted: Any one of these stations is enough; empty means "just be on the team".
    """
    if not restricted or privileged:
        return True, ""
    if member_stations is None:
        return (
            False,
            "This project is restricted to its team. Ask the project lead for an invite.",
        )
    needed = [w for w in wanted if w]
    if needed and not set(needed) & set(member_stations):
        names = " or ".join(needed)
        return (
            False,
            f"Your access to this project does not include the {names} station.",
        )
    return True, ""


# The account-level role new sign-ups get (a non-manager role). ``User.role``
# is only a display label; it grants nothing anywhere.
DEFAULT_ACCOUNT_ROLE = "developer"


async def workspace_member(
    session: AsyncSession, user: Any, workspace_id: uuid.UUID | None
) -> WorkspaceMember | None:
    """The caller's membership row in ``workspace_id``, or ``None``."""
    if workspace_id is None:
        return None
    return await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )


def _member_role(member: WorkspaceMember | None) -> str:
    if member is None:
        return ""
    role = member.role or ""
    # The owner, and anyone the owner made a workspace admin, always count as at
    # least a manager (see app/workspace_access.py for the access levels).
    if (member.is_owner or getattr(member, "access", "") in ("owner", "admin")) and role not in MANAGER_ROLES:
        return "pm"
    return role


async def effective_role(
    session: AsyncSession, user: Any, workspace_id: uuid.UUID | None
) -> str:
    """The role that counts for permissions: the one held *in that workspace*.

    ``User.role`` (the account label) never grants authority. A non-member
    has no role (``""``), and so does everyone on a resource with no workspace:
    such legacy rows are not governed by anyone's self-chosen label.
    """
    return _member_role(await workspace_member(session, user, workspace_id))


# Clearer name for new call sites; same function.
workspace_role = effective_role


async def require_workspace_role(
    session: AsyncSession, user: Any, workspace_id: uuid.UUID | None, *roles: str
) -> str:
    """Returns the caller's role in ``workspace_id``; 403 unless it is one of ``roles``."""
    role = await effective_role(session, user, workspace_id)
    allowed = {str(r) for r in roles}
    if role not in allowed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Requires role in this workspace: {', '.join(sorted(allowed))}",
        )
    return role


async def require_project_role(
    session: AsyncSession, user: Any, project: Project, *roles: str
) -> str:
    """403 unless the caller holds one of ``roles`` in the project's workspace.

    This replaces the old global ``require_role``: being a director in one
    workspace grants nothing in another.
    """
    return await require_workspace_role(session, user, project.workspace_id, *roles)


async def primary_workspace_id(session: AsyncSession, user: Any) -> uuid.UUID | None:
    """The workspace shown by default: owned first, then the earliest joined."""
    return await session.scalar(
        select(WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.is_owner.desc(), WorkspaceMember.joined_at.asc())
        .limit(1)
    )


async def resolve_workspace(
    session: AsyncSession, user: Any, requested: uuid.UUID | None
) -> uuid.UUID:
    """The workspace a new project or idea goes into.

    An explicit workspace must be one the caller belongs to; without one the
    caller's primary workspace is used. Nothing is created outside a workspace.
    """
    if requested is not None:
        if await workspace_member(session, user, requested) is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "You are not a member of that workspace."
            )
        return requested
    ws = await primary_workspace_id(session, user)
    if ws is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Create or join a workspace first.",
        )
    return ws


async def display_role(session: AsyncSession, user: Any) -> str:
    """Role label for navigation: the one held in the primary workspace.

    For UI only. Server-side checks always use the resource's workspace.
    """
    ws = await primary_workspace_id(session, user)
    member = await workspace_member(session, user, ws)
    return (member.role if member else None) or user.role or DEFAULT_ACCOUNT_ROLE


async def _is_privileged(session: AsyncSession, user: Any, project: Project) -> bool:
    if project.lead_id == user.id or project.created_by == user.id:
        return True
    return await effective_role(session, user, project.workspace_id) in MANAGER_ROLES


async def my_access(
    session: AsyncSession, user: Any, project: Project
) -> dict[str, Any]:
    """What the signed-in user can do on this project, for the UI and the guards."""
    privileged = await _is_privileged(session, user, project)
    member = await session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    )
    restricted = is_restricted(project)
    full = privileged or not restricted
    if full:
        stations = list(ALL_STATIONS)
    else:
        stations = list(member.stations or []) if member else []
    return {
        "projectId": str(project.id),
        "access": RESTRICTED if restricted else OPEN,
        "isMember": member is not None,
        "isLead": bool(member and member.is_lead) or project.lead_id == user.id,
        "canManage": privileged,
        "role": member.role if member else None,
        "stations": stations,
        "canView": full or member is not None,
    }


async def ensure_station(
    session: AsyncSession, user: Any, project: Project, *wanted: str
) -> None:
    """Raises 403 unless ``user`` may use one of the ``wanted`` stations here."""
    privileged = await _is_privileged(session, user, project)
    member = await session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    )
    if not is_restricted(project):
        # Open still means "inside the workspace", never "anyone on the platform".
        if project.workspace_id is None or privileged or member is not None:
            return
        in_workspace = await session.scalar(
            select(WorkspaceMember.id).where(
                WorkspaceMember.workspace_id == project.workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
        if in_workspace is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You are not a member of this project's workspace.",
            )
        return
    ok, why = decide(
        restricted=True,
        privileged=privileged,
        member_stations=(member.stations or []) if member else None,
        wanted=wanted,
    )
    if not ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, why)


def visible_projects(user: Any):
    """A SQL condition: the projects ``user`` may see in lists.

    Their workspaces only (plus legacy projects with no workspace), and within
    those, restricted projects only when they are on the team or manage it.
    """
    my_workspaces = select(WorkspaceMember.workspace_id).where(
        WorkspaceMember.user_id == user.id
    )
    my_projects = select(ProjectMember.project_id).where(
        ProjectMember.user_id == user.id
    )
    not_restricted = (
        func.coalesce(Project.settings["access"].astext, OPEN) != RESTRICTED
    )
    managed_workspaces = select(WorkspaceMember.workspace_id).where(
        WorkspaceMember.user_id == user.id,
        or_(
            WorkspaceMember.is_owner.is_(True),
            WorkspaceMember.role.in_(tuple(MANAGER_ROLES)),
        ),
    )
    manages = or_(
        Project.lead_id == user.id,
        Project.created_by == user.id,
        Project.workspace_id.in_(managed_workspaces),
    )
    return and_(
        or_(Project.workspace_id.is_(None), Project.workspace_id.in_(my_workspaces)),
        or_(not_restricted, Project.id.in_(my_projects), manages),
    )


async def get_visible_project(
    session: AsyncSession, user: Any, project_id: uuid.UUID
) -> Project:
    """Loads a project or 404s; restricted ones 403 for people outside the team."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await ensure_station(session, user, project)
    return project
