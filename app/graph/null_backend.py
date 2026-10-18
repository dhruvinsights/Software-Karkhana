"""
NullBackend — a safe no-op fallback when the graph DB is unavailable.

All write methods silently succeed.
All query methods return empty results.
This ensures the orchestrator works correctly even without FalkorDB running.
"""

from __future__ import annotations

from app.graph.base import (
    BlastRadius,
    ConflictCheckResult,
    FileNode,
    GraphBackend,
    RevisitMemory,
    ScopedContext,
)


class NullBackend(GraphBackend):
    """No-op backend.  Used when FalkorDB is unavailable or disabled."""

    def connect(self) -> None: pass
    def close(self) -> None: pass
    def is_available(self) -> bool: return False

    def ingest_repo_files(self, project_id, files): pass
    def add_import_edge(self, project_id, from_file, to_file): pass
    def add_test_covers_edge(self, project_id, test_file, source_file): pass
    def record_task_touches(self, project_id, task_id, task_title, file_paths): pass
    def link_requirement(self, project_id, requirement_id, requirement_text, task_ids): pass
    def record_agent_attempt(self, project_id, task_id, phase, file_paths, success, summary): pass

    def get_scoped_context(self, project_id, task_id, touched_files) -> ScopedContext:
        return ScopedContext(task_id=task_id, touched_files=touched_files)

    def check_parallel_conflicts(self, project_id, task_id, file_paths, active_task_ids) -> ConflictCheckResult:
        return ConflictCheckResult()

    def get_blast_radius(self, project_id, changed_files) -> BlastRadius:
        return BlastRadius(changed_files=changed_files)

    def get_requirement_trace(self, project_id, requirement_id) -> list:
        return []

    def get_revisit_memory(self, project_id, file_paths) -> list:
        return []
