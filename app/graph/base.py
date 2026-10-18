"""GraphBackend — the abstract interface every backend must implement.

Five concrete use-cases are supported through this interface:

  UC-1  Context scoping          — get focused file/test/req context for a worker
  UC-2  Parallel-safety check    — detect file conflicts before scheduling two tasks
  UC-3  Impact blast radius      — given a set of changed files, who else is affected?
  UC-4  Requirement traceability — which tasks/files implement a requirement?
  UC-5  Agent revisit memory     — what has previously been tried on these files?

To replace FalkorDB with another backend:
  1. Create a new class that inherits GraphBackend and implements all methods.
  2. Update `_BACKEND_CLASS` in factory.py.
  3. Update the optional-dependencies block in pyproject.toml if needed.
  No other file in the codebase needs to change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Shared result types
# ---------------------------------------------------------------------------

@dataclass
class FileNode:
    """A source file in the code graph."""

    path: str
    language: str = ""
    is_test: bool = False


@dataclass
class ScopedContext:
    """UC-1: Focused context for one worker run."""
    task_id: str
    touched_files: list[str]
    # Callers of touched files (1 hop)
    callers: list[str] = field(default_factory=list)
    # Test files that cover touched files
    related_tests: list[str] = field(default_factory=list)
    # Requirements/tasks whose scope overlaps
    related_requirements: list[str] = field(default_factory=list)

    def to_prompt_prefix(self) -> str:
        """Render as a compact prefix to inject into the worker prompt."""
        lines = ["## Graph Context (from Engineering Intelligence Graph)\n"]
        lines.append(f"**Touched files** ({len(self.touched_files)}):")
        for f in self.touched_files[:10]:
            lines.append(f"  - `{f}`")
        if self.callers:
            lines.append(f"\n**Direct callers / importers** ({len(self.callers)}):")
            for c in self.callers[:8]:
                lines.append(f"  - `{c}`")
        if self.related_tests:
            lines.append(f"\n**Related tests** ({len(self.related_tests)}):")
            for t in self.related_tests[:8]:
                lines.append(f"  - `{t}`")
        if self.related_requirements:
            lines.append(f"\n**Linked requirements/tasks** ({len(self.related_requirements)}):")
            for r in self.related_requirements[:5]:
                lines.append(f"  - {r}")
        lines.append("\n---")
        return "\n".join(lines)


@dataclass
class ConflictCheckResult:
    """UC-2: Result of a parallel-safety check."""
    # task_id → list[conflicting_file_paths]
    conflicts: dict[str, list[str]] = field(default_factory=dict)

    @property
    def has_conflicts(self) -> bool:
        """True when any task touches a file another task also touches."""
        return bool(self.conflicts)

    def summary(self) -> str:
        """Human-readable result for the PR or run log."""
        if not self.has_conflicts:
            return "No file conflicts detected — parallel execution is safe."
        lines = ["**File conflicts detected — serial execution required:**"]
        for task_id, files in self.conflicts.items():
            lines.append(f"  - Task `{task_id}` also touches: {', '.join(files)}")
        return "\n".join(lines)


@dataclass
class BlastRadius:
    """UC-3: Impact analysis for a set of changed files."""
    changed_files: list[str]
    affected_callers: list[str] = field(default_factory=list)
    affected_tests: list[str] = field(default_factory=list)
    affected_tasks: list[str] = field(default_factory=list)
    affected_requirements: list[str] = field(default_factory=list)

    def summary(self) -> str:
        """Human-readable blast radius."""
        lines = [f"**Blast radius for {len(self.changed_files)} changed file(s):**"]
        if self.affected_callers:
            lines.append(f"  Callers affected: {len(self.affected_callers)}")
        if self.affected_tests:
            lines.append(f"  Tests to re-run: {len(self.affected_tests)}")
        if self.affected_tasks:
            lines.append(f"  Other tasks touching these files: {', '.join(self.affected_tasks)}")
        if self.affected_requirements:
            lines.append(f"  Requirements impacted: {', '.join(self.affected_requirements)}")
        return "\n".join(lines)


@dataclass
class RevisitMemory:
    """UC-5: What has been tried on these files in past worker runs."""
    file_path: str
    past_attempts: list[dict] = field(default_factory=list)  # [{task_id, phase, outcome, summary}]

    def to_prompt_note(self) -> str:
        """A short note to prepend to the agent prompt (empty when nothing is known)."""
        if not self.past_attempts:
            return ""
        lines = [f"**Prior agent attempts on `{self.file_path}`:**"]
        for a in self.past_attempts[-3:]:  # last 3 only
            outcome = "✓" if a.get("success") else "✗"
            lines.append(f"  {outcome} [{a.get('phase', '?')}] {a.get('summary', '')[:120]}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Abstract backend
# ---------------------------------------------------------------------------

class GraphBackend(ABC):
    """Abstract graph backend interface.

    Every public method is either a *write* (ingest data into the graph) or a
    *query* (retrieve structured results).  No method should expose
    backend-specific query language or connection objects.
    """

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @abstractmethod
    def connect(self) -> None:
        """Open a connection / initialise the in-process DB.  Idempotent."""
        ...

    @abstractmethod
    def close(self) -> None:
        """Release resources."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Return True if the backend is reachable and ready."""
        ...

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    @abstractmethod
    def ingest_repo_files(self, project_id: str, files: list[FileNode]) -> None:
        """UC-1/3: Record all files in a repository. Idempotent (upsert)."""
        ...

    @abstractmethod
    def add_import_edge(self, project_id: str, from_file: str, to_file: str) -> None:
        """UC-1/3: Record that `from_file` imports / calls `to_file`."""
        ...

    @abstractmethod
    def add_test_covers_edge(self, project_id: str, test_file: str, source_file: str) -> None:
        """UC-1/3: Record that `test_file` tests `source_file`."""
        ...

    @abstractmethod
    def record_task_touches(
        self,
        project_id: str,
        task_id: str,
        task_title: str,
        file_paths: list[str],
    ) -> None:
        """UC-2/3: Record which files a task intends to touch."""
        ...

    @abstractmethod
    def link_requirement(
        self,
        project_id: str,
        requirement_id: str,
        requirement_text: str,
        task_ids: list[str],
    ) -> None:
        """UC-4: Link a requirement to its implementing tasks."""
        ...

    @abstractmethod
    def record_agent_attempt(
        self,
        project_id: str,
        task_id: str,
        phase: str,
        file_paths: list[str],
        success: bool,
        summary: str,
    ) -> None:
        """UC-5: Record the outcome of a worker run on a set of files."""
        ...

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    @abstractmethod
    def get_scoped_context(
        self,
        project_id: str,
        task_id: str,
        touched_files: list[str],
    ) -> ScopedContext:
        """UC-1: Return focused context (callers, tests, requirements) for touched files."""
        ...

    @abstractmethod
    def check_parallel_conflicts(
        self,
        project_id: str,
        task_id: str,
        file_paths: list[str],
        active_task_ids: list[str],
    ) -> ConflictCheckResult:
        """UC-2: Check whether any active task touches the same files."""
        ...

    @abstractmethod
    def get_blast_radius(
        self,
        project_id: str,
        changed_files: list[str],
    ) -> BlastRadius:
        """UC-3: Compute which callers, tests, tasks and requirements are affected."""
        ...

    @abstractmethod
    def get_requirement_trace(
        self,
        project_id: str,
        requirement_id: str,
    ) -> list[str]:
        """UC-4: Return task IDs and file paths that implement this requirement."""
        ...

    @abstractmethod
    def get_revisit_memory(
        self,
        project_id: str,
        file_paths: list[str],
    ) -> list[RevisitMemory]:
        """UC-5: Return past agent attempts on the given files."""
        ...
