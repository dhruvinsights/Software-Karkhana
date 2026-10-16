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

"""Real-time chat: WebSocket hub + REST channel/message API.

Architecture
------------
* One WebSocket connection per user per workspace (browser tab).
* The ``ConnectionManager`` keeps an in-process registry keyed by
  (workspace_id, user_id).  When a message arrives it is:
    1. Persisted to PostgreSQL (chat_messages table).
    2. Broadcast to every active connection in the same workspace.
* Typing indicators and presence are ephemeral JSON frames sent over the
  WebSocket and never written to the DB.
* REST endpoints cover channel CRUD, message history, project comments,
  and the activity feed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, current_user, decode_token
from app.db import get_session, sessionmaker
from app.models import (
    ActivityEvent,
    ChatChannel,
    ChatChannelMember,
    ChatMessage,
    ChatReadCursor,
    ProjectComment,
    User,
    WorkspaceMember,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])
Session = Annotated[AsyncSession, Depends(get_session)]


# ── In-process connection hub ─────────────────────────────────────────────────

class _Conn:
    """Wraps a WebSocket with metadata."""

    def __init__(self, ws: WebSocket, user_id: str, workspace_id: str, display_name: str):
        self.ws = ws
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.display_name = display_name

    async def send(self, data: dict[str, Any]) -> None:
        try:
            await self.ws.send_json(data)
        except Exception:
            pass  # stale connection — will be removed on disconnect


class ConnectionManager:
    """Manages all active WebSocket connections, keyed by workspace."""

    def __init__(self) -> None:
        # workspace_id → list[_Conn]
        self._rooms: dict[str, list[_Conn]] = defaultdict(list)

    def connect(self, conn: _Conn) -> None:
        self._rooms[conn.workspace_id].append(conn)
        logger.info("WS connected: %s in workspace %s", conn.user_id, conn.workspace_id)

    def disconnect(self, conn: _Conn) -> None:
        room = self._rooms.get(conn.workspace_id, [])
        if conn in room:
            room.remove(conn)
        logger.info("WS disconnected: %s", conn.user_id)

    async def broadcast(self, workspace_id: str, frame: dict[str, Any], exclude_user: str | None = None) -> None:
        """Send a frame to all connections in a workspace."""
        for conn in list(self._rooms.get(workspace_id, [])):
            if exclude_user and conn.user_id == exclude_user:
                continue
            await conn.send(frame)

    async def send_to_user(self, workspace_id: str, user_id: str, frame: dict[str, Any]) -> None:
        """Send a frame to a specific user (all their tabs)."""
        for conn in list(self._rooms.get(workspace_id, [])):
            if conn.user_id == user_id:
                await conn.send(frame)

    def online_users(self, workspace_id: str) -> list[str]:
        return list({c.user_id for c in self._rooms.get(workspace_id, [])})


manager = ConnectionManager()


# ── Pydantic payloads ─────────────────────────────────────────────────────────

class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None


class DMCreate(BaseModel):
    target_user_id: uuid.UUID


class MessageSend(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[uuid.UUID] = Field(default_factory=list)


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[uuid.UUID] = Field(default_factory=list)


class ReadCursorUpdate(BaseModel):
    message_id: uuid.UUID


# ── Helpers ───────────────────────────────────────────────────────────────────

def _msg_dict(msg: ChatMessage, sender: User) -> dict[str, Any]:
    return {
        "id": str(msg.id),
        "channelId": str(msg.channel_id),
        "senderId": str(msg.sender_id),
        "senderName": sender.display_name,
        "senderAvatar": sender.avatar_url,
        "body": msg.body,
        "mentions": [str(m) for m in (msg.mentions or [])],
        "createdAt": msg.created_at.isoformat(),
        "editedAt": msg.edited_at.isoformat() if msg.edited_at else None,
    }


async def _get_workspace_id(user: User, session: AsyncSession) -> str:
    """Return the first workspace this user belongs to."""
    row = await session.scalar(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id).limit(1)
    )
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of any workspace")
    return str(row)


async def _assert_channel_access(
    channel_id: uuid.UUID, workspace_id: str, user_id: uuid.UUID, session: AsyncSession
) -> ChatChannel:
    ch = await session.get(ChatChannel, channel_id)
    if not ch or str(ch.workspace_id) != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    if ch.type == "dm":
        # DM: user must be a participant
        member = await session.scalar(
            select(ChatChannelMember).where(
                and_(ChatChannelMember.channel_id == channel_id, ChatChannelMember.user_id == user_id)
            )
        )
        if not member:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a participant of this DM")
    return ch


async def _write_activity(
    session: AsyncSession,
    workspace_id: str,
    actor_id: uuid.UUID,
    recipient_id: uuid.UUID | None,
    event_type: str,
    summary: str,
    target_type: str | None = None,
    target_id: str | None = None,
    project_id: uuid.UUID | None = None,
) -> None:
    ev = ActivityEvent(
        workspace_id=uuid.UUID(workspace_id),
        actor_id=actor_id,
        recipient_id=recipient_id,
        type=event_type,
        summary=summary,
        target_type=target_type,
        target_id=str(target_id) if target_id else None,
        project_id=project_id,
    )
    session.add(ev)
    # Non-blocking — caller commits the transaction


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws")
async def chat_ws(
    websocket: WebSocket,
    token: str = Query(...),
):
    """
    Connect with ?token=<jwt>.  Frames are JSON objects with a ``type`` field:

    Client → Server
    ---------------
    ``{"type":"message","channelId":"<uuid>","body":"...","mentions":[...]}``
    ``{"type":"typing","channelId":"<uuid>"}``
    ``{"type":"read","channelId":"<uuid>","messageId":"<uuid>"}``
    ``{"type":"ping"}``

    Server → Client
    ---------------
    ``{"type":"message", ...message fields}``
    ``{"type":"typing","channelId":"<uuid>","userId":"<uuid>","displayName":"..."}``
    ``{"type":"presence","onlineUsers":["<uuid>", ...]}``
    ``{"type":"pong"}``
    ``{"type":"error","detail":"..."}``
    """
    # Authenticate via JWT before accepting
    payload = decode_token(token)
    if not payload or not payload.get("email"):
        await websocket.close(code=4001)
        return

    await websocket.accept()

    async with sessionmaker()() as session:
        user = await session.scalar(select(User).where(User.email == payload["email"].lower()))
        if not user:
            await websocket.close(code=4003)
            return

        workspace_id = await _get_workspace_id(user, session)

    conn = _Conn(websocket, str(user.id), workspace_id, user.display_name)
    manager.connect(conn)

    # Announce presence to the workspace
    await manager.broadcast(workspace_id, {
        "type": "presence",
        "onlineUsers": manager.online_users(workspace_id),
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                await conn.send({"type": "error", "detail": "Invalid JSON"})
                continue

            ftype = frame.get("type")

            # ── ping ──────────────────────────────────────────────────────────
            if ftype == "ping":
                await conn.send({"type": "pong"})

            # ── message ───────────────────────────────────────────────────────
            elif ftype == "message":
                channel_id_str = frame.get("channelId", "")
                body = (frame.get("body") or "").strip()
                mentions_raw = frame.get("mentions", [])

                if not body or not channel_id_str:
                    await conn.send({"type": "error", "detail": "body and channelId required"})
                    continue

                try:
                    channel_id = uuid.UUID(channel_id_str)
                    mention_ids = [uuid.UUID(m) for m in mentions_raw if m]
                except ValueError:
                    await conn.send({"type": "error", "detail": "Invalid UUID"})
                    continue

                async with sessionmaker()() as session:
                    try:
                        await _assert_channel_access(channel_id, workspace_id, user.id, session)
                    except HTTPException as exc:
                        await conn.send({"type": "error", "detail": exc.detail})
                        continue

                    msg = ChatMessage(
                        channel_id=channel_id,
                        sender_id=user.id,
                        body=body,
                        mentions=[str(m) for m in mention_ids],
                    )
                    session.add(msg)

                    # Write activity events for every @mention
                    for mid in mention_ids:
                        await _write_activity(
                            session,
                            workspace_id,
                            actor_id=user.id,
                            recipient_id=mid,
                            event_type="mention",
                            summary=f"{user.display_name} mentioned you in a message",
                            target_type="channel",
                            target_id=str(channel_id),
                        )

                    await session.commit()
                    await session.refresh(msg)

                out_frame = {
                    "type": "message",
                    **_msg_dict(msg, user),
                }
                # Broadcast to entire workspace (both sender and others)
                await manager.broadcast(workspace_id, out_frame)

            # ── typing indicator (ephemeral, never persisted) ─────────────────
            elif ftype == "typing":
                channel_id_str = frame.get("channelId", "")
                await manager.broadcast(workspace_id, {
                    "type": "typing",
                    "channelId": channel_id_str,
                    "userId": str(user.id),
                    "displayName": user.display_name,
                }, exclude_user=str(user.id))

            # ── read cursor ───────────────────────────────────────────────────
            elif ftype == "read":
                channel_id_str = frame.get("channelId", "")
                message_id_str = frame.get("messageId", "")
                try:
                    channel_id = uuid.UUID(channel_id_str)
                    message_id = uuid.UUID(message_id_str)
                except ValueError:
                    continue

                async with sessionmaker()() as session:
                    cursor = await session.get(ChatReadCursor, (user.id, channel_id))
                    if cursor:
                        cursor.last_read_message_id = message_id
                    else:
                        session.add(ChatReadCursor(
                            user_id=user.id,
                            channel_id=channel_id,
                            last_read_message_id=message_id,
                        ))
                    await session.commit()

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(conn)
        await manager.broadcast(workspace_id, {
            "type": "presence",
            "onlineUsers": manager.online_users(workspace_id),
        })


# ── REST: channels ────────────────────────────────────────────────────────────

@router.get("/channels")
async def list_channels(user: CurrentUser, session: Session) -> list[dict[str, Any]]:
    """All #channels the caller can see in their workspace."""
    workspace_id = await _get_workspace_id(user, session)

    channels = (await session.scalars(
        select(ChatChannel).where(
            and_(
                ChatChannel.workspace_id == uuid.UUID(workspace_id),
                ChatChannel.type == "channel",
            )
        ).order_by(ChatChannel.created_at)
    )).all()

    result = []
    for ch in channels:
        # Count unread messages since cursor
        cursor = await session.scalar(
            select(ChatReadCursor).where(
                and_(ChatReadCursor.user_id == user.id, ChatReadCursor.channel_id == ch.id)
            )
        )
        if cursor and cursor.last_read_message_id:
            cursor_msg = await session.get(ChatMessage, cursor.last_read_message_id)
            cursor_ts = cursor_msg.created_at if cursor_msg else None
        else:
            cursor_ts = None

        unread_q = select(func.count()).select_from(ChatMessage).where(
            ChatMessage.channel_id == ch.id
        )
        if cursor_ts:
            unread_q = unread_q.where(ChatMessage.created_at > cursor_ts)
        unread = int(await session.scalar(unread_q) or 0)

        last_msg_row = await session.scalar(
            select(ChatMessage).where(ChatMessage.channel_id == ch.id)
            .order_by(ChatMessage.created_at.desc()).limit(1)
        )
        result.append({
            "id": str(ch.id),
            "name": ch.name,
            "type": ch.type,
            "description": ch.description,
            "unreadCount": unread,
            "lastMessageAt": last_msg_row.created_at.isoformat() if last_msg_row else None,
        })
    return result


@router.post("/channels", status_code=201)
async def create_channel(body: ChannelCreate, user: CurrentUser, session: Session) -> dict[str, Any]:
    workspace_id = await _get_workspace_id(user, session)
    # Prevent duplicate channel names
    existing = await session.scalar(
        select(ChatChannel).where(
            and_(
                ChatChannel.workspace_id == uuid.UUID(workspace_id),
                ChatChannel.name == body.name.lower().replace(" ", "-"),
                ChatChannel.type == "channel",
            )
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Channel already exists")
    ch = ChatChannel(
        workspace_id=uuid.UUID(workspace_id),
        name=body.name.lower().replace(" ", "-"),
        description=body.description,
        created_by=user.id,
    )
    session.add(ch)
    await session.commit()
    await session.refresh(ch)
    return {"id": str(ch.id), "name": ch.name, "type": ch.type, "description": ch.description, "unreadCount": 0}


@router.get("/dms")
async def list_dms(user: CurrentUser, session: Session) -> list[dict[str, Any]]:
    """DM threads the caller is a participant of."""
    workspace_id = await _get_workspace_id(user, session)

    my_channel_ids = select(ChatChannelMember.channel_id).where(
        ChatChannelMember.user_id == user.id
    ).scalar_subquery()

    dms = (await session.scalars(
        select(ChatChannel).where(
            and_(
                ChatChannel.workspace_id == uuid.UUID(workspace_id),
                ChatChannel.type == "dm",
                ChatChannel.id.in_(my_channel_ids),
            )
        ).order_by(ChatChannel.created_at.desc())
    )).all()

    result = []
    for ch in dms:
        # Find the other participant
        other_member = await session.scalar(
            select(ChatChannelMember).where(
                and_(ChatChannelMember.channel_id == ch.id, ChatChannelMember.user_id != user.id)
            )
        )
        other_user = await session.get(User, other_member.user_id) if other_member else None

        unread_q = select(func.count()).select_from(ChatMessage).where(ChatMessage.channel_id == ch.id)
        cursor = await session.scalar(
            select(ChatReadCursor).where(
                and_(ChatReadCursor.user_id == user.id, ChatReadCursor.channel_id == ch.id)
            )
        )
        if cursor and cursor.last_read_message_id:
            cursor_msg = await session.get(ChatMessage, cursor.last_read_message_id)
            if cursor_msg:
                unread_q = unread_q.where(ChatMessage.created_at > cursor_msg.created_at)
        unread = int(await session.scalar(unread_q) or 0)

        result.append({
            "id": str(ch.id),
            "name": other_user.display_name if other_user else "Unknown",
            "type": "dm",
            "otherUserId": str(other_user.id) if other_user else None,
            "otherUserAvatar": other_user.avatar_url if other_user else None,
            "unreadCount": unread,
        })
    return result


@router.post("/dms", status_code=201)
async def open_dm(body: DMCreate, user: CurrentUser, session: Session) -> dict[str, Any]:
    """Open (or return existing) DM thread with target_user_id."""
    workspace_id = await _get_workspace_id(user, session)

    # Find existing DM between the two users in this workspace
    my_channels = select(ChatChannelMember.channel_id).where(ChatChannelMember.user_id == user.id)
    other_channels = select(ChatChannelMember.channel_id).where(ChatChannelMember.user_id == body.target_user_id)

    existing = await session.scalar(
        select(ChatChannel).where(
            and_(
                ChatChannel.workspace_id == uuid.UUID(workspace_id),
                ChatChannel.type == "dm",
                ChatChannel.id.in_(my_channels),
                ChatChannel.id.in_(other_channels),
            )
        )
    )
    if existing:
        return {"id": str(existing.id), "type": "dm"}

    target = await session.get(User, body.target_user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target user not found")

    ch = ChatChannel(
        workspace_id=uuid.UUID(workspace_id),
        name=target.display_name,
        type="dm",
        created_by=user.id,
    )
    session.add(ch)
    await session.flush()
    session.add(ChatChannelMember(channel_id=ch.id, user_id=user.id))
    session.add(ChatChannelMember(channel_id=ch.id, user_id=body.target_user_id))
    await session.commit()
    await session.refresh(ch)
    return {"id": str(ch.id), "type": "dm", "name": target.display_name}


# ── REST: messages ────────────────────────────────────────────────────────────

@router.get("/channels/{channel_id}/messages")
async def get_messages(
    channel_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    before: str | None = Query(default=None),  # ISO timestamp for pagination
    limit: int = Query(default=50, le=100),
) -> list[dict[str, Any]]:
    workspace_id = await _get_workspace_id(user, session)
    await _assert_channel_access(channel_id, workspace_id, user.id, session)

    q = (
        select(ChatMessage)
        .where(ChatMessage.channel_id == channel_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    if before:
        from datetime import datetime, timezone
        ts = datetime.fromisoformat(before)
        q = q.where(ChatMessage.created_at < ts)

    messages = (await session.scalars(q)).all()

    # Batch-load senders
    sender_ids = list({m.sender_id for m in messages})
    senders = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(sender_ids)))).all()
    }

    # Return in ascending order (oldest first)
    return [
        _msg_dict(m, senders[m.sender_id])
        for m in reversed(messages)
        if m.sender_id in senders
    ]


@router.post("/channels/{channel_id}/messages", status_code=201)
async def send_message(
    channel_id: uuid.UUID,
    body: MessageSend,
    user: CurrentUser,
    session: Session,
) -> dict[str, Any]:
    """REST fallback for sending a message (WebSocket preferred)."""
    workspace_id = await _get_workspace_id(user, session)
    await _assert_channel_access(channel_id, workspace_id, user.id, session)

    msg = ChatMessage(
        channel_id=channel_id,
        sender_id=user.id,
        body=body.body,
        mentions=[str(m) for m in body.mentions],
    )
    session.add(msg)

    for mid in body.mentions:
        await _write_activity(
            session, workspace_id, user.id, mid,
            event_type="mention",
            summary=f"{user.display_name} mentioned you in a message",
            target_type="channel",
            target_id=str(channel_id),
        )

    await session.commit()
    await session.refresh(msg)

    out = {"type": "message", **_msg_dict(msg, user)}
    await manager.broadcast(workspace_id, out)
    return out


@router.put("/channels/{channel_id}/read")
async def mark_read(
    channel_id: uuid.UUID,
    body: ReadCursorUpdate,
    user: CurrentUser,
    session: Session,
) -> dict[str, str]:
    workspace_id = await _get_workspace_id(user, session)
    await _assert_channel_access(channel_id, workspace_id, user.id, session)

    cursor = await session.get(ChatReadCursor, (user.id, channel_id))
    if cursor:
        cursor.last_read_message_id = body.message_id
    else:
        session.add(ChatReadCursor(user_id=user.id, channel_id=channel_id, last_read_message_id=body.message_id))
    await session.commit()
    return {"status": "ok"}


# ── REST: project comments ────────────────────────────────────────────────────

@router.get("/projects/{project_id}/comments")
async def get_project_comments(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
) -> list[dict[str, Any]]:
    comments = (await session.scalars(
        select(ProjectComment)
        .where(ProjectComment.project_id == project_id)
        .order_by(ProjectComment.created_at)
    )).all()

    author_ids = list({c.author_id for c in comments})
    authors = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(author_ids)))).all()
    }

    return [
        {
            "id": str(c.id),
            "projectId": str(c.project_id),
            "authorId": str(c.author_id),
            "authorName": authors[c.author_id].display_name if c.author_id in authors else "Unknown",
            "authorAvatar": authors[c.author_id].avatar_url if c.author_id in authors else None,
            "body": c.body,
            "mentions": [str(m) for m in (c.mentions or [])],
            "createdAt": c.created_at.isoformat(),
            "editedAt": c.edited_at.isoformat() if c.edited_at else None,
        }
        for c in comments
    ]


@router.post("/projects/{project_id}/comments", status_code=201)
async def add_project_comment(
    project_id: uuid.UUID,
    body: CommentCreate,
    user: CurrentUser,
    session: Session,
) -> dict[str, Any]:
    workspace_id = await _get_workspace_id(user, session)

    comment = ProjectComment(
        project_id=project_id,
        author_id=user.id,
        body=body.body,
        mentions=[str(m) for m in body.mentions],
    )
    session.add(comment)

    # Write mention activity for each @mentioned user
    for mid in body.mentions:
        await _write_activity(
            session, workspace_id, user.id, mid,
            event_type="mention",
            summary=f"{user.display_name} mentioned you in a project comment",
            target_type="project",
            target_id=str(project_id),
            project_id=project_id,
        )

    await session.commit()
    await session.refresh(comment)

    out = {
        "id": str(comment.id),
        "projectId": str(comment.project_id),
        "authorId": str(comment.author_id),
        "authorName": user.display_name,
        "authorAvatar": user.avatar_url,
        "body": comment.body,
        "mentions": [str(m) for m in (comment.mentions or [])],
        "createdAt": comment.created_at.isoformat(),
        "editedAt": None,
    }

    # Broadcast to WS clients so they see the comment live
    await manager.broadcast(workspace_id, {"type": "project_comment", **out})
    return out


# ── REST: activity feed ───────────────────────────────────────────────────────

@router.get("/activity")
async def get_activity(
    user: CurrentUser,
    session: Session,
    limit: int = Query(default=50, le=100),
) -> list[dict[str, Any]]:
    """Activity events for the current user (mentions, approvals, PR merges)."""
    workspace_id = await _get_workspace_id(user, session)

    events = (await session.scalars(
        select(ActivityEvent).where(
            and_(
                ActivityEvent.workspace_id == uuid.UUID(workspace_id),
                or_(
                    ActivityEvent.recipient_id == user.id,
                    ActivityEvent.recipient_id.is_(None),
                ),
            )
        ).order_by(ActivityEvent.created_at.desc()).limit(limit)
    )).all()

    actor_ids = list({e.actor_id for e in events if e.actor_id})
    actors = {
        u.id: u
        for u in (await session.scalars(select(User).where(User.id.in_(actor_ids)))).all()
    }

    return [
        {
            "id": str(e.id),
            "type": e.type,
            "summary": e.summary,
            "actorId": str(e.actor_id) if e.actor_id else None,
            "actorName": actors[e.actor_id].display_name if e.actor_id and e.actor_id in actors else "System",
            "actorAvatar": actors[e.actor_id].avatar_url if e.actor_id and e.actor_id in actors else None,
            "targetType": e.target_type,
            "targetId": e.target_id,
            "projectId": str(e.project_id) if e.project_id else None,
            "read": e.read,
            "createdAt": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.post("/activity/{event_id}/read")
async def mark_activity_read(event_id: uuid.UUID, user: CurrentUser, session: Session) -> dict[str, str]:
    ev = await session.get(ActivityEvent, event_id)
    if not ev or ev.recipient_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    ev.read = True
    await session.commit()
    return {"status": "ok"}


@router.post("/activity/read-all")
async def mark_all_activity_read(user: CurrentUser, session: Session) -> dict[str, int]:
    workspace_id = await _get_workspace_id(user, session)
    events = (await session.scalars(
        select(ActivityEvent).where(
            and_(
                ActivityEvent.workspace_id == uuid.UUID(workspace_id),
                ActivityEvent.recipient_id == user.id,
                ActivityEvent.read.is_(False),
            )
        )
    )).all()
    for ev in events:
        ev.read = True
    await session.commit()
    return {"marked": len(events)}


# ── REST: workspace members (for @mention picker) ─────────────────────────────

@router.get("/members")
async def workspace_members(user: CurrentUser, session: Session) -> list[dict[str, Any]]:
    """All users in the caller's workspace — used to populate @mention dropdown."""
    workspace_id = await _get_workspace_id(user, session)

    member_user_ids = select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == uuid.UUID(workspace_id)
    )
    users = (await session.scalars(
        select(User).where(User.id.in_(member_user_ids)).order_by(User.display_name)
    )).all()

    online = set(manager.online_users(workspace_id))
    return [
        {
            "id": str(u.id),
            "displayName": u.display_name,
            "email": u.email,
            "avatarUrl": u.avatar_url,
            "online": str(u.id) in online,
        }
        for u in users
    ]
