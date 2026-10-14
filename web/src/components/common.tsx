import { useState } from 'react';
import { useGet, useApi, type LedgerEntry, type Stage } from '../api';

// B4 trust badges: state by shape, so they read in black and white.
export type Trust = 'code' | 'ai' | 'assumption' | 'human' | 'cached';
const TRUST: Record<Trust, [string, string, string]> = {
  code: ['Verified by code', 'pill outline ok', 'Backed by a real test run or hash check'],
  ai: ['AI-generated, unverified', 'pill solid', 'Written by Gemini; a person has not confirmed it'],
  assumption: ['Assumption', 'pill dash warn', 'Not stated in the source; needs an answer'],
  human: ['Human-approved', 'pill outline', 'A named person decided this; recorded in the ledger'],
  cached: ['Cached', 'pill dash', 'Served from the demo fallback, not a live model call'],
};
export function Badge({ kind }: { kind: Trust }) {
  const [label, cls, title] = TRUST[kind];
  return <span className={cls} title={title}>{label}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="err">{error instanceof Error ? error.message : String(error)}</div>;
}

// A6: all 15 stages; wired ones highlighted, the rest marked Planned.
export function StageTracker({ stage }: { stage?: string }) {
  const { data } = useGet<Stage[]>(['stages'], '/api/stages');
  if (!data) return null;
  const idx = data.findIndex((s) => s.id === stage);
  return (
    <div className="stages" aria-label="Lifecycle stages">
      {data.map((s, i) => {
        const cls = !s.wired ? 'planned' : i === idx ? 'current' : i < idx ? 'done' : '';
        return (
          <div key={s.id} className={`stg ${cls}`} title={`${s.owner}. Gate: ${s.gate}`}>
            <small>{String(i + 1).padStart(2, '0')} · {s.wired ? s.phase : 'Planned'}</small>
            <b>{s.name}</b>
          </div>
        );
      })}
    </div>
  );
}

// A5: read-only ledger at the bottom of every screen.
export function Ledger({ projectId }: { projectId?: string }) {
  const path = projectId ? `/api/ledger?project_id=${projectId}&limit=200` : '/api/ledger?limit=100';
  const { data } = useGet<LedgerEntry[]>(['ledger', projectId ?? 'all'], path, 4000);
  const call = useApi();
  const [chain, setChain] = useState<string | null>(null);
  const verify = async () => {
    setChain('Verifying');
    try {
      const r = await call<{ ok: boolean; entries: number; first_bad_seq: number | null; reason: string | null }>('/api/ledger/verify');
      setChain(r.ok ? `Chain verified: ${r.entries} entries from genesis` : `BROKEN at #${r.first_bad_seq}: ${r.reason}`);
    } catch (e) { setChain(String(e)); }
  };
  return (
    <section className="ledger" aria-label="Evidence ledger">
      <div className="inner">
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="row"><h4 style={{ fontSize: 14 }}>Evidence ledger</h4><span className="muted sm">Append-only, SHA-256 hash chain. The app cannot edit or delete rows.</span></div>
          <div className="row">{chain && <span className="pill outline">{chain}</span>}<button className="btn sm" onClick={verify}>Verify chain</button></div>
        </div>
        <div className="tw">
          <table>
            <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Hash</th></tr></thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.seq}>
                  <td className="mono">{e.seq}</td>
                  <td className="mono sm">{new Date(e.created_at).toLocaleTimeString()}</td>
                  <td>{e.actor_kind === 'ai' ? <span className="pill solid">{e.actor_label}</span> : e.actor_kind === 'system' ? <span className="pill mut">{e.actor_label}</span> : e.actor_label}</td>
                  <td className="mono sm">{e.action}</td>
                  <td className="mono sm">{e.subject_type}:{e.subject_id.slice(0, 8)}</td>
                  <td className="mono sm" title={`prev ${e.prev_hash}`}>{e.hash.slice(0, 12)}…</td>
                </tr>
              ))}
              {data && data.length === 0 && <tr><td colSpan={6} className="muted">No entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
