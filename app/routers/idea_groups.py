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

"""Product sizing, idea groups, and approved features joining a project.

Endpoints:
  POST   /api/products/analyse                  — size a product before it is created
  POST   /api/products/{id}/profile             — re-size it (uses the latest code snapshot)
  POST   /api/products/{id}/idea-groups/auto    — AI bundles related features into projects
  POST   /api/products/{id}/idea-groups         — group chosen features by hand
  DELETE /api/idea-groups/{group_id}            — split a group back into features
  POST   /api/ideas/{idea_id}/add-to-project    — an approved feature becomes an epic
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, idea_flow, ledger
from app import workspace_access as wa
from app.ai.errors import ModelError
from app.auth import CurrentUser
from app.db import get_session
from app.models import Idea, Product
from app.routers.products import _idea_dict
from app.services import idea_scope
from app.services.realtime import notify_workspace

router = APIRouter(tags=["idea-groups"])
Session = Annotated[AsyncSession, Depends(get_session)]


async def _product(
    session: AsyncSession, user: Any, product_id: uuid.UUID, *, write: bool
) -> Product:
    product = await session.get(Product, product_id)
    if (
        product is None
        or product.archived_at is not None
        or product.workspace_id is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    ws = await wa.workspace_access(session, user, product.workspace_id)
    if write:
        ws.require_write()
    return product


class ProductSpecIn(BaseModel):
    """The product setup, before the product exists."""

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    problem_statement: str = ""
    target_users: str = ""
    tech_stack: list[str] = []
    key_features: list[str] = []
    constraints: list[str] = []


@router.post("/api/products/analyse")
async def analyse_spec(body: ProductSpecIn, _: CurrentUser) -> dict[str, Any]:
    """Sizes a product from its setup, so the setup screen can show it before creating."""
    return await idea_scope.analyse_product(
        name=body.name,
        description=body.description,
        settings={
            "problemStatement": body.problem_statement,
            "targetUsers": body.target_users,
            "techStack": body.tech_stack,
            "keyFeatures": body.key_features,
            "constraints": body.constraints,
        },
    )


@router.post("/api/products/{product_id}/profile")
async def refresh_profile(
    product_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Re-sizes the product, reading its code when a snapshot exists."""
    product = await _product(session, user, product_id, write=True)
    prof = await idea_scope.refresh_profile(session, product)
    await session.commit()
    await notify_workspace(product.workspace_id, "products")
    return prof


@router.post("/api/products/{product_id}/idea-groups/auto")
async def auto_group(
    product_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Bundles the product's related features into project ideas."""
    product = await _product(session, user, product_id, write=True)
    try:
        groups = await idea_scope.group_ideas(session, product, user.id)
    except idea_scope.GroupingError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ModelError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"The AI could not group the ideas: {exc}"
        ) from exc
    await session.commit()
    await notify_workspace(product.workspace_id, "ideas")
    return {"groups": [_idea_dict(g, user) for g in groups]}


class GroupIn(BaseModel):
    """Features a person groups into one project."""

    idea_ids: list[uuid.UUID] = Field(min_length=idea_scope.MIN_GROUP, max_length=30)
    title: str = Field(min_length=2, max_length=120)
    problem_statement: str = Field(min_length=2, max_length=4000)
    expected_value: str = Field(default="", max_length=4000)


@router.post(
    "/api/products/{product_id}/idea-groups", status_code=status.HTTP_201_CREATED
)
async def manual_group(
    product_id: uuid.UUID, body: GroupIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Groups chosen features into one project idea."""
    product = await _product(session, user, product_id, write=True)
    wanted = list(dict.fromkeys(body.idea_ids))
    if len(wanted) < idea_scope.MIN_GROUP:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A project needs at least two features.",
        )
    children = list(
        (await session.scalars(select(Idea).where(Idea.id.in_(wanted)))).all()
    )
    usable = {
        c.id
        for c in children
        if c.product_id == product.id
        and c.scope == idea_scope.FEATURE
        and c.parent_id is None
        and c.project_id is None
        and c.status in idea_scope.GROUPABLE
    }
    missing = [str(i) for i in wanted if i not in usable]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "These ideas cannot be grouped (not an open feature of this product, or already grouped): "
            + ", ".join(missing),
        )
    order = {i: n for n, i in enumerate(wanted)}
    children.sort(key=lambda c: order[c.id])
    group = idea_scope.make_group(
        product,
        children,
        title=body.title,
        problem=body.problem_statement,
        value=body.expected_value,
        rationale="Grouped by hand.",
        author_id=user.id,
        source="manual",
    )
    session.add(group)
    await session.flush()
    idea_scope.attach(group, children)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="idea.grouped",
        subject_type="idea",
        subject_id=group.id,
        payload={"title": group.title, "features": len(children)},
    )
    await session.commit()
    await notify_workspace(product.workspace_id, "ideas")
    return _idea_dict(group, user)


@router.delete("/api/idea-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def ungroup(group_id: uuid.UUID, session: Session, user: CurrentUser) -> None:
    """Splits a project idea back into its features (not once it is a project)."""
    group = await session.get(Idea, group_id)
    if group is None or group.scope != idea_scope.PROJECT:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    if group.workspace_id:
        (await wa.workspace_access(session, user, group.workspace_id)).require_write()
    if group.project_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This group is already a project."
        )
    for child in await idea_scope.children_of(session, group.id):
        child.parent_id = None
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="idea.ungrouped",
        subject_type="idea",
        subject_id=group.id,
        payload={"title": group.title},
    )
    await session.delete(group)
    await session.commit()
    if group.workspace_id:
        await notify_workspace(group.workspace_id, "ideas")


class AddToProjectIn(BaseModel):
    """Which project the approved feature joins."""

    project_id: uuid.UUID


@router.post(
    "/api/ideas/{idea_id}/add-to-project", status_code=status.HTTP_202_ACCEPTED
)
async def add_to_project(
    idea_id: uuid.UUID,
    body: AddToProjectIn,
    background: BackgroundTasks,
    session: Session,
    user: CurrentUser,
) -> dict[str, Any]:
    """Drafts an approved feature into an existing project as an epic with stories."""
    idea = await session.scalar(
        select(Idea).where(Idea.id == idea_id).with_for_update()
    )
    if idea is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found.")
    if idea.scope != idea_scope.FEATURE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A project idea is launched, not added to a project.",
        )
    if idea.parent_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This feature belongs to a project group; launch the group instead.",
        )
    if idea.status != idea_flow.IDEA_APPROVED or idea.project_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only an approved feature that is not yet planned can join a project.",
        )
    if (idea.delivery or {}).get("state") == "running":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This feature is already being added to a project.",
        )
    project = await access.get_visible_project(session, user, body.project_id)
    if project.archived_at is not None or project.product_id != idea.product_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Pick a live project of the same product.",
        )
    role = await access.effective_role(session, user, project.workspace_id)
    mine = await access.my_access(session, user, project)
    if not (idea_flow.can_promote(role) or mine["canManage"] or mine["isLead"]):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only a product manager or the project's lead can add features to it.",
        )
    idea.delivery = {
        "state": "running",
        "projectId": str(project.id),
        "projectName": project.name,
        "startedAt": dt.datetime.now(dt.UTC).isoformat(),
    }
    await session.commit()
    background.add_task(idea_scope.deliver_feature, idea.id, project.id, user.id)
    if idea.workspace_id:
        await notify_workspace(idea.workspace_id, "ideas")
    return {"status": "running", "projectId": str(project.id)}
