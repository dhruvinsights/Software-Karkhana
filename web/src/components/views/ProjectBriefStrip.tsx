/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * ProjectBriefStrip: the PRD and the epics dashboard, pinned to the top of a
 * project so every team sees the same scope whichever workspace they are in.
 */

import React, { useState } from 'react';
import { ChevronDown, FileText, ListTree, Loader2 } from 'lucide-react';
import { usePlan } from '../../lib/planApi';
import { downloadPdf, fetchHtml, fileSafe } from '../../lib/printable';
import { factoryStore } from '../../store/factoryStore';
import { DocumentModal } from '../workspace/DocumentModal';

const DONE = new Set(['done', 'wont_fix']);
const ACTIVE = new Set(['in_progress', 'in_review', 'ready_for_qa', 'in_qa']);

export const ProjectBriefStrip: React.FC<{ projectId: string; projectName: string; onOpenPlan: () => void }> = ({
  projectId,
  projectName,
  onOpenPlan,
}) => {
  const { plan, docs, offline } = usePlan(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [reading, setReading] = useState(false);
  if (offline) return null;

  const job = docs?.status ?? null;
  const prd = docs?.documents.find((d) => d.kind === 'prd');
  const epics = plan?.epics ?? [];
  const stories = epics.flatMap((e) => e.stories);
  const done = stories.filter((s) => DONE.has(s.status)).length;
  const token = factoryStore.getState().token ?? '';

  if (!prd && epics.length === 0) {
    if (job?.state !== 'running') return null;
    return (
      <div className="rounded-2xl border border-[#075BFF]/30 bg-[#075BFF]/[0.06] px-5 py-3 text-xs text-white flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#5B8FFF]" /> {job.step ?? 'Drafting the PRD and epics'}…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0C0D14]/80 overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-white/[0.06]">
        <button onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 text-sm font-semibold text-white cursor-pointer">
          <ListTree className="w-4 h-4 text-[#075BFF]" /> Epics & PRD
          <span className="text-[11px] font-normal text-[#827D8E]">
            {epics.length} epics · {stories.length} stories · {done} done
          </span>
          <ChevronDown className={`w-4 h-4 text-[#827D8E] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
        <div className="flex items-center gap-3 text-xs">
          {prd && (
            <button onClick={() => setReading(true)} className="text-[#5B8FFF] hover:text-white flex items-center gap-1.5 cursor-pointer">
              <FileText className="w-3.5 h-3.5" /> PRD v{prd.version}
              <span className="text-[10px] font-mono uppercase text-[#827D8E]">{prd.status}</span>
            </button>
          )}
          <button onClick={onOpenPlan} className="text-[#827D8E] hover:text-white cursor-pointer">
            Full plan →
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="p-4 space-y-3">
          {prd?.content?.summary && <p className="text-xs text-[#B5B1C0] leading-relaxed line-clamp-2">{prd.content.summary}</p>}
          <div className="flex gap-3 overflow-x-auto pb-1">
            {epics.map((epic) => {
              const total = epic.stories.length || 1;
              const d = epic.stories.filter((s) => DONE.has(s.status)).length;
              const a = epic.stories.filter((s) => ACTIVE.has(s.status)).length;
              return (
                <button
                  key={epic.id}
                  onClick={onOpenPlan}
                  className="w-60 shrink-0 text-left p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-[#075BFF]/40 cursor-pointer space-y-2"
                >
                  <p className="text-[10px] font-mono text-[#827D8E]">{epic.key}</p>
                  <p className="text-sm text-white line-clamp-2 min-h-[2.5rem]">{epic.title}</p>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
                    <span className="bg-emerald-400" style={{ width: `${(d / total) * 100}%` }} />
                    <span className="bg-[#075BFF]" style={{ width: `${(a / total) * 100}%` }} />
                  </div>
                  <p className="text-[11px] text-[#827D8E]">
                    {epic.stories.length} stories · {d} done{a ? ` · ${a} active` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {reading && (
        <DocumentModal
          title={`${projectName} · PRD`}
          loadHtml={() => fetchHtml(`/api/projects/${projectId}/documents/plan.html`, token)}
          downloadPdf={() => downloadPdf(`/api/projects/${projectId}/documents/plan.pdf`, `${fileSafe(projectName)}-PRD.pdf`, token)}
          onClose={() => setReading(false)}
        />
      )}
    </section>
  );
};
