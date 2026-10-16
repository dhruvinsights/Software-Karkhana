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

"""GitHub OAuth Device Flow + PR operations requiring live GitHub access.

Endpoints:
  POST   /api/github/auth/start    — kick off device flow, return user_code + uri
  POST   /api/github/auth/poll     — poll until granted; the token is stored
                                     encrypted server-side and never returned
  GET    /api/github/auth/status   — whether the caller has a stored token
  DELETE /api/github/auth          — disconnect (delete the stored token)
  GET  /api/github/prs/{id}/status — live check-run status from GitHub
  POST /api/github/prs/{id}/ci     — trigger CI check run on GitHub
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, require_role
from app.config import get_settings
from app.db import get_session
from app.integrations import github as gh_module
from app.integrations import github_tokens
from app.models import PullRequest, Run, Task, User
from app.process import Role
from app.routers.common import get_or_404

router = APIRouter(prefix="/api/github", tags=["github"])
Session = Annotated[AsyncSession, Depends(get_session)]
AnyRole = Annotated[User, Depends(require_role(*Role))]
Dev = Annotated[User, Depends(require_role(Role.DEVELOPER, Role.LEAD))]


# ── Schema ────────────────────────────────────────────────────────────────────

class DeviceFlowOut(BaseModel):
    user_code: str
    verification_uri: str
    device_code: str
    expires_in: int
    interval: int


class TokenPollOut(BaseModel):
    # The token itself is never returned: it is stored encrypted server-side.
    status: str          # "pending" | "granted" | "expired" | "error"
    error: str | None = None


class AuthStatusOut(BaseModel):
    """Whether the caller has a stored GitHub token. Never the token itself."""

    connected: bool
    scopes: str | None = None
    connected_at: dt.datetime | None = None
    server_token: bool = False  # A server-wide GITHUB_TOKEN is configured.


class CITriggerOut(BaseModel):
    check_run_id: int
    check_run_url: str
    status: str


class PRStatusOut(BaseModel):
    pr_number: int
    pr_url: str
    head_sha: str
    ci_status: str           # combined commit state: "pending" | "success" | "failure" | "error"
    ci_description: str
    check_runs: list[dict]
    tests_passed: bool
    reviewed: bool
    review_engine: str | None
    open_comments: int
    can_merge: bool


# ── Device flow ───────────────────────────────────────────────────────────────

@router.post("/auth/start", response_model=DeviceFlowOut)
async def github_auth_start(_: AnyRole) -> DeviceFlowOut:
    """Starts a GitHub OAuth Device Flow. Returns the user_code to display."""
    oauth = gh_module.oauth_client()
    if oauth is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GITHUB_CLIENT_ID is not configured on this server.",
        )
    try:
        flow = await oauth.start()
    finally:
        await oauth.aclose()
    return DeviceFlowOut(
        user_code=flow.user_code,
        verification_uri=flow.verification_uri,
        device_code=flow.device_code,
        expires_in=flow.expires_in,
        interval=flow.interval,
    )


@router.post("/auth/poll", response_model=TokenPollOut)
async def github_auth_poll(
    device_code: str, session: Session, user: AnyRole
) -> TokenPollOut:
    """Polls the device flow. Call every ``interval`` seconds until status != pending."""
    oauth = gh_module.oauth_client()
    if oauth is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GITHUB_CLIENT_ID is not configured on this server.",
        )
    try:
        token = await oauth.poll(device_code)
    except ValueError as exc:
        await oauth.aclose()
        return TokenPollOut(status="error", error=str(exc))
    finally:
        await oauth.aclose()

    if token is None:
        return TokenPollOut(status="pending")
    await github_tokens.save_token(session, user.id, token, gh_module.GitHubOAuth.SCOPES)
    return TokenPollOut(status="granted")


@router.get("/auth/status", response_model=AuthStatusOut)
async def github_auth_status(session: Session, user: AnyRole) -> AuthStatusOut:
    """Whether the caller has connected GitHub. Never includes the token."""
    row = await github_tokens.token_info(session, user.id)
    return AuthStatusOut(
        connected=row is not None,
        scopes=row.scopes if row else None,
        connected_at=row.updated_at if row else None,
        server_token=bool(get_settings().github_token),
    )


@router.delete("/auth", status_code=status.HTTP_204_NO_CONTENT)
async def github_auth_disconnect(session: Session, user: AnyRole) -> None:
    """Deletes the caller's stored GitHub token."""
    await github_tokens.delete_token(session, user.id)


async def _client_for(session: AsyncSession, user: User) -> gh_module.GitHub | None:
    """The caller's own GitHub token if connected, else the server token."""
    return gh_module.client(await github_tokens.load_token(session, user.id))


# ── PR status (live from GitHub) ──────────────────────────────────────────────

@router.get("/prs/{pr_id}/status", response_model=PRStatusOut)
async def pr_github_status(
    pr_id: uuid.UUID,
    session: Session,
    user: AnyRole,
) -> PRStatusOut:
    """Returns live CI / check-run status from GitHub for a stored PR."""
    from sqlalchemy import func, select
    from app.models import ReviewComment

    pr = await get_or_404(session, PullRequest, pr_id)

    open_c = await session.scalar(
        select(func.count())
        .select_from(ReviewComment)
        .where(ReviewComment.pr_id == pr.id, ReviewComment.triage == "open")
    ) or 0

    # Local-only PR — return what we have
    if pr.url.startswith("local://"):
        return PRStatusOut(
            pr_number=pr.number,
            pr_url=pr.url,
            head_sha=pr.head_sha,
            ci_status="success" if pr.tests_passed else "failure",
            ci_description="Local run (no GitHub)",
            check_runs=[],
            tests_passed=pr.tests_passed,
            reviewed=pr.reviewed_at is not None,
            review_engine=pr.review_engine,
            open_comments=open_c,
            can_merge=(pr.status == "open" and pr.tests_passed and pr.reviewed_at is not None and open_c == 0),
        )

    gh = await _client_for(session, user)
    if gh is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GitHub is not configured (GITHUB_TOKEN + GITHUB_REPO required).",
        )
    try:
        combined = await gh.get_combined_status(sha=pr.head_sha)
        check_runs = await gh.list_check_runs(sha=pr.head_sha)
    finally:
        await gh.aclose()

    return PRStatusOut(
        pr_number=pr.number,
        pr_url=pr.url,
        head_sha=pr.head_sha,
        ci_status=combined.get("state", "pending"),
        ci_description=combined.get("statuses", [{}])[0].get("description", "") if combined.get("statuses") else "",
        check_runs=[
            {
                "id": r.get("id"),
                "name": r.get("name"),
                "status": r.get("status"),
                "conclusion": r.get("conclusion"),
                "html_url": r.get("html_url"),
                "started_at": r.get("started_at"),
                "completed_at": r.get("completed_at"),
            }
            for r in check_runs
        ],
        tests_passed=pr.tests_passed,
        reviewed=pr.reviewed_at is not None,
        review_engine=pr.review_engine,
        open_comments=open_c,
        can_merge=(
            pr.status == "open"
            and pr.tests_passed
            and pr.reviewed_at is not None
            and open_c == 0
            and combined.get("state") in ("success", "pending")
        ),
    )


# ── CI trigger ────────────────────────────────────────────────────────────────

@router.post("/prs/{pr_id}/ci", response_model=CITriggerOut)
async def trigger_ci_check(
    pr_id: uuid.UUID,
    session: Session,
    user: Dev,
) -> CITriggerOut:
    """Creates a Karkhana check-run on GitHub for the PR's head commit.

    This registers the check as "in_progress"; the actual test outcome is
    reported by ``run_complete`` via ``set_status``. Use this to create a
    blocking check-run entry in the GitHub PR checks UI.
    """
    pr = await get_or_404(session, PullRequest, pr_id)
    if pr.url.startswith("local://"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Cannot create GitHub check-run for a local-only PR.",
        )
    gh = await _client_for(session, user)
    if gh is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GitHub is not configured (GITHUB_TOKEN + GITHUB_REPO required).",
        )
    task = await get_or_404(session, Task, pr.task_id)
    try:
        result = await gh.create_check_run(
            name="karkhana/ai-review",
            head_sha=pr.head_sha,
            status="in_progress",
            output_title=f"Karkhana AI Review — {task.key}",
            output_summary="Review in progress…",
        )
    finally:
        await gh.aclose()

    return CITriggerOut(
        check_run_id=result.run_id,
        check_run_url=result.html_url,
        status=result.status,
    )
