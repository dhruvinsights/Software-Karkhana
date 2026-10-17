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

"""Release station: gather what ships, check it, write the notes.

The manifest and the blockers are computed from records, never by a model:
merged pull requests not yet in a published release, their stories and QA
results, open security findings, and the CI state of the commit being tagged.
A model writes only the opening paragraph of the notes; every fact below it
is listed from the manifest.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import issue_rules
from app.ai import llm
from app.ai.errors import ModelError
from app.integrations import github
from app.models import (
    Issue,
    Project,
    PullRequest,
    Release,
    SecurityFinding,
    Task,
    TestScenario,
)
from app.services import pipelines

logger = logging.getLogger(__name__)

_BLOCKING_SEVERITIES = ("CRITICAL", "HIGH")
_OPEN_FINDING = ("open", "in_remediation")


async def _shipped_before(session: AsyncSession, project_id: uuid.UUID) -> set[int]:
    rows = (
        await session.scalars(
            select(Release.manifest).where(Release.project_id == project_id, Release.status == "published")
        )
    ).all()
    return {pr["number"] for m in rows for pr in m.get("pullRequests", [])}


async def build_manifest(
    session: AsyncSession, project: Project, gh: github.GitHub, base_branch: str
) -> dict[str, Any]:
    """Everything this release would ship, with its evidence."""
    shipped = await _shipped_before(session, project.id)
    rows = (
        await session.execute(
            select(PullRequest, Task)
            .join(Task, Task.id == PullRequest.task_id)
            .where(Task.project_id == project.id, PullRequest.status == "merged")
            .order_by(PullRequest.merged_at)
        )
    ).all()
    prs, stories = [], []
    for pr, task in rows:
        if pr.number in shipped:
            continue
        prs.append({"number": pr.number, "url": pr.url, "title": f"{task.key}: {task.title}"})
        story = await session.scalar(select(Issue).where(Issue.task_id == task.id, Issue.type == "story"))
        if story is None:
            continue
        results = (await session.scalars(select(TestScenario.status).where(TestScenario.issue_id == story.id))).all()
        stories.append(
            {
                "key": issue_rules.key(story.number),
                "title": story.title,
                "status": story.status,
                "qaPassed": sum(r == "passed" for r in results),
                "qaTotal": len(results),
            }
        )
    findings = (
        await session.scalars(
            select(SecurityFinding).where(
                SecurityFinding.project_id == project.id, SecurityFinding.status.in_(_OPEN_FINDING)
            )
        )
    ).all()
    commit = await gh.branch_sha(base_branch)
    return {
        "pullRequests": prs,
        "stories": stories,
        "security": [{"title": f.title, "severity": f.severity, "status": f.status} for f in findings],
        "commit": commit,
        "ci": await pipelines.ci_blockers(gh, commit),
    }


def blockers(manifest: dict[str, Any]) -> list[str]:
    """Why the release cannot be approved yet; empty when it can."""
    out: list[str] = []
    if not manifest["pullRequests"]:
        out.append("Nothing new has been merged since the last release.")
    for s in manifest["stories"]:
        if s["status"] != "done":
            out.append(f"{s['key']} has no QA sign-off ({s['qaPassed']}/{s['qaTotal']} scenarios passed).")
    for f in manifest["security"]:
        if f["severity"] in _BLOCKING_SEVERITIES:
            out.append(f"Open {f['severity'].lower()} security finding: {f['title']}.")
    out += [f"CI on the release commit: {c}." for c in manifest["ci"]]
    return out


def facts(manifest: dict[str, Any]) -> str:
    """The Markdown body of the notes, listed from the manifest."""
    lines = ["## What's in this release", ""]
    lines += [f"- **{s['key']}** {s['title']}" for s in manifest["stories"]] or ["- (no stories)"]
    lines += ["", "## Pull requests", ""]
    lines += [f"- [#{p['number']}]({p['url']}) {p['title']}" for p in manifest["pullRequests"]]
    lines += ["", "## Quality", ""]
    lines += [f"- {s['key']}: QA {s['qaPassed']}/{s['qaTotal']} scenarios passed" for s in manifest["stories"]]
    lines.append(f"- CI on `{manifest['commit'][:12]}`: " + ("green" if not manifest["ci"] else "; ".join(manifest["ci"])))
    open_findings = [f"{f['severity']} {f['title']} ({f['status']})" for f in manifest["security"]]
    lines += ["", "## Security", "", "- " + ("; ".join(open_findings) if open_findings else "No open findings.")]
    return "\n".join(lines)


async def summary(project: Project, version: str, manifest: dict[str, Any]) -> str:
    """One short paragraph for people, written from the manifest. Empty if the model fails."""
    try:
        return await llm.generate_text(
            messages=[{"role": "user", "content": json.dumps({"project": project.name, "version": version, **manifest})}],
            system=(
                "Write two or three plain sentences announcing this release to the team: what users can do now. "
                "Use only facts in the JSON. No Markdown, no hype."
            ),
            kind="release-notes",
        )
    except ModelError:
        logger.warning("Release summary skipped", exc_info=True)
        return ""
