import React, { useState } from 'react';
import { Bot, ThumbsDown, ThumbsUp } from 'lucide-react';
import { BORDER, Frame, Pill, fieldCls } from './demoKit';
import type { RecordFn } from './ledger';

interface Suggestion {
  id: string; title: string; story: string; severity: 'P1' | 'P2'; category: string;
  description: string; steps: string[]; expected: string; evidence: { path: string; line: number }[];
  state: 'open' | 'accepted' | 'dismissed'; note?: string; bug?: string;
}

const SEED: Suggestion[] = [
  {
    id: 's1', title: 'Expired card at the 3DS step returns a generic 500', story: 'PAY-142', severity: 'P1', category: 'error handling',
    description: 'The 3DS callback handler does not catch CardExpired, so the customer sees a server error instead of a retry prompt.',
    steps: ['Start checkout with a card expiring this month', 'Complete the 3DS challenge after expiry', 'Observe the response'],
    expected: 'A 402 with a recoverable "card expired" message.',
    evidence: [{ path: 'payments/threeds.py', line: 88 }, { path: 'tests/test_threeds.py', line: 12 }], state: 'open',
  },
  {
    id: 's2', title: 'Refund of 0.00 creates an empty ledger row', story: 'PAY-139', severity: 'P2', category: 'boundary',
    description: 'A zero-amount refund passes validation and writes a no-op settlement entry.',
    steps: ['POST /refunds with amount 0.00', 'Query the settlement table'], expected: 'Validation error: amount must be positive.',
    evidence: [{ path: 'payments/refunds.py', line: 41 }], state: 'open',
  },
];

export const QAIntelligenceDemo: React.FC<{ record: RecordFn }> = ({ record }) => {
  const [items, setItems] = useState(SEED);
  const [mode, setMode] = useState<{ id: string; kind: 'accept' | 'dismiss' } | null>(null);
  const [notes, setNotes] = useState('');
  const [prio, setPrio] = useState('P1');
  const [bugCount, setBugCount] = useState(0);

  const submit = (s: Suggestion) => {
    if (!mode) return;
    if (mode.kind === 'dismiss' && notes.trim().length < 10) return;
    if (mode.kind === 'accept') {
      const key = `BUG-${210 + bugCount}`;
      setBugCount((n) => n + 1);
      setItems((p) => p.map((x) => (x.id === s.id ? { ...x, state: 'accepted', bug: key, note: notes.trim() || undefined, severity: prio as 'P1' | 'P2' } : x)));
      record('QA_BUG_FILED', `You · QA Lead (${key})`, 'ASSIGNED TO DEV');
    } else {
      setItems((p) => p.map((x) => (x.id === s.id ? { ...x, state: 'dismissed', note: notes.trim() } : x)));
      record('QA_SUGGESTION_DISMISSED', 'You · QA Lead', 'REASON LOGGED');
    }
    setMode(null); setNotes('');
  };

  const open = items.filter((i) => i.state === 'open').length;

  return (
    <Frame title="QA Verification · Suggestions" hint="Accept one or dismiss with a reason">
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#B5B1C0]">The agent finds candidates from code and tests. <strong className="text-white">A person decides.</strong></span>
          <span className="font-mono text-[#827D8E]">{open} open · {bugCount} bug{bugCount === 1 ? '' : 's'} filed</span>
        </div>
        {items.map((s) => (
          <article key={s.id} className={`rounded-xl bg-[#0c0e15] border ${BORDER} p-4 space-y-2 text-xs`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-white"><Bot className="w-3.5 h-3.5 inline mr-1.5 text-fuchsia-300" />{s.title}</p>
              <div className="flex gap-1.5">
                <Pill className="bg-white/5 text-[#B5B1C0] border-white/10">{s.category}</Pill>
                <Pill className="bg-amber-500/10 text-amber-300 border-amber-500/30">{s.severity}</Pill>
                {s.state !== 'open' && <Pill className={s.state === 'accepted' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-[#827D8E] border-white/10'}>{s.state}</Pill>}
              </div>
            </div>
            <p className="text-[11px] text-[#827D8E]">on {s.story}</p>
            <p className="text-[#B5B1C0]">{s.description}</p>
            <ol className="list-decimal ml-5 text-[#a8a3b5] space-y-0.5">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            <p className="text-[#a8a3b5]"><span className="text-[#827D8E]">Expected:</span> {s.expected}</p>
            <div className="flex flex-wrap gap-1.5">{s.evidence.map((e) => <code key={e.path} className="text-[11px] px-2 py-0.5 rounded bg-black/40 text-[#7aa7ff]">{e.path}:{e.line}</code>)}</div>
            {s.state === 'accepted' && <p className="text-emerald-300 text-[11px] mk-fade">Filed as {s.bug} and routed to the developer. Logged on the ledger.</p>}
            {s.state === 'dismissed' && <p className="text-[#827D8E] text-[11px] mk-fade">“{s.note}”</p>}
            {s.state === 'open' && mode?.id !== s.id && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setMode({ id: s.id, kind: 'accept' }); setPrio(s.severity); setNotes(''); }} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5" />I reproduced it · file bug</button>
                <button onClick={() => { setMode({ id: s.id, kind: 'dismiss' }); setNotes(''); }} className="px-3 py-1.5 rounded-lg border border-white/[0.1] text-[#B5B1C0] hover:text-white cursor-pointer flex items-center gap-1.5"><ThumbsDown className="w-3.5 h-3.5" />Not a bug</button>
              </div>
            )}
            {mode?.id === s.id && (
              <div className="space-y-2 pt-1 mk-fade">
                {mode.kind === 'accept' && <select value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority" className={`${fieldCls} w-auto`}>{['P0', 'P1', 'P2', 'P3'].map((p) => <option key={p}>{p}</option>)}</select>}
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={mode.kind === 'accept' ? 'What you saw when you reproduced it (optional)' : 'Why this is not a bug (required, min 10 characters)'} className={fieldCls} />
                <div className="flex gap-2 items-center">
                  <button onClick={() => submit(s)} disabled={mode.kind === 'dismiss' && notes.trim().length < 10} className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white font-semibold cursor-pointer disabled:opacity-40">{mode.kind === 'accept' ? 'File bug to developer' : 'Dismiss'}</button>
                  <button onClick={() => setMode(null)} className="px-3 py-1.5 text-[#827D8E] hover:text-white cursor-pointer">Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
        {open === 0 && <button onClick={() => { setItems(SEED); setBugCount(0); }} className="text-[11px] text-[#5B8FFF] underline cursor-pointer">Reset demo suggestions</button>}
      </div>
    </Frame>
  );
};
