import React from 'react';
import { CheckCircle2, ListTree, RefreshCw } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { usePlan, PlanIssue } from '../../lib/planApi';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  backlog: 'bg-white/5 text-[#827D8E] border-white/10',
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase ${
      STATUS_STYLE[status] ?? 'bg-[#075BFF]/10 text-[#7aa7ff] border-[#075BFF]/30'
    }`}
  >
    {status.replace(/_/g, ' ')}
  </span>
);

const Story: React.FC<{ story: PlanIssue }> = ({ story }) => (
  <li className="px-4 py-3 border-t border-white/[0.06]">
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm text-white">
        <span className="font-mono text-[11px] text-[#827D8E] mr-2">{story.key}</span>
        {story.title}
      </p>
      <StatusPill status={story.status} />
    </div>
    {story.acceptanceCriteria.length > 0 && (
      <ul className="mt-2 ml-1 space-y-1">
        {story.acceptanceCriteria.map((c, i) => (
          <li key={i} className="text-xs text-[#a8a3b5] flex gap-2">
            <span className="text-[#075BFF]">✓</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    )}
  </li>
);

/** Epics and stories for a project, with the two lead actions: build the draft, approve it. */
export const ProjectPlanPanel: React.FC<{ projectId: string; canEdit: boolean }> = ({ projectId, canEdit }) => {
  const { plan, loading, busy, error, offline, build, approve } = usePlan(projectId);

  if (offline) {
    return <p className="text-xs text-[#827D8E]">This project is not saved on the server, so it has no plan.</p>;
  }

  const empty = !plan || plan.total === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <ListTree className="w-5 h-5 text-[#075BFF]" /> Plan
          </h2>
          <p className="text-xs text-[#827D8E] mt-1">
            {empty
              ? 'Epics and stories drafted from the approved idea appear here.'
              : `${plan!.epics.length} epics, ${plan!.total - plan!.epics.length} stories. ${plan!.draft} waiting for approval.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => void build()}
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {empty ? 'Build plan from evaluation' : 'Refresh from evaluation'}
            </button>
            {plan && plan.draft > 0 && (
              <button
                disabled={busy}
                onClick={() => void approve()}
                className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium hover:bg-[#1a6bff] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve plan ({plan.draft})
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}

      {loading && !plan && <p className="text-xs text-[#827D8E]">Loading plan…</p>}

      {plan?.epics.map((epic) => (
        <GlassCard key={epic.id} className="p-0 overflow-hidden">
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                <span className="font-mono text-[11px] text-[#827D8E] mr-2">{epic.key}</span>
                {epic.title}
              </p>
              {epic.description && <p className="text-xs text-[#a8a3b5] mt-1">{epic.description}</p>}
              {epic.sourceQuote && (
                <p className="text-[11px] text-[#827D8E] mt-2 italic border-l-2 border-white/10 pl-2">
                  “{epic.sourceQuote}”
                </p>
              )}
            </div>
            <StatusPill status={epic.status} />
          </div>
          <ul>
            {epic.stories.map((s) => (
              <Story key={s.id} story={s} />
            ))}
          </ul>
        </GlassCard>
      ))}
    </div>
  );
};
