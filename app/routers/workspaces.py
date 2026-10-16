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

"""Workspaces: onboarding, listing, invites, joining and members."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger
from app.auth import CurrentUser
from app.models import ActivityEvent, Product, User, Workspace, WorkspaceMember
from app.schemas import (
    WorkspaceOnboard,
    WorkspaceOut,
)
from app.services.realtime import notify_activity, notify_workspace
from app.workspace_access import workspace_access

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

router = APIRouter(tags=["auth"])

router = APIRouter(tags=["workspaces"])


def _slugify(text: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[-\s]+", "-", slug) or "workspace"


@router.post("/api/workspaces/onboard", response_model=WorkspaceOut)
async def onboard_workspace(
    payload: WorkspaceOnboard,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> WorkspaceOut:
    """Completes progressive onboarding by creating organization workspace and initial product."""
    ws_name = payload.workspace_name.strip()
    base_slug = payload.workspace_slug or _slugify(ws_name)
    slug = base_slug

    # Ensure slug uniqueness
    counter = 1
    while await session.scalar(select(Workspace).where(Workspace.slug == slug)):
        slug = f"{base_slug}-{counter}"
        counter += 1

    workspace = Workspace(
        id=uuid.uuid4(),
        name=ws_name,
        slug=slug,
        domain=payload.domain,
        plan="enterprise",
        security_posture=payload.security_posture,
        created_by=user.id,
    )
    session.add(workspace)
    await session.flush()

    # Add user as owner
    member = WorkspaceMember(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        user_id=user.id,
        role="pm",
        is_owner=True,
    )
    session.add(member)

    # Optional initial product
    if payload.product_name and payload.product_name.strip():
        prod_name = payload.product_name.strip()
        prod_code = re.sub(r"[^A-Za-z0-9]", "", prod_name).upper()[:6] or "PROD"
        product = Product(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            name=prod_name,
            code=prod_code,
            domain=payload.product_domain or "Cloud Services",
            description=payload.product_description or f"Core deliverable for {ws_name}.",
            status="active",
            created_by=user.id,
        )
        session.add(product)

    # The requested role lives on the membership only. ``User.role`` is never
    # written from a request: it is an account label that grants nothing.
    user.onboarded_at = dt.datetime.now(dt.UTC)
    session.add(user)
    await session.flush()

    # Record genesis event in tamper-evident ledger
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="workspace.genesis",
        subject_type="workspace",
        subject_id=workspace.id,
        payload={
            "workspace_name": workspace.name,
            "slug": workspace.slug,
            "security_posture": workspace.security_posture,
            "role": "pm",
        },
    )

    return WorkspaceOut.model_validate(workspace)


@router.get("/api/workspaces/me", response_model=WorkspaceOut | None)
async def get_my_workspace(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> WorkspaceOut | None:
    """Returns the primary active workspace for the current user."""
    member = await session.scalar(
        select(WorkspaceMember)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.is_owner.desc(), WorkspaceMember.joined_at.asc())
    )
    if not member:
        return None
    ws = await session.scalar(select(Workspace).where(Workspace.id == member.workspace_id))
    return WorkspaceOut.model_validate(ws) if ws else None


@router.get("/api/workspaces/list", response_model=list)
async def list_user_workspaces(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> list[dict]:
    """Lists all enrolled workspaces for the authenticated user."""
    memberships = (
        await session.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(WorkspaceMember.joined_at.desc())
        )
    ).all()

    results = []
    for m in memberships:
        ws = await session.scalar(select(Workspace).where(Workspace.id == m.workspace_id))
        if not ws:
            continue
        # Count members
        member_count = len((
            await session.scalars(
                select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id)
            )
        ).all())

        results.append({
            "id": str(ws.id),
            "name": ws.name,
            "slug": ws.slug,
            "domain": ws.domain or f"{ws.slug}.internal",
            "role": m.role,
            "member_count": max(member_count, 1),
            "last_active": "Just now",
            "is_owner": m.is_owner,
        })

    return results


@router.post("/api/workspaces/create", response_model=WorkspaceOut)
async def create_workspace(
    payload: dict,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> WorkspaceOut:
    """Creates a new workspace from the 3-step workspace modal."""
    ws_name = (payload.get("name") or "New Workspace").strip()
    base_slug = payload.get("slug") or _slugify(ws_name)
    slug = base_slug

    counter = 1
    while await session.scalar(select(Workspace).where(Workspace.slug == slug)):
        slug = f"{base_slug}-{counter}"
        counter += 1

    workspace = Workspace(
        id=uuid.uuid4(),
        name=ws_name,
        slug=slug,
        domain=f"{slug}.internal",
        plan="enterprise",
        security_posture="STANDARD",
        created_by=user.id,
    )
    session.add(workspace)
    await session.flush()

    if payload.get("user_name"):
        user.display_name = payload["user_name"].strip()
    user.onboarded_at = dt.datetime.now(dt.UTC)
    session.add(user)

    # The creator owns the new workspace with the role they asked for, in this
    # workspace only. Their account label (User.role) is left untouched.
    member = WorkspaceMember(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        user_id=user.id,
        role="pm",
        is_owner=True,
    )
    session.add(member)

    # Automatically create the first product anchor
    product = Product(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        name=f"{ws_name} Core",
        code=re.sub(r"[^A-Za-z0-9]", "", ws_name).upper()[:6] or "CORE",
        domain="Cloud Services",
        description=f"Primary product engineering anchor for {ws_name}.",
        status="active",
        created_by=user.id,
    )
    session.add(product)
    await session.flush()

    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="workspace.created",
        subject_type="workspace",
        subject_id=workspace.id,
        payload={"workspace_name": workspace.name, "slug": workspace.slug},
    )

    return WorkspaceOut.model_validate(workspace)


@router.get("/api/workspaces/{workspace_id}/members")
async def list_workspace_members(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> list[dict]:
    """Lists all team members enrolled in the workspace (members only)."""
    if await access.workspace_member(session, user, workspace_id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of this workspace.")
    stmt = (
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.joined_at.asc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(u.id),
            "name": u.display_name,
            "email": u.email,
            "role": wm.role,
            "isOwner": wm.is_owner,
            "access": "owner" if wm.is_owner else wm.access,
            "avatar": u.avatar_url or "",
            "joinedAt": wm.joined_at.isoformat(),
        }
        for wm, u in rows
    ]


class MemberAccessUpdate(BaseModel):
    """New access level for a workspace member."""

    access: Literal["admin", "reviewer", "guide", "member"]


@router.put("/api/workspaces/{workspace_id}/members/{member_user_id}/access")
async def set_member_access(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: MemberAccessUpdate,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> dict:
    """Makes a member an admin, reviewer, guide (read-only advisor) or regular member.

    Owners and admins may change access. Only the owner grants or removes
    admin, and nobody can change the owner's access.
    """
    caller = await workspace_access(session, user, workspace_id)
    caller.require_admin()
    target = await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == member_user_id
        )
    )
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this workspace")
    if target.is_owner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The workspace owner's access cannot be changed")
    if (body.access == "admin" or target.access == "admin") and not caller.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the workspace owner can add or remove admins")

    previous = target.access
    target.access = body.access
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="workspace.member_access_changed",
        subject_type="workspace",
        subject_id=workspace_id,
        payload={"user_id": str(member_user_id), "from": previous, "to": body.access},
    )
    member_user = await session.get(User, member_user_id)
    label = {
        "admin": "a workspace admin",
        "reviewer": "a reviewer (decides ideas, read-only project overview)",
        "guide": "a guide (read-only advisor)",
        "member": "a member",
    }[body.access]
    session.add(
        ActivityEvent(
            workspace_id=workspace_id,
            actor_id=user.id,
            recipient_id=member_user_id,
            type="access_changed",
            summary=f"{user.display_name} made you {label}",
        )
    )
    await session.commit()
    await notify_workspace(workspace_id, "members")
    await notify_activity(workspace_id, [member_user_id])
    return {"userId": str(member_user_id), "name": member_user.display_name if member_user else "", "access": body.access}
