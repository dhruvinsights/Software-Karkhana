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

"""Delivery: the DevOps station (CI/CD pipeline) and the Release station.

The pipeline runs on GitHub Actions; Karkhana proposes it as a pull request,
merges it once its own checks are green, and shows the runs. A release is a
record with evidence that a release manager approves; approval tags the
commit and publishes the GitHub Release.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger
from app.auth import CurrentUser
from app.integrations import github
from app.models import Project, ProjectMember, PullRequest, Release, Task
from app.notifications import email_people
from app.services import pipelines, releases, repo_context, repos
from app.services.realtime import notify_workspace

router = APIRouter(tags=["delivery"])
Session = Annotated[AsyncSession, Depends(db.get_session)]


async def _project(session: AsyncSession, user: Any, project_id: uuid.UUID, station: str) -> Project:
    project = await access.get_visible_project(session, user, project_id)
    await access.ensure_station(session, user, project, station)
    return project


async def _github(session: AsyncSession, project: Project, user: Any) -> tuple[github.GitHub, str]:
    gh = await repos.client_for(session, project.id, user.id)
    target = await repos.for_project(session, project.id)
    if gh is None or target is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Connect GitHub for this product's repository first.")
    return gh, target.base_branch


async def _announce(session: AsyncSession, project: Project) -> None:
    await session.commit()
    if project.workspace_id:
        await notify_workspace(project.workspace_id, "delivery")


# ── CI/CD pipeline ────────────────────────────────────────────────────────────


@router.get("/api/projects/{project_id}/pipeline")
async def pipeline_status(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """The pipeline setup PR (if any) and the latest GitHub Actions runs."""
    project = await _project(session, user, project_id, "devops")
    setup = (project.settings or {}).get("pipeline")
    gh, _ = await _github(session, project, user)
    try:
        runs = await gh.list_workflow_runs(per_page=15)
        if setup and setup.get("status") == "open":
            pr = await gh.get_pull_request(number=setup["number"])
            setup = {**setup, "headSha": pr["head"]["sha"], "ci": await pipelines.ci_blockers(gh, pr["head"]["sha"])}
    finally:
        await gh.aclose()
    return {
        "setup": setup,
        "runs": [
            {
                "id": r["id"],
                "name": r["name"],
                "branch": r["head_branch"],
                "event": r["event"],
                "status": r["status"],
                "conclusion": r["conclusion"],
                "url": r["html_url"],
                "sha": r["head_sha"][:12],
                "createdAt": r["created_at"],
            }
            for r in runs
        ],
    }


@router.post("/api/projects/{project_id}/pipeline", status_code=status.HTTP_201_CREATED)
async def propose_pipeline(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Opens a PR that adds GitHub Actions CI (and release) for the repository's stack."""
    project = await _project(session, user, project_id, "devops")
    product_snapshot = None
    if project.product_id:
        product_snapshot = await repo_context.latest(session, project.product_id)
    if product_snapshot is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The repository has not been read yet; run an Idea Lab scan.")
    try:
        stack = pipelines.detect(product_snapshot)
    except pipelines.UnsupportedStack as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    gh, base = await _github(session, project, user)
    try:
        pr = await pipelines.propose(gh, stack, base)
    finally:
        await gh.aclose()
    setup = {"number": pr.number, "url": pr.url, "status": "open", "stack": stack.kind, "by": str(user.id)}
    project.settings = {**(project.settings or {}), "pipeline": setup}
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="pipeline.proposed",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"pr": pr.number, "stack": stack.kind},
    )
    await _announce(session, project)
    return setup


@router.post("/api/projects/{project_id}/pipeline/merge")
async def merge_pipeline(project_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Merges the pipeline PR once its own checks are green; open story PRs are refreshed so CI runs on them."""
    project = await _project(session, user, project_id, "devops")
    setup = (project.settings or {}).get("pipeline")
    if not setup or setup.get("status") != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no open pipeline pull request.")
    gh, _ = await _github(session, project, user)
    try:
        pr = await gh.get_pull_request(number=setup["number"])
        failing = await pipelines.ci_blockers(gh, pr["head"]["sha"])
        if failing:
            raise HTTPException(status.HTTP_409_CONFLICT, "CI is not green yet: " + "; ".join(failing))
        sha = await gh.merge(number=setup["number"], title="CI/CD: GitHub Actions pipeline")
        open_prs = (
            await session.scalars(
                select(PullRequest.number)
                .join(Task, Task.id == PullRequest.task_id)
                .where(Task.project_id == project.id, PullRequest.status == "open", PullRequest.url.like("https://%"))
            )
        ).all()
        for number in open_prs:
            await gh.update_branch(number=number)
    finally:
        await gh.aclose()
    project.settings = {**(project.settings or {}), "pipeline": {**setup, "status": "merged", "mergeSha": sha}}
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="pipeline.merged",
        subject_type="project",
        subject_id=project.id,
        project_id=project.id,
        payload={"pr": setup["number"], "sha": sha, "refreshed": list(open_prs)},
    )
    await _announce(session, project)
    return project.settings["pipeline"]


# ── Releases ──────────────────────────────────────────────────────────────────


def _release_out(r: Release) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "version": r.version,
        "status": r.status,
        "manifest": r.manifest,
        "blockers": r.blockers,
        "notes": r.notes,
        "commit": r.commit_sha,
        "releaseUrl": r.release_url,
        "approvedAt": r.approved_at.isoformat() if r.approved_at else None,
        "createdAt": r.created_at.isoformat(),
    }


class ReleaseIn(BaseModel):
    """A new release version, e.g. v0.2.0."""

    version: str = Field(pattern=r"^v\d+\.\d+\.\d+$")


async def _refresh(session: AsyncSession, project: Project, release: Release, user: Any) -> None:
    gh, base = await _github(session, project, user)
    try:
        manifest = await releases.build_manifest(session, project, gh, base)
    finally:
        await gh.aclose()
    summary = await releases.summary(project, release.version, manifest)
    release.manifest, release.commit_sha = manifest, manifest["commit"]
    release.blockers = releases.blockers(manifest)
    release.notes = (f"{summary}\n\n" if summary else "") + releases.facts(manifest)


@router.get("/api/projects/{project_id}/releases")
async def list_releases(project_id: uuid.UUID, session: Session, user: CurrentUser) -> list[dict[str, Any]]:
    """Releases of the project, newest first."""
    project = await access.get_visible_project(session, user, project_id)
    rows = (
        await session.scalars(
            select(Release).where(Release.project_id == project.id).order_by(Release.created_at.desc())
        )
    ).all()
    return [_release_out(r) for r in rows]


@router.post("/api/projects/{project_id}/releases", status_code=status.HTTP_201_CREATED)
async def prepare_release(
    project_id: uuid.UUID, body: ReleaseIn, session: Session, user: CurrentUser
) -> dict[str, Any]:
    """Drafts a release: gathers what ships and checks it."""
    project = await _project(session, user, project_id, "release")
    if await session.scalar(select(Release.id).where(Release.project_id == project.id, Release.version == body.version)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{body.version} already exists.")
    release = Release(id=uuid.uuid4(), project_id=project.id, version=body.version, manifest={}, created_by=user.id)
    await _refresh(session, project, release, user)
    session.add(release)
    await _announce(session, project)
    return _release_out(release)


async def _draft(session: AsyncSession, user: Any, release_id: uuid.UUID) -> tuple[Release, Project]:
    release = await session.get(Release, release_id)
    if release is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Release not found.")
    project = await _project(session, user, release.project_id, "release")
    if release.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, f"{release.version} is already published.")
    return release, project


@router.post("/api/releases/{release_id}/refresh")
async def refresh_release(release_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """Re-gathers the evidence (after QA sign-off, a fix, a green CI run)."""
    release, project = await _draft(session, user, release_id)
    await _refresh(session, project, release, user)
    await _announce(session, project)
    return _release_out(release)


@router.post("/api/releases/{release_id}/approve")
async def approve_release(release_id: uuid.UUID, session: Session, user: CurrentUser) -> dict[str, Any]:
    """The release gate: with no blockers, tag the commit and publish the GitHub Release."""
    release, project = await _draft(session, user, release_id)
    await _refresh(session, project, release, user)
    if release.blockers:
        await _announce(session, project)
        raise HTTPException(status.HTTP_409_CONFLICT, "Not releasable: " + " ".join(release.blockers))
    gh, _ = await _github(session, project, user)
    try:
        published = await gh.create_release(
            tag=release.version, target=release.commit_sha, name=f"{project.name} {release.version}", body=release.notes
        )
    finally:
        await gh.aclose()
    release.status, release.release_url = "published", published["html_url"]
    release.approved_by, release.approved_at = user.id, dt.datetime.now(dt.UTC)
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="release.published",
        subject_type="release",
        subject_id=release.id,
        project_id=project.id,
        payload={
            "version": release.version,
            "commit": release.commit_sha,
            "pull_requests": [p["number"] for p in release.manifest["pullRequests"]],
            "url": release.release_url,
        },
    )
    team = (await session.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project.id))).all()
    await _announce(session, project)
    await email_people(
        session,
        team,
        subject=f"Released: {project.name} {release.version}",
        heading=f"{user.display_name} released {project.name} {release.version}",
        lines=[
            f"{len(release.manifest['pullRequests'])} pull request(s), {len(release.manifest['stories'])} story(ies).",
            f"GitHub Release: {release.release_url}",
        ],
    )
    return _release_out(release)
