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

"""What a build is told, and where the developer steers it.

The developer chooses what the coding agent receives (the **brief**: which
acceptance criteria, which shared notes, which files to focus on, their own
instruction) and where the build stops for their decision (the **control**).
This module holds those two shapes and the selection rules, so the preview the
developer sees and the spec the agent gets come from the same code.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app import agent_memory
from app.models import Project, Task
from app.schemas import ContextNote
from app.services import context_notes, design_handoff

logger = logging.getLogger(__name__)

# The places a build can pause for the developer.
PAUSES = ("after_code", "before_tests", "fix")
PAUSE_LABELS = {
    "after_code": "After the agent has written code, before any test runs",
    "before_tests": "Before each test suite: run it or skip it",
    "fix": "Before a failing test is sent back to the agent to fix",
}


class Control(BaseModel):
    """Where the build stops and waits for the developer."""

    mode: Literal["auto", "step", "custom"] = "auto"
    pauses: list[Literal["after_code", "before_tests", "fix"]] = Field(default_factory=list)

    def effective(self) -> list[str]:
        """``step`` pauses everywhere, ``auto`` nowhere, ``custom`` where listed."""
        if self.mode == "step":
            return list(PAUSES)
        if self.mode == "auto":
            return []
        return [p for p in PAUSES if p in self.pauses]


class Brief(BaseModel):
    """What the developer chose to give the agent. ``None`` means everything."""

    criteria: list[int] | None = Field(default=None, max_length=50, description="Indexes of the acceptance criteria to include.")
    notes: list[str] | None = Field(default=None, max_length=60, description="Ids of the shared notes to include.")
    focus: list[str] = Field(default_factory=list, max_length=30, description="Repository paths to start from.")
    instruction: str = Field(default="", max_length=4000)

    @field_validator("focus")
    @classmethod
    def _relative_paths(cls, paths: list[str]) -> list[str]:
        clean: list[str] = []
        for raw in paths:
            p = raw.strip()
            if not p:
                continue
            # Judge the path as typed; only afterwards drop a harmless leading "./".
            if p.startswith(("/", "~", "\\")) or ".." in p.replace("\\", "/").split("/") or len(p) > 200 or ":" in p[:3]:
                raise ValueError(f"Focus paths are relative to the repository (not '{raw}').")
            clean.append(p[2:] if p.startswith("./") else p)
        return clean


async def gather_notes(session: AsyncSession, project: Project, task: Task) -> list[ContextNote]:
    """Every note the agent could be given for ``task``: shared context, memory, the design slice."""
    notes = context_notes.as_notes(await context_notes.recent(session, project.id))
    notes += [
        ContextNote(id=f"memory:{i}", kind="memory", title="Project memory", body=m, author="mem0")
        for i, m in enumerate(await agent_memory.recall(project.id, f"{task.title}\n{task.description}", role="developer"))
    ]
    design = await design_handoff.latest_design(session, project.id)
    if design is not None and task.key:
        if body := design_handoff.as_note(design.content, task.key, design.version):
            notes.append(ContextNote(id="design", kind="design", title=f"Design for {task.key}", body=body, author="design station"))

    # UC-1 + UC-5: inject graph-scoped context (callers, tests, revisit memory).
    # Completely silent if FalkorDB is not running — NullBackend returns empty results.
    # The brief lives on the run, not the task; without focus paths the graph adds nothing.
    _brief = getattr(task, "brief", None) or {}
    _focus: list[str] = _brief.get("focus", []) if isinstance(_brief, dict) else []
    graph_note = _graph_context_note(str(project.id), str(task.id), _focus)
    if graph_note:
        notes.append(graph_note)

    return notes


def _graph_context_note(project_id: str, task_id: str, focus_paths: list[str]) -> ContextNote | None:
    """UC-1/UC-5: Query graph for scoped context and revisit memory.

    Returns a ContextNote the agent receives alongside its other context,
    or None when the graph is unavailable or has nothing relevant.
    """
    try:
        from app.graph import get_graph
        g = get_graph()
        if not g.is_available() or not focus_paths:
            return None

        ctx = g.get_scoped_context(project_id=project_id, task_id=task_id, touched_files=focus_paths)
        body = ctx.to_prompt_prefix()

        # UC-5: append any prior agent attempts on these files
        memories = g.get_revisit_memory(project_id=project_id, file_paths=focus_paths)
        revisit = "\n".join(m.to_prompt_note() for m in memories if m.past_attempts)
        if revisit:
            body += "\n\n## Prior agent attempts on these files\n" + revisit

        if body.strip() == "## Graph Context (from Engineering Intelligence Graph)\n\n---":
            return None  # nothing useful — graph is empty for this project yet

        return ContextNote(
            id="graph:context",
            kind="memory",
            title="Engineering Intelligence Graph context",
            body=body,
            author="falkordb",
        )
    except Exception as exc:
        logger.debug("[graph] gather_notes graph context skipped: %s", exc)
        return None


def select(items: list[Any], keep: list[Any] | None, key) -> list[Any]:
    """``items`` the developer kept; all of them when they made no selection."""
    if keep is None:
        return items
    wanted = set(keep)
    return [it for i, it in enumerate(items) if key(i, it) in wanted]


def chosen(brief: dict[str, Any] | None, criteria: list[str], notes: list[ContextNote]) -> tuple[list[str], list[ContextNote]]:
    """Applies a stored brief: the criteria and notes that go to the agent."""
    b = brief or {}
    return (
        select(criteria, b.get("criteria"), lambda i, _c: i),
        select(notes, b.get("notes"), lambda _i, n: n.id),
    )


def estimate_tokens(*texts: str) -> int:
    """A rough token count (four characters to a token) for the developer's preview."""
    return sum(len(t) for t in texts) // 4


def new_gate(name: str, summary: str, options: list[dict[str, Any]], now_iso: str) -> dict[str, Any]:
    """A decision waiting for the developer."""
    return {"id": uuid.uuid4().hex[:8], "name": name, "summary": summary[:2000], "options": options, "openedAt": now_iso, "decision": None}
