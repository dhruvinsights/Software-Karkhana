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

"""Google Chat incoming-webhook notifications (feature C4).

Best effort: a failed notification is logged and never fails the request.
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def notify(text: str) -> None:
    """Posts a plain-text message to the configured Google Chat space."""
    url = get_settings().google_chat_webhook_url
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=5) as http:
            r = await http.post(url, json={"text": text})
            r.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Google Chat notification failed: %s", exc)
