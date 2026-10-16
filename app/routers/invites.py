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

"""Invitations: workspace-level and project-level, by link and by email.

An invite carries a role (and, for a project, the stations the person may see).
The link opens the app, the person signs in, and the invite is accepted for the
signed-in account: addressed invites only for that email, single use.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import uuid
from html import escape
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db, idea_flow, invite_rules, ledger
from app.auth import CurrentUser
from app.config import get_settings
from app.email import send_email
from app.models import (
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceInvite,
    WorkspaceMember,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["invites"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


class InviteIn(BaseModel):
    """Create an invite. ``email`` makes it personal and sends it by email."""

    email: str | None = Field(default=None, max_length=254)
    role: str = "developer"
    project_id: uuid.UUID | None = None
    stations: list[str] | None = None
    is_lead: bool = False


class AcceptIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _base_url(request: Request) -> str:
    configured = (get_settings().app_url or "").rstrip("/")
    return configured or str(request.base_url).rstrip("/")


def _link(base: str, token: str) -> str:
    return f"{base}/?invite={token}"


def _email_html(*, inviter: str, workspace: str, role: str, project: str | None, link: str) -> str:
    where = f"the <b>{escape(project)}</b> project in " if project else ""
    return (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">'
        f"<h2>{escape(inviter)} invited you to Software Karkhana</h2>"
        f"<p>You have been added to {where}<b>{escape(workspace)}</b> as "
        f"<b>{escape(role.replace('_', ' '))}</b>.</p>"
        f'<p><a href="{escape(link)}" style="display:inline-block;padding:12px 22px;'
        'background:#075BFF;color:#fff;border-radius:8px;text-decoration:none">Accept invitation</a></p>'
        f'<p style="color:#667386;font-size:12px">Or open this link: {escape(link)}<br>'
        "It works for 14 days and only for this email address.</p></div>"
    )


async def _workspace_member(session: AsyncSession, ws_id: uuid.UUID, user_id: uuid.UUID) -> WorkspaceMember | None:
    return await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id == user_id
        )
    )


@router.post("/api/workspaces/{workspace_id}/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(
    workspace_id: uuid.UUID,
    body: InviteIn,
    request: Request,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Creates an invite link and, when an email is given, sends it."""
    member = await _workspace_member(session, workspace_id, user.id)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of this workspace.")
    ws = await session.get(Workspace, workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found.")

    ok, why = invite_rules.can_invite_role(
        inviter_role=member.role, inviter_is_owner=member.is_owner, target_role=body.role
    )
    if not ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, why)

    email = (body.email or "").strip().lower() or None
    if email and ("@" not in email or " " in email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid email address.")

    project: Project | None = None
    stations = body.stations
    if body.project_id:
        project = await session.get(Project, body.project_id)
        if project is None or project.workspace_id != workspace_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found in this workspace.")
        caller = await session.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
            )
        )
        stations = stations if stations is not None else idea_flow.stations_for(body.role)
        allowed, why = idea_flow.can_add_member(
            caller_role=member.role,
            caller_is_project_lead=project.lead_id == user.id,
            caller_member_is_lead=bool(caller and caller.is_lead),
            caller_member_role=caller.role if caller else None,
            caller_stations=(caller.stations or []) if caller else [],
            new_role=body.role,
            new_stations=stations,
        )
        if not allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, why)
        if body.is_lead and not (
            project.lead_id == user.id or member.role in idea_flow.MANAGER_ROLES or member.is_owner
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the project lead can invite a station lead.")

    invite = WorkspaceInvite(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        inviter_id=user.id,
        email=email,
        role=body.role,
        token=invite_rules.new_token(),
        status="pending",
        project_id=project.id if project else None,
        stations=stations,
        is_lead=body.is_lead,
        expires_at=_now() + invite_rules.INVITE_TTL,
    )
    session.add(invite)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="invite.created",
        subject_type="workspace",
        subject_id=workspace_id,
        project_id=project.id if project else None,
        payload={"role": body.role, "email": email, "project": project.name if project else None},
    )

    link = _link(_base_url(request), invite.token)
    email_sent = False
    if email:
        inviter = await session.get(User, user.id)
        try:
            result = await asyncio.to_thread(
                send_email,
                to=email,
                subject=f"{inviter.display_name if inviter else 'A teammate'} invited you to {ws.name}",
                html=_email_html(
                    inviter=inviter.display_name if inviter else "A teammate",
                    workspace=ws.name,
                    role=body.role,
                    project=project.name if project else None,
                    link=link,
                ),
            )
            email_sent = result is not None
        except Exception:  # noqa: BLE001 - never lose the invite because mail failed
            logger.exception("Invite email to %s failed", email)

    return {
        "id": str(invite.id),
        "token": invite.token,
        "inviteLink": link,
        "role": invite.role,
        "email": email,
        "projectId": str(project.id) if project else None,
        "expiresAt": invite.expires_at.isoformat(),
        "emailSent": email_sent,
    }


@router.get("/api/workspaces/{workspace_id}/invites")
async def list_invites(workspace_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Pending invites for the workspace (members only)."""
    if await _workspace_member(session, workspace_id, user.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of this workspace.")
    rows = (
        await session.scalars(
            select(WorkspaceInvite)
            .where(WorkspaceInvite.workspace_id == workspace_id, WorkspaceInvite.status == "pending")
            .order_by(WorkspaceInvite.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(i.id),
            "email": i.email,
            "role": i.role,
            "projectId": str(i.project_id) if i.project_id else None,
            "createdAt": i.created_at.isoformat(),
            "expiresAt": i.expires_at.isoformat() if i.expires_at else None,
        }
        for i in rows
    ]


@router.delete("/api/workspaces/{workspace_id}/invites/{invite_id}")
async def revoke_invite(
    workspace_id: uuid.UUID, invite_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, str]:
    """Cancels a pending invite. The inviter, the owner or a manager can do this."""
    member = await _workspace_member(session, workspace_id, user.id)
    invite = await session.get(WorkspaceInvite, invite_id)
    if member is None or invite is None or invite.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found.")
    if not (invite.inviter_id == user.id or member.is_owner or member.role in invite_rules.ADMIN_ROLES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the inviter or a manager can cancel this.")
    invite.status = "revoked"
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="invite.revoked",
        subject_type="workspace",
        subject_id=workspace_id,
        payload={"email": invite.email, "role": invite.role},
    )
    return {"status": "revoked"}


async def _preview(session: AsyncSession, token: str) -> dict[str, Any]:
    invite = await session.scalar(select(WorkspaceInvite).where(WorkspaceInvite.token == token))
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation link is not valid.")
    usable, why = invite_rules.is_usable(status=invite.status, expires_at=invite.expires_at, now=_now())
    if not usable:
        raise HTTPException(status.HTTP_410_GONE, why)
    ws = await session.get(Workspace, invite.workspace_id)
    inviter = await session.get(User, invite.inviter_id)
    project = await session.get(Project, invite.project_id) if invite.project_id else None
    return {
        "token": invite.token,
        "role": invite.role,
        "email": invite.email,
        "workspace": {"id": str(ws.id), "name": ws.name, "slug": ws.slug} if ws else None,
        "project": {"id": str(project.id), "name": project.name} if project else None,
        "inviter": {"name": inviter.display_name if inviter else "A teammate"},
        "expiresAt": invite.expires_at.isoformat() if invite.expires_at else None,
    }


@router.get("/api/invites/{token}")
@router.get("/api/workspaces/invites/{token}", include_in_schema=False)
async def preview_invite(token: str, session: Session) -> dict[str, Any]:
    """Public: what an invite link is for, so the sign-in page can say so."""
    return await _preview(session, token)


@router.post("/api/invites/accept")
@router.post("/api/workspaces/join", include_in_schema=False)
async def accept_invite(body: AcceptIn, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Accepts an invite for the signed-in account: joins the workspace (and project)."""
    invite = await session.scalar(
        select(WorkspaceInvite).where(WorkspaceInvite.token == body.token).with_for_update()
    )
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation link is not valid.")
    usable, why = invite_rules.is_usable(status=invite.status, expires_at=invite.expires_at, now=_now())
    if not usable:
        raise HTTPException(status.HTTP_410_GONE, why)
    account = await session.get(User, user.id)
    if account is None or not invite_rules.email_matches(invite.email, account.email):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"This invitation was sent to {invite.email}. Sign in with that address to accept it.",
        )

    ws = await session.get(Workspace, invite.workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace no longer exists.")

    member = await _workspace_member(session, ws.id, user.id)
    if member is None:
        member = WorkspaceMember(
            id=uuid.uuid4(), workspace_id=ws.id, user_id=user.id, role=invite.role, is_owner=False
        )
        session.add(member)

    project_id: str | None = None
    if invite.project_id:
        project = await session.get(Project, invite.project_id)
        if project is not None:
            pm = await session.scalar(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
                )
            )
            if pm is None:
                session.add(
                    ProjectMember(
                        project_id=project.id,
                        user_id=user.id,
                        role=invite.role,
                        stations=invite.stations or idea_flow.stations_for(invite.role),
                        is_lead=invite.is_lead,
                    )
                )
            project_id = str(project.id)

    if invite_rules.is_single_use(invite.email):
        invite.status = "accepted"
        invite.accepted_by = user.id
        invite.accepted_at = _now()

    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="invite.accepted",
        subject_type="workspace",
        subject_id=ws.id,
        project_id=invite.project_id,
        payload={"role": invite.role, "user_id": str(user.id)},
    )
    return {
        "status": "ok",
        "projectId": project_id,
        "workspace": {
            "id": str(ws.id),
            "name": ws.name,
            "slug": ws.slug,
            "domain": ws.domain,
            "role": member.role,
        },
    }
