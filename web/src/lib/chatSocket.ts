/**
 * chatSocket.ts — Singleton WebSocket client for the Karkhana chat system.
 *
 * Features
 * --------
 * - Automatic reconnect with exponential back-off (max 30 s)
 * - Heartbeat ping every 25 s to keep the connection alive through proxies
 * - Typed message dispatch via subscribe/unsubscribe
 * - Exposes send() that queues frames when the socket is not yet open
 */

import { apiWsUrl } from './apiBase';

export type ChatFrame =
  | { type: 'message'; id: string; channelId: string; senderId: string; senderName: string; senderAvatar?: string; body: string; mentions: string[]; createdAt: string; editedAt?: string; attachments?: ChatAttachment[] }
  | { type: 'typing'; channelId: string; userId: string; displayName: string }
  | { type: 'presence'; onlineUsers: string[] }
  | { type: 'project_comment'; id: string; projectId: string; authorId: string; authorName: string; authorAvatar?: string; body: string; mentions: string[]; createdAt: string }
  | { type: 'channel_created'; channel: { id: string; name: string; visibility: string } }
  | { type: 'workspace_sync'; scope: 'projects' | 'products' | 'members' | 'ideas' | string }
  | { type: 'scan_progress'; scanId: string; step: string; percent: number; note?: string }
  | { type: 'run_log'; runId: string; lines: { level: string; message: string }[] }
  | { type: 'reconnected' }
  | { type: 'activity' }
  | { type: 'pong' }
  | { type: 'error'; detail: string };

type Listener = (frame: ChatFrame) => void;

class ChatSocketManager {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private workspaceId: string | null = null;
  private listeners = new Set<Listener>();
  private queue: object[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 1000; // ms, doubles on each failed attempt (cap 30 s)
  private intentionalClose = false;
  private hasConnected = false;
  /** Last presence list, so views mounted later start with it. */
  online: string[] = [];

  /**
   * Call once after authentication — keeps the socket alive. Switching workspace reconnects.
   * Omitting workspaceId keeps the current one, so a caller that doesn't know it can't
   * move the socket to the user's default workspace by accident.
   */
  connect(token: string, workspaceId?: string): void {
    const ws = workspaceId ?? this.workspaceId;
    if (this.token === token && this.workspaceId === ws && this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.token = token;
    this.workspaceId = ws;
    this.intentionalClose = false;
    if (this.ws) {
      // Replace the old connection without triggering its reconnect loop.
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._clearTimers();
    this._open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._clearTimers();
    this.ws?.close();
    this.ws = null;
    this.token = null;
    this.workspaceId = null;
    this.hasConnected = false;
    this.queue = [];
  }

  /** Subscribe to all incoming frames. Returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Send a frame. Queued automatically if the socket is not yet open. */
  send(frame: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else {
      this.queue.push(frame);
    }
  }

  sendMessage(channelId: string, body: string, mentions: string[] = [], attachments: string[] = []): void {
    this.send({ type: 'message', channelId, body, mentions, attachments });
  }

  sendTyping(channelId: string): void {
    this.send({ type: 'typing', channelId });
  }

  sendRead(channelId: string, messageId: string): void {
    this.send({ type: 'read', channelId, messageId });
  }

  /** The workspace this socket (and every chat REST call) is scoped to. */
  get currentWorkspaceId(): string | null {
    return this.workspaceId;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _open(): void {
    if (!this.token) return;
    const wsParam = this.workspaceId ? `&workspace_id=${encodeURIComponent(this.workspaceId)}` : '';
    const url = apiWsUrl(`/api/chat/ws?token=${encodeURIComponent(this.token)}${wsParam}`);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[chat] WebSocket connected');
      this.backoff = 1000; // reset back-off on successful connect
      // Frames sent while we were down are lost; tell listeners to re-sync.
      if (this.hasConnected) this.listeners.forEach((fn) => fn({ type: 'reconnected' }));
      this.hasConnected = true;
      // Flush queued frames
      while (this.queue.length > 0) {
        const frame = this.queue.shift()!;
        this.ws!.send(JSON.stringify(frame));
      }
      // Start heartbeat
      this._clearTimers();
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' });
      }, 25_000);
    };

    this.ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as ChatFrame;
        if (frame.type === 'presence') this.online = frame.onlineUsers;
        this.listeners.forEach((fn) => fn(frame));
      } catch {
        console.warn('[chat] unparseable frame', ev.data);
      }
    };

    this.ws.onclose = () => {
      this._clearTimers();
      if (!this.intentionalClose) {
        console.log(`[chat] WebSocket closed — reconnecting in ${this.backoff}ms`);
        this.reconnectTimer = setTimeout(() => {
          this.backoff = Math.min(this.backoff * 2, 30_000);
          this._open();
        }, this.backoff);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close(); // triggers onclose → reconnect
    };
  }

  private _clearTimers(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

/** Singleton — import this everywhere. */
export const chatSocket = new ChatSocketManager();

// ── React hook ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { HttpError, friendlyStatus, httpError } from './friendlyErrors';

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt?: string;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  filename: string;
  contentType: string;
  kind: 'image' | 'audio' | 'file';
  size: number;
}

function authHeaders(token: string): Record<string, string> {
  const ws = chatSocket.currentWorkspaceId;
  return { Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace-Id': ws } : {}) };
}

/** Upload one file to a channel; send its id with the next message. */
export async function uploadAttachment(channelId: string, file: Blob, filename: string, token: string): Promise<ChatAttachment> {
  const form = new FormData();
  form.append('file', file, filename);
  const res = await fetch(`/api/chat/channels/${channelId}/attachments`, { method: 'POST', headers: authHeaders(token), body: form });
  if (!res.ok) throw await httpError(res);
  return res.json();
}

// Attachment bytes need the auth header, so <img>/<audio> get object URLs. Cached per tab.
const blobCache = new Map<string, Promise<Blob>>();
export function fetchAttachmentBlob(id: string, token: string): Promise<Blob> {
  let p = blobCache.get(id);
  if (!p) {
    p = fetch(`/api/chat/attachments/${id}`, { headers: authHeaders(token) }).then((r) => {
      if (!r.ok) throw new HttpError(r.status, friendlyStatus(r.status));
      return r.blob();
    });
    p.catch(() => blobCache.delete(id));
    blobCache.set(id, p);
  }
  return p;
}

export interface ChannelMeta {
  id: string;
  name: string;
  type: 'channel' | 'dm';
  description?: string;
  unreadCount: number;
  otherUserId?: string;
  otherUserAvatar?: string;
}

export interface WorkspaceMember {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  online: boolean;
}

/** Fetch JSON with auth token from factoryStore. */
async function apiFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  // Scope every chat call to the workspace on screen; without it the server
  // falls back to the user's first workspace and lists the wrong channels.
  const ws = chatSocket.currentWorkspaceId;
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(ws ? { 'X-Workspace-Id': ws } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw await httpError(res);
  return res.json();
}

/** Load message history for a channel via REST. */
export async function fetchMessages(channelId: string, token: string, before?: string): Promise<ChatMessage[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiFetch<ChatMessage[]>(`/api/chat/channels/${channelId}/messages${qs}`, token);
}

/** Load channels list. */
export async function fetchChannels(token: string): Promise<ChannelMeta[]> {
  return apiFetch<ChannelMeta[]>('/api/chat/channels', token);
}

/** Load DMs list. */
export async function fetchDMs(token: string): Promise<ChannelMeta[]> {
  return apiFetch<ChannelMeta[]>('/api/chat/dms', token);
}

/** Create a #channel. Team channels are private to the members you add. */
export async function createChannel(
  name: string,
  description: string | undefined,
  token: string,
  memberIds: string[] = [],
  visibility: 'private' | 'public' = 'private',
): Promise<ChannelMeta> {
  return apiFetch<ChannelMeta>('/api/chat/channels', token, {
    method: 'POST',
    body: JSON.stringify({ name, description, member_ids: memberIds, visibility }),
  });
}

/** Unread totals for the header badges: activity, plus messages across channels and DMs. */
export async function fetchUnreadCounts(token: string): Promise<{ activity: number; chat: number }> {
  const [activity, channels, dms] = await Promise.all([
    apiFetch<{ read: boolean }[]>('/api/chat/activity', token),
    apiFetch<ChannelMeta[]>('/api/chat/channels', token),
    apiFetch<ChannelMeta[]>('/api/chat/dms', token),
  ]);
  return {
    activity: activity.filter((a) => !a.read).length,
    chat: [...channels, ...dms].reduce((n, c) => n + (c.unreadCount || 0), 0),
  };
}

/** Open or return existing DM with a user. */
export async function openDM(targetUserId: string, token: string): Promise<{ id: string; type: string }> {
  return apiFetch('/api/chat/dms', token, {
    method: 'POST',
    body: JSON.stringify({ target_user_id: targetUserId }),
  });
}

/** Fetch workspace members for @mention picker. */
export async function fetchWorkspaceMembers(token: string): Promise<WorkspaceMember[]> {
  return apiFetch<WorkspaceMember[]>('/api/chat/members', token);
}

/** Send REST message (fallback when WS unavailable). */
export async function sendMessageRest(channelId: string, body: string, mentions: string[], token: string): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/api/chat/channels/${channelId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify({ body, mentions }),
  });
}

/** Mark channel read. */
export async function markRead(channelId: string, messageId: string, token: string): Promise<void> {
  await apiFetch(`/api/chat/channels/${channelId}/read`, token, {
    method: 'PUT',
    body: JSON.stringify({ message_id: messageId }),
  });
}

/** Fetch activity feed. */
export async function fetchActivity(token: string): Promise<object[]> {
  return apiFetch<object[]>('/api/chat/activity', token);
}

/** Mark all activity read. */
export async function markAllActivityRead(token: string): Promise<void> {
  await apiFetch('/api/chat/activity/read-all', token, { method: 'POST' });
}

/** Fetch project comments. */
export async function fetchProjectComments(projectId: string, token: string): Promise<object[]> {
  return apiFetch<object[]>(`/api/chat/projects/${projectId}/comments`, token);
}

/** Post a project comment. */
export async function postProjectComment(projectId: string, body: string, mentions: string[], token: string): Promise<object> {
  return apiFetch<object>(`/api/chat/projects/${projectId}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body, mentions }),
  });
}

/** Hook: subscribe to a specific frame type. */
export function useChatFrames<T extends ChatFrame['type']>(
  type: T,
  handler: (frame: Extract<ChatFrame, { type: T }>) => void,
  deps: unknown[] = [],
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return chatSocket.subscribe((frame) => {
      if (frame.type === type) {
        handlerRef.current(frame as Extract<ChatFrame, { type: T }>);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Hook: live messages for a channel (initial load via REST + WS updates).
 *
 * Re-fetches after a reconnect (Cloud Run cuts sockets; frames sent meanwhile are
 * lost) and marks the channel read up to the newest message while it is open.
 */
export function useChannelMessages(channelId: string | null, token: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!channelId || !token) { setMessages([]); return; }
    let live = true;
    setLoading(epoch === 0);
    fetchMessages(channelId, token)
      .then((rows) => { if (live) setMessages(rows); })
      .catch(() => { if (live && epoch === 0) setMessages([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [channelId, token, epoch]);

  useChatFrames('reconnected', () => setEpoch((n) => n + 1), []);

  useChatFrames('message', (frame) => {
    if (frame.channelId !== channelId) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === frame.id)) return prev;
      return [...prev, frame as ChatMessage];
    });
  }, [channelId]);

  // "Seen": advance the server read cursor whenever the newest visible message changes.
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!channelId || !token || !lastId || document.visibilityState === 'hidden') return;
    markRead(channelId, lastId, token).catch(() => {});
  }, [channelId, token, lastId]);

  return { messages, loading };
}

/** Hook: online presence for the workspace. */
export function usePresence() {
  const [onlineUsers, setOnlineUsers] = useState<string[]>(chatSocket.online);
  useChatFrames('presence', (frame) => setOnlineUsers(frame.onlineUsers));
  return onlineUsers;
}

/** Hook: typing indicators per channel. Clears after 3 s. */
export function useTypingUsers(channelId: string | null) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useChatFrames('typing', (frame) => {
    if (frame.channelId !== channelId) return;
    const uid = frame.userId;
    setTypingUsers((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
    if (timers.current[uid]) clearTimeout(timers.current[uid]);
    timers.current[uid] = setTimeout(() => {
      setTypingUsers((prev) => prev.filter((id) => id !== uid));
    }, 3000);
  }, [channelId]);

  return typingUsers;
}
