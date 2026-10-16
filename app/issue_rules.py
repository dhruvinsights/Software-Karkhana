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

"""Rules for issues and bugs: who may assign, edit and close them.

Pure functions, unit-tested. The principle: anyone on the team can raise an
issue and take work for themselves; handing work to someone else, or changing
somebody else's issue, needs a lead.
"""

from __future__ import annotations

import uuid

TYPES = ("story", "bug", "task", "chore", "security")
PRIORITIES = ("P0", "P1", "P2", "P3")
STATUSES = ("todo", "in_progress", "in_review", "done", "wont_fix")
SOURCES = ("manual", "qa", "security", "ci", "review")
CLOSED = frozenset({"done", "wont_fix"})


def key(number: int) -> str:
    """The human id shown in the UI and in commit messages."""
    return f"ISS-{number}"


def can_assign(
    *,
    actor_id: uuid.UUID,
    assignee_id: uuid.UUID | None,
    actor_is_lead: bool,
) -> tuple[bool, str]:
    """Leads (project lead, manager, station lead) assign anyone; others only themselves."""
    if actor_is_lead:
        return True, ""
    if assignee_id is None or assignee_id == actor_id:
        return True, ""
    return False, "Only a lead can assign work to someone else. You can assign it to yourself."


def can_modify(
    *,
    actor_id: uuid.UUID,
    reporter_id: uuid.UUID,
    assignee_id: uuid.UUID | None,
    actor_is_lead: bool,
) -> bool:
    """The reporter, the assignee or a lead may edit an issue or move it along."""
    return actor_is_lead or actor_id in (reporter_id, assignee_id)


def validate(*, type_: str | None = None, priority: str | None = None, status: str | None = None) -> str | None:
    """A message if any given value is not allowed, else ``None``."""
    if type_ is not None and type_ not in TYPES:
        return f"type must be one of: {', '.join(TYPES)}"
    if priority is not None and priority not in PRIORITIES:
        return f"priority must be one of: {', '.join(PRIORITIES)}"
    if status is not None and status not in STATUSES:
        return f"status must be one of: {', '.join(STATUSES)}"
    return None
