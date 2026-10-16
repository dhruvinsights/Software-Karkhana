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

"""Rules for the idea -> approval -> project flow.

Pure functions only (no database, no model), so every rule here is unit-tested
and the routers stay thin. The routers decide *what happened*; this module
decides *what is allowed* and *what the outcome is*.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"

# Idea statuses this flow owns.
IDEA_DRAFT = "draft"
IDEA_PENDING = "pending_approval"
IDEA_APPROVED = "approved"
IDEA_REJECTED = "rejected"
IDEA_PROMOTED = "promoted"

ALL_STATIONS: tuple[str, ...] = (
    "product",
    "design",
    "architecture",
    "developer",
    "qa",
    "devops",
    "security",
    "release",
)

# Which stations a role sees by default when enrolled on a project. A lead can
# narrow or widen this per person; it is a starting point, not a hard limit.
ROLE_STATIONS: dict[str, tuple[str, ...]] = {
    "pm": ALL_STATIONS,
    "product_manager": ALL_STATIONS,
    "lead": ALL_STATIONS,
    "director": ALL_STATIONS,
    "executive": ALL_STATIONS,
    "developer": ("product", "architecture", "developer", "qa"),
    "designer": ("product", "design", "architecture"),
    "architect": ("product", "design", "architecture", "developer", "security"),
    "qa": ("product", "developer", "qa"),
    "security": ("architecture", "developer", "security"),
    "devops": ("architecture", "developer", "devops", "release"),
    "release_manager": ("product", "qa", "devops", "security", "release"),
}

# Roles that run the business side of a product: they ask for approval, create
# projects from approved ideas and manage project membership.
MANAGER_ROLES = frozenset({"pm", "product_manager", "lead", "director", "executive"})

MAX_REVIEWERS = 10


def stations_for(role: str) -> list[str]:
    """Default stations for ``role``; unknown roles only see the product station."""
    return list(ROLE_STATIONS.get(role, ("product",)))


def tally(statuses: Iterable[str]) -> str:
    """The idea status implied by its reviewers' decisions.

    Every assigned reviewer must approve; one rejection stops the idea. No
    reviewers at all means the idea has not been put up for approval.
    """
    states = list(statuses)
    if not states:
        return IDEA_DRAFT
    if REJECTED in states:
        return IDEA_REJECTED
    if all(s == APPROVED for s in states):
        return IDEA_APPROVED
    return IDEA_PENDING


def can_request_approval(*, role: str, is_author: bool) -> bool:
    """The author or a manager role may put an idea up for approval."""
    return is_author or role in MANAGER_ROLES


def can_promote(role: str) -> bool:
    """Only manager roles turn an approved idea into a project."""
    return role in MANAGER_ROLES


def clean_reviewers(
    requester_id: uuid.UUID, reviewer_ids: Iterable[uuid.UUID]
) -> list[uuid.UUID]:
    """De-duplicates reviewers (keeping order) and enforces separation of duties.

    Raises:
        ValueError: If there is no reviewer, too many, or the requester is one.
    """
    seen: dict[uuid.UUID, None] = dict.fromkeys(reviewer_ids)
    ids = list(seen)
    if not ids:
        raise ValueError("Choose at least one reviewer.")
    if requester_id in seen:
        raise ValueError("You cannot be your own reviewer.")
    if len(ids) > MAX_REVIEWERS:
        raise ValueError(f"At most {MAX_REVIEWERS} reviewers.")
    return ids


def can_add_member(
    *,
    caller_role: str,
    caller_is_project_lead: bool,
    caller_member_is_lead: bool,
    caller_member_role: str | None,
    caller_stations: Iterable[str],
    new_role: str,
    new_stations: Iterable[str],
) -> tuple[bool, str]:
    """Whether the caller may add (or change) a project member.

    The project's own lead and manager roles can enrol anyone. A station lead
    (``is_lead`` member) can grow only their own team: the same role and no
    station they do not already have themselves. Everyone else cannot.
    """
    if caller_is_project_lead or caller_role in MANAGER_ROLES:
        return True, ""
    if caller_member_is_lead and caller_member_role:
        if new_role != caller_member_role:
            return (
                False,
                f"A {caller_member_role} lead can only add {caller_member_role} members.",
            )
        extra = set(new_stations) - set(caller_stations)
        if extra:
            return False, "You cannot grant access to: " + ", ".join(sorted(extra))
        return True, ""
    return False, "Only a project lead can add members."
