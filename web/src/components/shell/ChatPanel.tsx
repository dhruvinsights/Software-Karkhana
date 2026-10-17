import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Hash, MessageSquare, Plus, Search, Send, Volume2, VolumeX,
  X, ChevronDown, AtSign, Circle, Loader2, Mic, MicOff,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import {
  chatSocket,
  fetchChannels,
  fetchDMs,
  fetchMessages,
  fetchWorkspaceMembers,
  createChannel,
  openDM,
  markRead,
  useChatFrames,
  useChannelMessages,
  usePresence,
  useTypingUsers,
  type ChannelMeta,
  type WorkspaceMember,
  type ChatMessage,
} from '../../lib/chatSocket';

interface ChatPanelProps {
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Avatar({ name, src, size = 28, online }: { name: string; src?: string | null; size?: number; online?: boolean }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {src ? (
        <img src={src} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: '50%',
          background: 'linear-gradient(135deg,#075BFF,#9b6dff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.38, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-sans)',
        }}>{initials}</div>
      )}
      {online !== undefined && (
        <span style={{
          position: 'absolute', bottom: 0, right: 0,
          width: size * 0.32, height: size * 0.32, borderRadius: '50%',
          background: online ? '#00d9a6' : '#4e5668',
          border: '2px solid #0A0A0F',
        }} />
      )}
    </div>
  );
}

// ── Mention picker ────────────────────────────────────────────────────────────

function MentionPicker({
  query,
  members,
  onSelect,
}: {
  query: string;
  members: WorkspaceMember[];
  onSelect: (m: WorkspaceMember) => void;
}) {
  const filtered = members.filter((m) =>
    m.displayName.toLowerCase().includes(query.toLowerCase()) ||
    m.email.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6);

  if (!filtered.length) return null;
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6,
      background: '#131720', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 100,
    }}>
      <div style={{ padding: '6px 12px 4px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>Members</div>
      {filtered.map((m) => (
        <button key={m.id} onClick={() => onSelect(m)} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', transition: 'background 0.15s',
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <Avatar name={m.displayName} src={m.avatarUrl} size={22} online={m.online} />
          <span style={{ fontSize: 13, color: '#f0f2f5', fontWeight: 500 }}>{m.displayName}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{m.email}</span>
        </button>
      ))}
    </div>
  );
}

// ── Single message row ────────────────────────────────────────────────────────

function MessageRow({ msg, members, prevMsg }: { msg: ChatMessage; members: WorkspaceMember[]; prevMsg?: ChatMessage }) {
  const sender = members.find((m) => m.id === msg.senderId);
  const senderName = sender?.displayName ?? msg.senderName;
  const isSameSender = prevMsg?.senderId === msg.senderId &&
    new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < 5 * 60 * 1000;

  // Render @mentions as highlighted spans
  const renderBody = (body: string) => {
    const parts = body.split(/(@\w[\w\s]*)/g);
    return parts.map((part, i) =>
      part.startsWith('@') ? (
        <span key={i} style={{ color: '#00d9a6', fontWeight: 600, background: 'rgba(0,217,166,0.1)', borderRadius: 4, padding: '0 2px' }}>{part}</span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div style={{
      display: 'flex', gap: 10, padding: isSameSender ? '2px 16px' : '8px 16px 2px',
      alignItems: 'flex-start',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <div style={{ width: 28, flexShrink: 0 }}>
        {!isSameSender && <Avatar name={senderName} src={sender?.avatarUrl} size={28} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isSameSender && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#f0f2f5' }}>{senderName}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono)' }}>{timeAgo(msg.createdAt)}</span>
          </div>
        )}
        <p style={{ fontSize: 13.5, color: '#d0d4de', lineHeight: 1.55, margin: 0, wordBreak: 'break-word' }}>
          {renderBody(msg.body)}
        </p>
      </div>
    </div>
  );
}

// ── Message composer ──────────────────────────────────────────────────────────

function Composer({
  channelId,
  token,
  members,
  placeholder,
}: {
  channelId: string;
  token: string;
  members: WorkspaceMember[];
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Voice input (Web Speech API) ──────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Web Speech API not supported in this browser.');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recognitionRef.current = rec;

    let finalTranscript = text;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + t;
        } else {
          interim = t;
        }
      }
      setText(finalTranscript + (interim ? ` ${interim}` : ''));
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };

    rec.start();
    setListening(true);
  }, [listening, text]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @mention trigger
    const match = val.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : null);

    // Typing indicator
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    chatSocket.sendTyping(channelId);
    typingTimeout.current = setTimeout(() => { typingTimeout.current = null; }, 3000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const insertMention = (m: WorkspaceMember) => {
    const replaced = text.replace(/@(\w*)$/, `@${m.displayName} `);
    setText(replaced);
    setPendingMentions((prev) => [...prev, m.id]);
    setMentionQuery(null);
  };

  const doSend = () => {
    const body = text.trim();
    if (!body) return;
    chatSocket.sendMessage(channelId, body, pendingMentions);
    setText('');
    setPendingMentions([]);
    setMentionQuery(null);
  };

  return (
    <div style={{ padding: '8px 12px 12px', position: 'relative' }}>
      {mentionQuery !== null && (
        <MentionPicker query={mentionQuery} members={members} onSelect={insertMention} />
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12, padding: '8px 10px',
        transition: 'border-color 0.2s',
      }}>
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
            fontSize: 13.5, color: '#f0f2f5', lineHeight: 1.55,
            fontFamily: 'var(--font-sans)', maxHeight: 120, overflowY: 'auto',
          }}
        />
        {/* Voice button */}
        <button
          onClick={toggleVoice}
          title={listening ? 'Stop recording' : 'Voice input (Web Speech)'}
          style={{
            background: listening ? 'rgba(255,77,77,0.2)' : 'none',
            border: listening ? '1px solid rgba(255,77,77,0.4)' : '1px solid transparent',
            borderRadius: 8, padding: '4px 6px', cursor: 'pointer',
            color: listening ? '#ff4d4d' : 'rgba(255,255,255,0.4)',
            display: 'flex', alignItems: 'center', transition: 'all 0.2s',
          }}
        >
          {listening ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
        {/* @mention shortcut */}
        <button
          onClick={() => setText((t) => t + '@')}
          title="Mention someone"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: '4px 4px', display: 'flex', alignItems: 'center' }}
        >
          <AtSign size={15} />
        </button>
        {/* Send */}
        <button
          onClick={doSend}
          disabled={!text.trim()}
          style={{
            background: text.trim() ? '#075BFF' : 'rgba(255,255,255,0.08)',
            border: 'none', borderRadius: 8, padding: '5px 9px',
            cursor: text.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center',
            color: text.trim() ? '#fff' : 'rgba(255,255,255,0.3)', transition: 'all 0.2s',
          }}
        >
          <Send size={14} />
        </button>
      </div>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', margin: '4px 4px 0', fontFamily: 'var(--font-mono)' }}>
        Enter to send · Shift+Enter for new line · @ to mention · <Mic size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> for voice
      </p>
    </div>
  );
}

// ── Main ChatPanel component ──────────────────────────────────────────────────

export const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
  const state = factoryStore.getState();
  const token = state.token ?? '';

  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [dms, setDMs] = useState<ChannelMeta[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showDMPicker, setShowDMPicker] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  // Team channels are private: pick who is in it (you're always included).
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([]);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [dmSearch, setDMSearch] = useState('');
  const [tab, setTab] = useState<'channels' | 'dms'>('channels');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const onlineUsers = usePresence();
  const typingUsers = useTypingUsers(activeChannelId);
  const { messages, loading: msgsLoading } = useChannelMessages(activeChannelId, token);

  // Connect WebSocket on mount
  useEffect(() => {
    if (token) chatSocket.connect(token, state.activeWorkspaceId.length === 36 ? state.activeWorkspaceId : undefined);
    return () => { /* keep socket alive across unmounts */ };
  }, [token]);

  // Load channel list
  const reload = useCallback(async () => {
    if (!token) return;
    setLoadingChannels(true);
    try {
      const [chs, dmsData, mems] = await Promise.all([
        fetchChannels(token),
        fetchDMs(token),
        fetchWorkspaceMembers(token),
      ]);
      setChannels(chs);
      setDMs(dmsData);
      setMembers(mems);
      if (!activeChannelId && chs.length > 0) setActiveChannelId(chs[0].id);
    } catch {
      // If backend not available (demo mode), load local state channels
      const storeChannels = state.chatChannels;
      if (storeChannels.length > 0) {
        setChannels(storeChannels.filter((c) => c.type === 'channel').map((c) => ({
          id: c.id, name: c.name, type: 'channel' as const, description: c.description, unreadCount: c.unreadCount,
        })));
        setDMs(storeChannels.filter((c) => c.type === 'dm').map((c) => ({
          id: c.id, name: c.name, type: 'dm' as const, unreadCount: c.unreadCount,
        })));
        if (!activeChannelId && storeChannels.length > 0) setActiveChannelId(storeChannels[0].id);
      } else {
        // Ensure #general exists
        factoryStore.ensureGeneralChannel();
        const newState = factoryStore.getState();
        setChannels(newState.chatChannels.map((c) => ({
          id: c.id, name: c.name, type: 'channel' as const, description: c.description, unreadCount: c.unreadCount,
        })));
        if (newState.chatChannels.length > 0) setActiveChannelId(newState.chatChannels[0].id);
      }
      setMembers(state.members.map((m) => ({ id: m.id, displayName: m.name, email: m.email, avatarUrl: m.avatar, online: m.availability === 'online' })));
    } finally {
      setLoadingChannels(false);
    }
  }, [token, state.activeWorkspaceId]);

  useEffect(() => { reload(); }, [reload]);

  // Someone added us to a channel (or created a public one): show it without a reload.
  useChatFrames('channel_created', () => { reload(); }, [reload]);
  useChatFrames('reconnected', () => { reload(); }, [reload]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Update unread badge when a new message arrives in a different channel
  useChatFrames('message', (frame) => {
    if (frame.channelId !== activeChannelId) {
      setChannels((prev) =>
        prev.map((c) => c.id === frame.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c)
      );
      setDMs((prev) =>
        prev.map((c) => c.id === frame.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c)
      );
    }
    // Mark read for active channel
    if (frame.channelId === activeChannelId && token) {
      markRead(frame.channelId, frame.id, token).catch(() => {});
    }
  }, [activeChannelId, token]);

  const switchChannel = (id: string) => {
    setActiveChannelId(id);
    setChannels((prev) => prev.map((c) => c.id === id ? { ...c, unreadCount: 0 } : c));
    setDMs((prev) => prev.map((c) => c.id === id ? { ...c, unreadCount: 0 } : c));
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;
    setChannelError(null);
    try {
      const ch = await createChannel(newChannelName.trim(), undefined, token, newChannelMembers);
      setChannels((prev) => (prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]));
      setActiveChannelId(ch.id);
      setTab('channels');
    } catch (e) {
      // No local fallback: a channel only others can't see is worse than an error.
      setChannelError((e as Error).message.includes('409') ? 'A channel with that name already exists.' : 'Could not create the channel.');
      return;
    }
    setNewChannelName('');
    setNewChannelMembers([]);
    setShowNewChannel(false);
  };

  const handleOpenDM = async (targetId: string) => {
    try {
      const dm = await openDM(targetId, token);
      setDMs((prev) => prev.some((d) => d.id === dm.id) ? prev : [...prev, { id: dm.id, name: members.find((m) => m.id === targetId)?.displayName ?? 'DM', type: 'dm', unreadCount: 0 }]);
      setActiveChannelId(dm.id);
      setTab('dms');
    } catch {
      const ch = factoryStore.openDM(targetId);
      if (ch) {
        setDMs((prev) => prev.some((d) => d.id === ch.id) ? prev : [...prev, { id: ch.id, name: ch.name, type: 'dm', unreadCount: 0 }]);
        setActiveChannelId(ch.id);
        setTab('dms');
      }
    }
    setShowDMPicker(false);
    setDMSearch('');
  };

  const activeChannel = [...channels, ...dms].find((c) => c.id === activeChannelId);
  const filteredDMMembers = members.filter((m) =>
    m.id !== (state.currentUser?.id ?? state.members[0]?.id) &&
    (m.displayName.toLowerCase().includes(dmSearch.toLowerCase()) || m.email.toLowerCase().includes(dmSearch.toLowerCase()))
  );

  const typingLabel = (() => {
    const names = typingUsers.map((uid) => members.find((m) => m.id === uid)?.displayName ?? 'Someone');
    if (!names.length) return null;
    if (names.length === 1) return `${names[0]} is typing…`;
    return `${names.slice(0, 2).join(', ')} are typing…`;
  })();

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0,
      width: 680, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0A0A0F',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0d1017', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={16} style={{ color: '#075BFF' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f5' }}>Team Chat</span>
          <span style={{ fontSize: 10, color: '#00d9a6', fontFamily: 'var(--font-mono)', background: 'rgba(0,217,166,0.1)', border: '1px solid rgba(0,217,166,0.2)', padding: '1px 6px', borderRadius: 4 }}>
            {onlineUsers.length} online
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4, display: 'flex', borderRadius: 6 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Left sidebar (channel list) ───────────────────────────────────── */}
        <div style={{
          width: 220, display: 'flex', flexDirection: 'column', flexShrink: 0,
          background: '#0d1017', borderRight: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {(['channels', 'dms'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: tab === t ? '#f0f2f5' : 'rgba(255,255,255,0.35)',
                borderBottom: `2px solid ${tab === t ? '#075BFF' : 'transparent'}`,
                transition: 'all 0.15s',
              }}>
                {t === 'channels' ? 'Channels' : 'Direct'}
              </button>
            ))}
          </div>

          {/* Channel / DM list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {tab === 'channels' && (
              <>
                {loadingChannels ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Loader2 size={16} style={{ color: 'rgba(255,255,255,0.3)', animation: 'spin 1s linear infinite' }} /></div>
                ) : channels.map((ch) => (
                  <button key={ch.id} onClick={() => switchChannel(ch.id)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
                    background: activeChannelId === ch.id ? 'rgba(7,91,255,0.15)' : 'none',
                    border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 0,
                    transition: 'background 0.1s',
                  }}
                    onMouseEnter={(e) => { if (activeChannelId !== ch.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { if (activeChannelId !== ch.id) e.currentTarget.style.background = 'none'; }}
                  >
                    <Hash size={13} style={{ color: activeChannelId === ch.id ? '#075BFF' : 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: activeChannelId === ch.id ? '#f0f2f5' : 'rgba(255,255,255,0.7)', fontWeight: activeChannelId === ch.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                    {ch.unreadCount > 0 && (
                      <span style={{ fontSize: 10, background: '#075BFF', color: '#fff', borderRadius: 8, padding: '0 5px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{ch.unreadCount}</span>
                    )}
                  </button>
                ))}
                {/* New channel */}
                {showNewChannel ? (
                  <div style={{ padding: '6px 10px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        autoFocus
                        value={newChannelName}
                        onChange={(e) => setNewChannelName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowNewChannel(false); }}
                        placeholder="channel-name"
                        style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '4px 8px', fontSize: 12, color: '#f0f2f5', outline: 'none' }}
                      />
                      <button onClick={handleCreateChannel} style={{ background: '#075BFF', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#fff', fontSize: 11 }}>Add</button>
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: '8px 2px 4px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Members · private to them
                    </div>
                    <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                      {members.filter((m) => m.id !== state.currentUser?.id).map((m) => {
                        const on = newChannelMembers.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => setNewChannelMembers((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '4px 4px', background: on ? 'rgba(7,91,255,0.15)' : 'none', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                          >
                            <Avatar name={m.displayName} src={m.avatarUrl} size={18} />
                            <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: on ? '#f0f2f5' : '#d0d4de' }}>{m.displayName}</span>
                            {on && <span style={{ fontSize: 10, color: '#5b8fff' }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    {channelError && <div style={{ fontSize: 11, color: '#fda4af', marginTop: 6 }}>{channelError}</div>}
                  </div>
                ) : (
                  <button onClick={() => setShowNewChannel(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)' }}>
                    <Plus size={12} />
                    <span style={{ fontSize: 12 }}>Add channel</span>
                  </button>
                )}
              </>
            )}

            {tab === 'dms' && (
              <>
                {dms.map((dm) => {
                  const other = members.find((m) => m.id === (dm as any).otherUserId);
                  const isOnline = other ? onlineUsers.includes(other.id) : false;
                  return (
                    <button key={dm.id} onClick={() => switchChannel(dm.id)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                      background: activeChannelId === dm.id ? 'rgba(7,91,255,0.15)' : 'none',
                      border: 'none', cursor: 'pointer',
                    }}>
                      <Avatar name={dm.name} src={(dm as any).otherUserAvatar} size={22} online={isOnline} />
                      <span style={{ flex: 1, fontSize: 13, color: activeChannelId === dm.id ? '#f0f2f5' : 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dm.name}</span>
                      {dm.unreadCount > 0 && (
                        <span style={{ fontSize: 10, background: '#075BFF', color: '#fff', borderRadius: 8, padding: '0 5px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{dm.unreadCount}</span>
                      )}
                    </button>
                  );
                })}
                {/* New DM picker */}
                {showDMPicker ? (
                  <div style={{ padding: '6px 8px' }}>
                    <input
                      autoFocus
                      value={dmSearch}
                      onChange={(e) => setDMSearch(e.target.value)}
                      placeholder="Search members…"
                      style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: '#f0f2f5', outline: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                      {filteredDMMembers.map((m) => (
                        <button key={m.id} onClick={() => handleOpenDM(m.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '5px 4px', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Avatar name={m.displayName} src={m.avatarUrl} size={20} online={onlineUsers.includes(m.id)} />
                          <span style={{ fontSize: 12, color: '#d0d4de' }}>{m.displayName}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowDMPicker(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)' }}>
                    <Plus size={12} />
                    <span style={{ fontSize: 12 }}>New message</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: messages + composer ────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Channel header */}
          {activeChannel && (
            <div style={{
              height: 44, display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              {activeChannel.type === 'channel'
                ? <Hash size={14} style={{ color: '#075BFF' }} />
                : <Circle size={10} style={{ color: '#00d9a6', fill: '#00d9a6' }} />
              }
              <span style={{ fontSize: 14, fontWeight: 600, color: '#f0f2f5' }}>{activeChannel.name}</span>
              {activeChannel.description && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>{activeChannel.description}</span>
              )}
            </div>
          )}

          {/* Messages list */}
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
            {!activeChannelId && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.3)', gap: 8 }}>
                <MessageSquare size={32} />
                <p style={{ fontSize: 13 }}>Select a channel to start chatting</p>
              </div>
            )}
            {msgsLoading && activeChannelId && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                <Loader2 size={18} style={{ color: 'rgba(255,255,255,0.3)', animation: 'spin 1s linear infinite' }} />
              </div>
            )}
            {!msgsLoading && messages.length === 0 && activeChannelId && (
              <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                No messages yet. Say something! 👋
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageRow key={msg.id} msg={msg} members={members} prevMsg={messages[i - 1]} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          <div style={{ minHeight: 18, padding: '0 16px', flexShrink: 0 }}>
            {typingLabel && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', fontFamily: 'var(--font-mono)' }}>
                {typingLabel}
              </span>
            )}
          </div>

          {/* Composer */}
          {activeChannelId && (
            <Composer
              channelId={activeChannelId}
              token={token}
              members={members}
              placeholder={activeChannel?.type === 'dm' ? `Message ${activeChannel.name}` : `#${activeChannel?.name}`}
            />
          )}
        </div>
      </div>
    </div>
  );
};
