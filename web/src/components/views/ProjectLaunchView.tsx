/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * ProjectLaunchView: the full screen that turns an approved idea into a project.
 *
 *   1. Details & repository — a GitHub repository the factory can push to is required.
 *   2. Teams — the AI reads the idea and suggests which team spaces it needs.
 *   3. Plan — the server drafts the PRD, epics and user stories.
 *   4. Set up — approves the plan and opens the project with its team workspaces.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  FolderGit2,
  GitBranch,
  ListTree,
  Loader2,
  Lock,
  PenTool,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  Terminal,
  Unlock,
  Users,
  Workflow,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { Idea } from '../../types/factory';
import { launchApi, RepoCheck, TeamId, TeamPlan } from '../../lib/launchApi';
import { planApi, usePlan } from '../../lib/planApi';
import { fetchGitHubStatus, pollGitHubDeviceFlow, saveGitHubTokenDirect, startGitHubDeviceFlow } from '../../lib/githubApi';
import { downloadPdf, fetchHtml, fileSafe } from '../../lib/printable';
import { DocumentModal } from '../workspace/DocumentModal';

const STEPS = [
  { id: 'details', title: 'Details & repository', blurb: 'Name it and connect GitHub' },
  { id: 'teams', title: 'Teams', blurb: 'AI picks the teams it needs' },
  { id: 'plan', title: 'Epics & stories', blurb: 'AI drafts the PRD and backlog' },
  { id: 'launch', title: 'Set up project', blurb: 'Open the team workspaces' },
] as const;

export const TEAM_META: Record<TeamId, { label: string; Icon: React.FC<{ className?: string }>; tone: string; role: string }> = {
  design: { label: 'Design', Icon: PenTool, tone: 'text-fuchsia-300', role: 'designer' },
  architecture: { label: 'Architecture', Icon: Workflow, tone: 'text-[#7aa7ff]', role: 'architect' },
  developer: { label: 'Development', Icon: Terminal, tone: 'text-[#5B8FFF]', role: 'developer' },
  qa: { label: 'QA / QC', Icon: CheckCircle2, tone: 'text-emerald-400', role: 'qa' },
  devops: { label: 'CI/CD', Icon: Radio, tone: 'text-blue-400', role: 'devops' },
  security: { label: 'Security', Icon: Shield, tone: 'text-rose-400', role: 'security' },
  release: { label: 'Release', Icon: Rocket, tone: 'text-emerald-300', role: 'release_manager' },
};
const TEAM_ORDER = Object.keys(TEAM_META) as TeamId[];
const SERVER_ROLES = new Set([
  'pm', 'product_manager', 'director', 'executive', 'developer', 'lead', 'designer', 'architect',
  'qa', 'security', 'devops', 'release_manager', 'support', 'admin',
]);

const field =
  'w-full px-4 py-3 bg-[#07070B] border border-white/[0.1] rounded-xl text-sm text-white placeholder-[#5f5b6b] focus:outline-none focus:border-[#075BFF] focus:ring-2 focus:ring-[#075BFF]/20';
const label = 'block text-xs font-semibold text-[#B5B1C0] mb-2';
const card = 'rounded-2xl border border-white/[0.08] bg-[#0C0D14]/80';

const ErrorBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex gap-2">
    <AlertTriangle className="w-4 h-4 shrink-0" />
    <span>{children}</span>
  </div>
);

function codeFrom(name: string) {
  const c = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return c.length >= 2 ? c.slice(0, 6) : 'PRJ';
}

function slugFrom(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'new-project';
}

// ── Step 1: GitHub ────────────────────────────────────────────────────────────

const GitHubConnect: React.FC<{ token: string; onConnected: () => void }> = ({ token, onConnected }) => {
  const [pat, setPat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const startDevice = async () => {
    setError(null);
    try {
      const f = await startGitHubDeviceFlow(token);
      setFlow(f);
      window.open(f.verification_uri, '_blank', 'noopener');
      const wait = Math.max(f.interval, 5) * 1000;
      const deadline = Date.now() + f.expires_in * 1000;
      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, wait));
        const res = await pollGitHubDeviceFlow(f.device_code, token);
        if (res.status === 'granted') { onConnected(); return; }
        if (res.status === 'error') throw new Error(res.error || 'GitHub refused the sign-in.');
      }
    } catch (e) {
      setError((e as Error).message);
      setFlow(null);
    }
  };

  const savePat = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveGitHubTokenDirect(pat.trim(), token);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#B5B1C0]">
        Connect GitHub first. The factory pushes branches and opens pull requests in the project's repository with
        this account, so it needs write access.
      </p>
      {flow ? (
        <div className="p-4 rounded-xl bg-[#075BFF]/10 border border-[#075BFF]/30 text-sm text-white space-y-1">
          <p>Enter this code on GitHub:</p>
          <p className="font-mono text-2xl tracking-[0.3em] text-[#7aa7ff]">{flow.user_code}</p>
          <p className="text-xs text-[#827D8E] flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Waiting for GitHub… ({flow.verification_uri})
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void startDevice()}
          className="k-btn-primary px-5 py-2.5 bg-white text-black rounded-xl text-sm font-semibold flex items-center gap-2 cursor-pointer"
        >
          <FolderGit2 className="w-4 h-4" /> Sign in with GitHub
        </button>
      )}
      <div className="flex items-center gap-3 text-[11px] text-[#5f5b6b] uppercase font-mono">
        <span className="h-px flex-1 bg-white/[0.08]" /> or paste a personal access token <span className="h-px flex-1 bg-white/[0.08]" />
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_… (scopes: repo)"
          className={`${field} font-mono`}
        />
        <button
          type="button"
          disabled={busy || pat.trim().length < 10}
          onClick={() => void savePat()}
          className="px-5 bg-[#075BFF] text-white rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-40 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
};

const RepoVerified: React.FC<{ repo: RepoCheck; onChange: () => void; locked: boolean }> = ({ repo, onChange, locked }) => (
  <div className="p-4 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/30 flex items-start justify-between gap-3">
    <div className="space-y-1">
      <p className="text-sm font-semibold text-white flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {repo.slug}
      </p>
      <p className="text-xs text-[#B5B1C0] flex flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          {repo.private ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />} {repo.private ? 'Private' : 'Public'}
        </span>
        <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> {repo.defaultBranch}</span>
        <span>
          Access: {repo.permissions?.admin ? 'admin' : repo.permissions?.maintain ? 'maintain' : 'write'}
          {repo.login ? ` as @${repo.login}` : ''}
        </span>
        {repo.empty && <span className="text-amber-300">Empty repository</span>}
      </p>
    </div>
    {!locked && (
      <button type="button" onClick={onChange} className="text-xs text-[#827D8E] hover:text-white cursor-pointer shrink-0">
        Change
      </button>
    )}
  </div>
);

// ── Step 3: plan ──────────────────────────────────────────────────────────────

const PLAN_STAGES = ['Reading the repository', 'Writing the PRD', 'Designing the data model and the backlog'];

const PlanStep: React.FC<{ projectId: string; projectName: string }> = ({ projectId, projectName }) => {
  const { plan, docs, error, reload, redraft, busy } = usePlan(projectId);
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const job = docs?.status ?? null;
  const drafting = !job || job.state === 'running';

  // The job announces itself over the socket; poll too, in case the socket is down.
  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [drafting, reload]);

  const prd = docs?.documents.find((d) => d.kind === 'prd');
  const stageIdx = Math.max(0, PLAN_STAGES.findIndex((s) => job?.step?.startsWith(s)));
  const stories = plan ? plan.total - plan.epics.length : 0;
  const token = factoryStore.getState().token ?? '';

  if (job?.state === 'failed') {
    return (
      <div className="space-y-4">
        <ErrorBox>Drafting failed: {job.error}</ErrorBox>
        <button
          disabled={busy}
          onClick={() => void redraft()}
          className="px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Try again
        </button>
      </div>
    );
  }

  if (drafting || !plan || plan.total === 0) {
    return (
      <div className={`${card} p-8 space-y-6`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#075BFF]/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[#5B8FFF] animate-pulse" />
          </div>
          <div>
            <p className="text-white font-semibold">The AI is drafting your plan</p>
            <p className="text-xs text-[#827D8E]">PRD, data model, epics and user stories, grounded in the idea and the code. This takes a few minutes.</p>
          </div>
        </div>
        <ol className="space-y-3">
          {PLAN_STAGES.map((s, i) => {
            const done = job?.state === 'ready' || i < stageIdx;
            const now = !done && i === stageIdx;
            return (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center border ${
                    done ? 'bg-emerald-500/20 border-emerald-500/40' : now ? 'border-[#075BFF] bg-[#075BFF]/15' : 'border-white/10'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : now ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7aa7ff]" /> : null}
                </span>
                <span className={done ? 'text-[#B5B1C0]' : now ? 'text-white' : 'text-[#5f5b6b]'}>{s}</span>
              </li>
            );
          })}
        </ol>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#075BFF] to-fuchsia-500 transition-all duration-700"
            style={{ width: `${((stageIdx + 0.5) / PLAN_STAGES.length) * 100}%` }}
          />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Epics', plan.epics.length],
          ['User stories', stories],
          ['Requirements', prd?.content?.functional?.length ?? 0],
        ].map(([k, v]) => (
          <div key={k as string} className={`${card} p-4`}>
            <p className="text-2xl font-semibold text-white">{v}</p>
            <p className="text-[11px] uppercase font-mono text-[#827D8E]">{k}</p>
          </div>
        ))}
      </div>
      {prd && (
        <div className={`${card} p-5 space-y-2`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#075BFF]" /> PRD v{prd.version}
            </p>
            <button onClick={() => setReading(true)} className="text-xs text-[#5B8FFF] hover:text-white cursor-pointer">
              Read full PRD
            </button>
          </div>
          <p className="text-sm text-[#B5B1C0] leading-relaxed">{prd.content.summary}</p>
          {prd.content.goals?.length > 0 && (
            <ul className="text-xs text-[#a8a3b5] space-y-1 pt-1">
              {prd.content.goals.map((g: string) => (
                <li key={g} className="flex gap-2"><span className="text-[#075BFF]">●</span>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="space-y-2">
        {plan.epics.map((epic) => (
          <div key={epic.id} className={`${card} overflow-hidden`}>
            <button
              onClick={() => setOpen(open === epic.id ? null : epic.id)}
              className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-white/[0.02]"
            >
              <span className="text-sm text-white">
                <span className="font-mono text-[11px] text-[#827D8E] mr-2">{epic.key}</span>
                {epic.title}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-[#827D8E] shrink-0">
                {epic.stories.length} stories
                <ChevronDown className={`w-4 h-4 transition-transform ${open === epic.id ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {open === epic.id && (
              <ul className="border-t border-white/[0.06]">
                {epic.stories.map((s) => (
                  <li key={s.id} className="px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                    <p className="text-xs text-white">
                      <span className="font-mono text-[10px] text-[#827D8E] mr-2">{s.key}</span>
                      {s.title}
                    </p>
                    {s.acceptanceCriteria.length > 0 && (
                      <p className="text-[11px] text-[#827D8E] mt-1">{s.acceptanceCriteria.length} acceptance criteria</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
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

// ── The launch effect ─────────────────────────────────────────────────────────

const LaunchEffect: React.FC<{ name: string; teams: TeamId[]; onDone: () => void }> = ({ name, teams, onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-[100] bg-[#05050A] flex items-center justify-center overflow-hidden" role="status" aria-live="polite">
      <style>{`
        @keyframes kl-ring { from { transform: scale(.2); opacity: .9 } to { transform: scale(4); opacity: 0 } }
        @keyframes kl-rise { from { transform: translateY(24px) scale(.9); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes kl-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes kl-out { to { opacity: 0; transform: scale(1.06) } }
        .kl-root { animation: kl-out .5s ease-in 2.75s forwards }
        @media (prefers-reduced-motion: reduce) { .kl-root *, .kl-root { animation-duration: .01s !important; animation-delay: 0s !important } }
      `}</style>
      <div className="kl-root relative flex flex-col items-center gap-8 px-6 text-center">
        {[0, 0.35, 0.7].map((d) => (
          <span
            key={d}
            className="absolute top-8 w-40 h-40 rounded-full border border-[#075BFF]/60"
            style={{ animation: `kl-ring 1.8s ease-out ${d}s infinite` }}
          />
        ))}
        <div
          className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-[#075BFF] to-fuchsia-600 flex items-center justify-center shadow-[0_0_80px_rgba(7,91,255,0.6)]"
          style={{ animation: 'kl-rise .6s ease-out both' }}
        >
          <Rocket className="w-11 h-11 text-white" />
        </div>
        <div style={{ animation: 'kl-fade .6s ease-out .3s both' }}>
          <p className="text-xs uppercase font-mono tracking-[0.3em] text-[#7aa7ff]">Setting up</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-white mt-2">{name}</h2>
        </div>
        <div className="flex flex-wrap justify-center gap-3 max-w-xl">
          {teams.map((t, i) => {
            const { label: l, Icon, tone } = TEAM_META[t];
            return (
              <span
                key={t}
                className="px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] text-sm text-white flex items-center gap-2"
                style={{ animation: `kl-rise .5s ease-out ${0.7 + i * 0.18}s both` }}
              >
                <Icon className={`w-4 h-4 ${tone}`} /> {l}
              </span>
            );
          })}
        </div>
        <p className="text-sm text-[#827D8E]" style={{ animation: `kl-fade .5s ease-out ${0.9 + teams.length * 0.18}s both` }}>
          Team workspaces ready
        </p>
      </div>
    </div>
  );
};

// ── The screen ────────────────────────────────────────────────────────────────

export const ProjectLaunchView: React.FC<{ state: FactoryState }> = ({ state }) => {
  const token = state.token ?? '';
  const idea: Idea | undefined = state.ideas.find((i) => i.id === state.selectedIdeaId);
  const launchable = state.ideas.filter((i) => i.status === 'approved' && i.scope === 'project' && !i.promotedProjectId);
  const product = state.products.find((p) => p.id === idea?.productId);

  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(idea?.promotedProjectId ?? null);
  const locked = !!projectId; // after the project exists, details and teams are read-only

  // Step 1
  const [name, setName] = useState(idea?.title ?? '');
  const [code, setCode] = useState(codeFrom(idea?.title ?? ''));
  const [description, setDescription] = useState(idea ? `${idea.problemStatement}` : '');
  const [targetDate, setTargetDate] = useState('');
  const [ghConnected, setGhConnected] = useState<boolean | null>(null);
  const [repoMode, setRepoMode] = useState<'existing' | 'new'>(product?.settings?.repositoryUrl ? 'existing' : 'new');
  const [repoUrl, setRepoUrl] = useState<string>(product?.settings?.repositoryUrl ?? '');
  const [newRepo, setNewRepo] = useState({ owner: '', name: slugFrom(idea?.title ?? ''), private: true });
  const [repo, setRepo] = useState<RepoCheck | null>(null);
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  // Step 2
  const [teamPlan, setTeamPlan] = useState<TeamPlan | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teams, setTeams] = useState<Set<TeamId>>(new Set());
  const [people, setPeople] = useState<Partial<Record<TeamId, string[]>>>({});

  // Step 3/4
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const plan = usePlan(projectId ?? undefined);

  // Re-seed when the idea changes (the screen can open before the store syncs).
  useEffect(() => {
    if (!idea) return;
    setName(idea.title);
    setCode(codeFrom(idea.title));
    setDescription(idea.problemStatement);
    setNewRepo((r) => ({ ...r, name: slugFrom(idea.title) }));
    if (idea.promotedProjectId) {
      setProjectId(idea.promotedProjectId);
      setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea?.id]);

  useEffect(() => {
    if (product?.settings?.repositoryUrl && !repoUrl) setRepoUrl(product.settings.repositoryUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const refreshGh = () => {
    if (!token) return;
    fetchGitHubStatus(token).then((s) => setGhConnected(s.connected)).catch(() => setGhConnected(false));
  };
  useEffect(refreshGh, [token]);

  const members = useMemo(
    () => state.workspaceMembers.filter((m) => m.id !== state.currentUser?.id),
    [state.workspaceMembers, state.currentUser?.id],
  );

  const verifyRepo = async () => {
    setRepoBusy(true);
    setRepoError(null);
    try {
      const r = await launchApi.checkRepo(repoUrl.trim());
      if (r.ok) setRepo(r);
      else setRepoError(r.error ?? 'The factory cannot push to this repository.');
    } catch (e) {
      setRepoError((e as Error).message);
    } finally {
      setRepoBusy(false);
    }
  };

  const createRepo = async () => {
    setRepoBusy(true);
    setRepoError(null);
    try {
      const r = await launchApi.createRepo({
        name: newRepo.name.trim(),
        owner: newRepo.owner.trim() || undefined,
        private: newRepo.private,
        description: name,
      });
      setRepo(r);
      setRepoUrl(r.url ?? `https://github.com/${r.slug}`);
    } catch (e) {
      setRepoError((e as Error).message);
    } finally {
      setRepoBusy(false);
    }
  };

  const loadTeamPlan = async () => {
    if (!idea) return;
    setTeamBusy(true);
    setError(null);
    try {
      const p = await launchApi.teamPlan(idea.id);
      const allowed = new Set<string>(product?.teamSpaces?.length ? product.teamSpaces : TEAM_ORDER);
      setTeamPlan(p);
      setTeams(new Set(p.teams.filter((t) => t.needed && allowed.has(t.team)).map((t) => t.team)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTeamBusy(false);
    }
  };

  useEffect(() => {
    if (step === 1 && !teamPlan && !teamBusy && !locked) void loadTeamPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const toggleTeam = (t: TeamId) =>
    setTeams((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const togglePerson = (t: TeamId, userId: string) =>
    setPeople((prev) => {
      const cur = prev[t] ?? [];
      return { ...prev, [t]: cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId] };
    });

  const createProject = async () => {
    if (!idea || !repo) return;
    setCreating(true);
    setError(null);
    const picked = TEAM_ORDER.filter((t) => teams.has(t));
    const byUser = new Map<string, string[]>();
    for (const t of picked) for (const uid of people[t] ?? []) byUser.set(uid, [...(byUser.get(uid) ?? []), t]);
    try {
      const res = await launchApi.promote(idea.id, {
        name: name.trim(),
        code: code.trim() || undefined,
        description: description.trim() || undefined,
        repository_url: repo.url ?? `https://github.com/${repo.slug}`,
        target_release_date: targetDate || undefined,
        teams: ['product', ...picked],
        leads: [...byUser].map(([uid, stations]) => {
          const role = members.find((m) => m.id === uid)?.role ?? 'developer';
          return { user_id: uid, role: SERVER_ROLES.has(role) ? role : 'developer', stations, is_lead: true };
        }),
      });
      setProjectId(res.projectId);
      setStep(2);
      void factoryStore.syncSessionFromServer();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const setUp = async () => {
    if (!projectId) return;
    setError(null);
    try {
      if (plan.plan && plan.plan.draft > 0) await planApi.approve(projectId);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setLaunching(true);
  };

  const finishLaunch = React.useCallback(async () => {
    await factoryStore.syncSessionFromServer();
    if (projectId) factoryStore.selectProject(projectId);
    factoryStore.setScreen('project_detail');
  }, [projectId]);

  // ── Guards ──
  if (!idea) {
    return (
      <div className="max-w-2xl mx-auto py-16 space-y-6 animate-fade-in">
        <h1 className="text-3xl font-semibold text-white">Launch a project</h1>
        <p className="text-sm text-[#827D8E]">Pick an approved idea to turn into a project.</p>
        {launchable.length === 0 ? (
          <p className={`${card} p-6 text-sm text-[#B5B1C0]`}>No approved ideas are waiting. Get an idea approved by its reviewers first.</p>
        ) : (
          <div className="space-y-2">
            {launchable.map((i) => (
              <button
                key={i.id}
                onClick={() => factoryStore.selectIdea(i.id)}
                className={`${card} w-full p-4 text-left hover:border-[#075BFF]/50 cursor-pointer flex items-center justify-between`}
              >
                <span className="text-white text-sm">{i.title}</span>
                <ArrowRight className="w-4 h-4 text-[#827D8E]" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (idea.scope !== 'project' && !idea.promotedProjectId) {
    return (
      <div className="max-w-2xl mx-auto py-16 space-y-4 animate-fade-in">
        <h1 className="text-2xl font-semibold text-white">{idea.title} is a feature, not a project</h1>
        <p className="text-sm text-[#B5B1C0]">
          A single feature is added to a project that already exists. To start a new project, group it with related
          features from the product's ideas.
        </p>
        <button
          onClick={() => factoryStore.setScreen('product_detail')}
          className="px-4 py-2 rounded-xl bg-[#075BFF] text-white text-sm font-semibold cursor-pointer"
        >
          Back to ideas
        </button>
      </div>
    );
  }

  const features = state.ideas.filter((i) => i.parentId === idea.id);
  const canNext =
    step === 0 ? !!repo?.ok && name.trim().length >= 2 : step === 1 ? teams.size > 0 : step === 2 ? !!plan.plan && plan.plan.total > 0 : false;
  const pickedTeams = TEAM_ORDER.filter((t) => teams.has(t));
  const savedTeams = (state.projects.find((p) => p.id === projectId)?.teamsAssigned ?? []).filter((t): t is TeamId =>
    TEAM_ORDER.includes(t as TeamId),
  );
  const projectTeams: TeamId[] = pickedTeams.length ? pickedTeams : savedTeams.length ? savedTeams : TEAM_ORDER;

  const next = () => {
    if (step === 1 && !locked) void createProject();
    else setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto pb-16">
      {launching && <LaunchEffect name={name} teams={projectTeams} onDone={() => void finishLaunch()} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-6 mb-8 border-b border-white/[0.08]">
        <div className="space-y-1">
          <button
            onClick={() => factoryStore.setScreen('product_detail')}
            className="text-xs text-[#827D8E] hover:text-white flex items-center gap-1.5 cursor-pointer mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {product?.name ?? 'Product'}
          </button>
          <p className="text-xs uppercase font-mono tracking-widest text-[#075BFF]">Launch project</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">{idea.title}</h1>
        </div>
        <span className="px-3 py-1 rounded-full text-[11px] font-mono uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shrink-0">
          Idea approved
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
        {/* Stepper */}
        <ol className="flex lg:flex-col gap-2 overflow-x-auto">
          {STEPS.map((s, i) => {
            const done = i < step;
            const now = i === step;
            const reachable = i <= step || (locked && i <= 2);
            return (
              <li key={s.id} className="shrink-0">
                <button
                  disabled={!reachable}
                  onClick={() => setStep(i)}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors ${
                    now ? 'bg-[#075BFF]/10 border border-[#075BFF]/40' : 'border border-transparent hover:bg-white/[0.03]'
                  } ${reachable ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                      done ? 'bg-emerald-500/20 text-emerald-300' : now ? 'bg-[#075BFF] text-white' : 'bg-white/[0.06] text-[#827D8E]'
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </span>
                  <span>
                    <span className={`block text-sm font-medium ${now ? 'text-white' : 'text-[#B5B1C0]'}`}>{s.title}</span>
                    <span className="block text-[11px] text-[#827D8E] hidden sm:block">{s.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Content */}
        <div className="space-y-6 min-w-0">
          {step === 0 && (
            <>
              <section className={`${card} p-6 space-y-5`}>
                <h2 className="text-lg font-semibold text-white">Project details</h2>
                {locked && <p className="text-xs text-amber-300">The project already exists; these details are fixed.</p>}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-3">
                    <label className={label}>Project name *</label>
                    <input disabled={locked} value={name} onChange={(e) => setName(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className={label}>Code</label>
                    <input
                      disabled={locked}
                      value={code}
                      maxLength={8}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      className={`${field} font-mono text-center`}
                    />
                  </div>
                </div>
                {features.length > 0 && (
                  <div>
                    <label className={label}>Features this project delivers</label>
                    <ul className="flex flex-wrap gap-1.5">
                      {features.map((f) => (
                        <li key={f.id} className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-[#B5B1C0]">
                          {f.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <label className={label}>Scope</label>
                  <textarea disabled={locked} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
                </div>
                <div className="sm:w-1/2">
                  <label className={label}>Target release date</label>
                  <input disabled={locked} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={field} />
                </div>
              </section>

              <section className={`${card} p-6 space-y-5`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <FolderGit2 className="w-5 h-5 text-[#075BFF]" /> GitHub repository *
                  </h2>
                  <span className="text-[11px] font-mono text-[#827D8E]">required · write access</span>
                </div>

                {ghConnected === null ? (
                  <p className="text-xs text-[#827D8E] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Checking GitHub…</p>
                ) : !ghConnected ? (
                  <GitHubConnect token={token} onConnected={refreshGh} />
                ) : repo ? (
                  <RepoVerified repo={repo} locked={locked} onChange={() => setRepo(null)} />
                ) : (
                  <>
                    <div className="flex gap-1 p-1 bg-[#07070B] rounded-xl border border-white/[0.08] w-fit">
                      {(['existing', 'new'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => { setRepoMode(m); setRepoError(null); }}
                          className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                            repoMode === m ? 'bg-[#075BFF] text-white' : 'text-[#827D8E] hover:text-white'
                          }`}
                        >
                          {m === 'existing' ? 'Use an existing repository' : 'Create a new repository'}
                        </button>
                      ))}
                    </div>
                    {repoMode === 'existing' ? (
                      <div className="flex gap-2">
                        <input
                          value={repoUrl}
                          onChange={(e) => setRepoUrl(e.target.value)}
                          placeholder="https://github.com/org/repo"
                          className={`${field} font-mono`}
                        />
                        <button
                          disabled={repoBusy || !repoUrl.trim()}
                          onClick={() => void verifyRepo()}
                          className="px-5 bg-[#075BFF] text-white rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-40 shrink-0 flex items-center gap-2"
                        >
                          {repoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Verify access
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_2fr] gap-2 items-end">
                          <div>
                            <label className={label}>Owner (organisation)</label>
                            <input
                              value={newRepo.owner}
                              onChange={(e) => setNewRepo({ ...newRepo, owner: e.target.value })}
                              placeholder="your account"
                              className={`${field} font-mono`}
                            />
                          </div>
                          <span className="hidden sm:block pb-3 text-[#827D8E]">/</span>
                          <div>
                            <label className={label}>Repository name</label>
                            <input
                              value={newRepo.name}
                              onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '-') })}
                              className={`${field} font-mono`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-xs text-[#B5B1C0] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newRepo.private}
                              onChange={(e) => setNewRepo({ ...newRepo, private: e.target.checked })}
                            />
                            Private repository
                          </label>
                          <button
                            disabled={repoBusy || !newRepo.name.trim()}
                            onClick={() => void createRepo()}
                            className="px-5 py-2.5 bg-[#075BFF] text-white rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-2"
                          >
                            {repoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create repository
                          </button>
                        </div>
                      </div>
                    )}
                    {repoError && <ErrorBox>{repoError}</ErrorBox>}
                  </>
                )}
              </section>
            </>
          )}

          {step === 1 && (
            <>
              <section className={`${card} p-6 space-y-3`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#075BFF]" /> AI analysis
                  </h2>
                  {teamPlan && !locked && (
                    <button
                      disabled={teamBusy}
                      onClick={() => void loadTeamPlan()}
                      className="text-xs text-[#827D8E] hover:text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${teamBusy ? 'animate-spin' : ''}`} /> Re-analyse
                    </button>
                  )}
                </div>
                {teamBusy && !teamPlan ? (
                  <p className="text-sm text-[#B5B1C0] flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#5B8FFF]" /> Reading the idea, its evaluation and the product…
                  </p>
                ) : teamPlan ? (
                  <>
                    <p className="text-sm text-[#B5B1C0] leading-relaxed">{teamPlan.summary}</p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-[#075BFF]/15 text-[#7aa7ff] uppercase">{teamPlan.kind.replace('_', ' ')}</span>
                      {teamPlan.source === 'heuristic' && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">AI unavailable: keyword guess</span>
                      )}
                    </div>
                    {teamPlan.risks.length > 0 && (
                      <ul className="text-xs text-[#a8a3b5] space-y-1">
                        {teamPlan.risks.map((r) => (
                          <li key={r} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />{r}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : locked ? (
                  <p className="text-sm text-[#827D8E]">The project already exists; its teams are set.</p>
                ) : null}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#075BFF]" /> Teams for this project
                  <span className="text-[11px] font-normal text-[#827D8E]">· turn on what you need, pick people for each</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {TEAM_ORDER.map((t) => {
                    const meta = TEAM_META[t];
                    const need = teamPlan?.teams.find((x) => x.team === t);
                    const on = teams.has(t);
                    const picked = people[t] ?? [];
                    return (
                      <div
                        key={t}
                        className={`${card} p-4 space-y-3 transition-colors ${on ? 'border-[#075BFF]/40 bg-[#075BFF]/[0.04]' : 'opacity-70'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <meta.Icon className={`w-4 h-4 ${meta.tone}`} />
                            <span className="text-sm font-semibold text-white">{meta.label}</span>
                            {need && (
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                  need.needed ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.05] text-[#827D8E]'
                                }`}
                              >
                                {need.needed ? 'AI: needed' : 'AI: not needed'}
                              </span>
                            )}
                          </div>
                          <button
                            role="switch"
                            aria-checked={on}
                            aria-label={`${meta.label} team`}
                            disabled={locked}
                            onClick={() => toggleTeam(t)}
                            className={`w-10 h-6 rounded-full relative transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                              on ? 'bg-[#075BFF]' : 'bg-white/[0.12]'
                            }`}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                          </button>
                        </div>
                        {need?.reason && <p className="text-xs text-[#a8a3b5]">{need.reason}</p>}
                        {on && members.length > 0 && !locked && (
                          <div className="flex flex-wrap gap-1.5">
                            {members.map((m) => {
                              const sel = picked.includes(m.id);
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => togglePerson(t, m.id)}
                                  title={`${m.name} · ${m.role}`}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1.5 cursor-pointer border ${
                                    sel ? 'bg-[#075BFF]/20 border-[#075BFF]/60 text-white' : 'border-white/[0.08] text-[#827D8E] hover:text-white'
                                  }`}
                                >
                                  {sel && <Check className="w-3 h-3" />}
                                  {m.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              {!locked && (
                <p className="text-xs text-[#827D8E]">
                  Next creates the project and starts drafting its PRD, epics and stories. You stay the project lead with every team.
                </p>
              )}
            </>
          )}

          {step === 2 && projectId && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ListTree className="w-5 h-5 text-[#075BFF]" /> Epics, user stories and the PRD
              </h2>
              <PlanStep projectId={projectId} projectName={name} />
            </section>
          )}

          {step === 3 && (
            <section className={`${card} p-8 space-y-6`}>
              <div>
                <p className="text-xs uppercase font-mono tracking-widest text-[#075BFF]">Ready</p>
                <h2 className="text-2xl font-semibold text-white mt-1">{name}</h2>
                <p className="text-sm text-[#827D8E] mt-1">
                  Setting up approves the drafted plan, moves the stories to the backlog and opens the project.
                </p>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <dt className="text-[11px] uppercase font-mono text-[#827D8E]">Repository</dt>
                  <dd className="text-white font-mono text-xs mt-1 break-all">{repo?.slug ?? state.projects.find((p) => p.id === projectId)?.repositoryUrl}</dd>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <dt className="text-[11px] uppercase font-mono text-[#827D8E]">Plan</dt>
                  <dd className="text-white mt-1">
                    {plan.plan ? `${plan.plan.epics.length} epics · ${plan.plan.total - plan.plan.epics.length} stories` : '—'}
                  </dd>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <dt className="text-[11px] uppercase font-mono text-[#827D8E]">Teams</dt>
                  <dd className="text-white mt-1">{projectTeams.length}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {projectTeams.map((t) => {
                  const { label: l, Icon, tone } = TEAM_META[t];
                  const n = (people[t] ?? []).length;
                  return (
                    <span key={t} className="px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-white flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 ${tone}`} /> {l}
                      {n > 0 && <span className="text-[#827D8E]">· {n}</span>}
                    </span>
                  );
                })}
              </div>
              <button
                onClick={() => void setUp()}
                className="k-btn-primary w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-[#075BFF] to-fuchsia-600 text-white rounded-2xl text-base font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/30"
              >
                <Rocket className="w-5 h-5" /> Set up project
              </button>
            </section>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}

          {/* Footer nav */}
          {step < 3 && (
            <div className="flex items-center justify-between pt-4 border-t border-white/[0.08]">
              <button
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="px-4 py-2.5 text-sm text-[#827D8E] hover:text-white cursor-pointer disabled:opacity-30 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                disabled={!canNext || creating}
                onClick={next}
                className="k-btn-primary px-6 py-3 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Creating project…</>
                ) : step === 1 && !locked ? (
                  <>Create project & draft plan <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <>Continue <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
