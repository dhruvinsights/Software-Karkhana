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

"""Demo sandboxes: an anonymous visitor's private, pre-built workspace.

Lifecycle:

1. ``create`` makes a guest identity and a sandbox workspace seeded with the
   ClearAuth scenario (``app.services.demo_scenario``), and returns a session
   token that expires with the demo (24 hours).
2. The guest uses the real platform. What a guest may *not* do is enforced
   here, server-side: anything that reaches outside the sandbox (email
   invites, GitHub, paired machines, new workspaces) answers 403 with a
   ``X-Karkhana-Signup-Required`` header so the UI can offer sign-up instead.
3. ``claim`` runs after the visitor signs up or signs in. It proves they hold
   the demo token, copies only what *they* wrote in the demo (never seeded
   data) and their tour progress into ``user_onboarding``, then ends the guest
   session. The sandbox itself is never joined to the real account, so demo
   and real data cannot mix.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import ledger
from app.auth import _session_secret, create_token, decode_token
from app.db import bind_rls_user
from app.models import (
    DemoSession,
    Idea,
    Product,
    Project,
    User,
    UserOnboarding,
    Workspace,
)
from app.services import demo_scenario

DEMO_TTL = dt.timedelta(hours=24)
GUEST_DOMAIN = "sandbox.karkhana.invalid"
SIGNUP_HEADER = "X-Karkhana-Signup-Required"
MAX_DRAFTS = 25


def max_per_client_per_hour() -> int:
    """How many demos one client address may start per hour (``DEMO_MAX_PER_HOUR``)."""
    try:
        return max(1, int(os.environ.get("DEMO_MAX_PER_HOUR", "6")))
    except ValueError:
        return 6


def client_hash(address: str) -> str:
    """A keyed hash of the client address: rate-limits without storing the address."""
    return hmac.new(
        _session_secret(), f"demo-client:{address}".encode(), hashlib.sha256
    ).hexdigest()


@dataclass(frozen=True)
class Created:
    """A new demo and what the browser needs to open it."""

    demo: DemoSession
    guest: User
    workspace: Workspace
    seeded: demo_scenario.Seeded
    token: str


def signup_required(action: str) -> HTTPException:
    """The refusal every guest-blocked action returns."""
    return HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"{action} needs a free account. Sign up to create your own workspace; the demo stays as it is.",
        headers={SIGNUP_HEADER: "1"},
    )


def refuse_guest(user: User, action: str) -> None:
    """403 for guest identities: ``action`` needs a real account."""
    if getattr(user, "is_guest", False):
        raise signup_required(action)


async def is_sandbox_workspace(
    session: AsyncSession, workspace_id: uuid.UUID | None
) -> bool:
    """True for demo workspaces."""
    if workspace_id is None:
        return False
    return bool(
        await session.scalar(
            select(Workspace.is_sandbox).where(Workspace.id == workspace_id)
        )
    )


async def is_sandbox_project(session: AsyncSession, project: Project) -> bool:
    """True when the project lives in a demo workspace."""
    return await is_sandbox_workspace(session, project.workspace_id)


async def refuse_in_sandbox(
    session: AsyncSession, workspace_id: uuid.UUID | None, action: str
) -> None:
    """403 when ``action`` would reach outside a demo workspace (email, GitHub, machines)."""
    if await is_sandbox_workspace(session, workspace_id):
        raise signup_required(action)


async def expire_stale(session: AsyncSession) -> int:
    """Ends demos past their expiry: the session is marked and the guest can no longer act."""
    now = dt.datetime.now(dt.UTC)
    stale = list(
        (
            await session.scalars(
                select(DemoSession).where(
                    DemoSession.status == "active", DemoSession.expires_at < now
                )
            )
        ).all()
    )
    for d in stale:
        d.status = "expired"
    if stale:
        await session.execute(
            update(User)
            .where(User.id.in_([d.guest_user_id for d in stale]))
            .values(is_active=False)
        )
    return len(stale)


def session_token(demo: DemoSession, guest: User) -> str:
    """The guest's session JWT. It carries the demo id and dies with the demo."""
    remaining = int((demo.expires_at - dt.datetime.now(dt.UTC)).total_seconds())
    return create_token(
        {
            "sub": str(guest.id),
            "email": guest.email,
            "role": guest.role,
            "name": guest.display_name,
            "demo": str(demo.id),
        },
        expires_in_seconds=max(60, remaining),
    )


async def create(session: AsyncSession, *, client_address: str) -> Created:
    """Starts a demo: guest, sandbox workspace, scenario data. Raises 429 when over the limit."""
    await expire_stale(session)
    who = client_hash(client_address or "unknown")
    hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    recent = await session.scalar(
        select(func.count())
        .select_from(DemoSession)
        .where(DemoSession.client_hash == who, DemoSession.created_at > hour_ago)
    )
    if (recent or 0) >= max_per_client_per_hour():
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many demos started from this network in the last hour. Try again later, or sign up free.",
        )

    tag = uuid.uuid4().hex
    now = dt.datetime.now(dt.UTC)
    guest = User(
        id=uuid.uuid4(),
        email=f"guest-{tag}@{GUEST_DOMAIN}",
        display_name="Demo Guest",
        role="lead",
        hashed_password=None,
        is_active=True,
        is_verified=False,
        is_guest=True,
        onboarded_at=now,
    )
    session.add(guest)
    await session.flush()
    workspace = Workspace(
        id=uuid.uuid4(),
        name=demo_scenario.WORKSPACE_NAME,
        slug=f"demo-{tag[:12]}",
        domain=f"demo-{tag[:12]}.sandbox",
        plan="demo",
        security_posture="HARDENED",
        created_by=guest.id,
        is_sandbox=True,
    )
    session.add(workspace)
    await session.flush()
    seeded = await demo_scenario.seed(session, workspace=workspace, guest=guest)
    demo = DemoSession(
        id=uuid.uuid4(),
        guest_user_id=guest.id,
        workspace_id=workspace.id,
        scenario=demo_scenario.SCENARIO,
        status="active",
        client_hash=who,
        created_at=now,
        expires_at=now + DEMO_TTL,
    )
    session.add(demo)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.SYSTEM,
        action="demo.started",
        subject_type="workspace",
        subject_id=workspace.id,
        payload={"scenario": demo.scenario, "expires_at": demo.expires_at.isoformat()},
        workspace_id=workspace.id,
    )
    return Created(
        demo=demo,
        guest=guest,
        workspace=workspace,
        seeded=seeded,
        token=session_token(demo, guest),
    )


async def for_guest(session: AsyncSession, guest: User) -> DemoSession | None:
    """The demo a guest identity belongs to."""
    return await session.scalar(
        select(DemoSession).where(DemoSession.guest_user_id == guest.id)
    )


def anchors(seeded: demo_scenario.Seeded) -> dict[str, str]:
    """Records the guided tour opens."""
    return {
        "productId": str(seeded.product_id),
        "projectId": str(seeded.project_id),
        "openPrId": str(seeded.open_pr_id),
        "readyTaskId": str(seeded.ready_task_id),
        "pendingIdeaId": str(seeded.pending_idea_id),
    }


async def guest_drafts(
    session: AsyncSession, demo: DemoSession
) -> list[dict[str, Any]]:
    """What the guest wrote in the sandbox: ideas, projects and products they created.

    Seeded rows are authored by personas, so they never appear here.
    """
    guest_id, ws = demo.guest_user_id, demo.workspace_id
    drafts: list[dict[str, Any]] = []
    for i in (
        await session.scalars(
            select(Idea)
            .where(Idea.workspace_id == ws, Idea.author_id == guest_id)
            .order_by(Idea.created_at)
        )
    ).all():
        drafts.append(
            {
                "kind": "idea",
                "title": i.title,
                "problemStatement": i.problem_statement,
                "targetUser": i.target_user,
                "expectedValue": i.expected_value,
                "tags": list(i.tags or []),
            }
        )
    for p in (
        await session.scalars(
            select(Project).where(
                Project.workspace_id == ws,
                Project.created_by == guest_id,
                Project.archived_at.is_(None),
            )
        )
    ).all():
        drafts.append(
            {
                "kind": "project",
                "title": p.name,
                "problemStatement": (p.settings or {}).get("description")
                or p.idea_text,
                "targetUser": "",
                "expectedValue": "",
                "tags": ["from-demo"],
            }
        )
    for p in (
        await session.scalars(
            select(Product).where(
                Product.workspace_id == ws,
                Product.created_by == guest_id,
                Product.archived_at.is_(None),
            )
        )
    ).all():
        drafts.append(
            {
                "kind": "product",
                "title": p.name,
                "problemStatement": p.description,
                "targetUser": (p.settings or {}).get("targetUsers", ""),
                "expectedValue": "",
                "tags": ["from-demo"],
            }
        )
    return drafts[:MAX_DRAFTS]


def _clean_tour(tour: dict[str, Any] | None) -> dict[str, Any]:
    tour = tour or {}
    completed = [
        str(s)[:60] for s in (tour.get("completed") or []) if isinstance(s, str | int)
    ][:60]
    return {
        "completed": completed,
        "lastStep": str(tour.get("lastStep") or "")[:60],
        "finished": bool(tour.get("finished")),
        "skipped": bool(tour.get("skipped")),
    }


def _clean_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    allowed = ("useCase", "industry", "teamSize", "role", "intent")
    return {
        k: str((profile or {}).get(k))[:120] for k in allowed if (profile or {}).get(k)
    }


async def onboarding_for(session: AsyncSession, user: User) -> UserOnboarding:
    """The user's onboarding row, created on first use."""
    row = await session.get(UserOnboarding, user.id)
    if row is None:
        row = UserOnboarding(user_id=user.id, tour={}, profile={}, drafts=[])
        session.add(row)
        await session.flush()
    return row


async def claim(
    session: AsyncSession,
    *,
    user: User,
    demo_token: str,
    tour: dict[str, Any] | None,
    profile: dict[str, Any] | None,
) -> tuple[UserOnboarding, bool]:
    """Moves the demo's personal session data to ``user``. Returns (row, newly_claimed).

    The caller must hold the demo's own token: that is the proof the demo was
    theirs. Claiming twice by the same account is a no-op; a demo claimed by
    someone else is refused.
    """
    refuse_guest(user, "Claiming a demo")
    payload = decode_token(demo_token)
    demo_id = (payload or {}).get("demo")
    if not demo_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a demo session.")
    demo = await session.get(DemoSession, uuid.UUID(str(demo_id)), with_for_update=True)
    if demo is None or str(demo.guest_user_id) != str(payload.get("sub")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a demo session.")
    row = await onboarding_for(session, user)
    if demo.status == "claimed":
        if demo.claimed_by == user.id:
            return row, False
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This demo was already saved to another account."
        )
    if demo.status != "active":
        raise HTTPException(status.HTTP_410_GONE, "This demo has ended.")

    row.demo_session_id = demo.id
    row.tour = _clean_tour(tour)
    row.profile = {**(row.profile or {}), **_clean_profile(profile)}
    # Row-level security hides the sandbox from the real account, so its drafts
    # and ledger entry are read and written as the demo's own guest, then the
    # request goes back to the real user.
    await bind_rls_user(session, demo.guest_user_id)
    row.drafts = await guest_drafts(session, demo)
    demo.status, demo.claimed_by, demo.claimed_at = (
        "claimed",
        user.id,
        dt.datetime.now(dt.UTC),
    )
    await session.execute(
        update(User).where(User.id == demo.guest_user_id).values(is_active=False)
    )
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="demo.claimed",
        subject_type="workspace",
        subject_id=demo.workspace_id,
        payload={"demo": str(demo.id), "drafts": len(row.drafts)},
        workspace_id=demo.workspace_id,
    )
    await bind_rls_user(session, user.id)
    return row, True


async def import_drafts(
    session: AsyncSession,
    *,
    user: User,
    row: UserOnboarding,
    workspace_id: uuid.UUID,
    product_id: uuid.UUID,
    indexes: list[int],
) -> int:
    """Copies the chosen demo drafts into ``workspace_id`` as new draft ideas. Returns how many."""
    drafts = list(row.drafts or [])
    picked = sorted({i for i in indexes if 0 <= i < len(drafts)})
    for i in picked:
        d = drafts[i]
        session.add(
            Idea(
                id=uuid.uuid4(),
                product_id=product_id,
                workspace_id=workspace_id,
                title=str(d.get("title") or "Idea from the demo")[:200],
                problem_statement=str(d.get("problemStatement") or "")[:4000],
                target_user=str(d.get("targetUser") or "Enterprise Users")[:200]
                or "Enterprise Users",
                expected_value=str(d.get("expectedValue") or "")[:2000],
                author_id=user.id,
                status="draft",
                tags=[*(str(t)[:40] for t in (d.get("tags") or [])[:8]), "from-demo"],
                source="manual",
                scope="feature",
            )
        )
    if picked:
        row.drafts = [d for i, d in enumerate(drafts) if i not in picked]
    await session.flush()
    return len(picked)


async def save_profile(
    session: AsyncSession, *, user: User, profile: dict[str, Any] | None
) -> UserOnboarding:
    """Adds workspace-setup answers (use case, team size, ...) to the user's onboarding row."""
    row = await onboarding_for(session, user)
    row.profile = {**(row.profile or {}), **_clean_profile(profile)}
    await session.flush()
    return row


# Calls that would leave the sandbox (email, GitHub, a person's machine) or spend
# model budget. Guests get a "sign up" refusal instead; the rest of the API is open.
_BLOCKED: tuple[tuple[str, str], ...] = (
    ("POST", r"/api/workspaces/[^/]+/invites"),
    ("ANY", r"/api/github/.*"),
    ("ANY", r"/api/devices.*"),
    ("POST", r"/api/agent/pair"),
    ("POST", r"/api/projects/[^/]+/pipeline(/merge)?"),
    ("POST", r"/api/projects/[^/]+/releases"),
    ("POST", r"/api/releases/[^/]+/(refresh|approve)"),
    ("POST", r"/api/prs/[^/]+/(reviewers|review)"),
    ("ANY", r"/api/gemini/.*"),
    ("POST", r"/api/rag/(chat|ingest)"),
    ("POST", r"/api/products/[^/]+/(idea-scans|idea-chats|profile|idea-groups/auto)"),
    ("POST", r"/api/products/(extract-from-doc|analyse)"),
    ("POST", r"/api/idea-chats/[^/]+/messages"),
    ("POST", r"/api/ideas/[^/]+/(evaluate|team-plan)"),
    ("POST", r"/api/issues/[^/]+/test-scenarios"),
    ("POST", r"/api/projects/[^/]+/stitch/(generate|edit|variants|sync)"),
    ("POST", r"/api/projects/[^/]+/(documents/redraft|design)"),
)
_BLOCKED_RE = tuple((m, re.compile(p + "$")) for m, p in _BLOCKED)


async def guest_gate(request: Request) -> None:
    """App-wide dependency: demo-session tokens may not call the blocked routes above."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return
    payload = decode_token(auth.removeprefix("Bearer ").strip())
    if not payload or not payload.get("demo"):
        return
    path = request.url.path.rstrip("/")
    for method, pattern in _BLOCKED_RE:
        if method in ("ANY", request.method) and pattern.match(path):
            raise signup_required("That action")
