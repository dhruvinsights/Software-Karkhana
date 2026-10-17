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

"""What the project launch screen needs before it promotes an approved idea.

Endpoints:
  POST /api/github/repo-check          — does the caller's GitHub token reach the
                                         repository, and may it push?
  POST /api/github/repos               — create a repository with the caller's token
  POST /api/ideas/{idea_id}/team-plan  — which team spaces this idea really needs
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import idea_flow
from app import workspace_access as wa
from app.ai import llm
from app.ai.errors import ModelError
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.integrations import github_tokens
from app.models import Idea, Product, User
from app.services import idea_scope, repos

logger = logging.getLogger(__name__)
router = APIRouter(tags=["project-launch"])
Session = Annotated[AsyncSession, Depends(get_session)]

# Team spaces a project can have; the PM side ("product") is always on.
TEAMS: tuple[str, ...] = tuple(s for s in idea_flow.ALL_STATIONS if s != "product")


async def _token(session: AsyncSession, user: User) -> str:
    token = await github_tokens.load_token(session, user.id)
    if not token:
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            "Connect your GitHub account first, so the factory can reach the repository.",
        )
    return token


def _gh(token: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=get_settings().github_api_url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "software-karkhana",
        },
        timeout=15,
    )


def _repo_out(slug: str, repo: dict[str, Any], login: str | None) -> dict[str, Any]:
    perms = repo.get("permissions") or {}
    can_push = bool(perms.get("push") or perms.get("admin") or perms.get("maintain"))
    return {
        "ok": can_push,
        "slug": slug,
        "url": repo.get("html_url") or f"https://github.com/{slug}",
        "private": bool(repo.get("private")),
        "defaultBranch": repo.get("default_branch") or "main",
        "empty": (repo.get("size") or 0) == 0,
        "permissions": {
            k: bool(perms.get(k)) for k in ("admin", "maintain", "push", "pull")
        },
        "login": login,
        "error": None
        if can_push
        else "Your GitHub account can read this repository but cannot push to it. Ask an owner for write access.",
    }


class RepoCheckIn(BaseModel):
    """A repository URL to check."""

    url: str = Field(min_length=10, max_length=500)


@router.post("/api/github/repo-check")
async def repo_check(
    body: RepoCheckIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Whether the caller's GitHub token can see and push to ``url``."""
    slug = repos.parse_slug(body.url)
    if slug is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That is not a GitHub repository URL (https://github.com/owner/name).",
        )
    token = await _token(session, user)
    async with _gh(token) as http:
        try:
            me = await http.get("/user")
            r = await http.get(f"/repos/{slug}")
        except httpx.HTTPError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "Could not reach GitHub."
            ) from exc
    login = me.json().get("login") if me.status_code == 200 else None
    if r.status_code == 404:
        return {
            "ok": False,
            "slug": slug,
            "login": login,
            "error": "Repository not found, or your GitHub account has no access to it.",
        }
    if r.status_code != 200:
        return {
            "ok": False,
            "slug": slug,
            "login": login,
            "error": f"GitHub answered HTTP {r.status_code}.",
        }
    return _repo_out(slug, r.json(), login)


class RepoCreateIn(BaseModel):
    """A new repository."""

    name: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")
    owner: str | None = Field(
        default=None,
        max_length=100,
        description="An organisation; empty for your account.",
    )
    private: bool = True
    description: str = Field(default="", max_length=350)


@router.post("/api/github/repos", status_code=status.HTTP_201_CREATED)
async def repo_create(
    body: RepoCreateIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Creates a repository (with a README so it can be cloned) using the caller's token."""
    token = await _token(session, user)
    payload = {
        "name": body.name,
        "private": body.private,
        "description": body.description,
        "auto_init": True,
    }
    async with _gh(token) as http:
        try:
            me = (await http.get("/user")).json()
            login = me.get("login")
            owner = (body.owner or "").strip()
            path = (
                "/user/repos" if not owner or owner == login else f"/orgs/{owner}/repos"
            )
            r = await http.post(path, json=payload)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "Could not reach GitHub."
            ) from exc
    if r.status_code not in (200, 201):
        try:
            err = r.json()
        except ValueError:
            err = {}
        detail = err.get("message", "")
        if err.get("errors"):
            detail += ": " + "; ".join(str(e.get("message", e)) for e in err["errors"])
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"GitHub refused to create the repository. {detail}".strip(),
        )
    repo = r.json()
    return _repo_out(repo["full_name"], repo, login)


# ── Team plan ─────────────────────────────────────────────────────────────────


class TeamNeed(BaseModel):
    """One team space and whether this idea needs it."""

    team: Literal[
        "design", "architecture", "developer", "qa", "devops", "security", "release"
    ]
    needed: bool
    reason: str = Field(description="One sentence, grounded in the idea.")


class TeamPlan(BaseModel):
    """The AI's view of the idea and the teams it needs."""

    summary: str = Field(
        description="Two or three sentences: what will be built and its shape."
    )
    kind: Literal[
        "backend", "frontend", "full_stack", "data", "infrastructure", "mobile", "other"
    ]
    teams: list[TeamNeed] = Field(min_length=len(TEAMS), max_length=len(TEAMS))
    risks: list[str] = Field(max_length=5)


TEAM_SYSTEM = """\
You staff a software project. Decide which team spaces this approved idea needs.
Teams: design (UI/UX screens and prototypes), architecture (system and data design),
developer (writing the code), qa (testing), devops (CI/CD and infrastructure),
security (threat review, pentest), release (release management).
Be honest: a backend-only API or a data pipeline usually needs no design team;
a small internal tool may not need a separate release team. Developer is
almost always needed. Return every team exactly once with needed true or false.
Ground every reason in the inputs. Plain sentences, no Markdown.
"""


def _fallback_plan(idea: Idea) -> TeamPlan:
    """A keyword guess when no model is reachable, so the screen still works."""
    text = f"{idea.title} {idea.problem_statement} {idea.expected_value} {' '.join(idea.tags or [])}".lower()
    ui = any(
        w in text
        for w in (
            "ui",
            "screen",
            "dashboard",
            "page",
            "frontend",
            "mobile",
            "design",
            "user interface",
            "ux",
        )
    )
    infra = any(
        w in text
        for w in ("deploy", "pipeline", "infra", "kubernetes", "docker", "ci", "cloud")
    )
    sec = any(
        w in text
        for w in (
            "auth",
            "security",
            "payment",
            "pii",
            "token",
            "permission",
            "compliance",
        )
    )
    needs = {
        "design": (
            ui,
            "The idea has user-facing screens."
            if ui
            else "No user-facing screens are described.",
        ),
        "architecture": (
            True,
            "Every change needs its system and data design reviewed.",
        ),
        "developer": (True, "Someone has to write the code."),
        "qa": (True, "Every story ships with tests and a QA gate."),
        "devops": (
            infra,
            "The idea touches deployment or infrastructure."
            if infra
            else "Existing pipelines should be enough.",
        ),
        "security": (
            sec,
            "The idea touches authentication or sensitive data."
            if sec
            else "No sensitive surface is described.",
        ),
        "release": (True, "The change goes out through a release record."),
    }
    return TeamPlan(
        summary=idea.problem_statement[:400],
        kind="full_stack" if ui else "backend",
        teams=[TeamNeed(team=t, needed=n, reason=r) for t, (n, r) in needs.items()],  # type: ignore[arg-type]
        risks=[],
    )


@router.post("/api/ideas/{idea_id}/team-plan")
async def team_plan(
    idea_id: uuid.UUID, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Analyses the approved idea and suggests the team spaces the project needs."""
    idea = await session.get(Idea, idea_id)
    if idea is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found.")
    if idea.workspace_id:
        await wa.workspace_access(session, user, idea.workspace_id)
    product = await session.get(Product, idea.product_id) if idea.product_id else None
    st = (product.settings or {}) if product else {}
    report = (idea.review_report or {}).get("report")
    children = await idea_scope.children_of(session, idea.id)
    features = (
        "FEATURES THIS PROJECT GROUPS:\n"
        + "\n".join(f"- {c.title}: {c.problem_statement[:300]}" for c in children)
        if children
        else ""
    )
    prompt = (
        f"PRODUCT: {product.name if product else '(none)'}\n{product.description if product else ''}\n"
        f"Tech stack: {', '.join(st.get('techStack') or []) or 'unknown'}\n"
        f"Target users: {st.get('targetUsers') or 'unknown'}\n"
        f"Product team spaces: {', '.join(st.get('teamSpaces') or TEAMS)}\n\n"
        f"IDEA: {idea.title}\nProblem: {idea.problem_statement}\nExpected value: {idea.expected_value}\n"
        f"Target user: {idea.target_user}\nComplexity: {idea.complexity}\nTags: {', '.join(idea.tags or [])}\n"
        f"Assessment: {json.dumps(idea.assessment) if idea.assessment else '(none)'}\n"
        f"{features}\n"
        f"EVALUATION REPORT:\n{json.dumps(report)[:12000] if report else '(none)'}\n"
    )
    source = "ai"
    try:
        out = await llm.generate_structured(
            prompt=prompt, schema=TeamPlan, system=TEAM_SYSTEM, timeout_s=120
        )
        seen = {t.team for t in out.teams}
        if seen != set(TEAMS):
            raise ModelError(f"team plan named {sorted(seen)}")
    except Exception as exc:  # any model or provider failure falls back
        logger.info("Team plan fell back to keywords for %s: %s", idea_id, exc)
        out, source = _fallback_plan(idea), "heuristic"
    order = {t: i for i, t in enumerate(TEAMS)}
    return {
        "summary": out.summary,
        "kind": out.kind,
        "teams": sorted(
            (t.model_dump() for t in out.teams), key=lambda t: order[t["team"]]
        ),
        "risks": out.risks,
        "source": source,
    }
