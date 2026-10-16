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

"""One-time sign-in codes: generation, expiry, attempt limits and resend cooldown.

Pure logic with an injectable clock so every rule is unit-tested. Codes come
from ``secrets`` (not ``random``), are compared in constant time, die after
``MAX_ATTEMPTS`` wrong guesses, and can only be re-sent after ``RESEND_COOLDOWN``.

State is in process memory: correct for one instance. Run several instances
only after moving the store to the database or Redis.
"""

from __future__ import annotations

import hmac
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

TTL_SECONDS = 600
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = 60
MAX_ENTRIES = 10_000  # bounds memory under abuse


class OtpError(Exception):
    """A rejected code request; ``status`` is the HTTP status to return."""

    def __init__(self, message: str, status: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.retry_after = retry_after


@dataclass
class _Entry:
    code: str
    expires_at: float
    issued_at: float
    attempts: int = 0


class OtpStore:
    """Issues and verifies single-use codes keyed by email."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._entries: dict[str, _Entry] = {}

    def issue(self, email: str) -> str:
        """Creates a fresh 6-digit code.

        Raises:
            OtpError: 429 if a code was issued less than RESEND_COOLDOWN ago.
        """
        now = self._clock()
        self._evict(now)
        prior = self._entries.get(email)
        if prior and now - prior.issued_at < RESEND_COOLDOWN:
            wait = int(RESEND_COOLDOWN - (now - prior.issued_at)) + 1
            raise OtpError(f"Please wait {wait}s before requesting another code.", 429, wait)
        code = f"{secrets.randbelow(900_000) + 100_000}"
        self._entries[email] = _Entry(code, now + TTL_SECONDS, now)
        return code

    def verify(self, email: str, code: str) -> None:
        """Consumes the code on success.

        Raises:
            OtpError: If the code is missing, expired, wrong or locked out. The
                message never reveals which of those it was for an unknown email.
        """
        now = self._clock()
        entry = self._entries.get(email)
        generic = OtpError("Invalid or expired verification code.")
        if entry is None:
            raise generic
        if entry.expires_at <= now:
            del self._entries[email]
            raise generic
        if entry.attempts >= MAX_ATTEMPTS:
            raise OtpError("Too many attempts. Request a new code.", 429)
        if not hmac.compare_digest(entry.code.encode(), code.strip().encode()):
            entry.attempts += 1
            if entry.attempts >= MAX_ATTEMPTS:
                raise OtpError("Too many attempts. Request a new code.", 429)
            raise generic
        del self._entries[email]

    def _evict(self, now: float) -> None:
        for key in [k for k, e in self._entries.items() if e.expires_at <= now]:
            del self._entries[key]
        while len(self._entries) >= MAX_ENTRIES:
            self._entries.pop(next(iter(self._entries)))
