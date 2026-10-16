import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell, AtSign, GitPullRequest, CheckCircle2, MessageSquare,
  Play, X, Check, Loader2, RefreshCw,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { fetchActivity, markAllActivityRead } from '../../lib/chatSocket';
import { useChatFrames } from '../../lib/chatSocket';
import type { ActivityEvent } from '../../types/factory';

interface ActivityFeedPanelProps {
  onClose: () => void;
  onNavigate?: (screen: string, targetId?: string) => void;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  mention:      { icon: <AtSign size={13} />,        color: '#075BFF',  label: 'Mentioned you' },
  comment:      { icon: <MessageSquare size={13} />, color: '#9b6dff',  label: 'Comment' },
  review:       { icon: <GitPullRequest size={13} />,color: '#f0a500',  label: 'Review' },
  approval:     { icon: <CheckCircle2 size={13} />,  color: '#00d9a6',  label: 'Approval' },
  run_complete: { icon: <Play size={13} />,           color: '#00d9a6',  label: 'Agent run' },
  pr_merged:    { icon: <GitPullRequest size={13} />, color: '#9b6dff', label: 'PR merged' },
};

interface FeedItem {
  id: string;
  type: string;
  summary: string;
  actorName: string;
  actorAvatar?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  projectName?: string;
  read: boolean;
  createdAt: string;
}

function FeedRow({
  item,
  onRead,
  onNavigate,
}: {
  item: FeedItem;
  onRead: (id: string) => void;
  onNavigate?: (screen: string, targetId?: string) => void;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META.comment;

  return (
    <div
      onClick={() => {
        if (!item.read) onRead(item.id);
        if (onNavigate && item.targetType) {
          onNavigate(item.targetType === 'project' ? 'project_detail' : 'chat_channel', item.targetId ?? undefined);
        }
      }}
      style={{
        display: 'flex', gap: 12, padding: '12px 16px', cursor: 'pointer',
        background: item.read ? 'none' : 'rgba(7,91,255,0.06)',
        borderLeft: item.read ? '3px solid transparent' : `3px solid ${meta.color}`,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = item.read ? 'none' : 'rgba(7,91,255,0.06)')}
    >
      {/* Icon */}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: `${meta.color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: meta.color,
      }}>
        {meta.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#d0d4de', margin: 0, lineHeight: 1.45 }}>
          <span style={{ color: '#f0f2f5', fontWeight: 600 }}>{item.actorName}</span>
          {' '}
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{item.summary.replace(item.actorName, '').trim()}</span>
        </p>
        {item.projectName && (
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '2px 0 0', fontFamily: 'var(--font-mono)' }}>
            in {item.projectName}
          </p>
        )}
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', margin: '2px 0 0', fontFamily: 'var(--font-mono)' }}>
          {timeAgo(item.createdAt)}
        </p>
      </div>

      {/* Unread dot */}
      {!item.read && (
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0, marginTop: 6 }} />
      )}
    </div>
  );
}

export const ActivityFeedPanel: React.FC<ActivityFeedPanelProps> = ({ onClose, onNavigate }) => {
  const state = factoryStore.getState();
  const token = state.token ?? '';

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mentions' | 'unread'>('all');

  const unreadCount = items.filter((i) => !i.read).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchActivity(token) as FeedItem[];
      setItems(data);
    } catch {
      // Fall back to store activity events
      const storeEvents = state.activityEvents;
      setItems(storeEvents.map((ev: ActivityEvent) => ({
        id: ev.id,
        type: ev.type,
        summary: ev.summary,
        actorName: ev.actorName,
        actorAvatar: ev.actorAvatar,
        targetType: ev.targetScreen ?? null,
        targetId: ev.targetId ?? null,
        projectId: ev.projectId ?? null,
        projectName: ev.projectName,
        read: ev.read,
        createdAt: ev.createdAt,
      })));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // The server signals new mentions, review requests and invites; refetch the real feed.
  useChatFrames('activity', () => { load(); }, [load]);
  useChatFrames('reconnected', () => { load(); }, [load]);

  // Live: push incoming project_comment / message mention frames into the feed
  useChatFrames('project_comment', (frame) => {
    const myId = state.currentUser?.id ?? state.members[0]?.id ?? '';
    if (!frame.mentions.includes(myId)) return;
    const ev: FeedItem = {
      id: `live-${frame.id}`,
      type: 'mention',
      summary: `${frame.authorName} mentioned you in a project comment`,
      actorName: frame.authorName,
      actorAvatar: frame.authorAvatar,
      targetType: 'project',
      targetId: frame.projectId,
      projectId: frame.projectId,
      read: false,
      createdAt: frame.createdAt,
    };
    setItems((prev) => [ev, ...prev]);
  }, []);

  useChatFrames('message', (frame) => {
    const myId = state.currentUser?.id ?? state.members[0]?.id ?? '';
    if (!frame.mentions.includes(myId)) return;
    const ev: FeedItem = {
      id: `live-msg-${frame.id}`,
      type: 'mention',
      summary: `${frame.senderName} mentioned you in a message`,
      actorName: frame.senderName,
      actorAvatar: frame.senderAvatar,
      targetType: 'channel',
      targetId: frame.channelId,
      projectId: null,
      read: false,
      createdAt: frame.createdAt,
    };
    setItems((prev) => [ev, ...prev]);
  }, []);

  const markRead = (id: string) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, read: true } : i));
    factoryStore.markActivityRead(id);
    fetch(`/api/chat/activity/${id}/read`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  const markAllRead = async () => {
    try { await markAllActivityRead(token); } catch { /* offline */ }
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    factoryStore.markAllActivityRead();
  };

  const filtered = items.filter((i) => {
    if (filter === 'unread') return !i.read;
    if (filter === 'mentions') return i.type === 'mention';
    return true;
  });

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0,
      width: 420, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0A0A0F',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Header */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0d1017', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={16} style={{ color: '#f0a500' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f5' }}>Activity</span>
          {unreadCount > 0 && (
            <span style={{ fontSize: 10, background: '#f0a500', color: '#000', borderRadius: 8, padding: '1px 6px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {unreadCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {unreadCount > 0 && (
            <button onClick={markAllRead} title="Mark all read" style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)',
              fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Check size={11} /> Mark all read
            </button>
          )}
          <button onClick={() => load()} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4, display: 'flex' }}>
            <RefreshCw size={14} />
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        {(['all', 'mentions', 'unread'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
            fontWeight: 500, border: '1px solid',
            background: filter === f ? 'rgba(7,91,255,0.2)' : 'none',
            borderColor: filter === f ? 'rgba(7,91,255,0.5)' : 'rgba(255,255,255,0.1)',
            color: filter === f ? '#75aaff' : 'rgba(255,255,255,0.5)',
            transition: 'all 0.15s',
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'unread' && unreadCount > 0 && ` (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <Loader2 size={20} style={{ color: 'rgba(255,255,255,0.3)', animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'rgba(255,255,255,0.3)' }}>
            <Bell size={28} style={{ opacity: 0.4 }} />
            <p style={{ fontSize: 13, margin: 0 }}>
              {filter === 'unread' ? 'All caught up!' : 'No activity yet'}
            </p>
            <p style={{ fontSize: 11, margin: 0, color: 'rgba(255,255,255,0.2)' }}>
              Mentions, comments and events will appear here
            </p>
          </div>
        )}
        {!loading && filtered.map((item) => (
          <FeedRow key={item.id} item={item} onRead={markRead} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
};
