/**
 * Full-screen team chat (Slack-style), rendered inside the workspace shell.
 *
 * Data and realtime come from lib/chatSocket (same as the quick-peek ChatPanel).
 * Messages are Markdown (GFM) rendered with react-markdown + highlight.js;
 * files, images and voice notes go through /api/chat/.../attachments.
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {
  AtSign, Bold, ChevronDown, Code, Download, FileCode2, FileText, Hash, Image as ImageIcon,
  Italic, Link2, List, ListChecks, ListOrdered, Loader2, Lock, Mic, Paperclip, Plus, Quote,
  Search, SendHorizontal, Smile, SquareCode, Strikethrough, Trash2, Type, X,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { SoftAurora } from '../reactbits/SoftAurora';
import {
  chatSocket, createChannel, fetchAttachmentBlob, fetchChannels, fetchDMs, fetchWorkspaceMembers,
  openDM, uploadAttachment, useChannelMessages, useChatFrames, usePresence, useTypingUsers,
  type ChannelMeta, type ChatAttachment, type ChatMessage, type WorkspaceMember,
} from '../../lib/chatSocket';
import { openChatChannel } from '../shell/ChatPanel';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const CODE_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', rb: 'ruby', php: 'php', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', swift: 'swift', sh: 'bash',
  sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', html: 'html', css: 'css',
  xml: 'xml', txt: 'plaintext', log: 'plaintext', env: 'bash', dockerfile: 'dockerfile', tf: 'hcl',
};
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : name.toLowerCase());

const SNIPPET_LANGS = ['plaintext', 'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp',
  'cpp', 'c', 'ruby', 'php', 'swift', 'bash', 'sql', 'json', 'yaml', 'html', 'css', 'markdown', 'dockerfile'];

function Avatar({ name, src, size = 36, online }: { name: string; src?: string | null; size?: number; online?: boolean }) {
  const initials = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src
        ? <img src={src} alt="" className="w-full h-full rounded-lg object-cover" />
        : <div className="w-full h-full rounded-lg flex items-center justify-center font-semibold text-white bg-gradient-to-br from-[#075BFF] to-indigo-600" style={{ fontSize: size * 0.38 }}>{initials}</div>}
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0A0A0F] ${online ? 'bg-[#00d9a6]' : 'bg-[#5b5866]'}`} />
      )}
    </div>
  );
}

// ── attachments ──────────────────────────────────────────────────────────────

function useBlobUrl(id: string, token: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    fetchAttachmentBlob(id, token).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => {});
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, token]);
  return url;
}

function ImageAttachment({ a, token, onOpen }: { a: ChatAttachment; token: string; onOpen: (url: string) => void }) {
  const url = useBlobUrl(a.id, token);
  return (
    <button onClick={() => url && onOpen(url)} className="block rounded-lg overflow-hidden border border-white/10 bg-white/[0.03] hover:border-white/25 transition-colors">
      {url ? <img src={url} alt={a.filename} className="max-h-72 max-w-[min(420px,100%)] object-contain" /> : <div className="w-64 h-40 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>}
    </button>
  );
}

function AudioAttachment({ a, token }: { a: ChatAttachment; token: string }) {
  const url = useBlobUrl(a.id, token);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#101016] px-3 py-2 w-fit max-w-full">
      <Mic className="w-4 h-4 text-[#75aaff] shrink-0" />
      {url ? <audio controls src={url} className="h-9 max-w-[320px]" /> : <Loader2 className="w-4 h-4 animate-spin text-white/30" />}
    </div>
  );
}

function FileAttachment({ a, token }: { a: ChatAttachment; token: string }) {
  const lang = CODE_EXT[extOf(a.filename)] ?? (a.contentType.startsWith('text/') ? 'plaintext' : null);
  const [preview, setPreview] = useState<string | null>(null);
  const download = async () => {
    const b = await fetchAttachmentBlob(a.id, token);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(b);
    link.download = a.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  };
  const togglePreview = async () => {
    if (preview !== null) { setPreview(null); return; }
    const text = await (await fetchAttachmentBlob(a.id, token)).text();
    setPreview(text.length > 60000 ? `${text.slice(0, 60000)}\n…` : text);
  };
  return (
    <div className="rounded-xl border border-white/10 bg-[#101016] overflow-hidden max-w-[640px]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${lang ? 'bg-[#075BFF]/20 text-[#7aa8ff]' : 'bg-white/10 text-white/70'}`}>
          {lang ? <FileCode2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-white truncate">{a.filename}</div>
          <div className="text-[12px] text-white/45">{lang ? `${lang} · ` : ''}{fmtSize(a.size)}</div>
        </div>
        {lang && a.size < 400_000 && (
          <button onClick={togglePreview} className="text-[12px] px-2.5 py-1 rounded-md border border-white/10 text-white/70 hover:text-white hover:bg-white/5">{preview !== null ? 'Hide' : 'Preview'}</button>
        )}
        <button onClick={download} title="Download" className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5"><Download className="w-4 h-4" /></button>
      </div>
      {preview !== null && (
        <div className="border-t border-white/10 max-h-96 overflow-auto chat-md">
          <ReactMarkdown rehypePlugins={[[rehypeHighlight, { detect: true }]]}>{'```' + (lang ?? '') + '\n' + preview + '\n```'}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ── message ──────────────────────────────────────────────────────────────────

function MessageBody({ body, members }: { body: string; members: WorkspaceMember[] }) {
  const md = useMemo(() => {
    let out = body;
    for (const m of [...members].sort((a, b) => b.displayName.length - a.displayName.length)) {
      out = out.replace(new RegExp(`@${escapeRe(m.displayName)}(?![\\w])`, 'g'), `[@${m.displayName}](mention:${m.id})`);
    }
    return out;
  }, [body, members]);
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        urlTransform={(u) => (u.startsWith('mention:') ? u : defaultUrlTransform(u))}
        components={{
          a: ({ href, children }) => href?.startsWith('mention:')
            ? <span className="chat-mention">{children}</span>
            : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        }}
      >{md}</ReactMarkdown>
    </div>
  );
}

function MessageItem({ msg, grouped, members, token, onImage }: {
  msg: ChatMessage; grouped: boolean; members: WorkspaceMember[]; token: string; onImage: (u: string) => void;
}) {
  const sender = members.find((m) => m.id === msg.senderId);
  const name = sender?.displayName ?? msg.senderName;
  const files = msg.attachments ?? [];
  return (
    <div className={`group relative flex gap-3 px-6 hover:bg-white/[0.03] transition-colors ${grouped ? 'py-0.5' : 'pt-2.5 pb-0.5 mt-1'}`}>
      <div className="w-9 shrink-0">
        {grouped
          ? <span className="hidden group-hover:block text-[11px] text-white/35 text-right pt-1">{fmtTime(msg.createdAt)}</span>
          : <Avatar name={name} src={sender?.avatarUrl ?? msg.senderAvatar} />}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-white hover:underline cursor-pointer">{name}</span>
            <span className="text-[12px] text-white/40">{fmtTime(msg.createdAt)}</span>
          </div>
        )}
        {msg.body && <MessageBody body={msg.body} members={members} />}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {files.map((a) => a.kind === 'image'
              ? <ImageAttachment key={a.id} a={a} token={token} onOpen={onImage} />
              : a.kind === 'audio' ? <AudioAttachment key={a.id} a={a} token={token} />
              : <FileAttachment key={a.id} a={a} token={token} />)}
          </div>
        )}
      </div>
      <div className="absolute -top-3 right-6 hidden group-hover:flex items-center rounded-lg border border-white/10 bg-[#101016] shadow-xl">
        <button title="Copy text" onClick={() => navigator.clipboard?.writeText(msg.body)} className="p-1.5 text-white/60 hover:text-white"><FileText className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

// ── composer ─────────────────────────────────────────────────────────────────

interface Pending { key: string; name: string; size: number; status: 'uploading' | 'ready' | 'error'; att?: ChatAttachment; error?: string }

function Composer({ channel, members, token, onUploadedFiles }: {
  channel: ChannelMeta; members: WorkspaceMember[]; token: string; onUploadedFiles?: () => void;
}) {
  const [text, setText] = useState('');
  const [showToolbar, setShowToolbar] = useState(true);
  const [plusOpen, setPlusOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => { setText(''); setPending([]); setMentionIds([]); }, [channel.id]);
  useEffect(() => {
    const el = ta.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 280)}px`; }
  }, [text]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recording.started) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  const upload = useCallback((files: File[] | FileList) => {
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      setPending((p) => [...p, { key, name: f.name, size: f.size, status: 'uploading' }]);
      uploadAttachment(channel.id, f, f.name, token)
        .then((att) => { setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'ready', att } : x))); onUploadedFiles?.(); })
        .catch((e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'error', error: e.message } : x))));
    }
  }, [channel.id, token, onUploadedFiles]);

  // Drop and paste anywhere on the page land here.
  useEffect(() => {
    const onDrop = (e: DragEvent) => { if (e.dataTransfer?.files.length) { e.preventDefault(); upload(e.dataTransfer.files); } };
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    return () => { window.removeEventListener('drop', onDrop); window.removeEventListener('dragover', onOver); };
  }, [upload]);

  const send = (bodyOverride?: string, extraIds: string[] = []) => {
    const body = (bodyOverride ?? text).trim();
    const ids = [...pending.filter((p) => p.status === 'ready').map((p) => p.att!.id), ...extraIds];
    if (!body && !ids.length) return;
    if (pending.some((p) => p.status === 'uploading')) return;
    const mentions = mentionIds.filter((id) => {
      const m = members.find((x) => x.id === id);
      return m && body.includes(`@${m.displayName}`);
    });
    chatSocket.sendMessage(channel.id, body, mentions, ids);
    if (bodyOverride === undefined) { setText(''); setPending([]); setMentionIds([]); }
  };

  // Markdown formatting on the selection (Slack-style toolbar).
  const wrap = (before: string, after = before, placeholder = 'text') => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = text.slice(s, e) || placeholder;
    const next = text.slice(0, s) + before + sel + after + text.slice(e);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); });
  };
  const prefixLines = (fn: (i: number) => string) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const start = text.lastIndexOf('\n', s - 1) + 1;
    const block = text.slice(start, e) || '';
    const lines = (block || 'item').split('\n').map((l, i) => fn(i) + l);
    setText(text.slice(0, start) + lines.join('\n') + text.slice(e));
    requestAnimationFrame(() => el.focus());
  };
  const insert = (str: string) => {
    const el = ta.current;
    const s = el?.selectionStart ?? text.length;
    setText(text.slice(0, s) + str + text.slice(el?.selectionEnd ?? s));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + str.length, s + str.length); });
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const m = v.slice(0, e.target.selectionStart).match(/@([\w.\- ]{0,30})$/);
    setMentionQ(m ? m[1] : null);
    if (Date.now() - lastTyping.current > 2000) { chatSocket.sendTyping(channel.id); lastTyping.current = Date.now(); }
  };
  const pickMention = (m: WorkspaceMember) => {
    const el = ta.current!;
    const pos = el.selectionStart;
    const start = text.slice(0, pos).lastIndexOf('@');
    setText(`${text.slice(0, start)}@${m.displayName} ${text.slice(pos)}`);
    setMentionIds((ids) => [...new Set([...ids, m.id])]);
    setMentionQ(null);
    requestAnimationFrame(() => el.focus());
  };
  const mentionMatches = mentionQ === null ? [] : members
    .filter((m) => m.displayName.toLowerCase().includes(mentionQ.toLowerCase().trim())).slice(0, 6);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(mentionMatches[0]); return; }
    if (e.key === 'Escape') { setMentionQ(null); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'b') { e.preventDefault(); wrap('**'); return; }
    if (mod && e.key === 'i') { e.preventDefault(); wrap('_'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); wrap('~~'); return; }
    if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); setSnippetOpen(true); return; }
    if (e.key === 'Enter' && !e.shiftKey && !text.trimStart().startsWith('```')) { e.preventDefault(); send(); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if ((rec as MediaRecorder & { cancelled?: boolean }).cancelled || !chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        try {
          const att = await uploadAttachment(channel.id, blob, `voice-message.${ext}`, token);
          send('', [att.id]);
        } catch (err) { alert((err as Error).message); }
      };
      rec.start();
      setElapsed(0);
      setRecording({ rec, started: Date.now() });
    } catch {
      alert('Microphone access was blocked.');
    }
  };
  const stopRecording = (cancel = false) => {
    if (!recording) return;
    (recording.rec as MediaRecorder & { cancelled?: boolean }).cancelled = cancel;
    recording.rec.stop();
    setRecording(null);
  };

  const placeholder = channel.type === 'dm' ? `Message ${channel.name}` : `Message #${channel.name}`;
  const tb = 'p-1.5 rounded-md text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors';

  return (
    <div className="relative px-6 pb-5 pt-1">
      {mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-6 mb-2 w-80 rounded-xl border border-white/10 bg-[#101016] shadow-2xl overflow-hidden z-30">
          {mentionMatches.map((m) => (
            <button key={m.id} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#075BFF]/25 text-left">
              <Avatar name={m.displayName} src={m.avatarUrl} size={24} online={m.online} />
              <span className="text-[14px] text-white">{m.displayName}</span>
              <span className="ml-auto text-[12px] text-white/40 truncate">{m.email}</span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/15 bg-[#101016]/95 backdrop-blur focus-within:border-white/30 transition-colors shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        {showToolbar && (
          <div className="flex items-center gap-0.5 px-2 pt-2">
            <button className={tb} title="Bold (⌘B)" onClick={() => wrap('**')}><Bold className="w-4 h-4" /></button>
            <button className={tb} title="Italic (⌘I)" onClick={() => wrap('_')}><Italic className="w-4 h-4" /></button>
            <button className={tb} title="Strikethrough (⌘⇧X)" onClick={() => wrap('~~')}><Strikethrough className="w-4 h-4" /></button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button className={tb} title="Link" onClick={() => wrap('[', '](https://)', 'link text')}><Link2 className="w-4 h-4" /></button>
            <button className={tb} title="Numbered list" onClick={() => prefixLines((i) => `${i + 1}. `)}><ListOrdered className="w-4 h-4" /></button>
            <button className={tb} title="Bulleted list" onClick={() => prefixLines(() => '- ')}><List className="w-4 h-4" /></button>
            <button className={tb} title="Checklist" onClick={() => prefixLines(() => '- [ ] ')}><ListChecks className="w-4 h-4" /></button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button className={tb} title="Quote" onClick={() => prefixLines(() => '> ')}><Quote className="w-4 h-4" /></button>
            <button className={tb} title="Code" onClick={() => wrap('`', '`', 'code')}><Code className="w-4 h-4" /></button>
            <button className={tb} title="Code block" onClick={() => wrap('```\n', '\n```', 'code')}><SquareCode className="w-4 h-4" /></button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2.5">
            {pending.map((p) => (
              <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${p.status === 'error' ? 'border-red-500/40 text-red-300' : 'border-white/10 text-white/80'} bg-white/[0.04]`}>
                {p.status === 'uploading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                <span className="max-w-[180px] truncate">{p.name}</span>
                <span className="text-white/35">{p.error ?? fmtSize(p.size)}</span>
                <button onClick={() => setPending((xs) => xs.filter((x) => x.key !== p.key))} className="text-white/40 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[15px] text-white font-mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
            <span className="text-[14px] text-white/50">Recording voice message…</span>
            <button onClick={() => stopRecording(true)} className="ml-auto p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5" title="Discard"><Trash2 className="w-4 h-4" /></button>
            <button onClick={() => stopRecording(false)} className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-[13px] font-semibold hover:brightness-110">Send</button>
          </div>
        ) : (
          <textarea
            ref={ta}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); upload(e.clipboardData.files); } }}
            placeholder={placeholder}
            rows={1}
            className="block w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-white placeholder:text-white/35 outline-none"
          />
        )}

        <div className="flex items-center gap-0.5 px-2 pb-2">
          <div className="relative">
            <button onClick={() => setPlusOpen((o) => !o)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${plusOpen ? 'bg-white/20 text-white' : 'bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white'}`} title="Attach">
              <Plus className="w-4 h-4" />
            </button>
            {plusOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/10 bg-[#101016] shadow-2xl py-1.5 z-30" onMouseLeave={() => setPlusOpen(false)}>
                {[
                  { icon: ListChecks, label: 'List', act: () => { prefixLines(() => '- [ ] '); } },
                  { icon: SquareCode, label: 'Text snippet', hint: '⌘⇧Enter', act: () => setSnippetOpen(true) },
                  { icon: ImageIcon, label: 'Upload from your computer', hint: '10 MB', act: () => fileInput.current?.click() },
                ].map(({ icon: I, label, hint, act }) => (
                  <button key={label} onClick={() => { setPlusOpen(false); act(); }} className="w-full flex items-center gap-3 px-3.5 py-2 text-[14px] text-white/90 hover:bg-[#075BFF]/25 text-left">
                    <I className="w-4 h-4 text-white/70" /> <span className="flex-1">{label}</span>
                    {hint && <span className="text-[12px] text-white/35">{hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={`${tb} ${showToolbar ? 'text-white' : ''}`} title="Show formatting" onClick={() => setShowToolbar((v) => !v)}><Type className="w-4 h-4" /></button>
          <div className="relative">
            <button className={tb} title="Emoji" onClick={() => setEmojiOpen((o) => !o)}><Smile className="w-4 h-4" /></button>
            {emojiOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-30">
                <Suspense fallback={<div className="w-[350px] h-[400px] rounded-xl bg-[#101016] flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>}>
                  <EmojiPicker theme={'dark' as never} onEmojiClick={(e) => { insert(e.emoji); setEmojiOpen(false); }} lazyLoadEmojis />
                </Suspense>
              </div>
            )}
          </div>
          <button className={tb} title="Mention someone" onClick={() => { insert('@'); setMentionQ(''); }}><AtSign className="w-4 h-4" /></button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button className={tb} title="Record a voice message" onClick={() => (recording ? stopRecording(false) : startRecording())}><Mic className="w-4 h-4" /></button>
          <button className={tb} title="Text snippet" onClick={() => setSnippetOpen(true)}><FileCode2 className="w-4 h-4" /></button>
          <button
            onClick={() => send()}
            disabled={!text.trim() && !pending.some((p) => p.status === 'ready')}
            className="ml-auto h-8 px-3 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold transition-all disabled:bg-transparent disabled:text-white/25 bg-[#075BFF] text-white hover:brightness-110"
            title="Send (Enter)"
          >
            <SendHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="px-1 pt-1.5 text-[11px] text-white/30"><b>Enter</b> to send · <b>Shift+Enter</b> new line · drop or paste files to attach (10 MB)</div>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
      {snippetOpen && <SnippetModal onClose={() => setSnippetOpen(false)} onSend={(lang, title, code) => { send(`${title ? `**${title}**\n` : ''}\`\`\`${lang}\n${code}\n\`\`\``); setSnippetOpen(false); }} />}
    </div>
  );
}

function SnippetModal({ onClose, onSend }: { onClose: () => void; onSend: (lang: string, title: string, code: string) => void }) {
  const [lang, setLang] = useState('plaintext');
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#101016] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-[17px] font-bold text-white">Create a text snippet</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="flex-1 rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-[14px] text-white outline-none focus:border-white/30" />
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg bg-[#17151D] border border-white/10 px-3 py-2 text-[14px] text-white outline-none">
              {SNIPPET_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <textarea autoFocus value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} placeholder="Paste or type code…" className="w-full h-72 rounded-lg bg-[#0E0D14] border border-white/10 p-3 font-mono text-[13px] leading-relaxed text-[#e6edf3] outline-none focus:border-white/30 resize-y" />
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/15 text-[14px] text-white/80 hover:bg-white/5">Cancel</button>
          <button disabled={!code.trim()} onClick={() => onSend(lang, title.trim(), code.replace(/\n+$/, ''))} className="px-4 py-2 rounded-lg bg-[#075BFF] text-[14px] font-semibold text-white disabled:opacity-40">Share snippet</button>
        </div>
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export const ChatPage: React.FC = () => {
  const state = factoryStore.getState();
  const token = state.token ?? '';
  const workspaceName = state.workspaces?.find?.((w: { id: string; name: string }) => w.id === state.activeWorkspaceId)?.name ?? 'Workspace';

  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [dms, setDMs] = useState<ChannelMeta[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [openSections, setOpenSections] = useState({ channels: true, dms: true });
  const [creating, setCreating] = useState<'channel' | 'dm' | null>(null);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'messages' | 'files'>('messages');
  const [lightbox, setLightbox] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const online = usePresence();
  const typing = useTypingUsers(activeId);
  const { messages, loading } = useChannelMessages(activeId, token);

  useEffect(() => {
    if (token) chatSocket.connect(token, state.activeWorkspaceId.length === 36 ? state.activeWorkspaceId : undefined);
  }, [token, state.activeWorkspaceId]);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [chs, d, mem] = await Promise.all([fetchChannels(token), fetchDMs(token), fetchWorkspaceMembers(token)]);
      setChannels(chs); setDMs(d); setMembers(mem);
      setActiveId((cur) => cur ?? chs.find((c) => c.name === 'general')?.id ?? chs[0]?.id ?? null);
    } catch { /* offline: keep what we have */ }
  }, [token, state.activeWorkspaceId]);
  useEffect(() => { reload(); }, [reload]);
  useChatFrames('channel_created', () => reload(), [reload]);
  useChatFrames('reconnected', () => reload(), [reload]);

  // Activity rows open a specific channel.
  useEffect(() => {
    const onOpen = (e: Event) => setActiveId((e as CustomEvent<string>).detail);
    window.addEventListener('karkhana:open-channel', onOpen);
    return () => window.removeEventListener('karkhana:open-channel', onOpen);
  }, []);

  useChatFrames('message', (f) => {
    const known = [...channels, ...dms].some((c) => c.id === f.channelId);
    if (!known) { reload(); return; }
    if (f.channelId === activeId) { if (f.senderId === state.currentUser?.id) atBottom.current = true; return; }
    const bump = (cs: ChannelMeta[]) => cs.map((c) => (c.id === f.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c));
    setChannels(bump); setDMs(bump);
  }, [channels, dms, activeId, reload]);

  const select = (id: string) => {
    setActiveId(id); setTab('messages'); atBottom.current = true;
    const clear = (cs: ChannelMeta[]) => cs.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c));
    setChannels(clear); setDMs(clear);
  };

  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeId, tab]);

  const active = [...channels, ...dms].find((c) => c.id === activeId) ?? null;
  const q = filter.toLowerCase();
  const shownChannels = channels.filter((c) => c.name.toLowerCase().includes(q));
  const shownDMs = dms.filter((c) => c.name.toLowerCase().includes(q));
  const files = useMemo(() => messages.flatMap((m) => (m.attachments ?? []).map((a) => ({ a, m }))).reverse(), [messages]);
  const typingNames = typing.map((id) => members.find((m) => m.id === id)?.displayName ?? 'Someone');

  const submitCreate = async () => {
    setFormError(null);
    try {
      if (creating === 'channel') {
        if (!newName.trim()) return;
        const ch = await createChannel(newName.trim(), undefined, token, newMembers);
        await reload(); select(ch.id);
      } else if (creating === 'dm' && newMembers[0]) {
        const dm = await openDM(newMembers[0], token);
        await reload(); select(dm.id);
      }
      setCreating(null); setNewName(''); setNewMembers([]);
    } catch (e) {
      setFormError((e as Error).message.startsWith('409') ? 'A channel with that name exists' : 'Could not create it');
    }
  };

  const row = (c: ChannelMeta) => {
    const on = c.id === activeId;
    const other = members.find((m) => m.id === c.otherUserId);
    const unread = c.unreadCount > 0 && !on;
    return (
      <button key={c.id} onClick={() => select(c.id)}
        className={`w-full flex items-center gap-2 h-8 px-3 mx-0 rounded-md text-left text-[15px] transition-colors ${on ? 'bg-[#075BFF] text-white' : unread ? 'text-white font-bold hover:bg-white/[0.06]' : 'text-white/65 hover:bg-white/[0.06]'}`}>
        {c.type === 'dm'
          ? <Avatar name={c.name} src={c.otherUserAvatar ?? other?.avatarUrl} size={20} online={other ? online.includes(other.id) : undefined} />
          : (c as ChannelMeta & { visibility?: string }).visibility === 'private' ? <Lock className="w-4 h-4 shrink-0 opacity-70" /> : <Hash className="w-4 h-4 shrink-0 opacity-70" />}
        <span className="truncate flex-1">{c.name}</span>
        {unread && <span className="text-[11px] font-bold bg-[#075BFF] text-white rounded-full px-1.5 min-w-[20px] text-center">{c.unreadCount}</span>}
      </button>
    );
  };

  return (
    <div className="relative h-full w-full flex overflow-hidden bg-[#0B0A10] text-white" style={{ fontFamily: 'var(--font-sans)' }}>
      <style>{CHAT_CSS}</style>

      {/* Sidebar */}
      <aside className="relative w-[280px] shrink-0 flex flex-col border-r border-white/[0.08] bg-[#0A0A0F]/80 backdrop-blur-md">
        <div className="h-14 flex items-center justify-between px-4 border-b border-white/[0.08]">
          <button className="flex items-center gap-1 text-[18px] font-extrabold tracking-tight truncate">{workspaceName}<ChevronDown className="w-4 h-4 opacity-70" /></button>
          <button onClick={() => { setCreating('dm'); setNewMembers([]); }} title="New message" className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-white/[0.07] border border-white/[0.06] focus-within:border-white/25">
            <Search className="w-3.5 h-3.5 text-white/45" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a conversation…" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/40" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-4 chat-scroll">
          {(['channels', 'dms'] as const).map((sec) => (
            <div key={sec}>
              <div className="group flex items-center justify-between px-2 h-7">
                <button onClick={() => setOpenSections((s) => ({ ...s, [sec]: !s[sec] }))} className="flex items-center gap-1 text-[14px] text-white/60 hover:text-white">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openSections[sec] ? '' : '-rotate-90'}`} />
                  {sec === 'channels' ? 'Channels' : 'Direct messages'}
                </button>
                <button onClick={() => { setCreating(sec === 'channels' ? 'channel' : 'dm'); setNewMembers([]); setNewName(''); }} className="opacity-0 group-hover:opacity-100 text-white/60 hover:text-white" title="Add"><Plus className="w-4 h-4" /></button>
              </div>
              {openSections[sec] && <div className="space-y-px">{(sec === 'channels' ? shownChannels : shownDMs).map(row)}</div>}
              {openSections[sec] && (
                <button onClick={() => { setCreating(sec === 'channels' ? 'channel' : 'dm'); setNewMembers([]); setNewName(''); }} className="w-full flex items-center gap-2 h-8 px-3 rounded-md text-[14px] text-white/45 hover:bg-white/[0.06] hover:text-white/80">
                  <span className="w-5 h-5 rounded bg-white/10 flex items-center justify-center"><Plus className="w-3 h-3" /></span>
                  {sec === 'channels' ? 'Add channel' : 'Add teammate'}
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <section className="relative flex-1 min-w-0 flex flex-col">
        <div className="absolute inset-0 pointer-events-none opacity-[0.16] overflow-hidden">
          <SoftAurora speed={0.35} scale={1.4} brightness={0.75} color1="#075BFF" color2="#7C3AED" noiseFrequency={2.2} noiseAmplitude={0.9} bandHeight={0.55} bandSpread={1.2} lightMode={false} />
        </div>

        {active ? (
          <>
            <header className="relative z-10 border-b border-white/[0.08] bg-[#0F0D16]/80 backdrop-blur-md">
              <div className="h-14 flex items-center gap-2 px-6">
                {active.type === 'dm' ? <Avatar name={active.name} src={active.otherUserAvatar} size={26} /> : <Hash className="w-5 h-5 text-white/70" />}
                <h2 className="text-[18px] font-extrabold tracking-tight truncate">{active.name}</h2>
                {active.description && <span className="text-[13px] text-white/45 truncate ml-2">{active.description}</span>}
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {members.filter((m) => online.includes(m.id)).slice(0, 3).map((m) => <div key={m.id} className="ring-2 ring-[#0F0D16] rounded-lg"><Avatar name={m.displayName} src={m.avatarUrl} size={24} /></div>)}
                  </div>
                  <span className="text-[13px] text-white/55">{online.length} online</span>
                </div>
              </div>
              <nav className="flex items-center gap-1 px-5 -mb-px">
                {(['messages', 'files'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`px-2.5 pb-2 pt-0.5 text-[14px] border-b-2 transition-colors ${tab === t ? 'border-white text-white font-semibold' : 'border-transparent text-white/50 hover:text-white/80'}`}>
                    {t === 'messages' ? 'Messages' : `Files${files.length ? ` · ${files.length}` : ''}`}
                  </button>
                ))}
              </nav>
            </header>

            <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="relative z-10 flex-1 overflow-y-auto chat-scroll">
              {tab === 'files' ? (
                <div className="p-6 grid gap-3 max-w-3xl">
                  {files.length === 0 && <p className="text-white/45 text-[15px]">No files in this conversation yet.</p>}
                  {files.map(({ a, m }) => (
                    <div key={a.id} className="space-y-1">
                      <div className="text-[12px] text-white/40">{m.senderName} · {dayLabel(m.createdAt)} {fmtTime(m.createdAt)}</div>
                      {a.kind === 'image' ? <ImageAttachment a={a} token={token} onOpen={setLightbox} /> : a.kind === 'audio' ? <AudioAttachment a={a} token={token} /> : <FileAttachment a={a} token={token} />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pb-4 pt-6">
                  {loading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-white/30" /></div>}
                  {!loading && messages.length === 0 && (
                    <div className="px-6 pb-6">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#075BFF] to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-[#075BFF]/30"><Hash className="w-7 h-7" /></div>
                      <h3 className="text-[26px] font-extrabold">{active.type === 'dm' ? active.name : `Welcome to #${active.name}`}</h3>
                      <p className="text-[15px] text-white/55 mt-1">This is the very beginning of this conversation. Messages are kept for 90 days.</p>
                    </div>
                  )}
                  {messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                    const grouped = !newDay && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
                    return (
                      <React.Fragment key={m.id}>
                        {newDay && (
                          <div className="sticky top-2 z-20 flex items-center my-3 px-6">
                            <div className="flex-1 h-px bg-white/[0.08]" />
                            <span className="px-3.5 py-1 rounded-full border border-white/15 bg-[#101016] text-[13px] font-semibold text-white/85 shadow">{dayLabel(m.createdAt)}</span>
                            <div className="flex-1 h-px bg-white/[0.08]" />
                          </div>
                        )}
                        <MessageItem msg={m} grouped={grouped} members={members} token={token} onImage={setLightbox} />
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="relative z-10">
              <div className="h-5 px-7 text-[12px] text-white/50 italic">
                {typingNames.length > 0 && `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`}
              </div>
              <Composer channel={active} members={members} token={token} />
            </div>
          </>
        ) : (
          <div className="relative z-10 flex-1 flex items-center justify-center text-white/45 text-[15px]">
            {channels.length ? 'Pick a conversation' : <Loader2 className="w-6 h-6 animate-spin" />}
          </div>
        )}
      </section>

      {creating && (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => setCreating(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101016] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h3 className="text-[17px] font-bold">{creating === 'channel' ? 'Create a channel' : 'New direct message'}</h3>
              <button onClick={() => setCreating(null)} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              {creating === 'channel' && (
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.05] border border-white/10 px-3 focus-within:border-white/30">
                  <Hash className="w-4 h-4 text-white/40" />
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitCreate()} placeholder="e.g. build-team" className="flex-1 bg-transparent py-2 text-[14px] outline-none" />
                </div>
              )}
              <div className="text-[12px] uppercase tracking-wider text-white/40">{creating === 'channel' ? 'Members (private to them and you)' : 'Who?'}</div>
              <div className="max-h-64 overflow-y-auto space-y-0.5 chat-scroll">
                {members.filter((m) => m.id !== state.currentUser?.id).map((m) => {
                  const on = newMembers.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => setNewMembers((xs) => (creating === 'dm' ? [m.id] : on ? xs.filter((x) => x !== m.id) : [...xs, m.id]))}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left ${on ? 'bg-[#075BFF]/25' : 'hover:bg-white/[0.05]'}`}>
                      <Avatar name={m.displayName} src={m.avatarUrl} size={26} online={online.includes(m.id)} />
                      <span className="text-[14px] flex-1">{m.displayName}</span>
                      <span className={`w-4 h-4 rounded border ${on ? 'bg-[#075BFF] border-[#075BFF]' : 'border-white/25'}`} />
                    </button>
                  );
                })}
              </div>
              {formError && <p className="text-[13px] text-red-300">{formError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setCreating(null)} className="px-4 py-2 rounded-lg border border-white/15 text-[14px] text-white/80 hover:bg-white/5">Cancel</button>
              <button onClick={submitCreate} disabled={creating === 'channel' ? !newName.trim() : !newMembers.length} className="px-4 py-2 rounded-lg bg-[#075BFF] text-[14px] font-semibold disabled:opacity-40">{creating === 'channel' ? 'Create' : 'Open'}</button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[300] bg-black/85 flex items-center justify-center p-8" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl" />
          <button className="absolute top-5 right-5 text-white/70 hover:text-white"><X className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

export { openChatChannel };

const CHAT_CSS = `
.chat-md { font-size: 15px; line-height: 1.55; color: rgba(255,255,255,0.88); overflow-wrap: anywhere; }
.chat-md p { margin: 0; }
.chat-md p + p { margin-top: 4px; }
.chat-md strong { color: #fff; font-weight: 700; }
.chat-md a { color: #75aaff; text-decoration: none; }
.chat-md a:hover { text-decoration: underline; }
.chat-md ul, .chat-md ol { margin: 4px 0; padding-left: 22px; }
.chat-md ul { list-style: disc; } .chat-md ol { list-style: decimal; }
.chat-md li.task-list-item { list-style: none; margin-left: -20px; }
.chat-md li.task-list-item input { margin-right: 6px; accent-color: #075BFF; }
.chat-md blockquote { border-left: 4px solid rgba(255,255,255,0.25); padding-left: 12px; margin: 4px 0; color: rgba(255,255,255,0.7); }
.chat-md code { font-family: var(--font-mono); font-size: 12.5px; color: #F0A35E; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 1px 4px; }
.chat-md pre { margin: 6px 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; background: #0E0D14 !important; overflow-x: auto; }
.chat-md pre code { display: block; padding: 12px 14px; border: 0; background: transparent; color: #e6edf3; font-size: 13px; line-height: 1.55; }
.chat-md pre code.hljs { background: transparent; }
.chat-md table { border-collapse: collapse; margin: 6px 0; } .chat-md th, .chat-md td { border: 1px solid rgba(255,255,255,0.12); padding: 4px 8px; }
.chat-md del { opacity: 0.7; }
.chat-mention { color: #75aaff; background: rgba(7,91,255,0.18); border-radius: 4px; padding: 0 3px; font-weight: 600; }
.chat-scroll::-webkit-scrollbar { width: 10px; } .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
`;
