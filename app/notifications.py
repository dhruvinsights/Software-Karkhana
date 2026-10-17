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

"""Email for workflow gates: someone must act (review, approve, sign off).

The in-app activity feed is the record; email only tells people to look. A
failed send is logged and never fails the request that triggered it.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Iterable
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.email import send_email
from app.models import User

logger = logging.getLogger(__name__)


def _html(heading: str, lines: Iterable[str], link: str) -> str:
    body = "".join(f'<p style="margin:0 0 12px;line-height:1.55">{escape(line)}</p>' for line in lines)
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:28px;color:#14161c">'
        '<p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#0b5cff;font-weight:bold">'
        "Software Karkhana</p>"
        f'<h2 style="margin:0 0 16px;font-size:20px">{escape(heading)}</h2>{body}'
        f'<p style="margin:22px 0 0"><a href="{escape(link)}" style="display:inline-block;padding:11px 20px;'
        'background:#0b5cff;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">'
        "Open Software Karkhana</a></p></div>"
    )


async def email_people(
    session: AsyncSession,
    user_ids: Iterable[uuid.UUID | None],
    *,
    subject: str,
    heading: str,
    lines: Iterable[str],
) -> int:
    """Emails each user once. Returns how many sends Resend accepted."""
    ids = {u for u in user_ids if u}
    if not ids:
        return 0
    emails = (await session.scalars(select(User.email).where(User.id.in_(ids)))).all()
    s = get_settings()
    html = _html(heading, list(lines), s.app_url or s.public_base_url)
    sent = 0
    for to in emails:
        try:
            if await asyncio.to_thread(send_email, to=to, subject=subject, html=html):
                sent += 1
        except Exception:
            logger.warning("Notification email to %s failed", to, exc_info=True)
    return sent
