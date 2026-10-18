"""FalkorDB backend for the Karkhana Engineering Intelligence Graph.

Uses FalkorDB (SSPL v1) for hackathon / internal use.
For production SaaS, swap this file with kuzu_backend.py or neo4j_backend.py.
See docs/FALKORDB.md → "Swapping the backend" for instructions.

Graph schema (property graph):
  Nodes:
    (:File   {id, project_id, path, language, is_test})
    (:Task   {id, project_id, title})
    (:Req    {id, project_id, text})
    (:Attempt{id, project_id, task_id, phase, success, summary, ts})

  Edges:
    (:File)-[:IMPORTS]->(:File)
    (:File)-[:TESTED_BY]->(:File)           # source file → test file
    (:Task)-[:TOUCHES]->(:File)
    (:Req)-[:IMPLEMENTED_BY]->(:Task)
    (:Attempt)-[:ON_FILE]->(:File)
"""

from __future__ import annotations

import logging
import time

from app.graph.base import (
    BlastRadius,
    ConflictCheckResult,
    FileNode,
    GraphBackend,
    RevisitMemory,
    ScopedContext,
)

logger = logging.getLogger(__name__)


class FalkorDBBackend(GraphBackend):
    """Graph backend backed by FalkorDB.

    Connection is lazy — nothing opens until `connect()` is called.
    All graph operations are no-ops if the backend is not available,
    so the rest of the orchestrator degrades gracefully.
    """

    def __init__(self, host: str = "localhost", port: int = 6379, graph_name: str = "karkhana"):
        self._host = host
        self._port = port
        self._graph_name = graph_name
        self._db = None   # falkordb.FalkorDB instance
        self._graph = None  # falkordb.Graph instance
        self._available = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> None:
        try:
            import falkordb
            self._db = falkordb.FalkorDB(host=self._host, port=self._port)
            self._graph = self._db.select_graph(self._graph_name)
            self._ensure_schema()
            self._available = True
            logger.info("[FalkorDB] Connected to %s:%s graph=%s", self._host, self._port, self._graph_name)
        except ImportError:
            logger.warning("[FalkorDB] falkordb package not installed — graph features disabled")
            self._available = False
        except Exception as exc:
            logger.warning("[FalkorDB] Connection failed (%s) — graph features disabled", exc)
            self._available = False

    def close(self) -> None:
        self._db = None
        self._graph = None
        self._available = False

    def is_available(self) -> bool:
        return self._available

    def _ensure_schema(self) -> None:
        """Create indexes for fast lookup. Idempotent."""
        if not self._graph:
            return
        # Node indexes
        for label, prop in [("File", "id"), ("Task", "id"), ("Req", "id")]:
            try:
                self._graph.query(f"CREATE INDEX FOR (n:{label}) ON (n.{prop})")
            except Exception:  # noqa: S110 - FalkorDB raises on a duplicate index; that is fine
                pass

    def _q(self, cypher: str, params: dict | None = None):
        """Execute a Cypher query. Returns result or empty result on error."""
        if not self._available or self._graph is None:
            return None
        try:
            return self._graph.query(cypher, params or {})
        except Exception as exc:
            logger.debug("[FalkorDB] Query error: %s | query: %s", exc, cypher[:120])
            return None

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    def ingest_repo_files(self, project_id: str, files: list[FileNode]) -> None:
        if not self._available:
            return
        for f in files:
            self._q(
                "MERGE (n:File {id: $id}) "
                "SET n.project_id = $project_id, n.path = $path, "
                "n.language = $language, n.is_test = $is_test",
                {
                    "id": f"{project_id}::{f.path}",
                    "project_id": project_id,
                    "path": f.path,
                    "language": f.language,
                    "is_test": f.is_test,
                },
            )
        logger.debug("[FalkorDB] Ingested %d files for project %s", len(files), project_id)

    def add_import_edge(self, project_id: str, from_file: str, to_file: str) -> None:
        if not self._available:
            return
        self._q(
            "MERGE (a:File {id: $a_id}) "
            "MERGE (b:File {id: $b_id}) "
            "MERGE (a)-[:IMPORTS]->(b)",
            {"a_id": f"{project_id}::{from_file}", "b_id": f"{project_id}::{to_file}"},
        )

    def add_test_covers_edge(self, project_id: str, test_file: str, source_file: str) -> None:
        if not self._available:
            return
        self._q(
            "MERGE (src:File {id: $src_id}) "
            "MERGE (tst:File {id: $tst_id}) "
            "SET tst.is_test = true "
            "MERGE (src)-[:TESTED_BY]->(tst)",
            {"src_id": f"{project_id}::{source_file}", "tst_id": f"{project_id}::{test_file}"},
        )

    def record_task_touches(
        self,
        project_id: str,
        task_id: str,
        task_title: str,
        file_paths: list[str],
    ) -> None:
        if not self._available:
            return
        self._q(
            "MERGE (t:Task {id: $task_id}) SET t.project_id = $project_id, t.title = $title",
            {"task_id": task_id, "project_id": project_id, "title": task_title},
        )
        for path in file_paths:
            self._q(
                "MERGE (f:File {id: $file_id}) SET f.project_id = $project_id, f.path = $path "
                "MERGE (t:Task {id: $task_id}) "
                "MERGE (t)-[:TOUCHES]->(f)",
                {
                    "file_id": f"{project_id}::{path}",
                    "project_id": project_id,
                    "path": path,
                    "task_id": task_id,
                },
            )
        logger.debug("[FalkorDB] Recorded TOUCHES for task %s: %d files", task_id, len(file_paths))

    def link_requirement(
        self,
        project_id: str,
        requirement_id: str,
        requirement_text: str,
        task_ids: list[str],
    ) -> None:
        if not self._available:
            return
        self._q(
            "MERGE (r:Req {id: $req_id}) SET r.project_id = $project_id, r.text = $text",
            {"req_id": requirement_id, "project_id": project_id, "text": requirement_text[:500]},
        )
        for tid in task_ids:
            self._q(
                "MERGE (r:Req {id: $req_id}) "
                "MERGE (t:Task {id: $task_id}) "
                "MERGE (r)-[:IMPLEMENTED_BY]->(t)",
                {"req_id": requirement_id, "task_id": tid},
            )

    def record_agent_attempt(
        self,
        project_id: str,
        task_id: str,
        phase: str,
        file_paths: list[str],
        success: bool,
        summary: str,
    ) -> None:
        if not self._available:
            return
        attempt_id = f"{task_id}::{phase}::{int(time.time())}"
        self._q(
            "CREATE (a:Attempt {id: $id, project_id: $project_id, task_id: $task_id, "
            "phase: $phase, success: $success, summary: $summary, ts: $ts})",
            {
                "id": attempt_id,
                "project_id": project_id,
                "task_id": task_id,
                "phase": phase,
                "success": success,
                "summary": summary[:300],
                "ts": int(time.time()),
            },
        )
        for path in file_paths:
            self._q(
                "MATCH (a:Attempt {id: $attempt_id}) "
                "MERGE (f:File {id: $file_id}) SET f.project_id = $project_id, f.path = $path "
                "MERGE (a)-[:ON_FILE]->(f)",
                {
                    "attempt_id": attempt_id,
                    "file_id": f"{project_id}::{path}",
                    "project_id": project_id,
                    "path": path,
                },
            )

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_scoped_context(
        self,
        project_id: str,
        task_id: str,
        touched_files: list[str],
    ) -> ScopedContext:
        callers: list[str] = []
        tests: list[str] = []
        reqs: list[str] = []

        if not self._available or not touched_files:
            return ScopedContext(task_id=task_id, touched_files=touched_files)

        file_ids = [f"{project_id}::{p}" for p in touched_files]

        # 1-hop callers (files that import any of our touched files)
        result = self._q(
            "MATCH (caller:File)-[:IMPORTS]->(f:File) "
            "WHERE f.id IN $file_ids AND caller.project_id = $project_id "
            "RETURN DISTINCT caller.path AS path LIMIT 15",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            callers = [row[0] for row in result.result_set if row[0]]

        # Tests that cover any of our touched files
        result = self._q(
            "MATCH (f:File)-[:TESTED_BY]->(t:File) "
            "WHERE f.id IN $file_ids AND t.project_id = $project_id "
            "RETURN DISTINCT t.path AS path LIMIT 12",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            tests = [row[0] for row in result.result_set if row[0]]

        # Requirements linked to this task
        result = self._q(
            "MATCH (r:Req)-[:IMPLEMENTED_BY]->(t:Task {id: $task_id}) "
            "RETURN r.text AS text LIMIT 5",
            {"task_id": task_id},
        )
        if result:
            reqs = [row[0][:120] for row in result.result_set if row[0]]

        return ScopedContext(
            task_id=task_id,
            touched_files=touched_files,
            callers=callers,
            related_tests=tests,
            related_requirements=reqs,
        )

    def check_parallel_conflicts(
        self,
        project_id: str,
        task_id: str,
        file_paths: list[str],
        active_task_ids: list[str],
    ) -> ConflictCheckResult:
        if not self._available or not active_task_ids:
            return ConflictCheckResult()

        if file_paths:
            # Caller supplied an explicit file list
            file_ids = [f"{project_id}::{p}" for p in file_paths]
            result = self._q(
                "MATCH (t:Task)-[:TOUCHES]->(f:File) "
                "WHERE f.id IN $file_ids "
                "AND t.id IN $active_ids "
                "AND t.id <> $task_id "
                "RETURN t.id AS task_id, f.path AS path",
                {"file_ids": file_ids, "active_ids": active_task_ids, "task_id": task_id},
            )
        else:
            # Scheduler path: look up task's stored TOUCHES, then find overlaps with active tasks
            result = self._q(
                "MATCH (me:Task {id: $task_id})-[:TOUCHES]->(f:File)"
                "<-[:TOUCHES]-(other:Task) "
                "WHERE other.id IN $active_ids "
                "AND other.id <> $task_id "
                "RETURN other.id AS task_id, f.path AS path",
                {"task_id": task_id, "active_ids": active_task_ids},
            )

        conflicts: dict[str, list[str]] = {}
        if result:
            for row in result.result_set:
                tid, path = row[0], row[1]
                conflicts.setdefault(tid, []).append(path)

        return ConflictCheckResult(conflicts=conflicts)

    def get_blast_radius(
        self,
        project_id: str,
        changed_files: list[str],
    ) -> BlastRadius:
        if not self._available or not changed_files:
            return BlastRadius(changed_files=changed_files)

        file_ids = [f"{project_id}::{p}" for p in changed_files]

        callers: list[str] = []
        tests: list[str] = []
        tasks: list[str] = []
        reqs: list[str] = []

        # Callers
        result = self._q(
            "MATCH (c:File)-[:IMPORTS]->(f:File) "
            "WHERE f.id IN $file_ids AND c.project_id = $project_id "
            "RETURN DISTINCT c.path LIMIT 20",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            callers = [row[0] for row in result.result_set if row[0]]

        # Tests
        result = self._q(
            "MATCH (f:File)-[:TESTED_BY]->(t:File) "
            "WHERE f.id IN $file_ids AND t.project_id = $project_id "
            "RETURN DISTINCT t.path LIMIT 20",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            tests = [row[0] for row in result.result_set if row[0]]

        # Other tasks touching same files
        result = self._q(
            "MATCH (t:Task)-[:TOUCHES]->(f:File) "
            "WHERE f.id IN $file_ids AND t.project_id = $project_id "
            "RETURN DISTINCT t.id LIMIT 10",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            tasks = [row[0] for row in result.result_set if row[0]]

        # Requirements that link to tasks touching these files
        result = self._q(
            "MATCH (r:Req)-[:IMPLEMENTED_BY]->(t:Task)-[:TOUCHES]->(f:File) "
            "WHERE f.id IN $file_ids AND r.project_id = $project_id "
            "RETURN DISTINCT r.text LIMIT 5",
            {"file_ids": file_ids, "project_id": project_id},
        )
        if result:
            reqs = [row[0][:100] for row in result.result_set if row[0]]

        return BlastRadius(
            changed_files=changed_files,
            affected_callers=callers,
            affected_tests=tests,
            affected_tasks=tasks,
            affected_requirements=reqs,
        )

    def get_requirement_trace(
        self,
        project_id: str,
        requirement_id: str,
    ) -> list[str]:
        if not self._available:
            return []
        result = self._q(
            "MATCH (r:Req {id: $req_id})-[:IMPLEMENTED_BY]->(t:Task)-[:TOUCHES]->(f:File) "
            "RETURN DISTINCT t.id AS task_id, f.path AS path",
            {"req_id": requirement_id},
        )
        if not result:
            return []
        return [f"{row[0]} → {row[1]}" for row in result.result_set if row[0] and row[1]]

    def get_revisit_memory(
        self,
        project_id: str,
        file_paths: list[str],
    ) -> list[RevisitMemory]:
        if not self._available or not file_paths:
            return []

        memories: list[RevisitMemory] = []
        for path in file_paths:
            result = self._q(
                "MATCH (a:Attempt)-[:ON_FILE]->(f:File {id: $file_id}) "
                "WHERE a.project_id = $project_id "
                "RETURN a.task_id, a.phase, a.success, a.summary, a.ts "
                "ORDER BY a.ts DESC LIMIT 5",
                {"file_id": f"{project_id}::{path}", "project_id": project_id},
            )
            if result and result.result_set:
                attempts = [
                    {
                        "task_id": row[0],
                        "phase": row[1],
                        "success": bool(row[2]),
                        "summary": row[3] or "",
                    }
                    for row in result.result_set
                ]
                memories.append(RevisitMemory(file_path=path, past_attempts=attempts))
        return memories
