"""parallel_planner.py — Independence analysis before launching parallel agent runs.

The claim Karkhana makes: parallel agents are only launched when the tasks are
genuinely independent. This module answers the question before any build starts.

UC-2 (FalkorDB): when the graph is available, ``enrich_from_graph`` augments
each StoryMeta with historically-touched file paths before ``analyse`` runs.
This catches conflicts that are invisible from focus_paths alone (e.g. a story
that touched ``app/auth/service.py`` last time, even though that path isn't
explicitly set in its brief this time).
"""
from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class StoryMeta:
    """Minimal story info needed for the independence check."""
    id: str
    focus_paths: list[str] = field(default_factory=list)
    recent_diff_paths: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)      # ids this story blocks
    blocked_by: list[str] = field(default_factory=list)  # ids blocking this story


@dataclass
class ConflictEdge:
    """Two stories that may collide, with why and how likely."""

    a: str
    b: str
    reason: str
    risk: float  # 0.0 = safe, 1.0 = must serialize


@dataclass
class ParallelPlan:
    """Stories split into groups that can run side by side."""

    groups: list[list[str]]   # each group is safe to run in parallel
    conflicts: list[ConflictEdge]
    max_risk: float
    ok_to_parallelize: bool   # False when any conflict has risk >= HARD_BLOCK


HARD_BLOCK = 0.8   # risk above this: refuse to run in parallel


def _paths_for(story: StoryMeta) -> set[str]:
    """Return the set of relevant paths for a story (focus paths preferred, else diff)."""
    paths = story.focus_paths or story.recent_diff_paths
    # normalise: strip leading ./ and trailing /
    return {re.sub(r'^\./', '', p).rstrip('/') for p in paths if p}


def _path_overlap(a: set[str], b: set[str]) -> float:
    """Returns a 0-1 overlap score.

    Exact match = 1.0; prefix containment (one path is ancestor of another) = 0.7;
    same top-level directory = 0.3; no overlap = 0.0.
    """
    if not a or not b:
        return 0.0

    # exact overlap
    exact = a & b
    if exact:
        return 1.0

    # prefix containment
    for pa in a:
        for pb in b:
            if pa.startswith(pb + '/') or pb.startswith(pa + '/'):
                return 0.7

    # same top-level dir
    tops_a = {p.split('/')[0] for p in a}
    tops_b = {p.split('/')[0] for p in b}
    if tops_a & tops_b:
        return 0.3

    return 0.0


def _dependency_risk(a: StoryMeta, b: StoryMeta) -> float:
    """Returns 1.0 if there is a hard dependency edge between the two stories."""
    if b.id in a.blocks or a.id in b.blocks:
        return 1.0
    if b.id in a.blocked_by or a.id in b.blocked_by:
        return 1.0
    return 0.0


def analyse(stories: Sequence[StoryMeta]) -> ParallelPlan:
    """Analyse a set of stories and return a ParallelPlan.

    Usage::

        plan = analyse([
            StoryMeta(id="STORY-1", focus_paths=["web/src/auth"]),
            StoryMeta(id="STORY-2", focus_paths=["web/src/billing"]),
            StoryMeta(id="STORY-3", focus_paths=["web/src/auth/login.ts"]),
        ])
        # STORY-1 and STORY-3 will conflict (path overlap);
        # STORY-1 and STORY-2 are safe.
    """
    story_paths = {s.id: _paths_for(s) for s in stories}
    conflicts: list[ConflictEdge] = []

    story_list = list(stories)
    for i in range(len(story_list)):
        for j in range(i + 1, len(story_list)):
            a, b = story_list[i], story_list[j]
            dep_risk = _dependency_risk(a, b)
            path_risk = _path_overlap(story_paths[a.id], story_paths[b.id])
            risk = max(dep_risk, path_risk)
            if risk > 0:
                reason = (
                    "hard dependency" if dep_risk >= 1.0
                    else "exact path overlap" if path_risk >= 1.0
                    else "path prefix overlap" if path_risk >= 0.7
                    else "same top-level directory"
                )
                conflicts.append(ConflictEdge(a=a.id, b=b.id, reason=reason, risk=risk))

    # Build groups: greedy — add story to first group it doesn't conflict with
    conflict_pairs = {(c.a, c.b) for c in conflicts if c.risk >= HARD_BLOCK}
    conflict_pairs |= {(b, a) for a, b in conflict_pairs}

    groups: list[list[str]] = []
    for story in story_list:
        placed = False
        for group in groups:
            safe = all((story.id, other) not in conflict_pairs for other in group)
            if safe:
                group.append(story.id)
                placed = True
                break
        if not placed:
            groups.append([story.id])

    max_risk = max((c.risk for c in conflicts), default=0.0)
    ok = max_risk < HARD_BLOCK

    return ParallelPlan(groups=groups, conflicts=conflicts, max_risk=max_risk, ok_to_parallelize=ok)


def enrich_from_graph(project_id: str, stories: list[StoryMeta]) -> list[StoryMeta]:
    """UC-2: Augment StoryMeta focus_paths with historically-touched files from the graph.

    If FalkorDB is unavailable (NullBackend) this is a no-op and stories are
    returned unchanged — the existing Python path-overlap logic still runs.

    Call this before ``analyse()`` to get graph-aware conflict detection:

        enriched = enrich_from_graph(project_id, stories)
        plan = analyse(enriched)
    """
    try:
        from app.graph import get_graph
        g = get_graph()
        if not g.is_available():
            return stories

        enriched: list[StoryMeta] = []
        for story in stories:
            # Query graph for files this task has previously touched
            # Collect all paths known from graph TOUCHES edges for this story
            historical: list[str] = []
            try:
                from app.graph.falkordb_backend import FalkorDBBackend
                if isinstance(g, FalkorDBBackend):
                    res = g._q(
                        "MATCH (t:Task {id: $tid})-[:TOUCHES]->(f:File) "
                        "WHERE t.project_id = $pid "
                        "RETURN f.path",
                        {"tid": story.id, "pid": project_id},
                    )
                    if res:
                        historical = [row[0] for row in res.result_set if row[0]]
            except Exception:  # noqa: S110 - the graph is optional; fall back to focus paths
                pass

            if historical:
                merged = list(dict.fromkeys(story.focus_paths + historical))
                enriched.append(StoryMeta(
                    id=story.id,
                    focus_paths=merged,
                    recent_diff_paths=story.recent_diff_paths,
                    blocks=story.blocks,
                    blocked_by=story.blocked_by,
                ))
            else:
                enriched.append(story)

        logger.debug("[graph] enrich_from_graph: enriched %d stories for project %s", len(enriched), project_id)
        return enriched

    except Exception as exc:
        logger.debug("[graph] enrich_from_graph skipped: %s", exc)
        return stories
