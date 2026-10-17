import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, GitMerge, Radio, RefreshCw, Rocket, XCircle } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { deliveryApi, PipelineSetup, ReleaseRecord, WorkflowRun } from '../../lib/deliveryApi';
import { useChatFrames } from '../../lib/chatSocket';

function useLive<T>(load: () => Promise<T>, scope: string, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [load]);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => void reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  useChatFrames('workspace_sync', (f) => {
    if (f.scope === scope || f.scope === 'runs') void reload();
  }, [reload]);
  return { data, error, setError, reload };
}

const RunIcon: React.FC<{ run: WorkflowRun }> = ({ run }) =>
  run.status !== 'completed' ? (
    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#7aa7ff]" />
  ) : run.conclusion === 'success' ? (
    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
  ) : (
    <XCircle className="w-3.5 h-3.5 text-rose-400" />
  );

/** DevOps station: propose the GitHub Actions pipeline, merge it when green, watch runs. */
export const ProjectPipelinePanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const load = useCallback(() => deliveryApi.pipeline(projectId), [projectId]);
  const { data, error, setError, reload } = useLive(load, 'delivery', 20_000);
  const [busy, setBusy] = useState(false);
  const setup: PipelineSetup | null = data?.setup ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-[#075BFF]" /> CI/CD pipeline
        </h2>
        {!setup && (
          <button
            disabled={busy}
            onClick={() => act(() => deliveryApi.proposePipeline(projectId))}
            className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            Set up CI/CD
          </button>
        )}
        {setup?.status === 'open' && (
          <button
            disabled={busy || (setup.ci?.length ?? 1) > 0}
            onClick={() => act(() => deliveryApi.mergePipeline(projectId))}
            title={setup.ci?.length ? setup.ci.join('; ') : 'Merge the pipeline'}
            className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <GitMerge className="w-3.5 h-3.5" /> Merge pipeline
          </button>
        )}
      </div>
      {setup && (
        <GlassCard className="p-4 text-xs text-[#B5B1C0] space-y-1">
          <p>
            Pipeline ({setup.stack}) proposed in{' '}
            <a className="text-[#7aa7ff] underline" href={setup.url} target="_blank" rel="noreferrer">
              PR #{setup.number}
            </a>{' '}
            · {setup.status}
          </p>
          {setup.status === 'open' &&
            (setup.ci?.length ? (
              <p className="text-amber-300">Waiting for: {setup.ci.join('; ')}</p>
            ) : (
              <p className="text-emerald-300">Its own checks are green; it can be merged.</p>
            ))}
        </GlassCard>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <GlassCard className="p-0 overflow-hidden">
        <p className="px-4 py-3 text-sm font-semibold text-white">Recent runs on GitHub Actions</p>
        {(data?.runs ?? []).length === 0 ? (
          <p className="px-4 pb-4 text-xs text-[#827D8E]">No workflow runs yet.</p>
        ) : (
          <ul>
            {data!.runs.map((r) => (
              <li key={r.id} className="px-4 py-2.5 border-t border-white/[0.06] flex items-center gap-3 text-xs">
                <RunIcon run={r} />
                <span className="text-white w-20">{r.name}</span>
                <span className="text-[#827D8E] font-mono flex-1 truncate">
                  {r.branch} · {r.event} · {r.sha}
                </span>
                <span className="text-[#B5B1C0]">{r.status === 'completed' ? r.conclusion : r.status}</span>
                <a href={r.url} target="_blank" rel="noreferrer" className="text-[#7aa7ff]" title="Open on GitHub">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
};

const nextVersion = (rows: ReleaseRecord[]) => {
  const last = rows.find((r) => r.status === 'published')?.version ?? 'v0.1.0';
  const [maj, min] = last.slice(1).split('.').map(Number);
  return `v${maj}.${min + 1}.0`;
};

/** Release station: prepare a release with its evidence, approve it to tag and publish. */
export const ProjectReleasePanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const load = useCallback(() => deliveryApi.releases(projectId), [projectId]);
  const { data, error, setError, reload } = useLive(load, 'delivery');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = data ?? [];
  const draft = rows.find((r) => r.status === 'draft');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await reload();
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <Rocket className="w-5 h-5 text-[#075BFF]" /> Releases
      </h2>
      {!draft && (
        <GlassCard className="p-4 flex items-center gap-3">
          <input
            value={version || nextVersion(rows)}
            onChange={(e) => setVersion(e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white w-32 font-mono"
          />
          <button
            disabled={busy}
            onClick={() => act(() => deliveryApi.prepare(projectId, version || nextVersion(rows)))}
            className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            Prepare release
          </button>
          <p className="text-[11px] text-[#827D8E]">Gathers merged PRs, QA results, security findings and CI since the last release.</p>
        </GlassCard>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {rows.map((r) => (
        <GlassCard key={r.id} className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">
              {r.version} <span className="text-[11px] text-[#827D8E] font-mono">· {r.status} · {r.commit.slice(0, 12)}</span>
            </p>
            {r.status === 'draft' ? (
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => act(() => deliveryApi.refresh(r.id))}
                  className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-lg text-xs cursor-pointer disabled:opacity-50"
                >
                  Refresh evidence
                </button>
                <button
                  disabled={busy || r.blockers.length > 0}
                  onClick={() => act(() => deliveryApi.approve(r.id))}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  Approve and publish
                </button>
              </div>
            ) : (
              r.releaseUrl && (
                <a href={r.releaseUrl} target="_blank" rel="noreferrer" className="text-xs text-[#7aa7ff] flex items-center gap-1">
                  GitHub Release <ExternalLink className="w-3 h-3" />
                </a>
              )
            )}
          </div>
          {r.blockers.length > 0 && (
            <ul className="space-y-1">
              {r.blockers.map((b) => (
                <li key={b} className="text-xs text-amber-300 flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          )}
          <pre className="text-[11px] text-[#B5B1C0] whitespace-pre-wrap font-sans bg-black/30 rounded-lg p-3">{r.notes}</pre>
        </GlassCard>
      ))}
    </div>
  );
};
