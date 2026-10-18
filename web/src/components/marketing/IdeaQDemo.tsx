import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronRight, MessageSquare, Plus, Send, Sparkles } from 'lucide-react';
import { Frame } from './demoKit';
import type { RecordFn } from './ledger';

const STARTERS = [
  { q: 'Audit architectural bottlenecks in our codebase', a: ['Scanning payments/, settlement/ and 214 files…', 'Found 3 hotspots with citations.'], body: '1. **settlement/batch.py:41** creates a batch per job with no idempotency key, so a worker restart double-submits.\n2. **payments/ratelimit.py:17** uses a fixed window; bursts at the window edge pass through.\n3. **reporting/render.py:9** pins jinja2 2.x (known sandbox escape).', idea: 'Idempotent retries for settlement jobs' },
  { q: 'Propose 3 high-impact features with expected ROI', a: ['Reading open incidents and support themes…', 'Ranking by effort and evidence.'], body: '1. **Idempotent settlement retries**: ~6 ops hours/week recovered.\n2. **Token-bucket rate limiter**: removes campaign-launch throttling incidents.\n3. **Self-serve refund reconciliation**: cuts ~40% of merchant support tickets.', idea: 'Token-bucket rate limiter service' },
  { q: 'Evaluate security and scalability risks', a: ['Cross-checking SBOM and dependency graph…', 'Summarising by severity.'], body: '**High:** jinja2 2.x in reporting worker.\n**Medium:** webhook handler has no replay protection.\n**Low:** settlement table lacks a partial index on `status`. Every finding links to file and line.', idea: 'Webhook replay protection' },
];

const render = (s: string) =>
  s.split('\n').map((line, i) => (
    <p key={i} className="mb-1.5" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/`(.+?)`/g, '<code class="px-1 rounded bg-black/40 text-[#7aa7ff]">$1</code>') }} />
  ));

export const IdeaQDemo: React.FC<{ record: RecordFn }> = ({ record }) => {
  const [turns, setTurns] = useState<{ q: string; body?: string; idea?: string; saved?: boolean }[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns, steps]);

  const ask = (q: string) => {
    if (thinking || !q.trim()) return;
    const hit = STARTERS.find((s) => s.q === q) ?? STARTERS[(turns.length + 1) % STARTERS.length];
    setTurns((t) => [...t, { q }]);
    setThinking(true);
    setSteps([]);
    hit.a.forEach((s, i) => timers.current.push(setTimeout(() => setSteps((p) => [...p, s]), 500 * (i + 1))));
    timers.current.push(setTimeout(() => {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, body: hit.body, idea: hit.idea } : x)));
      setThinking(false);
      setSteps([]);
    }, 500 * (hit.a.length + 1) + 300));
  };

  const save = (i: number) => {
    const t = turns[i];
    if (!t.idea || t.saved) return;
    setTurns((p) => p.map((x, k) => (k === i ? { ...x, saved: true } : x)));
    setSaved((s) => [...s, t.idea!]);
    record('IDEA_SAVED', 'You · IdeaQ', 'QUEUED FOR REVIEW');
  };

  return (
    <Frame title="IdeaQ · Payments Gateway" hint="Ask it something about the codebase">
      <div className="grid md:grid-cols-[170px_1fr_210px] min-h-[380px]">
        <aside className="hidden md:block border-r border-white/[0.08] bg-[#0B0B11]/70 p-3 space-y-2 text-xs">
          <div className="py-2 px-3 bg-[#15151F] border border-white/[0.1] rounded-xl flex items-center justify-center gap-2 text-[#F6F5FA] font-semibold"><Plus className="w-3.5 h-3.5 text-[#075BFF]" />New chat</div>
          <div className="text-[10px] uppercase font-mono text-[#827D8E] px-1">Recent</div>
          {['Settlement audit', 'Rate limiter options'].map((c, i) => <div key={c} className={`p-2 rounded-lg flex items-center gap-2 ${i === 0 ? 'bg-[#075BFF]/15 border border-[#075BFF]/30 text-white' : 'text-[#B5B1C0]'}`}><MessageSquare className="w-3.5 h-3.5 text-[#827D8E]" /><span className="truncate">{c}</span></div>)}
        </aside>

        <main className="flex flex-col bg-[#0A0A0F] min-w-0">
          <div className="flex-1 overflow-y-auto mk-scroll p-4 space-y-4 max-h-[340px]">
            {turns.length === 0 && (
              <div className="text-center space-y-3 py-4">
                <div className="w-11 h-11 mx-auto rounded-2xl bg-gradient-to-tr from-[#075BFF]/30 to-transparent border border-white/10 flex items-center justify-center"><Sparkles className="w-5 h-5 text-[#075BFF]" /></div>
                <h4 className="text-lg text-white">What are we building in <span className="font-semibold text-[#5B8FFF]">Payments Gateway</span>?</h4>
                <div className="grid gap-2 max-w-md mx-auto">
                  {STARTERS.map((s) => <button key={s.q} onClick={() => ask(s.q)} className="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-left text-[11px] text-[#D1D5DB] flex items-center justify-between cursor-pointer group"><span>{s.q}</span><ChevronRight className="w-3.5 h-3.5 text-[#827D8E] group-hover:text-white" /></button>)}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="space-y-2 mk-fade">
                <div className="flex justify-end"><div className="bg-[#1C1C26] border border-white/[0.1] text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-xs max-w-[85%]">{t.q}</div></div>
                {t.body && (
                  <div className="text-[12px] text-[#D1D5DB] leading-relaxed">
                    {render(t.body)}
                    <button onClick={() => save(i)} disabled={t.saved} className="mt-1 flex items-center gap-1.5 text-[11px] text-[#827D8E] hover:text-white disabled:text-emerald-300 cursor-pointer"><Bookmark className="w-3.5 h-3.5" />{t.saved ? 'Saved to Ideas' : 'Save as Idea'}</button>
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div className="text-[11px] text-[#827D8E] space-y-1 font-mono">
                {steps.map((s) => <div key={s} className="mk-fade">› {s}</div>)}
                <div className="flex gap-1 pt-0.5"><span className="mk-dot w-1.5 h-1.5 rounded-full bg-[#075BFF]" /><span className="mk-dot w-1.5 h-1.5 rounded-full bg-[#075BFF]" /><span className="mk-dot w-1.5 h-1.5 rounded-full bg-[#075BFF]" /></div>
              </div>
            )}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(draft); setDraft(''); }} className="px-4 pb-3">
            <div className="bg-[#12121A] border border-white/[0.12] focus-within:border-[#075BFF]/60 rounded-full p-1.5 pl-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#075BFF] shrink-0" />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about Payments Gateway…" className="flex-1 min-w-0 bg-transparent text-xs text-[#F6F5FA] placeholder-[#777D8B] outline-none" />
              <button type="submit" disabled={!draft.trim() || thinking} aria-label="Send" className="w-8 h-8 rounded-full bg-[#075BFF] disabled:opacity-40 text-white flex items-center justify-center cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
            </div>
          </form>
        </main>

        <aside className="border-t md:border-t-0 md:border-l border-white/[0.08] bg-[#0B0B11]/80 p-3 text-xs space-y-2">
          <div className="text-[11px] font-medium text-white border-b border-[#075BFF] inline-block pb-1">Ideas ({saved.length})</div>
          {saved.length === 0 && <p className="text-[11px] text-[#827D8E]">Save an answer as an idea. It goes to Reviews, where a named person approves or rejects it.</p>}
          {saved.map((s) => <div key={s} className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[11px] text-white mk-pop">{s}<div className="text-[10px] font-mono text-amber-300 mt-1">awaiting review</div></div>)}
        </aside>
      </div>
    </Frame>
  );
};
