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

export type ChatFrame =
  | { type: 'message'; id: string; channelId: string; senderId: string; senderName: string; senderAvatar?: string; body: string; mentions: string[]; createdAt: string; editedAt?: string }
  | { type: 'typing'; channelId: string; userId: string; displayName: string }
  | { type: 'presence'; onlineUsers: string[] }
  | { type: 'project_comment'; id: string; projectId: string; authorId: string; authorName: string; authorAvatar?: string; body: string; mentions: string[]; createdAt: string }
  | { type: 'pong' }
  | { type: 'error'; detail: string };

type Listener = (frame: ChatFrame) => void;

class ChatSocketManager {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private queue: object[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 1000; // ms, doubles on each failed attempt (cap 30 s)
  private intentionalClose = false;

  /** Call once after authentication — keeps the socket alive. */
  connect(token: string): void {
    if (this.token === token && this.ws?.readyState === WebSocket.OPEN) return;
    this.token = token;
    this.intentionalClose = false;
    this._open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._clearTimers();
    this.ws?.close();
    this.ws = null;
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

  sendMessage(channelId: string, body: string, mentions: string[] = []): void {
    this.send({ type: 'message', channelId, body, mentions });
  }

  sendTyping(channelId: string): void {
    this.send({ type: 'typing', channelId });
  }

  sendRead(channelId: string, messageId: string): void {
    this.send({ type: 'read', channelId, messageId });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _open(): void {
    if (!this.token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/api/chat/ws?token=${encodeURIComponent(this.token)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[chat] WebSocket connected');
      this.backoff = 1000; // reset back-off on successful connect
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
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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

/** Create a #channel. */
export async function createChannel(name: string, description: string | undefined, token: string): Promise<ChannelMeta> {
  return apiFetch<ChannelMeta>('/api/chat/channels', token, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
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

/** Hook: live messages for a channel (initial load via REST + WS updates). */
export function useChannelMessages(channelId: string | null, token: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Initial load
  useEffect(() => {
    if (!channelId || !token) { setMessages([]); return; }
    setLoading(true);
    fetchMessages(channelId, token)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [channelId, token]);

  // Real-time updates
  useChatFrames('message', (frame) => {
    if (frame.channelId !== channelId) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === frame.id)) return prev;
      return [...prev, frame as ChatMessage];
    });
  }, [channelId]);

  return { messages, loading };
}

/** Hook: online presence for the workspace. */
export function usePresence() {
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
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
