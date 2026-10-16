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


"""Hourly purge of chat older than ``CHAT_RETENTION_DAYS`` (migration 023).

Every API instance runs the loop; the DELETE is idempotent, so overlap is harmless.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app import db
from app.config import get_settings

logger = logging.getLogger(__name__)

PURGE_EVERY_SEC = 3600


async def purge_once() -> int:
    """Deletes expired chat messages; returns how many were removed."""
    async with db.sessionmaker()() as session:
        removed = (
            await session.execute(
                text("SELECT purge_expired_chat(:days)"),
                {"days": get_settings().chat_retention_days},
            )
        ).scalar_one()
        await session.commit()
    if removed:
        logger.info("Chat retention: purged %d messages", removed)
    return int(removed or 0)


async def run_forever() -> None:
    """Purges on startup and then every hour until cancelled."""
    while True:
        try:
            await purge_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Missing migration or DB down: try again next round.
            logger.warning("Chat retention purge failed", exc_info=True)
        await asyncio.sleep(PURGE_EVERY_SEC)
