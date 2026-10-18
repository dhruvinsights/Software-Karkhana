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

"""Launch Demo and the journey from demo to a real workspace.

``POST /api/demo/sessions`` needs no account: it creates a guest identity and
a sandbox workspace and returns a session token. Everything after that is the
normal API under that guest's token. When the visitor signs up, ``claim``
moves their tour progress and drafts to the new account; the sandbox itself is
never joined to a real account.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.auth import CurrentUser
from app.models import DemoSession, Product, User, Workspace, WorkspaceMember
from app.schemas import UserOut, WorkspaceOut
from app.services import demo_sandbox

router = APIRouter(tags=["demo"])
Session = Annotated[AsyncSession, Depends(db.get_session)]

TOUR_MINUTES = 5


class TourState(BaseModel):
    """Guided-tour progress kept in the browser and sent on claim."""

    completed: list[str] = Field(default_factory=list, max_length=60)
    lastStep: str = Field(default="", max_length=60)
    finished: bool = False
    skipped: bool = False


class ClaimIn(BaseModel):
    """Saves a demo's personal data to the signed-in account."""

    demo_token: str = Field(min_length=20, max_length=4000)
    tour: TourState | None = None
    profile: dict[str, Any] | None = None


class ProfileIn(BaseModel):
    """Workspace-setup answers."""

    profile: dict[str, Any]


class ImportIn(BaseModel):
    """Which demo drafts to bring into a real workspace."""

    workspace_id: uuid.UUID
    product_id: uuid.UUID
    indexes: list[int] = Field(max_length=demo_sandbox.MAX_DRAFTS)


def _client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _view(demo: DemoSession) -> dict[str, Any]:
    return {
        "id": str(demo.id),
        "status": demo.status,
        "scenario": demo.scenario,
        "createdAt": demo.created_at.isoformat(),
        "expiresAt": demo.expires_at.isoformat(),
        "tourMinutes": TOUR_MINUTES,
    }


def _onboarding_view(row: Any) -> dict[str, Any]:
    return {
        "tour": row.tour or {},
        "profile": row.profile or {},
        "drafts": [
            {"index": i, "kind": d.get("kind"), "title": d.get("title")}
            for i, d in enumerate(row.drafts or [])
        ],
        "demoSessionId": str(row.demo_session_id) if row.demo_session_id else None,
    }


@router.post("/api/demo/sessions", status_code=status.HTTP_201_CREATED)
async def start_demo(request: Request, session: Session) -> dict[str, Any]:
    """Opens a fresh demo workspace. Public, and limited per network."""
    made = await demo_sandbox.create(session, client_address=_client_address(request))
    return {
        "token": made.token,
        "user": UserOut.model_validate(made.guest).model_dump(mode="json"),
        "workspace": WorkspaceOut.model_validate(made.workspace).model_dump(
            mode="json"
        ),
        "anchors": demo_sandbox.anchors(made.seeded),
        "session": _view(made.demo),
    }


async def _own_demo(session: AsyncSession, user: User) -> DemoSession:
    if not user.is_guest:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This is not a demo session.")
    demo = await demo_sandbox.for_guest(session, user)
    if demo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demo not found.")
    return demo


@router.get("/api/demo/session")
async def get_demo(session: Session, user: CurrentUser) -> dict[str, Any]:
    """The caller's demo: status and expiry."""
    demo = await _own_demo(session, user)
    if demo.status == "active" and demo.expires_at < dt.datetime.now(dt.UTC):
        raise HTTPException(status.HTTP_410_GONE, "This demo has ended.")
    return _view(demo)


@router.post("/api/demo/session/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_demo(session: Session, user: CurrentUser) -> None:
    """Ends the caller's demo ("Exit demo"). The guest can no longer act."""
    demo = await _own_demo(session, user)
    if demo.status == "active":
        demo.status = "expired"
        user.is_active = False


@router.post("/api/demo/claim")
async def claim_demo(
    body: ClaimIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """After sign-up or sign-in: attach the demo's tour progress and drafts to this account."""
    row, newly = await demo_sandbox.claim(
        session,
        user=user,
        demo_token=body.demo_token,
        tour=body.tour.model_dump() if body.tour else None,
        profile=body.profile,
    )
    return {"claimed": newly, **_onboarding_view(row)}


@router.get("/api/me/onboarding")
async def get_onboarding(session: Session, user: CurrentUser) -> dict[str, Any]:
    """The account's onboarding record."""
    demo_sandbox.refuse_guest(user, "Saving your setup")
    return _onboarding_view(await demo_sandbox.onboarding_for(session, user))


@router.put("/api/me/onboarding")
async def put_onboarding(
    body: ProfileIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Saves workspace-setup answers (use case, team size, ...)."""
    demo_sandbox.refuse_guest(user, "Saving your setup")
    return _onboarding_view(
        await demo_sandbox.save_profile(session, user=user, profile=body.profile)
    )


@router.post("/api/me/onboarding/import-drafts")
async def import_drafts(
    body: ImportIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Brings chosen demo drafts into one of the caller's own workspaces as draft ideas."""
    demo_sandbox.refuse_guest(user, "Importing demo work")
    member = await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == body.workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    workspace = await session.get(Workspace, body.workspace_id)
    if member is None or workspace is None or workspace.is_sandbox:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You are not a member of that workspace."
        )
    product = await session.get(Product, body.product_id)
    if product is None or product.workspace_id != workspace.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Product not found in this workspace."
        )
    row = await demo_sandbox.onboarding_for(session, user)
    count = await demo_sandbox.import_drafts(
        session,
        user=user,
        row=row,
        workspace_id=workspace.id,
        product_id=product.id,
        indexes=body.indexes,
    )
    return {"imported": count, **_onboarding_view(row)}
