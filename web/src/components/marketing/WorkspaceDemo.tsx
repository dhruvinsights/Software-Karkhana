import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Send } from 'lucide-react';
import { Avatar, BORDER, Frame, Pill } from './demoKit';
import type { RecordFn } from './ledger';

type Team = 'product' | 'design' | 'arch' | 'dev' | 'qa' | 'sec';

const TEAMS: { id: Team; label: string; who: string; tool: string }[] = [
  { id: 'product', label: 'Product', who: 'Priya N.', tool: 'was Jira' },
  { id: 'design', label: 'Design', who: 'Kavya R.', tool: 'was Figma' },
  { id: 'arch', label: 'Architecture', who: 'Arjun K.', tool: 'was Confluence' },
  { id: 'dev', label: 'Engineering', who: 'Rahul V.', tool: 'was IDE + GitHub' },
  { id: 'qa', label: 'QA', who: 'Meera S.', tool: 'was TestRail' },
  { id: 'sec', label: 'Security', who: 'Sana A.', tool: 'was SonarQube' },
];

interface Evt { id: number; from: Team; text: string; reach: Team[] }

/** What each action sets off elsewhere. This is the point of the demo: one change, six teams. */
const ACTIONS: { team: Team; label: string; text: string; reach: Team[] }[] = [
  { team: 'product', label: 'PM tightens acceptance criteria', text: 'Updated PAY-142: refunds must be idempotent', reach: ['design', 'arch', 'dev', 'qa'] },
  { team: 'arch', label: 'Architect signs ADR-042', text: 'Signed ADR-042: idempotency key format', reach: ['dev', 'qa', 'sec'] },
  { team: 'dev', label: 'Agent opens PR #118', text: 'PR #118 opened with 14/14 tests and a diff', reach: ['arch', 'qa', 'sec', 'product'] },
  { team: 'qa', label: 'QA files a bug', text: 'BUG-211 filed on PAY-142 (3DS expiry)', reach: ['dev', 'product'] },
  { team: 'sec', label: 'AppSec blocks a release', text: 'Gate closed: jinja2 CVE in reporting worker', reach: ['dev', 'qa', 'product', 'arch'] },
];

const REPLIES: Record<Team, string[]> = {
  product: ['Noted. Rolling this into the sprint scope.', 'Thanks, updating the stakeholder summary.'],
  design: ['Checked the flow, no UI change needed.', 'Will adjust the error state in the prototype.'],
  arch: ['Boundary rules still hold.', 'Reviewing against the contract registry.'],
  dev: ['Picking this up now.', 'On it, agent re-run queued.'],
  qa: ['Adding a scenario for this.', 'Will re-verify once the fix lands.'],
  sec: ['Tracking it in the SBOM report.', 'I will waive or patch before sign-off.'],
};

export const WorkspaceDemo: React.FC<{ record: RecordFn }> = ({ record }) => {
  const [events, setEvents] = useState<Evt[]>([]);
  const [lit, setLit] = useState<Team[]>([]);
  const [view, setView] = useState<Team>('dev');
  const [draft, setDraft] = useState('');
  const [chat, setChat] = useState<{ who: string; text: string; me?: boolean }[]>([
    { who: 'Rahul V.', text: 'Worker finished the retry logic, tests green.' },
  ]);
  const id = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [chat]);

  const fire = (a: (typeof ACTIONS)[number]) => {
    const ev: Evt = { id: id.current++, from: a.team, text: a.text, reach: a.reach };
    setEvents((e) => [ev, ...e].slice(0, 8));
    setLit([a.team, ...a.reach]);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLit([]), 1800);
    record(a.text.slice(0, 28).toUpperCase(), TEAMS.find((t) => t.id === a.team)!.who, 'DELIVERED');
    const replier = a.reach[0];
    setTimeout(() => {
      const r = REPLIES[replier][id.current % 2];
      setChat((c) => [...c, { who: TEAMS.find((t) => t.id === replier)!.who, text: r }]);
    }, 900);
  };

  const mine = useMemo(() => events.filter((e) => e.from === view || e.reach.includes(view)), [events, view]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setChat((c) => [...c, { who: 'You', text: draft.trim(), me: true }]);
    setDraft('');
  };

  return (
    <Frame title="Workspace · Acme Payments" hint="Fire an event, watch who gets it">
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-px bg-white/[0.06]">
        <div className="bg-[#0a0b12] p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {TEAMS.map((t) => {
              const on = lit.includes(t.id);
              return (
                <button key={t.id} onClick={() => setView(t.id)} className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${view === t.id ? 'border-[#075BFF]/60 bg-[#075BFF]/10' : on ? 'border-emerald-400/60 bg-emerald-400/10' : `${BORDER} bg-white/[0.02] hover:bg-white/[0.05]`}`}>
                  <div className="flex items-center gap-2"><Avatar name={t.who} size={24} online={on || view === t.id} /><span className="text-xs font-semibold text-white">{t.label}</span></div>
                  <div className="text-[10px] font-mono text-[#827D8E] mt-1.5 truncate">{t.tool}</div>
                  <div className={`text-[10px] font-mono mt-0.5 ${on ? 'text-emerald-300' : 'text-transparent'}`}>● notified</div>
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase font-mono tracking-wider text-[#827D8E]">Make something happen</div>
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map((a) => <button key={a.label} onClick={() => fire(a)} className={`px-3 py-1.5 rounded-lg border ${BORDER} bg-white/[0.03] hover:bg-[#075BFF]/15 hover:border-[#075BFF]/40 text-[11px] text-slate-200 cursor-pointer transition-colors`}>{a.label}</button>)}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase font-mono tracking-wider text-[#827D8E]">Activity for {TEAMS.find((t) => t.id === view)!.label}</div>
            <div className={`rounded-xl bg-[#0c0e15] border ${BORDER} min-h-[120px] divide-y divide-white/[0.05]`}>
              {mine.length === 0 && <div className="p-4 text-[11px] text-[#827D8E]">Nothing yet. Click an action above, or switch to another team.</div>}
              {mine.slice(0, 4).map((e) => (
                <div key={e.id} className="px-3 py-2 text-[11px] flex items-center justify-between gap-2 mk-row">
                  <span className="text-slate-200 truncate">{e.text}</span>
                  <Pill className={e.from === view ? 'bg-[#075BFF]/15 text-[#8fb4ff] border-[#075BFF]/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'}>{e.from === view ? 'you' : `from ${TEAMS.find((t) => t.id === e.from)!.label}`}</Pill>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-[#0a0b12] p-5 flex flex-col min-h-[320px]">
          <div className="flex items-center gap-2 text-xs text-white font-semibold mb-2"><Hash className="w-3.5 h-3.5 text-[#827D8E]" />general<span className="text-[10px] font-mono text-[#827D8E] font-normal">· all teams, one thread</span></div>
          <div className="flex-1 overflow-y-auto mk-scroll space-y-3 max-h-[240px] pr-1">
            {chat.map((m, i) => (
              <div key={i} className="flex gap-2.5 mk-pop"><Avatar name={m.who} size={26} online /><div className="min-w-0"><div className="text-xs font-semibold text-white">{m.who}</div><p className={`text-[12px] ${m.me ? 'text-[#8fb4ff]' : 'text-[#D1D5DB]'}`}>{m.text}</p></div></div>
            ))}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="mt-3 flex gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message everyone…" className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B]" />
            <button type="submit" aria-label="Send" className="w-9 rounded-xl bg-[#075BFF] text-white flex items-center justify-center cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
          </form>
        </div>
      </div>
    </Frame>
  );
};
