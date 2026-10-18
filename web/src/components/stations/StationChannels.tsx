/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Channels of one station of one project, inside that station's screen:
 * create one for the team, the project, or linked to the whole workspace;
 * link it later; and talk in it without leaving the station.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe2, Hash, Link2, Loader2, Lock, Plus, Send, Users } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ChatMessage, fetchMessages, sendMessageRest, useChatFrames } from '../../lib/chatSocket';
import { devQaApi, StationChannel } from '../../lib/devQaApi';
import { card, ErrorText, field, Modal } from './StationKit';

const AUDIENCE = {
  team: { label: 'My team', hint: 'People on this station of the project', Icon: Users },
  project: { label: 'Whole project', hint: 'Everyone on the project', Icon: Lock },
  workspace: { label: 'Linked to workspace', hint: 'Anyone in the workspace can find and join it', Icon: Globe2 },
} as const;

const Thread: React.FC<{ channel: StationChannel }> = ({ channel }) => {
  const token = factoryStore.getState().token ?? '';
  const me = factoryStore.getState().currentUser?.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    fetchMessages(channel.id, token)
      .then((rows) => setMessages([...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))))
      .catch((e) => setError((e as Error).message));
  }, [channel.id, token]);

  useChatFrames('message', (f) => {
    if (f.channelId !== channel.id) return;
    setMessages((prev) => (prev.some((m) => m.id === f.id) ? prev : [...prev, f as unknown as ChatMessage]));
  }, [channel.id]);

  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const m = await sendMessageRest(channel.id, body, [], token);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    } catch (e) {
      setError((e as Error).message);
      setText(body);
    }
  };

  return (
    <div className="flex flex-col h-[420px]">
      <div className="flex-1 overflow-y-auto space-y-2 p-4">
        {messages.length === 0 && <p className="text-xs text-[#827D8E]">No messages yet. Start the conversation.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] ${m.senderId === me ? 'ml-auto text-right' : ''}`}>
            <p className="text-[10px] text-[#827D8E]">
              {m.senderName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p
              className={`inline-block text-sm px-3 py-2 rounded-2xl mt-0.5 whitespace-pre-wrap text-left ${
                m.senderId === me ? 'bg-[#075BFF] text-white' : 'bg-white/[0.06] text-[#D1D5DB]'
              }`}
            >
              {m.body}
            </p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error && <div className="px-4"><ErrorText>{error}</ErrorText></div>}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder={`Message #${channel.name}`}
          className={field}
          aria-label={`Message #${channel.name}`}
        />
        <button
          onClick={() => void send()}
          disabled={!text.trim()}
          aria-label="Send"
          className="px-3 rounded-xl bg-[#075BFF] text-white cursor-pointer disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const StationChannels: React.FC<{ projectId: string; projectCode: string; station: string; stationLabel: string }> = ({
  projectId,
  projectCode,
  station,
  stationLabel,
}) => {
  const [channels, setChannels] = useState<StationChannel[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const all = await devQaApi.channels();
      const mine = all.filter((c) => c.projectId === projectId && c.station === station);
      setChannels(mine);
      setOpen((cur) => cur ?? mine[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, station]);

  useEffect(() => {
    void load();
  }, [load]);
  useChatFrames('channel_created', () => void load(), [load]);

  const link = async (id: string) => {
    setError(null);
    try {
      await devQaApi.linkChannel(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const current = channels.find((c) => c.id === open) ?? null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <div className={`${card} p-3 space-y-1 h-fit`}>
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[11px] uppercase font-mono text-[#827D8E]">{stationLabel} channels</p>
          <button onClick={() => setCreating(true)} aria-label="New channel" className="p-1 text-[#7aa7ff] hover:text-white cursor-pointer">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {channels.length === 0 && <p className="px-1 text-xs text-[#827D8E]">No channels yet for this space.</p>}
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setOpen(c.id)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer ${
              open === c.id ? 'bg-[#075BFF]/15 text-white' : 'text-[#B5B1C0] hover:bg-white/[0.04]'
            }`}
          >
            <Hash className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate flex-1">{c.name}</span>
            {c.visibility === 'public' && <Globe2 className="w-3 h-3 text-emerald-300" aria-label="Linked to workspace" />}
            {c.unreadCount > 0 && <span className="text-[10px] px-1.5 rounded-full bg-rose-500 text-white">{c.unreadCount}</span>}
          </button>
        ))}
      </div>
      <div className={`${card} overflow-hidden`}>
        {current ? (
          <>
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">#{current.name}</p>
                <p className="text-[11px] text-[#827D8E]">
                  {current.visibility === 'public' ? 'Linked to the workspace: anyone can find it' : 'Private to the people added'}
                  {current.description ? ` · ${current.description}` : ''}
                </p>
              </div>
              {current.visibility !== 'public' && (
                <button
                  onClick={() => void link(current.id)}
                  className="px-3 py-1.5 rounded-lg border border-white/[0.1] text-xs text-[#B5B1C0] hover:text-white flex items-center gap-1.5 cursor-pointer"
                  title="Make this channel visible to everyone in the workspace"
                >
                  <Link2 className="w-3.5 h-3.5" /> Link to workspace
                </button>
              )}
            </div>
            <Thread channel={current} />
          </>
        ) : (
          <div className="p-10 text-center space-y-3">
            <Hash className="w-8 h-8 mx-auto text-[#075BFF]" />
            <p className="text-sm text-white">A place for the {stationLabel.toLowerCase()} team of this project to talk.</p>
            <button onClick={() => setCreating(true)} className="px-4 py-2 rounded-xl bg-[#075BFF] text-white text-xs font-semibold cursor-pointer">
              Create a channel
            </button>
          </div>
        )}
        {error && <div className="px-4 pb-3"><ErrorText>{error}</ErrorText></div>}
      </div>
      {creating && (
        <CreateChannel
          defaultName={`${projectCode}-${station === 'developer' ? 'dev' : station}`.toLowerCase()}
          stationLabel={stationLabel}
          onClose={() => setCreating(false)}
          onCreate={async (name, audience, description) => {
            const ch = await devQaApi.createChannel({ name, project_id: projectId, station, audience, description });
            await load();
            setOpen(ch.id);
          }}
        />
      )}
    </div>
  );
};

const CreateChannel: React.FC<{
  defaultName: string;
  stationLabel: string;
  onClose: () => void;
  onCreate: (name: string, audience: keyof typeof AUDIENCE, description: string) => Promise<void>;
}> = ({ defaultName, stationLabel, onClose, onCreate }) => {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<keyof typeof AUDIENCE>('team');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), audience, description.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`New ${stationLabel.toLowerCase()} channel`} subtitle="It lives in this station of this project." onClose={onClose}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="channel-name" className={`${field} font-mono`} aria-label="Channel name" />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is it for? (optional)"
        className={field}
        aria-label="Description"
      />
      <div className="space-y-1.5" role="radiogroup" aria-label="Who is it for">
        {(Object.keys(AUDIENCE) as (keyof typeof AUDIENCE)[]).map((a) => {
          const { label, hint, Icon } = AUDIENCE[a];
          return (
            <label
              key={a}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                audience === a ? 'border-[#075BFF]/60 bg-[#075BFF]/10' : 'border-white/[0.08] hover:bg-white/[0.03]'
              }`}
            >
              <input type="radio" name="audience" checked={audience === a} onChange={() => setAudience(a)} className="mt-1" />
              <Icon className="w-4 h-4 text-[#7aa7ff] mt-0.5" />
              <span>
                <span className="block text-sm text-white">{label}</span>
                <span className="block text-[11px] text-[#827D8E]">{hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-xs text-[#827D8E] hover:text-white cursor-pointer">
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || name.trim().length < 2}
          className="px-4 py-2 rounded-xl bg-[#075BFF] text-white text-xs font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Create
        </button>
      </div>
    </Modal>
  );
};

