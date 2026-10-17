import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PenTool, RefreshCw } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { planApi, ProjectDoc, ProjectDocs } from '../../lib/planApi';
import { useChatFrames } from '../../lib/chatSocket';
import { factoryStore } from '../../store/factoryStore';

interface Contract {
  method: string;
  path: string;
  summary: string;
  story_keys: string[];
  request_example: string;
  response_example: string;
  errors: string[];
}

interface Screen {
  name: string;
  purpose: string;
  story_keys: string[];
  states: string[];
  html: string;
}

async function post(path: string): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${factoryStore.getState().token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  }
}

const pretty = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

const ContractCard: React.FC<{ c: Contract }> = ({ c }) => (
  <GlassCard className="p-4 space-y-2">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#075BFF]/20 text-[#7aa7ff]">{c.method}</span>
      <code className="text-sm text-white">{c.path}</code>
      <span className="text-[11px] text-[#827D8E] font-mono ml-auto">{c.story_keys.join(', ')}</span>
    </div>
    <p className="text-xs text-[#B5B1C0]">{c.summary}</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {c.request_example.trim() && (
        <pre className="text-[11px] text-[#a8a3b5] bg-black/40 rounded-lg p-3 overflow-x-auto">{pretty(c.request_example)}</pre>
      )}
      <pre className="text-[11px] text-[#a8a3b5] bg-black/40 rounded-lg p-3 overflow-x-auto">{pretty(c.response_example)}</pre>
    </div>
    {c.errors.length > 0 && <p className="text-[11px] text-[#827D8E]">Errors: {c.errors.join(' · ')}</p>}
  </GlassCard>
);

/** The design station: draft the design from the approved plan, review it, hand it to developers. */
export const ProjectDesignPanel: React.FC<{ projectId: string; canDesign: boolean }> = ({ projectId, canDesign }) => {
  const [docs, setDocs] = useState<ProjectDocs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDocs(await planApi.documents(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useChatFrames('workspace_sync', (f) => {
    if (f.scope === 'projects') void reload();
  }, [reload]);

  const act = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await post(path);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const job = (docs?.status as { design?: { state: string; error?: string } } | null)?.design;
  const design: ProjectDoc | undefined = docs?.documents.find((d) => d.kind === 'design');
  const planApproved = docs?.documents.some((d) => d.kind === 'prd' && d.status === 'approved');
  const spec = design?.content;
  const drafting = job?.state === 'running';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <PenTool className="w-5 h-5 text-[#075BFF]" /> Design
          </h2>
          <p className="text-xs text-[#827D8E] mt-1">
            {design
              ? `Design v${design.version} · ${design.status === 'approved' ? 'approved and handed to developers' : 'draft, waiting for the designer'}`
              : planApproved
                ? 'Draft the API contracts and screens from the approved plan.'
                : 'The plan must be approved before design starts.'}
          </p>
        </div>
        {canDesign && planApproved && (
          <div className="flex gap-2">
            {!drafting && (
              <button
                disabled={busy}
                onClick={() => act(`/api/projects/${projectId}/design`)}
                className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> {design ? 'Draft a new version' : 'Draft design'}
              </button>
            )}
            {design?.status === 'draft' && !drafting && (
              <button
                disabled={busy}
                onClick={() => act(`/api/projects/${projectId}/documents/design/approve`)}
                className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium hover:bg-[#1a6bff] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve and hand off
              </button>
            )}
          </div>
        )}
      </div>

      {drafting && (
        <div className="text-xs text-white bg-[#075BFF]/10 border border-[#075BFF]/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#5B8FFF]" /> Drafting the design from the approved plan…
        </div>
      )}
      {job?.state === 'failed' && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {job.error}
        </div>
      )}
      {error && <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">{error}</div>}

      {spec && (
        <>
          <GlassCard className="p-5 space-y-3">
            <p className="text-sm text-[#D1D5DB] leading-relaxed">{spec.overview}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#B5B1C0]">
              <div>
                <p className="text-[10px] font-mono uppercase text-[#827D8E] mb-1">Principles</p>
                <ul className="list-disc ml-4 space-y-1">{spec.principles.map((p: string) => <li key={p}>{p}</li>)}</ul>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase text-[#827D8E] mb-1">Handoff notes for developers</p>
                <ul className="list-disc ml-4 space-y-1">{spec.handoff_notes.map((p: string) => <li key={p}>{p}</li>)}</ul>
              </div>
            </div>
          </GlassCard>

          {spec.api_contracts.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">API contracts</h3>
              {spec.api_contracts.map((c: Contract) => <ContractCard key={`${c.method} ${c.path}`} c={c} />)}
            </div>
          )}

          {spec.screens.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Screens</h3>
              {spec.screens.map((s: Screen) => (
                <GlassCard key={s.name} className="p-4 space-y-2">
                  <p className="text-sm text-white font-medium">
                    {s.name} <span className="text-[11px] text-[#827D8E] font-mono">· {s.story_keys.join(', ')}</span>
                  </p>
                  <p className="text-xs text-[#B5B1C0]">{s.purpose}</p>
                  {/* sandbox="" runs no scripts; prototypes are static HTML by contract. */}
                  <iframe title={s.name} sandbox="" srcDoc={s.html} className="w-full h-80 rounded-lg bg-white" />
                  <p className="text-[11px] text-[#827D8E]">States: {s.states.join(' · ')}</p>
                </GlassCard>
              ))}
            </div>
          )}

          {spec.tokens.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {spec.tokens.map((t: { name: string; value: string }) => (
                <span key={t.name} className="text-[11px] font-mono px-2 py-1 rounded bg-white/[0.05] text-[#B5B1C0]">
                  {t.name}: {t.value}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
