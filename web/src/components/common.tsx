import { useState, type ReactNode } from 'react';
import { useGet, useApi, type LedgerEntry, type Stage } from '../api';

// Trust badges: every claim says who or what stands behind it.
export type Trust = 'code' | 'ai' | 'assumption' | 'human';
const TRUST: Record<Trust, [string, string, string]> = {
  code: ['Verified by code', 'pill ok', 'Backed by a real test run or hash check'],
  ai: ['AI-generated, unverified', 'pill', 'Written by a model; a person has not confirmed it'],
  assumption: ['Assumption', 'pill dash warn', 'Not stated in the source; needs an answer'],
  human: ['Human-approved', 'pill outline', 'A named person decided this; recorded in the ledger'],
};
export function Badge({ kind }: { kind: Trust }) {
  const [label, cls, title] = TRUST[kind];
  return <span className={cls} title={title}>{label}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="err" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="vh">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Loading() {
  return <div className="stack" aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ height: 88 }} /><div className="skeleton" style={{ height: 88 }} /></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

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

// Append-only ledger table, optionally scoped to a project.
export function LedgerTable({ projectId }: { projectId?: string }) {
  const path = projectId ? `/api/ledger?project_id=${projectId}&limit=200` : '/api/ledger?limit=200';
  const { data, error } = useGet<LedgerEntry[]>(['ledger', projectId ?? 'all'], path, 4000);
  const call = useApi();
  const [chain, setChain] = useState<{ ok: boolean; text: string } | null>(null);
  const verify = async () => {
    setChain({ ok: true, text: 'Verifying…' });
    try {
      const r = await call<{ ok: boolean; entries: number; first_bad_seq: number | null; reason: string | null }>('/api/ledger/verify');
      setChain({ ok: r.ok, text: r.ok ? `Chain verified: ${r.entries} entries from genesis` : `Broken at #${r.first_bad_seq}: ${r.reason}` });
    } catch (e) { setChain({ ok: false, text: String(e) }); }
  };
  return (
    <section className="stack" aria-label="Evidence ledger">
      <div className="row between">
        <span className="muted sm">Append-only, SHA-256 hash chain. The app cannot edit or delete rows.</span>
        <div className="row">{chain && <span className={`pill ${chain.ok ? 'ok' : 'bad'}`}>{chain.text}</span>}<button className="btn sm" onClick={verify}>Verify chain</button></div>
      </div>
      <ErrorBox error={error} />
      <div className="tw">
        <table>
          <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Hash</th></tr></thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.seq}>
                <td className="mono">{e.seq}</td>
                <td className="mono sm">{new Date(e.created_at).toLocaleString()}</td>
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
    </section>
  );
}

export const STATUS_HINT: Record<string, string> = {
  submitted: 'Evaluating', evaluated: 'Awaiting director', rejected: 'Rejected', ready: 'Approved, board ready',
  running: 'Agent running', failed: 'Run failed', open: 'PR open', triage: 'Review triage', pending: 'Merged, QA pending',
};
