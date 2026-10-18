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

"""QA gate: a story is Done only when QA signs it off after every scenario passed.

Recording a result moves the story into QA; a failed scenario files one bug
issue under the story (linked by a label naming the scenario, so recording the
same failure twice does not file twice). Releases read the same rule.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import issue_rules, ledger
from app.models import Issue, Project, PullRequest, TestScenario, User
from app.services import osv_scan


def _bug_label(scenario: TestScenario) -> str:
    return f"qa-scenario:{scenario.id}"


async def record_result(session: AsyncSession, scenario: TestScenario, user: User) -> None:
    """Applies a scenario result to its story and files a bug on failure."""
    story = await session.get(Issue, scenario.issue_id)
    if story is None:
        return
    if story.status == "ready_for_qa":
        story.status, story.updated_at = "in_qa", dt.datetime.now(dt.UTC)
    if scenario.status != "failed":
        return
    label = _bug_label(scenario)
    if await session.scalar(select(Issue.id).where(Issue.project_id == story.project_id, Issue.labels.contains([label]))):
        return
    project = await session.scalar(select(Project).where(Project.id == story.project_id).with_for_update())
    assert project is not None
    number = (
        await session.scalar(select(func.coalesce(func.max(Issue.number), 0)).where(Issue.project_id == project.id))
    ) + 1
    bug = Issue(
        id=uuid.uuid4(),
        project_id=project.id,
        number=number,
        title=f"QA: {scenario.title}"[:200],
        description=(
            f"Failed scenario on {issue_rules.key(story.number)}.\n\n"
            f"Expected: {scenario.expected_result}\nActual: {scenario.actual_result or '(not recorded)'}"
        ),
        type="bug",
        priority=scenario.priority if scenario.priority in issue_rules.PRIORITIES else "P1",
        status="backlog",
        source="qa",
        reporter_id=user.id,
        parent_id=story.id,
        labels=["qa", label],
    )
    session.add(bug)
    await session.flush()
    await ledger.append(
        session,
        actor=ledger.Actor.human(user),
        action="qa.bug_filed",
        subject_type="issue",
        subject_id=bug.id,
        project_id=project.id,
        payload={"story": issue_rules.key(story.number), "scenario": str(scenario.id)},
    )


async def signoff_problem(session: AsyncSession, story: Issue) -> str | None:
    """Why the story cannot be signed off yet, or ``None`` when it can."""
    if story.status not in ("ready_for_qa", "in_qa"):
        return f"{issue_rules.key(story.number)} is {story.status.replace('_', ' ')}, not waiting for QA."
    results = list(
        (await session.scalars(select(TestScenario.status).where(TestScenario.issue_id == story.id))).all()
    )
    if not results:
        return "Add or generate test scenarios and run them first."
    pending = [r for r in results if r != "passed"]
    if pending:
        return f"{len(pending)} of {len(results)} scenarios have not passed."
    open_bugs = await session.scalar(
        select(func.count())
        .select_from(Issue)
        .where(Issue.parent_id == story.id, Issue.type == "bug", Issue.status.not_in(issue_rules.CLOSED))
    )
    if open_bugs:
        return f"{open_bugs} QA bug(s) on this story are still open."
    return await security_problem(session, story)


async def security_problem(session: AsyncSession, story: Issue) -> str | None:
    """Why the security gate is closed for this story, or ``None`` when it is open.

    A story with a pull request is judged on that pull request's own scan; one
    without is judged on the project's open findings. The project's policy
    decides which severities block and whether a scan is required at all.
    """
    project = await session.get(Project, story.project_id)
    if project is None:
        return None
    pr = await session.get(PullRequest, story.pr_id) if story.pr_id else None
    reasons = await osv_scan.gate_blockers(session, project, pr=pr)
    return ("Security gate closed: " + "; ".join(reasons) + ".") if reasons else None
