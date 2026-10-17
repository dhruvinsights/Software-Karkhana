import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, FileText, ListTree, RefreshCw } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { usePlan, PlanIssue, ProjectDoc } from '../../lib/planApi';
import { downloadPdf, fetchHtml, fileSafe } from '../../lib/printable';
import { factoryStore } from '../../store/factoryStore';
import { DocumentModal } from '../workspace/DocumentModal';
import { MermaidDiagram } from '../workspace/MermaidDiagram';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  backlog: 'bg-white/5 text-[#827D8E] border-white/10',
  approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase whitespace-nowrap ${
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
    {story.description && <p className="text-[11px] text-[#827D8E] mt-1 font-mono">{story.description}</p>}
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

const PrdCard: React.FC<{ doc: ProjectDoc; onRead: () => void }> = ({ doc, onRead }) => {
  const prd = doc.content;
  const musts = prd.functional.filter((r: { priority: string }) => r.priority === 'Must').length;
  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#075BFF]" /> PRD v{doc.version}
        </p>
        <StatusPill status={doc.status} />
      </div>
      <p className="text-xs text-[#B5B1C0] leading-relaxed line-clamp-4">{prd.summary}</p>
      <p className="text-[11px] text-[#827D8E]">
        {prd.functional.length} requirements ({musts} must) · {prd.non_functional.length} quality · {prd.journeys.length} journeys
      </p>
      <button
        onClick={onRead}
        className="px-3 py-1.5 bg-[#075BFF]/15 hover:bg-[#075BFF]/25 text-[#5B8FFF] rounded-lg text-xs font-medium cursor-pointer"
      >
        Read PRD, data model and backlog
      </button>
    </GlassCard>
  );
};

const ErdCard: React.FC<{ doc: ProjectDoc }> = ({ doc }) => (
  <GlassCard className="p-5 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm font-semibold text-white flex items-center gap-2">
        <Database className="w-4 h-4 text-[#075BFF]" /> Data model v{doc.version}
      </p>
      <StatusPill status={doc.status} />
    </div>
    <div className="flex flex-wrap gap-1.5">
      {doc.content.entities.map((e: { name: string; status: string }) => (
        <span key={e.name} className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-[#B5B1C0]">
          {e.name} <span className="text-[#827D8E]">· {e.status}</span>
        </span>
      ))}
    </div>
    {doc.mermaid && <MermaidDiagram source={doc.mermaid} className="overflow-x-auto [&_svg]:max-w-full" />}
  </GlassCard>
);

/** The plan drafted from the approved idea: PRD, data model and backlog, approved together by a lead. */
export const ProjectPlanPanel: React.FC<{ projectId: string; projectName: string; canEdit: boolean }> = ({
  projectId,
  projectName,
  canEdit,
}) => {
  const { plan, docs, loading, busy, error, offline, build, approve, redraft } = usePlan(projectId);
  const [reading, setReading] = useState(false);

  if (offline) {
    return <p className="text-xs text-[#827D8E]">This project is not saved on the server, so it has no plan.</p>;
  }

  const token = factoryStore.getState().token ?? '';
  const job = docs?.status ?? null;
  const prd = docs?.documents.find((d) => d.kind === 'prd');
  const erd = docs?.documents.find((d) => d.kind === 'erd');
  const empty = !plan || plan.total === 0;
  const drafting = job?.state === 'running';
  const approved = prd?.status === 'approved';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <ListTree className="w-5 h-5 text-[#075BFF]" /> Plan
          </h2>
          <p className="text-xs text-[#827D8E] mt-1">
            {empty
              ? 'The PRD, data model, epics and stories drafted from the approved idea appear here.'
              : `${plan!.epics.length} epics, ${plan!.total - plan!.epics.length} stories. ${
                  plan!.draft ? `${plan!.draft} waiting for approval.` : 'Approved.'
                }`}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {job && !approved && !drafting && (
              <button
                disabled={busy}
                onClick={() => void redraft()}
                className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Re-draft
              </button>
            )}
            {!job && empty && (
              <button
                disabled={busy}
                onClick={() => void build()}
                className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Build plan from evaluation
              </button>
            )}
            {plan && plan.draft > 0 && !drafting && (
              <button
                disabled={busy}
                onClick={() => void approve()}
                className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium hover:bg-[#1a6bff] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve plan ({plan.draft})
              </button>
            )}
          </div>
        )}
      </div>

      {drafting && (
        <div className="text-xs text-white bg-[#075BFF]/10 border border-[#075BFF]/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#5B8FFF]" /> {job?.step ?? 'Drafting the plan'}…
        </div>
      )}
      {job?.state === 'failed' && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Drafting failed: {job.error}
        </div>
      )}
      {error && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}
      {loading && !plan && <p className="text-xs text-[#827D8E]">Loading plan…</p>}

      {(prd || erd) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {prd && <PrdCard doc={prd} onRead={() => setReading(true)} />}
          {erd && <ErdCard doc={erd} />}
        </div>
      )}

      {plan?.epics.map((epic) => (
        <GlassCard key={epic.id} className="p-0 overflow-hidden">
          <div className="px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                <span className="font-mono text-[11px] text-[#827D8E] mr-2">{epic.key}</span>
                {epic.title}
              </p>
              {epic.description && <p className="text-xs text-[#a8a3b5] mt-1">{epic.description}</p>}
              {epic.sourceQuote && <p className="text-[11px] text-[#827D8E] mt-2 font-mono">{epic.sourceQuote}</p>}
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

      {reading && (
        <DocumentModal
          title={`${projectName} · PRD`}
          loadHtml={() => fetchHtml(`/api/projects/${projectId}/documents/plan.html`, token)}
          downloadPdf={() => downloadPdf(`/api/projects/${projectId}/documents/plan.pdf`, `${fileSafe(projectName)}-PRD.pdf`, token)}
          onClose={() => setReading(false)}
        />
      )}
    </div>
  );
};
