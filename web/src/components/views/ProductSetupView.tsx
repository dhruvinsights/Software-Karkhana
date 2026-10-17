import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  Cpu,
  GitPullRequest,
  Layers,
  Lock,
  Radio,
  Server,
  Shield,
  CheckCircle2,
  Users,
  Workflow,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import type { Product, ProductProfile } from '../../types/factory';
import { ideaGroupsApi, SIZE_COPY } from '../../lib/ideaGroupsApi';
import { CreateProductModal } from '../workspace/CreateProductModal';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';

/**
 * Full-screen product setup (replaces the "Create Real Product" popup).
 * 1. Product specs  2. Team spaces  3. Reviewers  4. Review & create.
 * Team spaces are the separate work environments each project of this product
 * gets; the people in them are picked per project.
 */

const TEAM_SPACES: {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  env: string[];
}[] = [
  { id: 'design', label: 'Design', icon: <Cpu className="w-4 h-4" />, color: '#5B8FFF', env: ['AI prototype studio', 'Screen flow maps', 'Design tokens & review pins'] },
  { id: 'architecture', label: 'Architecture', icon: <Workflow className="w-4 h-4" />, color: '#5B8FFF', env: ['System design (C4 / Mermaid)', 'ADR registry', 'API contracts & risk map'] },
  { id: 'developer', label: 'Development', icon: <GitPullRequest className="w-4 h-4" />, color: '#075BFF', env: ['Agent sandboxes & sessions', 'Pull requests & AI review', 'Dependency manifest'] },
  { id: 'qa', label: 'QA / QC', icon: <CheckCircle2 className="w-4 h-4" />, color: '#00d9a6', env: ['AI test scenario generator', 'Manual & automated runs', 'Defects & QA sign-off'] },
  { id: 'security', label: 'Security & Pentest', icon: <Shield className="w-4 h-4" />, color: '#f43f5e', env: ['Threat model & assessments', 'Dependency / SAST / DAST scans', 'Findings & SLA tracking'] },
  { id: 'devops', label: 'CI/CD', icon: <Server className="w-4 h-4" />, color: '#f0a500', env: ['Pipeline studio', 'Environments', 'Deployment readiness'] },
  { id: 'release', label: 'Release', icon: <Radio className="w-4 h-4" />, color: '#22c55e', env: ['Pre-flight checklist', 'Multi-role sign-off', 'Release notes & rollout'] },
];

const STEPS = [
  { id: 1, label: 'Product', hint: 'Specs, docs or JSON' },
  { id: 2, label: 'Team spaces', hint: 'Work environments' },
  { id: 3, label: 'Reviewers', hint: 'Who decides ideas' },
  { id: 4, label: 'Review & create', hint: 'Confirm setup' },
] as const;

export const ProductSetupView: React.FC<{ state: FactoryState }> = ({ state }) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [spec, setSpec] = useState<Partial<Product> | null>(null);
  const [teamSpaces, setTeamSpaces] = useState<Set<string>>(new Set(TEAM_SPACES.map((t) => t.id)));
  const [reviewerIds, setReviewerIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The AI sizes the product on the review step; the size decides what counts as a project.
  const [profile, setProfile] = useState<ProductProfile | null>(null);
  const [sizing, setSizing] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 4 || !spec?.name || profile || sizing) return;
    setSizing(true);
    setSizeError(null);
    ideaGroupsApi
      .analyse({
        name: spec.name,
        description: spec.description,
        problem_statement: spec.problemStatement,
        target_users: spec.targetUsers,
        tech_stack: spec.techStack,
        key_features: spec.keyFeatures,
        constraints: spec.constraints,
      })
      .then(setProfile)
      .catch((e) => setSizeError((e as Error).message))
      .finally(() => setSizing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, spec]);

  // A changed spec needs a fresh sizing.
  useEffect(() => setProfile(null), [spec]);

  const isAdmin = state.myAccess === 'owner' || state.myAccess === 'admin';
  const others = state.workspaceMembers.filter((m) => m.id !== state.currentUser?.id);
  const exit = () => factoryStore.setScreen('workspace_home');

  // Access arrives with the first sync; don't show the lock to a real admin before it does.
  if (state.myAccess === null) {
    return (
      <div className="max-w-3xl mx-auto py-24 flex justify-center animate-fade-in">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto py-24 text-center space-y-3 animate-fade-in">
        <Lock className="w-8 h-8 mx-auto text-[#827D8E]" />
        <h1 className="text-2xl font-semibold text-white">Only workspace admins can set up a product</h1>
        <p className="text-sm text-[#B5B1C0]">Ask the workspace owner to make you an admin from the Admin Panel.</p>
        <button onClick={exit} className="mt-4 px-4 py-2 rounded-xl border border-white/[0.1] text-xs text-white hover:bg-white/[0.04] cursor-pointer">
          Back to Overview
        </button>
      </div>
    );
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const create = async () => {
    if (!spec) return;
    setCreating(true);
    setError(null);
    try {
      await factoryStore.createProduct({
        ...spec,
        teamSpaces: TEAM_SPACES.filter((t) => teamSpaces.has(t.id)).map((t) => t.id),
        reviewerIds: [...reviewerIds],
        profile,
      });
    } catch (e) {
      setError((e as Error).message || 'Could not create the product.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Hero, same editorial style as Overview */}
      <div className="relative pb-8 border-b border-white/[0.08] flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-mono text-[#075BFF] font-medium px-2 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">
              {state.workspace.name}
            </span>
            <span className="text-xs text-[#827D8E] font-mono">· Product workspace setup</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-tight">
            Create <ShinyText text="Product" speed={4} />
          </h1>
          <p className="text-sm text-[#B5B1C0] max-w-2xl font-light leading-relaxed">
            Describe the product in detail, choose the team spaces its projects work in, and pick the seniors who review ideas.
            Everyone in the workspace sees this product on Overview.
          </p>
        </div>
        <button onClick={exit} className="px-4 py-2 rounded-xl border border-white/[0.1] text-xs text-[#B5B1C0] hover:text-white hover:bg-white/[0.04] cursor-pointer shrink-0">
          Cancel
        </button>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl text-xs">
        {STEPS.map((s) => {
          const done = s.id < step;
          const active = s.id === step;
          // Leaving step 1 goes through Continue so the spec is always the latest one;
          // reviewers and review need at least one team space.
          const reachable =
            s.id === 1 || (spec !== null && step !== 1 && (s.id === 2 || teamSpaces.size > 0));
          return (
            <button
              key={s.id}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && setStep(s.id)}
              className={`py-2.5 px-3 rounded-lg font-medium transition-colors flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed ${
                active ? 'bg-blue-600 text-white shadow-xs' : reachable ? 'text-slate-300 hover:text-white' : 'text-slate-600'
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-[10px] font-mono flex items-center justify-center shrink-0 ${active ? 'bg-white/20' : done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800'}`}>
                {done ? <Check className="w-3 h-3" /> : s.id}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{s.label}</span>
                <span className={`block text-[10px] truncate ${active ? 'text-white/70' : 'text-slate-500'}`}>{s.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Step 1: the existing product form, inline. Kept mounted so nothing typed is lost. */}
      <div className={step === 1 ? '' : 'hidden'}>
        <CreateProductModal
          isOpen
          variant="page"
          onClose={exit}
          onContinue={(s) => {
            setSpec(s);
            setStep(2);
          }}
        />
      </div>

      {/* Step 2: team spaces */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Team spaces</h2>
              <p className="text-xs text-[#827D8E] mt-1 max-w-2xl">
                Each team space is a separate work environment inside every project of this product, visible only to the people
                added to it. You pick those people when you create each project. Product (PM) and the reviewers' read-only overview are always included.
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#827D8E] shrink-0">{teamSpaces.size} of {TEAM_SPACES.length} enabled</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEAM_SPACES.map((t) => {
              const on = teamSpaces.has(t.id);
              return (
                <button key={t.id} type="button" onClick={() => toggle(teamSpaces, setTeamSpaces, t.id)} className="text-left cursor-pointer">
                  <SpotlightCard
                    className={`p-5 bg-[#0c0e15]/90 transition-all space-y-3 h-full ${on ? 'border-white/[0.16]' : 'border-white/[0.06] opacity-50'}`}
                    spotlightColor={`${t.color}33`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${t.color}1f`, color: t.color }}>
                          {t.icon}
                        </span>
                        <span className="text-sm font-semibold text-white">{t.label}</span>
                      </div>
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-blue-600 border-blue-500' : 'border-white/20'}`}>
                        {on && <Check className="w-3 h-3 text-white" />}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {t.env.map((e) => (
                        <li key={e} className="text-[11px] text-[#B5B1C0] font-mono flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
                          {e}
                        </li>
                      ))}
                    </ul>
                  </SpotlightCard>
                </button>
              );
            })}
          </div>
          <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel="Continue to Reviewers" nextDisabled={teamSpaces.size === 0} />
        </div>
      )}

      {/* Step 3: reviewers */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Reviewers</h2>
            <p className="text-xs text-[#827D8E] mt-1 max-w-2xl">
              Seniors such as directors who review the product's ideas. Reviewers can comment and approve or reject ideas, and see a
              read-only overview of each project (status, epics, progress). They don't see team work areas unless they're also added to a team.
              Each reviewer gets a notification.
            </p>
          </div>
          <SpotlightCard className="p-5 bg-[#0c0e15]/90 border-white/[0.08]" spotlightColor="rgba(0, 217, 166, 0.12)">
            {others.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#827D8E]">
                <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                No one else is in this workspace yet. Invite people with "Invite to Workspace"; you can add reviewers later from the Admin Panel.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {others.map((m) => {
                  const on = reviewerIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(reviewerIds, setReviewerIds, m.id)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer"
                      style={{
                        background: on ? 'rgba(0,217,166,0.08)' : 'rgba(0,0,0,0.3)',
                        border: on ? '1px solid rgba(0,217,166,0.45)' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <span className="w-8 h-8 rounded-lg bg-[#075BFF]/20 flex items-center justify-center text-[11px] font-bold text-[#B5B1C0] shrink-0 overflow-hidden">
                        {m.avatar ? <img src={m.avatar} alt="" className="w-8 h-8 object-cover" referrerPolicy="no-referrer" /> : m.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-white truncate">{m.name}</span>
                        <span className="block text-[10px] font-mono text-slate-500 truncate">{m.email} · {m.role.replace(/_/g, ' ')}</span>
                      </span>
                      {on ? <ClipboardCheck className="w-4 h-4 text-[#00d9a6] shrink-0" /> : <span className="text-[10px] font-mono text-slate-500 shrink-0">{m.access}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </SpotlightCard>
          <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Review setup" />
        </div>
      )}

      {/* Step 4: review & create */}
      {step === 4 && spec && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SpotlightCard className="lg:col-span-2 p-6 bg-[#0c0e15]/90 border-white/[0.08] space-y-3" spotlightColor="rgba(7, 91, 255, 0.15)">
              <div className="flex items-center gap-2 text-xs font-mono text-[#827D8E]">
                <Layers className="w-3.5 h-3.5 text-[#075BFF]" />
                <span>{spec.code}</span>
                <span>·</span>
                <span className="text-[#075BFF]">{spec.domain}</span>
              </div>
              <h3 className="text-2xl font-medium text-white tracking-tight">{spec.name}</h3>
              {spec.problemStatement && <p className="text-sm text-[#B5B1C0] leading-relaxed font-light">{spec.problemStatement}</p>}
              {spec.targetUsers && <p className="text-xs text-[#827D8E]">For: {spec.targetUsers}</p>}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(spec.techStack ?? []).map((t) => (
                  <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[#B5B1C0]">{t}</span>
                ))}
              </div>
              {spec.repositories?.[0] && <div className="text-xs font-mono text-[#827D8E]">Repo: <span className="text-[#075BFF]">{spec.repositories[0]}</span></div>}
            </SpotlightCard>
            <div className="space-y-4">
              <SpotlightCard className="p-5 bg-[#0c0e15]/90 border-white/[0.08] space-y-2" spotlightColor="rgba(81, 76, 232, 0.15)">
                <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E]">Team spaces · {teamSpaces.size}</div>
                <div className="flex flex-wrap gap-1.5">
                  {TEAM_SPACES.filter((t) => teamSpaces.has(t.id)).map((t) => (
                    <span key={t.id} className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ color: t.color, borderColor: `${t.color}55`, background: `${t.color}14` }}>{t.label}</span>
                  ))}
                </div>
              </SpotlightCard>
              <SpotlightCard className="p-5 bg-[#0c0e15]/90 border-white/[0.08] space-y-2" spotlightColor="rgba(0, 217, 166, 0.12)">
                <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E]">Reviewers · {reviewerIds.size}</div>
                <div className="text-xs text-[#B5B1C0]">
                  {reviewerIds.size === 0 ? 'None yet (add later from the Admin Panel)' : others.filter((m) => reviewerIds.has(m.id)).map((m) => m.name).join(', ')}
                </div>
              </SpotlightCard>
            </div>
          </div>
          <SpotlightCard className="p-5 bg-[#0c0e15]/90 border-white/[0.08] space-y-2" spotlightColor="rgba(192, 38, 211, 0.12)">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E]">AI sizing</div>
              {profile && (
                <div className="flex gap-1">
                  {(['small', 'medium', 'large'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setProfile({ ...profile, size: sz })}
                      className={`px-2.5 py-1 rounded-lg text-[11px] capitalize cursor-pointer ${
                        profile.size === sz ? 'bg-fuchsia-500/20 text-white border border-fuchsia-500/50' : 'text-[#827D8E] border border-white/[0.08] hover:text-white'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {sizing ? (
              <p className="text-sm text-[#B5B1C0] flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" /> Reading the product to size it…
              </p>
            ) : profile ? (
              <>
                <p className="text-sm text-white font-medium">{SIZE_COPY[profile.size].label}</p>
                <p className="text-xs text-[#B5B1C0]">{SIZE_COPY[profile.size].rule}</p>
                {profile.summary && <p className="text-xs text-[#827D8E]">{profile.summary}</p>}
                <p className="text-[11px] text-[#827D8E]">{profile.reason}</p>
              </>
            ) : (
              <p className="text-xs text-[#827D8E]">
                {sizeError ? `Could not size it now (${sizeError}); it will be sized after creation.` : 'Not sized yet.'}
              </p>
            )}
          </SpotlightCard>
          {error && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2.5">{error}</div>}
          <StepNav onBack={() => setStep(3)} onNext={create} nextLabel={creating ? 'Creating…' : 'Create Product'} nextDisabled={creating || sizing} primary />
        </div>
      )}
    </div>
  );
};

function StepNav({
  onBack, onNext, nextLabel, nextDisabled, primary,
}: { onBack: () => void; onNext: () => void; nextLabel: string; nextDisabled?: boolean; primary?: boolean }) {
  return (
    <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
      <button type="button" onClick={onBack} className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className={`px-5 py-2.5 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          primary ? 'bg-[#075BFF] hover:bg-[#075BFF]/90 shadow-[#075BFF]/20' : 'bg-blue-600 hover:bg-blue-500'
        }`}
      >
        <span>{nextLabel}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
