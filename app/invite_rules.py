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

"""Rules for invitations: who may invite as what, and when a link still works.

Pure functions (no database), unit-tested; the router only applies them.
"""

from __future__ import annotations

import datetime as dt
import secrets

from app.idea_flow import MANAGER_ROLES
from app.process import Role

INVITE_TTL = dt.timedelta(days=14)
VALID_ROLES = frozenset(r.value for r in Role)
ADMIN_ROLES = MANAGER_ROLES | {"admin"}


def new_token() -> str:
    """An unguessable, URL-safe token (192 bits)."""
    return "inv_" + secrets.token_urlsafe(24)


def can_invite_role(*, inviter_role: str, inviter_is_owner: bool, target_role: str) -> tuple[bool, str]:
    """Whether the inviter may hand out ``target_role``.

    Owners and manager roles can invite any valid role. Everyone else can only
    grow their own team: invite people into the role they hold themselves. This
    stops a developer minting an executive.
    """
    if target_role not in VALID_ROLES:
        return False, f"Unknown role: {target_role}."
    if inviter_is_owner or inviter_role in ADMIN_ROLES:
        return True, ""
    if target_role == inviter_role:
        return True, ""
    return False, f"A {inviter_role} can only invite other {inviter_role} members."


def email_matches(invite_email: str | None, user_email: str) -> bool:
    """An invite sent to an address can only be accepted by that address."""
    return invite_email is None or invite_email.strip().lower() == user_email.strip().lower()


def is_usable(*, status: str, expires_at: dt.datetime | None, now: dt.datetime) -> tuple[bool, str]:
    """Whether the invite can still be accepted, with a user-facing reason if not."""
    if status == "accepted":
        return False, "This invitation has already been used."
    if status == "revoked":
        return False, "This invitation was cancelled."
    if status != "pending":
        return False, "This invitation is no longer valid."
    if expires_at is not None and expires_at <= now:
        return False, "This invitation has expired. Ask for a new one."
    return True, ""


def is_single_use(invite_email: str | None) -> bool:
    """Invites addressed to a person are single-use; open links stay reusable until expiry."""
    return invite_email is not None
