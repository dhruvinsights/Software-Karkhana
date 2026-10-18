import React from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { BORDER, Pill } from './demoKit';
import { LedgerEntry, shortHash } from './ledger';

interface Props {
  entries: LedgerEntry[];
  verify: () => Promise<number>;
  tamper: () => void;
  reset: () => void;
  broken: number | null;
  verifying: boolean;
}

export const LedgerPanel: React.FC<Props> = ({ entries, verify, tamper, reset, broken, verifying }) => {
  const [result, setResult] = React.useState<'ok' | 'bad' | null>(null);
  const rows = entries.slice(1);
  const visible = rows.slice(-8);

  const run = async () => {
    const idx = await verify();
    setResult(idx === -1 ? 'ok' : 'bad');
  };

  return (
    <div className={`p-5 sm:p-6 rounded-2xl bg-[#0d0e14] border ${BORDER} font-mono text-xs space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-slate-400">Chain length <span className="text-white">{rows.length}</span> · every block hashes the one before it</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={run} disabled={verifying} className="px-3 py-1.5 rounded-lg bg-[#075BFF] hover:bg-[#075BFF]/90 text-white font-sans font-semibold cursor-pointer disabled:opacity-50">{verifying ? 'Recomputing…' : 'Verify chain'}</button>
          <button onClick={() => { tamper(); setResult(null); }} className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 font-sans cursor-pointer">Tamper with a past entry</button>
          <button onClick={() => { reset(); setResult(null); }} className="px-3 py-1.5 text-slate-500 hover:text-white font-sans cursor-pointer">Reset</button>
        </div>
      </div>

      {result === 'ok' && <div role="status" className="flex items-center gap-2 text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 font-sans mk-fade"><CheckCircle2 className="w-4 h-4" />All {rows.length} blocks recomputed. Chain intact.</div>}
      {result === 'bad' && broken !== null && <div role="alert" className="flex items-center gap-2 text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 font-sans mk-fade"><ShieldAlert className="w-4 h-4" />Block #{entries[broken]?.seq} no longer matches its hash. Everything after it is untrusted.</div>}

      <div className="overflow-x-auto mk-scroll">
        <div className="min-w-[620px]">
          <div className={`grid grid-cols-12 text-slate-500 text-[11px] pb-2 border-b ${BORDER}`}>
            <span className="col-span-1">Seq</span><span className="col-span-3">Event</span><span className="col-span-3">Actor</span><span className="col-span-3">Hash</span><span className="col-span-2 text-right">Status</span>
          </div>
          {visible.map((e) => {
            const bad = result === 'bad' && broken !== null && e.seq === entries[broken]?.seq;
            return (
              <div key={e.seq} className={`grid grid-cols-12 items-center text-slate-300 py-2.5 border-b ${BORDER} last:border-0 mk-row ${bad ? 'bg-rose-500/10' : ''}`}>
                <span className="col-span-1 text-slate-500">#{e.seq}</span>
                <span className="col-span-3 text-white font-medium truncate">{e.stage}</span>
                <span className="col-span-3 text-slate-400 truncate pr-2">{e.actor}</span>
                <span className="col-span-3 text-slate-400">{shortHash(e.hash)}</span>
                <span className="col-span-2 text-right"><Pill className={bad ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-[#075bff]/15 text-[#7fa4ff] border-[#075bff]/30'}>{e.status}</Pill></span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="font-sans text-[11px] text-slate-500">Anything you did in the demos above appears here. The hashes are real SHA-256, computed in your browser.</p>
    </div>
  );
};
