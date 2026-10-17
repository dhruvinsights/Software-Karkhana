/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Features vs projects in the idea lists.
 *
 *   ScopeBadge       "Feature" or "Project · n features"
 *   IdeaGroupsBar    the product's size, the rule it implies, AI and manual grouping
 *   IdeaScopeActions per idea: its grouped features, Launch / Add to project / Ungroup
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, FolderGit2, Layers, Loader2, Rocket, Sparkles, Split, X } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { Idea, Product, Project } from '../../types/factory';
import { ideaGroupsApi, SIZE_COPY } from '../../lib/ideaGroupsApi';

const GROUPABLE = new Set(['draft', 'pending_approval', 'approved']);

export const ScopeBadge: React.FC<{ idea: Idea; ideas: Idea[] }> = ({ idea, ideas }) => {
  if (idea.scope === 'project') {
    const n = ideas.filter((i) => i.parentId === idea.id).length;
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30 inline-flex items-center gap-1">
        <Boxes className="w-3 h-3" /> Project{n ? ` · ${n} features` : ''}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border bg-white/[0.04] text-[#B5B1C0] border-white/[0.1] inline-flex items-center gap-1">
      <Layers className="w-3 h-3" /> Feature
    </span>
  );
};

// ── Bar ───────────────────────────────────────────────────────────────────────

export const IdeaGroupsBar: React.FC<{
  product: Product;
  ideas: Idea[];
  projects: Project[];
  onChanged?: () => void;
  compact?: boolean;
}> = ({ product, ideas, projects, onChanged, compact }) => {
  const [busy, setBusy] = useState<'auto' | 'size' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [manual, setManual] = useState(false);
  const profile = product.profile;
  const open = useMemo(
    () => ideas.filter((i) => i.scope !== 'project' && !i.parentId && !i.promotedProjectId && GROUPABLE.has(i.status)),
    [ideas],
  );

  const done = () => {
    void factoryStore.syncSessionFromServer();
    onChanged?.();
  };

  const autoGroup = async () => {
    setBusy('auto');
    setMsg(null);
    try {
      const { groups } = await ideaGroupsApi.autoGroup(product.id);
      setMsg({
        tone: 'ok',
        text: groups.length
          ? `Grouped into ${groups.length} project${groups.length > 1 ? 's' : ''}: ${groups.map((g) => g.title).join(', ')}.`
          : 'No features belong together yet; they stay features.',
      });
      done();
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const resize = async () => {
    setBusy('size');
    setMsg(null);
    try {
      await ideaGroupsApi.refreshProfile(product.id);
      done();
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const copy = profile ? SIZE_COPY[profile.size] : null;
  const small = profile?.size === 'small';

  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-[#0C0D14]/80 ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-semibold text-white flex items-center gap-2">
            <Boxes className="w-4 h-4 text-fuchsia-300" />
            {copy ? copy.label : 'Product not sized yet'}
            {profile?.source === 'heuristic' && <span className="text-[10px] font-mono text-amber-300">estimate</span>}
          </p>
          <p className="text-[11px] text-[#827D8E] leading-relaxed">
            {copy ? copy.rule : 'Size the product so the AI knows what counts as a project here.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void resize()}
            disabled={busy !== null}
            className="px-2.5 py-1.5 rounded-lg text-[11px] text-[#827D8E] hover:text-white border border-white/[0.08] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            title="Re-size the product with its latest code"
          >
            {busy === 'size' && <Loader2 className="w-3 h-3 animate-spin" />} {profile ? 'Re-size' : 'Size product'}
          </button>
          {!(small && projects.length > 0) && (
            <>
              <button
                onClick={() => setManual(true)}
                disabled={open.length < 2}
                className="px-2.5 py-1.5 rounded-lg text-[11px] text-white border border-white/[0.12] hover:bg-white/[0.05] cursor-pointer disabled:opacity-40"
              >
                Group by hand
              </button>
              <button
                onClick={() => void autoGroup()}
                disabled={busy !== null || open.length < 2}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-[#075BFF] to-fuchsia-600 cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                title={open.length < 2 ? 'Needs at least two open features' : 'Bundle related features into projects'}
              >
                {busy === 'auto' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Group related features
              </button>
            </>
          )}
        </div>
      </div>
      {small && projects.length > 0 && (
        <p className="text-[11px] text-[#B5B1C0]">
          Approved features are added to <span className="text-white">{projects[0].name}</span>.
        </p>
      )}
      {msg && (
        <p className={`text-[11px] ${msg.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
      )}
      {manual && <ManualGroupModal product={product} features={open} onClose={() => setManual(false)} onDone={done} />}
    </div>
  );
};

const ManualGroupModal: React.FC<{ product: Product; features: Idea[]; onClose: () => void; onDone: () => void }> = ({
  product,
  features,
  onClose,
  onDone,
}) => {
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await ideaGroupsApi.group(product.id, { idea_ids: picked, title: title.trim(), problem_statement: problem.trim() });
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full px-3 py-2.5 bg-[#07070B] border border-white/[0.1] rounded-xl text-sm text-white placeholder-[#5f5b6b] focus:outline-none focus:border-[#075BFF]';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-[#0C0D14] border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Group features into a project</h3>
            <p className="text-xs text-[#827D8E]">Pick at least two related features.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-[#827D8E] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {features.map((f) => (
            <label key={f.id} className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.03] cursor-pointer">
              <input
                type="checkbox"
                checked={picked.includes(f.id)}
                onChange={() => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}
                className="mt-0.5"
              />
              <span className="text-sm text-white">
                {f.title}
                <span className="block text-[11px] text-[#827D8E] line-clamp-1">{f.problemStatement}</span>
              </span>
            </label>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project name" className={input} />
        <textarea
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          rows={3}
          placeholder="The goal these features deliver together"
          className={input}
        />
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-[#827D8E] hover:text-white cursor-pointer">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || picked.length < 2 || title.trim().length < 2 || problem.trim().length < 2}
            className="px-4 py-2 rounded-xl bg-[#075BFF] text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
          >
            {busy ? 'Grouping…' : `Group ${picked.length} features`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Per idea ──────────────────────────────────────────────────────────────────

export const IdeaScopeActions: React.FC<{
  idea: Idea;
  ideas: Idea[];
  projects: Project[];
  onChanged?: () => void;
}> = ({ idea, ideas, projects, onChanged }) => {
  const [target, setTarget] = useState(projects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const children = ideas.filter((i) => i.parentId === idea.id);
  const delivery = idea.delivery;

  const done = () => {
    void factoryStore.syncSessionFromServer();
    onChanged?.();
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (idea.scope === 'project') {
    return (
      <div className="space-y-2">
        {children.length > 0 && (
          <ul className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.05]">
            {children.map((c) => (
              <li key={c.id} className="px-3 py-2 text-xs text-[#B5B1C0] flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <Layers className="w-3 h-3 text-[#827D8E] shrink-0" />
                  <span className="truncate">{c.title}</span>
                </span>
                <span className="text-[10px] font-mono uppercase text-[#827D8E] shrink-0">{c.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
        {typeof idea.assessment?.rationale === 'string' && idea.assessment.rationale && (
          <p className="text-[11px] text-[#827D8E] italic">{idea.assessment.rationale}</p>
        )}
        {!idea.promotedProjectId && (
          <div className="flex flex-wrap gap-2">
            {idea.status === 'approved' && (
              <button
                onClick={() => factoryStore.openProjectLaunch(idea.id)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Rocket className="w-3.5 h-3.5" /> Launch project
              </button>
            )}
            {children.length > 0 && (
              <button
                disabled={busy}
                onClick={() => void run(() => ideaGroupsApi.ungroup(idea.id))}
                className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#827D8E] hover:text-white text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Split className="w-3.5 h-3.5" /> Ungroup
              </button>
            )}
          </div>
        )}
        {error && <p className="text-[11px] text-red-300">{error}</p>}
      </div>
    );
  }

  // A feature.
  if (delivery?.state === 'running') {
    return (
      <p className="text-[11px] text-[#7aa7ff] flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Drafting into {delivery.projectName ?? 'the project'}…
      </p>
    );
  }
  if (idea.promotedProjectId) return null;
  if (idea.status !== 'approved' || idea.parentId) {
    return delivery?.state === 'failed' ? (
      <p className="text-[11px] text-red-300 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> {delivery.error}
      </p>
    ) : null;
  }
  return (
    <div className="space-y-1.5">
      {delivery?.state === 'failed' && (
        <p className="text-[11px] text-red-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> Last try failed: {delivery.error}
        </p>
      )}
      {projects.length === 0 ? (
        <p className="text-[11px] text-[#827D8E]">
          A single feature is not a project. Group it with related features to start one.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <FolderGit2 className="w-3.5 h-3.5 text-[#5B8FFF]" />
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-[#07070B] border border-white/[0.1] rounded-lg text-xs text-white px-2 py-1.5"
            aria-label="Project to add the feature to"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !target}
            onClick={() => void run(() => ideaGroupsApi.addToProject(idea.id, target))}
            className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-xs font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add to project
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
};
