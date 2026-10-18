"""
Graph factory — returns a connected GraphBackend singleton.

This is the ONLY place that imports a concrete backend class.
Swap `_BACKEND_CLASS` here when replacing FalkorDB.

Supported env vars:
  KARKHANA_GRAPH_HOST     FalkorDB host (default: localhost)
  KARKHANA_GRAPH_PORT     FalkorDB port (default: 6379)
  KARKHANA_GRAPH_NAME     Graph name   (default: karkhana)
  KARKHANA_GRAPH_DISABLED Set to "1" to disable graph features entirely
                          (useful in CI or when FalkorDB is not running)
"""

from __future__ import annotations

import logging
import os

from app.graph.base import GraphBackend

logger = logging.getLogger(__name__)

# ── Swap this import to change the backend ────────────────────────────────────
# Current: FalkorDB (SSPL v1) — fine for hackathon / internal use.
# Future options (see docs/FALKORDB.md):
#   from app.graph.kuzu_backend   import KuzuBackend   as _BACKEND_CLASS
#   from app.graph.neo4j_backend  import Neo4jBackend  as _BACKEND_CLASS
#   from app.graph.null_backend   import NullBackend   as _BACKEND_CLASS
from app.graph.falkordb_backend import FalkorDBBackend as _BACKEND_CLASS
# ─────────────────────────────────────────────────────────────────────────────

_instance: GraphBackend | None = None


def get_graph() -> GraphBackend:
    """Return the connected graph backend singleton.

    If KARKHANA_GRAPH_DISABLED=1 or the backend fails to connect, a
    NullBackend is returned — all its methods are safe no-ops.
    """
    global _instance
    if _instance is not None:
        return _instance

    if os.environ.get("KARKHANA_GRAPH_DISABLED", "0") == "1":
        from app.graph.null_backend import NullBackend
        _instance = NullBackend()
        return _instance

    host = os.environ.get("KARKHANA_GRAPH_HOST", "localhost")
    port = int(os.environ.get("KARKHANA_GRAPH_PORT", "6379"))
    name = os.environ.get("KARKHANA_GRAPH_NAME", "karkhana")

    backend = _BACKEND_CLASS(host=host, port=port, graph_name=name)  # type: ignore[call-arg]
    backend.connect()

    if not backend.is_available():
        logger.warning(
            "[graph] Backend unavailable — falling back to NullBackend. "
            "Graph features (context scoping, conflict detection, blast radius) disabled."
        )
        from app.graph.null_backend import NullBackend
        _instance = NullBackend()
    else:
        _instance = backend

    return _instance


def reset_graph() -> None:
    """Reset the singleton. Used in tests."""
    global _instance
    if _instance is not None:
        _instance.close()
    _instance = None
