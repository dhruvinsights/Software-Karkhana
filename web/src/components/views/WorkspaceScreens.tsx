// Workspace-level screens on the real API: per-project station screens (with a
// project picker), the knowledge base (learnings), governance (the evidence
// ledger) and incidents (bugs and security issues across a project).
import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ShieldCheck, Bug } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { FactoryState, factoryStore } from '../../store/factoryStore';

async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${factoryStore.getState().token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  return body as T;
}

function useServer<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!path) return;
    getJson<T>(path).then(setData).catch((e: Error) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

/** A station screen for one project: pick the project, then render its panel. */
export const ProjectScoped: React.FC<{
  state: FactoryState;
  title: string;
  render: (projectId: string) => React.ReactNode;
}> = ({ state, title, render }) => {
  const project = state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  if (!project) {
    return (
      <div className="max-w-3xl mx-auto py-16 space-y-3">
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        <p className="text-sm text-[#827D8E]">Create a project from an approved idea first; this station works on a project.</p>
      </div>
    );
  }
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-white mr-4">{title}</h1>
        {state.projects.map((p) => (
          <button
            key={p.id}
            onClick={() => factoryStore.selectProject(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
              p.id === project.id ? 'bg-[#075BFF] text-white' : 'bg-white/[0.06] text-[#B5B1C0] hover:text-white'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {render(project.id)}
    </div>
  );
};

interface Learning {
  id: string;
  project_id: string;
  text: string;
  status: string;
  source: { pr_number?: number; pr_url?: string };
  verified_at: string | null;
  created_at: string;
}

/** Knowledge base: lessons captured at every merge; a lead verifies them before agents reuse them. */
export const KnowledgeScreen: React.FC = () => {
  const { data, error, reload } = useServer<Learning[]>('/api/learnings');
  const [actionError, setActionError] = useState<string | null>(null);
  const decide = async (id: string, decision: 'verified' | 'rejected') => {
    setActionError(null);
    try {
      await getJson(`/api/learnings/${id}/verify?decision=${decision}`, { method: 'POST' });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
        <BookOpen className="w-6 h-6 text-[#075BFF]" /> Knowledge base
      </h1>
      <p className="text-xs text-[#827D8E]">Each merge captures a lesson from its review. Verified lessons are retrieved for later evaluations and agents.</p>
      {(error || actionError) && <p className="text-xs text-rose-300">{error || actionError}</p>}
      {(data ?? []).length === 0 && <p className="text-sm text-[#827D8E]">No lessons yet. They appear after the first merge.</p>}
      {(data ?? []).map((l) => (
        <GlassCard key={l.id} className="p-4 space-y-2">
          <p className="text-sm text-white">{l.text}</p>
          <div className="flex items-center gap-3 text-[11px] text-[#827D8E]">
            <span className="uppercase font-mono">{l.status}</span>
            {l.source?.pr_url && (
              <a href={l.source.pr_url} target="_blank" rel="noreferrer" className="text-[#7aa7ff]">
                PR #{l.source.pr_number}
              </a>
            )}
            <span>{new Date(l.created_at).toLocaleString()}</span>
            {l.status === 'unverified' && (
              <span className="ml-auto flex gap-2">
                <button onClick={() => decide(l.id, 'verified')} className="px-2 py-1 rounded bg-emerald-600/80 text-white cursor-pointer">
                  Verify
                </button>
                <button onClick={() => decide(l.id, 'rejected')} className="px-2 py-1 rounded bg-white/[0.08] text-white cursor-pointer">
                  Reject
                </button>
              </span>
            )}
          </div>
        </GlassCard>
      ))}
    </div>
  );
};

interface LedgerRow {
  seq: number;
  actor_label: string;
  actor_kind: string;
  action: string;
  subject_type: string;
  created_at: string;
  hash: string;
}

/** Governance: the hash-chained evidence ledger and its integrity check. */
export const GovernanceScreen: React.FC = () => {
  const { data, error } = useServer<LedgerRow[]>('/api/ledger');
  const [check, setCheck] = useState<string | null>(null);
  const verify = async () => {
    try {
      const out = await getJson<{ ok: boolean; checked?: number; entries?: number; detail?: string }>('/api/ledger/verify');
      setCheck(out.ok ? `Chain intact (${out.checked ?? out.entries ?? 'all'} entries checked).` : `Chain broken: ${out.detail ?? 'see server log'}`);
    } catch (e) {
      setCheck((e as Error).message);
    }
  };
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#075BFF]" /> Governance and audit
        </h1>
        <button onClick={verify} className="px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs cursor-pointer">
          Verify chain
        </button>
      </div>
      <p className="text-xs text-[#827D8E]">Every approval, run, merge and release is a SHA-256 chained ledger entry.</p>
      {check && <p className="text-xs text-emerald-300">{check}</p>}
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <GlassCard className="p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-[#827D8E] text-left">
            <tr>
              <th className="px-4 py-2">#</th>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Subject</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).slice(0, 200).map((r) => (
              <tr key={r.seq} className="border-t border-white/[0.06] text-[#B5B1C0]">
                <td className="px-4 py-1.5 font-mono">{r.seq}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  {r.actor_label} <span className="text-[#827D8E]">({r.actor_kind})</span>
                </td>
                <td className="text-white">{r.action}</td>
                <td>{r.subject_type}</td>
                <td className="font-mono text-[#827D8E]">{r.hash.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </div>
  );
};

interface IssueRow {
  id: string;
  key: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  source: string;
  description: string;
}

/** Incidents: bugs from QA, security issues and reported defects of a project. */
export const IncidentsPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { data, error } = useServer<IssueRow[]>(`/api/projects/${projectId}/issues`);
  const rows = (data ?? []).filter((i) => i.type === 'bug' || i.type === 'security');
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#827D8E]">QA files a bug automatically when a scenario fails; it blocks that story's sign-off until it is closed.</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {rows.length === 0 && <p className="text-sm text-[#827D8E]">No open bugs or security issues.</p>}
      {rows.map((i) => (
        <GlassCard key={i.id} className="p-4 space-y-1">
          <p className="text-sm text-white flex items-center gap-2">
            <Bug className="w-4 h-4 text-rose-300" /> <span className="font-mono text-[11px] text-[#827D8E]">{i.key}</span> {i.title}
          </p>
          <p className="text-[11px] text-[#827D8E]">
            {i.type} · {i.priority} · {i.status.replace(/_/g, ' ')} · from {i.source}
          </p>
          <p className="text-xs text-[#B5B1C0] whitespace-pre-wrap">{i.description}</p>
        </GlassCard>
      ))}
    </div>
  );
};
