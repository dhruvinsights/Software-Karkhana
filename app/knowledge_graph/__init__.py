# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Knowledge graph (FalkorDB): a derived, rebuildable projection of Postgres.

Like ``agent_memory``, it is a helper and never a gate: every public call here
returns an empty result when the graph is off or fails.
"""

from __future__ import annotations

import logging
import uuid

from app.knowledge_graph import client, queries

logger = logging.getLogger(__name__)


async def task_context_notes(
    workspace_id: uuid.UUID | None, task_id: uuid.UUID, task_text: str
) -> list[tuple[str, str]]:
    """(title, body) notes for the coder: governing ADRs, open findings, lessons, bugs."""
    if not client.enabled():
        return []
    try:
        from app.ai import llm

        try:
            vec = await llm.embed(task_text, task_type="RETRIEVAL_QUERY")
        except Exception:
            vec = None
        ctx = await queries.agent_context(
            client.graph(client.graph_name(workspace_id)), str(task_id), vec, llm.embed_model_name()
        )
    except Exception as exc:
        logger.warning("Knowledge graph context skipped: %s", exc)
        return []
    notes = [
        (f"ADR-{a['number']} ({a['status']})", f"{a['title']} [governs {a['via']}]")
        for a in ctx["adrs"]
    ]
    notes += [(f"Open {sev} finding on {comp}", title) for title, sev, comp in ctx["open_findings"]]
    notes += [("Verified lesson", t) for t in ctx["lessons"][:5]]
    notes += [(f"Open bug #{n}", t) for n, t in ctx["open_bugs"]]
    return notes
