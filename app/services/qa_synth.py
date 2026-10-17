# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""QA scenarios from a finished story: manual steps plus an automation script."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import llm
from app.models import Issue, Project, TestScenario, User

SYSTEM = (
    "You are a senior QA engineer. From one finished story and its acceptance "
    "criteria, write test scenarios a tester can run by hand and a runnable "
    "automation script for each. Cover the main flow, boundaries and at least "
    "one negative or security case. Be specific: real inputs, real expected "
    "results. Leave automation_script empty; it is written in a second step."
)

SCRIPT_SYSTEM = (
    "You write one pytest test function. Use the `requests` library against the "
    "module variable BASE_URL. Include real assertions on status code and body. "
    "Reply with the Python code only, no explanation, no code fence. Example:\n"
    "def test_expired_code_rejected():\n"
    "    r = requests.post(f'{BASE_URL}/cart/discount', json={'code': 'OLD10'})\n"
    "    assert r.status_code == 400\n"
    "    assert r.json()['error'] == 'Code expired'"
)


def strip_fence(text: str) -> str:
    """Drops a Markdown code fence if the model added one."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    return t.strip()


def looks_runnable(code: str) -> bool:
    """A real test has a def, an assert and is valid Python."""
    if "def test_" not in code or "assert" not in code:
        return False
    try:
        compile(code, "<scenario>", "exec")
    except SyntaxError:
        return False
    return True


async def write_script(issue_text: str, d: DraftScenario) -> str:
    """Asks for the test code of one scenario. Empty when the reply is not runnable."""
    ask = (
        f"{issue_text}\n\nScenario: {d.title}\nSteps:\n"
        + "\n".join(f"- {x}" for x in d.steps)
        + f"\nExpected: {d.expected_result}"
    )
    try:
        code = strip_fence(
            await llm.generate_text(
                messages=[{"role": "user", "content": ask}],
                system=SCRIPT_SYSTEM,
                kind="qa-script",
                temperature=0.2,
                timeout_s=120,
            )
        )
    except Exception:
        return ""
    return code if looks_runnable(code) else ""


class DraftScenario(BaseModel):
    """One scenario as the model returns it."""

    title: str = Field(min_length=3, max_length=200)
    type: str = "Functional"
    priority: str = "P1"
    steps: list[str] = Field(min_length=1)
    expected_result: str
    automation_script: str = ""


class DraftScenarios(BaseModel):
    """What the model must return."""

    scenarios: list[DraftScenario] = Field(min_length=1, max_length=8)


_TYPES = {"Functional", "Boundary", "Security / Negative", "Performance / Load", "Accessibility"}


def clean(d: DraftScenario) -> DraftScenario:
    """Pins model output to values the table accepts."""
    d.type = d.type if d.type in _TYPES else "Functional"
    d.priority = d.priority if d.priority in {"P0", "P1", "P2"} else "P1"
    d.title = d.title.strip()
    return d


def prompt_for(issue: Issue, project: Project) -> str:
    """The story, as the model should read it."""
    criteria = "\n".join(f"- {c}" for c in issue.acceptance_criteria or []) or "- (none written)"
    return (
        f"Project: {project.name}\nStory {issue.number}: {issue.title}\n\n"
        f"Description:\n{issue.description or '(none)'}\n\nAcceptance criteria:\n{criteria}"
    )


async def synthesize_for_issue(
    session: AsyncSession, project: Project, issue: Issue, user: User
) -> list[TestScenario]:
    """Drafts and saves scenarios for one story. Replaces nothing; titles already present are skipped."""
    draft = await llm.generate_structured(
        prompt=prompt_for(issue, project),
        schema=DraftScenarios,
        system=SYSTEM,
        temperature=0.3,
        timeout_s=240,
    )
    have = {
        t.lower()
        for t in (
            await session.scalars(
                select(TestScenario.title).where(TestScenario.issue_id == issue.id)
            )
        ).all()
    }
    made: list[TestScenario] = []
    story = prompt_for(issue, project)
    for d in map(clean, draft.scenarios):
        if d.title.lower() in have:
            continue
        d.automation_script = await write_script(story, d)
        row = TestScenario(
            id=uuid.uuid4(),
            project_id=project.id,
            workspace_id=project.workspace_id,
            issue_id=issue.id,
            title=d.title,
            type=d.type,
            priority=d.priority,
            steps=d.steps,
            expected_result=d.expected_result,
            automation_script=d.automation_script or None,
            status="not_run",
            created_by=user.id,
        )
        session.add(row)
        made.append(row)
    await session.flush()
    return made
