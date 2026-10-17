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

"""Who is accountable for what between the developer and QA.

Pure functions, unit-tested. Agents (coding, review, QA) only suggest; a person
confirms every step that moves work forward:

* The developer manually checks a finished story against every acceptance
  criterion before QA may sign it off.
* A QA bug goes to the story's developer. They mark it fixed only with a
  manual check of the fix; QA then verifies it or reopens it.
"""

from __future__ import annotations

import re
from typing import Any

MIN_NOTES = 10

# Bug issue status -> what the Developer and QA stations call it.
BUG_STATES = {
    "backlog": "new",
    "todo": "fixing",
    "ready": "fixing",
    "in_progress": "fixing",
    "in_review": "fixing",
    "ready_for_qa": "fixed",
    "in_qa": "fixed",
    "done": "verified",
    "wont_fix": "wont_fix",
}

LAYERS = ("backend", "frontend", "data", "test", "docs", "devops")
_LAYER_IN_TEXT = re.compile(r"·\s*(" + "|".join(LAYERS) + r")\s*·")


def bug_state(status: str, reopen_count: int) -> str:
    """New, reopened, fixing, fixed, verified or wont_fix."""
    state = BUG_STATES.get(status, "new")
    if state == "new" and reopen_count:
        return "reopened"
    return state


def layer_of(labels: list[str] | None, description: str = "") -> str | None:
    """The story's layer: its ``layer:<x>`` label, else the planner's description."""
    for label in labels or []:
        if label.startswith("layer:") and label[6:] in LAYERS:
            return label[6:]
    m = _LAYER_IN_TEXT.search(description or "")
    return m.group(1) if m else None


def check_problem(criteria: list[str], ticked: list[dict[str, Any]], notes: str) -> str | None:
    """Why a manual check is not acceptable yet, or ``None``.

    Every acceptance criterion must be listed and confirmed, and the notes must
    say what was actually tried.
    """
    if len((notes or "").strip()) < MIN_NOTES:
        return f"Write at least {MIN_NOTES} characters on what you tried by hand."
    confirmed = {str(t.get("text", "")).strip() for t in ticked if t.get("ok") is True}
    missing = [c for c in criteria if c.strip() not in confirmed]
    if missing:
        return f"{len(missing)} acceptance criteria are not confirmed: " + "; ".join(m[:60] for m in missing[:3])
    return None


def story_check_allowed(status: str) -> bool:
    """A story is checked once its code exists: in review, merged or with QA."""
    return status in ("in_progress", "in_review", "ready_for_qa", "in_qa")


def fix_allowed(status: str) -> bool:
    """A bug can be marked fixed while it is new, reopened or being fixed."""
    return BUG_STATES.get(status) in ("new", "fixing")


def verify_allowed(status: str) -> bool:
    """QA verifies only bugs the developer marked fixed."""
    return BUG_STATES.get(status) == "fixed"
