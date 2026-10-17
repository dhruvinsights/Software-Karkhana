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

"""The part of the approved design each story needs.

The Design station's spec cites story keys on every screen and API contract.
The Developer station's Frontend workspace shows each story with its slice,
and a coding run for that story gets the same slice as context, so the agent
builds to the designer's screens and contracts.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ProjectDocument

# Prototype HTML is large; a run gets at most this much of it per story.
_HTML_BUDGET = 12_000


async def latest_design(
    session: AsyncSession, project_id: uuid.UUID
) -> ProjectDocument | None:
    """The newest design version (approved or not)."""
    return await session.scalar(
        select(ProjectDocument)
        .where(
            ProjectDocument.project_id == project_id, ProjectDocument.kind == "design"
        )
        .order_by(ProjectDocument.version.desc())
        .limit(1)
    )


def slice_for(spec: dict[str, Any], story_key: str) -> dict[str, Any]:
    """Screens and API contracts that cite ``story_key``."""
    return {
        "screens": [
            s for s in spec.get("screens", []) if story_key in s.get("story_keys", [])
        ],
        "contracts": [
            c
            for c in spec.get("api_contracts", [])
            if story_key in c.get("story_keys", [])
        ],
    }


def keys_with_screens(spec: dict[str, Any]) -> set[str]:
    """Stories a screen was designed for: frontend work, whatever their layer says."""
    return {k for s in spec.get("screens", []) for k in s.get("story_keys", [])}


def as_note(spec: dict[str, Any], story_key: str, version: int) -> str | None:
    """The slice as text for a coding run, or ``None`` when the design does not cite the story."""
    part = slice_for(spec, story_key)
    if not part["screens"] and not part["contracts"]:
        return None
    lines = [
        f"Approved design v{version} for {story_key}. Build to it; do not change contracts silently."
    ]
    for c in part["contracts"]:
        lines.append(
            f"API {c['method']} {c['path']}: {c['summary']}\n"
            f"  request: {c.get('request_example') or '(none)'}\n  response: {c.get('response_example')}\n"
            f"  errors: {'; '.join(c.get('errors', [])) or 'none'}"
        )
    budget = _HTML_BUDGET
    for s in part["screens"]:
        html = s.get("html", "")
        shown = html[:budget]
        budget -= len(shown)
        lines.append(
            f"SCREEN {s['name']}: {s['purpose']}\n  states: {', '.join(s.get('states', []))}\n"
            f"  prototype HTML{' (truncated)' if len(shown) < len(html) else ''}:\n{shown}"
        )
    tokens = spec.get("tokens") or []
    if tokens and part["screens"]:
        lines.append(
            "Design tokens: " + json.dumps({t["name"]: t["value"] for t in tokens})
        )
    if spec.get("accessibility") and part["screens"]:
        lines.append("Accessibility: " + "; ".join(spec["accessibility"]))
    return "\n\n".join(lines)
