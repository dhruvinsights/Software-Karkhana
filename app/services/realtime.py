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


"""WebSocket hub shared by routers and agents.

Routers may not import each other, so the connection registry and the
``notify_*`` helpers live here instead of in ``app.routers.chat``.

Each instance holds its own sockets. With ``REALTIME_BROKER_URL`` set (Kafka
or Redis, via the OSS ``broadcaster`` library), every outgoing frame is
published to one topic and each instance delivers it to the sockets it holds,
so users on different instances see each other. Unset: delivered in-process.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

from broadcaster import Broadcast
from fastapi import WebSocket

from app.config import get_settings

logger = logging.getLogger(__name__)


class Conn:
    """Wraps a WebSocket with metadata."""

    def __init__(self, ws: WebSocket, user_id: str, workspace_id: str, display_name: str):
        self.ws = ws
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.display_name = display_name

    async def send(self, data: dict[str, Any]) -> None:
        """Send a JSON frame, ignoring a dead socket."""
        try:
            await self.ws.send_json(data)
        except Exception:
            # stale connection — will be removed on disconnect
            logger.debug("WS send failed for %s", self.user_id, exc_info=True)


class ConnectionManager:
    """Manages all active WebSocket connections, keyed by workspace."""

    def __init__(self) -> None:
        # workspace_id → list[Conn]
        self._rooms: dict[str, list[Conn]] = defaultdict(list)
        self._broker: Broadcast | None = None
        self._topic = ""
        self._consumer: asyncio.Task[None] | None = None

    def connect(self, conn: Conn) -> None:
        """Register a connection in its workspace room."""
        self._rooms[conn.workspace_id].append(conn)
        logger.info("WS connected: %s in workspace %s", conn.user_id, conn.workspace_id)

    def disconnect(self, conn: Conn) -> None:
        """Remove a connection from its workspace room, if present."""
        room = self._rooms.get(conn.workspace_id, [])
        if conn in room:
            room.remove(conn)
        logger.info("WS disconnected: %s", conn.user_id)

    async def broadcast(self, workspace_id: str, frame: dict[str, Any], exclude_user: str | None = None) -> None:
        """Send a frame to all connections in a workspace."""
        await self.deliver(workspace_id, None, frame, exclude_user)

    async def send_to_user(self, workspace_id: str, user_id: str, frame: dict[str, Any]) -> None:
        """Send a frame to a specific user (all their tabs)."""
        await self.send_to_users(workspace_id, {user_id}, frame)

    async def send_to_users(
        self, workspace_id: str, user_ids: set[str], frame: dict[str, Any], exclude_user: str | None = None
    ) -> None:
        """Send a frame to the listed users' open tabs in a workspace."""
        await self.deliver(workspace_id, user_ids, frame, exclude_user)

    async def deliver(
        self, workspace_id: str, audience: set[str] | None, frame: dict[str, Any], exclude_user: str | None = None
    ) -> None:
        """``audience`` None means every member of the workspace."""
        if self._broker is not None:
            envelope = {
                "w": workspace_id,
                "a": sorted(audience) if audience is not None else None,
                "x": exclude_user,
                "f": frame,
            }
            try:
                await self._broker.publish(channel=self._topic, message=json.dumps(envelope, default=str))
                return
            except Exception:
                # Broker down: at least reach the sockets on this instance.
                logger.warning("Realtime broker publish failed; delivering locally", exc_info=True)
        await self._deliver_local(workspace_id, audience, frame, exclude_user)

    async def _deliver_local(
        self, workspace_id: str, audience: set[str] | None, frame: dict[str, Any], exclude_user: str | None
    ) -> None:
        for conn in list(self._rooms.get(workspace_id, [])):
            if conn.user_id == exclude_user:
                continue
            if audience is None or conn.user_id in audience:
                await conn.send(frame)

    # ── Broker (cross-instance fan-out) ──────────────────────────────────────

    async def start_broker(self) -> None:
        """Connects to ``REALTIME_BROKER_URL`` if set; no-op otherwise."""
        settings = get_settings()
        if not settings.realtime_broker_url:
            return
        broker = Broadcast(settings.realtime_broker_url)
        await broker.connect()
        self._broker, self._topic = broker, settings.realtime_topic
        ready = asyncio.Event()
        self._consumer = asyncio.create_task(self._consume(ready))
        await ready.wait()
        logger.info("Realtime broker connected: topic %s", self._topic)

    async def stop_broker(self) -> None:
        """Stops the consumer and disconnects from the broker."""
        if self._consumer:
            self._consumer.cancel()
            await asyncio.gather(self._consumer, return_exceptions=True)
        if self._broker:
            await self._broker.disconnect()
        self._broker = self._consumer = None

    async def _consume(self, ready: asyncio.Event) -> None:
        assert self._broker is not None
        async with self._broker.subscribe(channel=self._topic) as subscriber:
            ready.set()
            async for event in subscriber:
                try:
                    env = json.loads(event.message)
                    audience = set(env["a"]) if env["a"] is not None else None
                    await self._deliver_local(env["w"], audience, env["f"], env["x"])
                except Exception:
                    logger.warning("Bad realtime envelope dropped", exc_info=True)

    def online_users(self, workspace_id: str) -> list[str]:
        """Return the distinct user ids currently connected to a workspace."""
        return list({c.user_id for c in self._rooms.get(workspace_id, [])})


manager = ConnectionManager()


async def notify_activity(workspace_id: uuid.UUID | str, user_ids: list[uuid.UUID] | set[str] | list[str]) -> None:
    """Tells these users' open tabs that they have new activity (mention, review request...).

    Call after the ActivityEvent rows are committed; clients refetch their feed.
    """
    ids = {str(u) for u in user_ids}
    if ids:
        await manager.send_to_users(str(workspace_id), ids, {"type": "activity"})


async def notify_workspace(workspace_id: uuid.UUID | str, scope: str) -> None:
    """Tells every open tab in the workspace that ``scope`` changed so it re-syncs.

    Scopes: projects, products, members. The frame carries no data; clients
    refetch through the normal access-checked endpoints.
    """
    await manager.broadcast(str(workspace_id), {"type": "workspace_sync", "scope": scope})
