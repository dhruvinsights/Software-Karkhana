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
"""Transactional email via Resend.

Usage::

    from app.email import send_email

    await send_email(
        to="user@example.com",
        subject="Welcome to Software Karkhana",
        html="<p>Your account is ready.</p>",
    )

The ``RESEND_API_KEY`` must be set (in ``.env`` locally, or via Secret Manager
on Cloud Run). Calls are no-ops when the key is absent so local dev and tests
that do not set the key keep working without needing to mock anything.
"""

from __future__ import annotations

import logging

import resend

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    from_address: str | None = None,
) -> dict | None:
    """Send a transactional email via Resend.

    Args:
        to: Recipient address or list of addresses.
        subject: Email subject line.
        html: HTML body of the email.
        from_address: Override the default sender. Falls back to
            ``settings.email_from`` when not provided.

    Returns:
        The Resend API response dict on success, or ``None`` when no API key
        is configured (local dev / CI without secrets).
    """
    settings = get_settings()

    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY is not set — skipping email to %s", to)
        return None

    resend.api_key = settings.resend_api_key

    params: resend.Emails.SendParams = {
        "from": from_address or settings.email_from,
        "to": [to] if isinstance(to, str) else to,
        "subject": subject,
        "html": html,
    }

    response = resend.Emails.send(params)
    logger.info("Email sent via Resend: id=%s to=%s", response.get("id"), to)
    return response
