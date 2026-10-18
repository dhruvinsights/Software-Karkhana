import React, { useState } from 'react';
import { Bot, Check, GitPullRequest, Lock, ShieldCheck } from 'lucide-react';
import { Avatar, BORDER, Frame, Pill } from './demoKit';
import type { RecordFn } from './ledger';

const GATES = [
  { id: 'arch', role: 'Architect', who: 'Arjun K.', check: 'Boundary + ADR-042 respected' },
  { id: 'sec', role: 'AppSec', who: 'Rahul V.', check: 'No new critical CVE, SBOM clean' },
  { id: 'qa', role: 'QA Lead', who: 'Meera S.', check: '14/14 scenarios pass, 0 open P0/P1' },
  { id: 'dir', role: 'Director', who: 'Priya N.', check: 'Budget and rollout window approved' },
] as const;

const DIFF = [
  { t: ' ', c: 'def create_batch(job):' },
  { t: '-', c: '    batch = Batch(job.id)' },
  { t: '+', c: '    key = idempotency_key(job)' },
  { t: '+', c: '    batch = Batch.get_or_create(key)' },
  { t: ' ', c: '    return batch.submit()' },
];

export const AccountabilityDemo: React.FC<{ record: RecordFn }> = ({ record }) => {
  const [signed, setSigned] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);
  const next = GATES.find((g) => !signed.includes(g.id));

  const sign = (id: string) => {
    const g = GATES.find((x) => x.id === id)!;
    if (next && g.id !== next.id) {
      setRefused(`${g.role} cannot sign yet. Waiting on ${next.role} (${next.who}).`);
      return;
    }
    setRefused(null);
    setSigned((s) => [...s, id]);
    record(`GATE_${g.role.toUpperCase().replace(' ', '_')}`, `${g.who} · ${g.role}`, 'SIGNED');
  };

  const tryMerge = () => {
    if (next) {
      setRefused(`Merge refused: ${GATES.length - signed.length} human sign-off(s) missing. The agent cannot approve its own work.`);
      return;
    }
    setMerged(true);
    setRefused(null);
    record('PR #118 MERGED', 'ADK Worker #4', 'VERIFIED');
  };

  const reset = () => { setSigned([]); setMerged(false); setRefused(null); };

  return (
    <Frame title="PR #118 · Idempotent settlement retries" hint="Try merging before anyone signs">
      <div className="grid md:grid-cols-2 gap-px bg-white/[0.06]">
        {/* LEFT: what the AI did */}
        <div className="bg-[#0a0b12] p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs"><Bot className="w-4 h-4 text-fuchsia-300" /><span className="font-semibold text-white">AI worker output</span><Pill className="bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30">agent</Pill></div>
          <div className="rounded-xl bg-black/50 border border-white/[0.06] font-mono text-[11.5px] leading-6 overflow-x-auto">
            {DIFF.map((l, i) => (
              <div key={i} className={`px-3 whitespace-pre ${l.t === '+' ? 'bg-emerald-500/10 text-emerald-300' : l.t === '-' ? 'bg-rose-500/10 text-rose-300' : 'text-slate-400'}`}>{l.t} {l.c}</div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            {[['14/14', 'tests pass'], ['0', 'new CVEs'], ['0 breaking', 'API diff']].map(([v, l]) => (
              <div key={l} className={`rounded-lg bg-white/[0.03] border ${BORDER} py-2`}><div className="text-white font-semibold">{v}</div><div className="text-[#827D8E]">{l}</div></div>
            ))}
          </div>
          <p className="text-[11px] text-[#827D8E] leading-relaxed">Evidence is attached, but it is only evidence. An agent finishing is never the same as the work being approved.</p>
        </div>

        {/* RIGHT: who is accountable */}
        <div className="bg-[#0a0b12] p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs"><ShieldCheck className="w-4 h-4 text-[#5B8FFF]" /><span className="font-semibold text-white">Human gates, in order</span></div>
          <ol className="space-y-2">
            {GATES.map((g, i) => {
              const done = signed.includes(g.id);
              const active = next?.id === g.id;
              return (
                <li key={g.id} className={`p-2.5 rounded-xl border flex items-center gap-3 text-xs transition-colors ${done ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : active ? 'border-[#075BFF]/50 bg-[#075BFF]/[0.07]' : `${BORDER} bg-white/[0.02]`}`}>
                  <Avatar name={g.who} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-medium">{i + 1}. {g.role} <span className="text-[#827D8E] font-normal">· {g.who}</span></div>
                    <div className="text-[11px] text-[#827D8E] truncate">{g.check}</div>
                  </div>
                  {done ? <span className="flex items-center gap-1 text-emerald-300 text-[11px] font-mono shrink-0"><Check className="w-3.5 h-3.5" />signed</span> : (
                    <button onClick={() => sign(g.id)} className="px-2.5 py-1 rounded-lg bg-[#075BFF]/20 hover:bg-[#075BFF]/35 text-[#8fb4ff] text-[11px] font-medium cursor-pointer shrink-0">Sign as {g.role}</button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={tryMerge} disabled={merged} className={`flex-1 py-2 rounded-xl text-xs font-semibold cursor-pointer flex items-center justify-center gap-2 ${merged ? 'bg-emerald-500/20 text-emerald-300' : next ? 'bg-white/[0.06] text-slate-300 hover:bg-white/10' : 'bg-emerald-500 text-white'}`}>
              {merged ? <><Check className="w-3.5 h-3.5" />Merged and recorded on the ledger</> : <>{next ? <Lock className="w-3.5 h-3.5" /> : <GitPullRequest className="w-3.5 h-3.5" />}Merge PR #118</>}
            </button>
            {(signed.length > 0 || merged) && <button onClick={reset} className="text-[11px] text-[#827D8E] hover:text-white underline cursor-pointer">Reset</button>}
          </div>
          {refused && <div role="alert" className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mk-fade">{refused}</div>}
        </div>
      </div>
    </Frame>
  );
};
