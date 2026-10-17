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
"""FalkorDB connection, one graph per workspace, and index setup.

The graph is never the record. Postgres is; this is a projection that can be
dropped and rebuilt from it at any time (``python -m app.knowledge_graph rebuild``).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)

META_GRAPH = "kg_meta"
PLATFORM = "platform"

# Labels that carry an ``id`` property and get an exact-match index.
LABELS = (
    "Product", "Project", "Epic", "Task", "Run", "PR", "ADR",
    "Component", "Issue", "Finding", "Learning", "Scenario",
)
VECTOR_LABELS = ("ADR", "Learning")


class Graph(Protocol):
    """The slice of the FalkorDB graph API this package uses (sync or async)."""

    async def query(self, q: str, params: dict[str, Any] | None = None) -> Any:  # noqa: D102
        ...


def enabled() -> bool:
    """True when a FalkorDB URL is configured."""
    return bool(get_settings().falkordb_url)


def graph_name(workspace_id: uuid.UUID | str | None) -> str:
    """Tenant boundary: one graph per workspace, mirroring the ledger chains."""
    return f"kg_{workspace_id}" if workspace_id else f"kg_{PLATFORM}"


_db: Any = None


def _client() -> Any:
    global _db
    if _db is None:
        from falkordb.asyncio import FalkorDB

        _db = FalkorDB.from_url(get_settings().falkordb_url)
    return _db


def set_client(db: Any) -> None:
    """Injects a client (tests use an embedded FalkorDBLite)."""
    global _db
    _db = db
    _ready.clear()


def graph(name: str) -> Graph:
    """Returns the named graph."""
    return _client().select_graph(name)


_ready: set[str] = set()


async def ensure_schema(g: Graph, name: str) -> None:
    """Creates indexes once per process per graph. Safe to repeat."""
    if name in _ready:
        return
    dim = get_settings().embedding_dim
    stmts = [f"CREATE INDEX FOR (n:{lbl}) ON (n.id)" for lbl in LABELS]
    stmts += [f"CREATE INDEX FOR (n:{lbl}) ON (n.project_id)" for lbl in LABELS]
    stmts += [
        f"CREATE VECTOR INDEX FOR (n:{lbl}) ON (n.embedding) "
        f"OPTIONS {{dimension:{dim}, similarityFunction:'cosine'}}"
        for lbl in VECTOR_LABELS
    ]
    for s in stmts:
        try:
            await g.query(s)
        except Exception as exc:
            if "already" not in str(exc).lower():
                raise
    _ready.add(name)


async def close() -> None:
    """Closes the client on shutdown."""
    global _db
    if _db is not None and hasattr(_db, "aclose"):
        await _db.aclose()
    _db = None
    _ready.clear()
