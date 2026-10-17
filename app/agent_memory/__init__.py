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

"""Per-project, per-role agent memory backed by mem0 (``third_party/mem0``).

mem0 runs in its own virtualenv (``scripts/setup_mem0.sh``) behind a tiny JSON
CLI, the same isolation pr-agent uses, so its dependency set never touches the
API's. Memory is a helper, never a gate: every call here swallows failures and
returns an empty result, so a missing venv or a slow model cannot fail a run.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

_CLI = Path(__file__).resolve().parents[2] / "scripts" / "mem0_cli.py"
_LOCK = asyncio.Lock()  # The local file store allows one writer at a time.


def enabled() -> bool:
    """True when a mem0 interpreter is configured and exists."""
    py = get_settings().mem0_python
    return bool(py) and Path(py).exists()


async def _call(payload: dict[str, Any], timeout: float) -> dict[str, Any]:  # noqa: ASYNC109
    s = get_settings()
    payload["config"] = {
        "ollama_url": s.ollama_base_url,
        "llm_model": s.ollama_model,
        "embed_model": s.ollama_embed_model,
        "store": s.mem0_store,
        "path": s.mem0_path,
        "dsn": s.mem0_dsn,
    }
    async with _LOCK:
        proc = await asyncio.create_subprocess_exec(
            s.mem0_python or sys.executable,
            str(_CLI),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            out, _ = await asyncio.wait_for(
                proc.communicate(json.dumps(payload).encode()), timeout
            )
        except TimeoutError:
            proc.kill()
            raise
    return json.loads(out.decode().strip().splitlines()[-1])


def scope(project_id: object, role: str) -> dict[str, str]:
    """mem0 identity: one project, one agent role."""
    return {"user_id": str(project_id), "agent_id": role}


async def remember(project_id: object, role: str, text: str) -> list[str]:
    """Stores what an agent learned. Returns the extracted facts; ``[]`` on any failure."""
    if not enabled() or not text.strip():
        return []
    try:
        res = await _call(
            {"op": "add", "text": text[:8000], **scope(project_id, role)}, timeout=180
        )
        return [r["memory"] for r in res.get("results", []) if r.get("memory")]
    except Exception as exc:
        logger.warning("mem0 remember skipped: %s", exc)
        return []


async def recall(
    project_id: object, query: str, *, role: str | None = None, limit: int = 5
) -> list[str]:
    """Facts relevant to ``query`` for this project (and role, when given)."""
    if not enabled() or not query.strip():
        return []
    try:
        res = await _call(
            {
                "op": "search",
                "query": query[:2000],
                "limit": limit,
                "user_id": str(project_id),
                "agent_id": role,
            },
            timeout=60,
        )
        return [r["memory"] for r in res.get("results", []) if r.get("memory")]
    except Exception as exc:
        logger.warning("mem0 recall skipped: %s", exc)
        return []
