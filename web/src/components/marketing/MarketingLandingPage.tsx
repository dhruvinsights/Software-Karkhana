import React, { useRef, useState } from 'react';
import { ArrowRight, Check, X as XIcon } from 'lucide-react';
import { MarketingNavbar } from './MarketingNavbar';
import { LaserFlow } from '../reactbits/LaserFlow';
import { SpecularButton } from '../reactbits/SpecularButton';
import { LiquidEther } from '../reactbits/LiquidEther';
import { HeroDashboard } from './HeroDashboard';
import { WorkspaceDemo } from './WorkspaceDemo';
import { AccountabilityDemo } from './AccountabilityDemo';
import { QAIntelligenceDemo } from './QAIntelligenceDemo';
import { IdeaQDemo } from './IdeaQDemo';
import { LedgerPanel } from './LedgerPanel';
import { useLedger } from './useLedger';
import { BORDER, SectionHeading } from './demoKit';
import './marketing.css';

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  /** True while "Launch Software Factory" is preparing the demo workspace. */
  getStartedBusy?: boolean;
  getStartedError?: string | null;
}

type RoleTab = 'exec' | 'arch' | 'dev' | 'qa' | 'sec';

const CONTAINER = 'max-w-[1280px] mx-auto px-6 lg:px-12';

const CLAIMS = [
  ['6 teams', 'one shared project graph'],
  ['0 unsigned merges', 'humans own every gate'],
  ['100% of decisions', 'on a hash-chained ledger'],
  ['Role-aware', 'each person sees their own station'],
];

const BEFORE_AFTER = [
  { dim: 'Context', before: 'PM in Jira, design in Figma, architects in Confluence, devs in the IDE, QA in TestRail. Context dies at every handoff.', after: 'One project graph. Acceptance criteria, ADRs and rules travel with every story and agent task.' },
  { dim: 'AI output', before: 'An agent says "done" and nobody can tell what it actually checked.', after: 'Completion needs test runs, a diff and evidence. Then a named person signs.' },
  { dim: 'Approvals', before: 'Architecture, security waivers and releases get approved in email and chat threads.', after: 'Role-enforced gates. Director, Architect, AppSec and QA each hold explicit authority.' },
  { dim: 'Audit', before: 'Finding who approved a change takes days of log archaeology.', after: 'Every transition, approval and diff is a block in a SHA-256 chain you can verify.' },
];

const STAGES = [
  { name: 'Idea & evidence', who: 'Product', desc: 'IdeaQ turns a question about your codebase into a cited proposal. Reviewers approve it or say why not.' },
  { name: 'Design & architecture', who: 'Design + Architect', desc: 'Flows, tokens, ADRs and API contracts are written against the same graph the developers build from.' },
  { name: 'Agent build', who: 'Engineering', desc: 'Sandboxed workers write the patch, run the real tests and open a PR with a diff for a human to review.' },
  { name: 'QA & security gate', who: 'QA + AppSec', desc: 'QA agents suggest, people reproduce. A closed security gate blocks sign-off at the server.' },
  { name: 'Release & learn', who: 'DevOps + Release', desc: 'Staged rollout with rollback plans. Incidents become verified learnings that feed the next project.' },
];

const ROLE_TABS: { id: RoleTab; label: string }[] = [
  { id: 'exec', label: 'Director' },
  { id: 'arch', label: 'Architect' },
  { id: 'dev', label: 'Developer' },
  { id: 'qa', label: 'QA Lead' },
  { id: 'sec', label: 'AppSec' },
];

const ROLES: Record<RoleTab, { title: string; desc: string; features: string[]; badge: string }> = {
  exec: { badge: 'Owns the go / no-go', title: 'See portfolio risk without chasing status', desc: 'Approve proposals, budgets and releases from one queue. Every approval carries your name and lands on the ledger.', features: ['Reviewer queue with evaluation reports', 'Phase-gate sign-off', 'Portfolio health at a glance'] },
  arch: { badge: 'Owns the boundaries', title: 'Decide once, enforce everywhere', desc: 'Write ADRs and API contracts that agents and developers build against, and review every PR for boundary violations.', features: ['ADR studio', 'OpenAPI contract registry', 'Threat and risk map'] },
  dev: { badge: 'Owns the code', title: 'Delegate the typing, keep the judgement', desc: 'Agents work in isolated sandboxes and run real tests. You review a diff with evidence, not a promise.', features: ['Sandboxed agent runs', 'Diff and PR review panel', 'Manual check before QA'] },
  qa: { badge: 'Owns "is it done"', title: 'Agents suggest. You decide.', desc: 'The QA agent drafts scenarios and flags suspects from the code. You reproduce, file or dismiss with a reason.', features: ['AI scenario drafting', 'Accept or dismiss suggestions', 'Sign-off blocked by open gates'] },
  sec: { badge: 'Owns the gate', title: 'A gate the server actually enforces', desc: 'Findings, SBOM and waivers live next to the work. While the gate is closed, sign-off is refused, not just discouraged.', features: ['SBOM and dependency audit', 'Waivers with a named owner', 'Policy rules per project'] },
};

export const MarketingLandingPage: React.FC<MarketingLandingPageProps> = ({
  onGetStarted,
  onSignIn,
  getStartedBusy,
  getStartedError,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [activeRoleTab, setActiveRoleTab] = useState<RoleTab>('qa');
  const [activeStage, setActiveStage] = useState(2);
  const ledger = useLedger();
  const role = ROLES[activeRoleTab];

  return (
    <div className="min-h-screen text-[#f7f8fc] font-sans antialiased selection:bg-[#075bff] selection:text-white relative overflow-x-hidden" style={{ background: '#05010f' }}>
      <LiquidEther
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
        colors={['#2a00ff', '#5300ff', '#b497cf']}
        mouseForce={12}
        cursorSize={50}
        persistence={0.5}
        autoDemo
        autoSpeed={0.25}
        autoIntensity={0.3}
        intensity={0.35}
        viscosity={0}
        resolution={0.4}
        clickBurst={false}
        bounceEdges={false}
        intro={false}
        lightMode={false}
      />
      <MarketingNavbar onGetStarted={onSignIn} onSignIn={onSignIn} />

      {/* 1. HERO */}
      <section className="relative pt-24 pb-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none z-0">
          <LaserFlow surfaceRef={cardRef} beamPosition={0.72} surfaceLevel={0.25} color="#3847ff" intensity={1.8} mouseInteraction intro />
        </div>

        <div className={`${CONTAINER} relative z-20 pt-8`}>
          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08] text-white">
              Autonomous where it&apos;s safe. <span className="font-serif italic font-normal text-[#5B8FFF]">Accountable where it matters.</span>
            </h1>
            <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
              Agents execute the tasks. Product, design, architecture, engineering, QA and security work from one place, and a named person signs every decision on a ledger you can verify.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <SpecularButton size="md" radius={14} tint="#075bff" tintOpacity={0.3} lineColor="#ffffff" baseColor="#075bff" intensity={1.2} glow={1.2} followMouse proximity={250} onClick={getStartedBusy ? undefined : onGetStarted} className="font-semibold">
                <span>{getStartedBusy ? 'Preparing your workspace…' : 'Try the live workspace'}</span>
                <ArrowRight className="w-4 h-4 ml-1 inline-block" />
              </SpecularButton>
              <SpecularButton size="md" radius={14} tint="#ffffff" tintOpacity={0.08} lineColor="#60a5fa" baseColor="#111524" intensity={0.9} glow={0.8} followMouse proximity={250} onClick={onSignIn} className="font-medium">
                <span>Sign in</span>
              </SpecularButton>
            </div>
            <p className="text-xs text-slate-500">No account needed. You get a sandbox workspace with sample data.</p>
            {getStartedError && (
              <p role="alert" className="text-sm text-rose-300">
                {getStartedError}{' '}
                <button type="button" onClick={onSignIn} className="underline cursor-pointer">Sign in instead</button>
              </p>
            )}
          </div>
        </div>

        <div className="relative max-w-[1400px] h-[720px] sm:h-[760px] lg:h-[800px] mx-auto mt-16 px-4 sm:px-8 z-20">
          <HeroDashboard entries={ledger.entries} record={ledger.record} onGetStarted={onGetStarted} cardRef={cardRef} />
        </div>
        <p className="relative z-20 text-center text-[11px] text-slate-500 mt-3">This is the real workspace layout. Approve a proposal, add a product, chat. It all works.</p>
      </section>

      {/* Claims strip */}
      <section className={`${CONTAINER} pb-20 relative z-20`}>
        <div className={`grid grid-cols-2 lg:grid-cols-4 border-t border-l ${BORDER}`}>
          {CLAIMS.map(([big, small]) => (
            <div key={big} className={`p-6 border-r border-b ${BORDER} bg-[#0d0e14]/60`}>
              <div className="text-2xl font-semibold text-white tracking-tight">{big}</div>
              <div className="text-xs text-slate-400 mt-1">{small}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. THE PROBLEM */}
      <section id="problem-section" className={`${CONTAINER} pb-24 space-y-10 relative z-20`}>
        <SectionHeading eyebrow="The problem" lead="Your teams are good. Your handoffs are" accent="where it breaks." sub="Context fragments across tools, AI agents claim 'done' without proof, and approvals happen in threads nobody can audit later." />
        <div className={`border-t ${BORDER}`}>
          <div className={`hidden md:grid grid-cols-[140px_1fr_1fr] gap-6 py-3 text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b ${BORDER}`}>
            <span /><span>Disconnected enterprise</span><span className="text-[#5B8FFF]">With Software Karkhana</span>
          </div>
          {BEFORE_AFTER.map((r) => (
            <div key={r.dim} className={`grid md:grid-cols-[140px_1fr_1fr] gap-3 md:gap-6 py-5 border-b ${BORDER}`}>
              <div className="text-sm font-semibold text-white">{r.dim}</div>
              <div className="flex gap-2.5 text-sm text-slate-400 leading-relaxed"><XIcon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />{r.before}</div>
              <div className="flex gap-2.5 text-sm text-slate-200 leading-relaxed"><Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />{r.after}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. TEAMS CONNECTED */}
      <section id="teams-section" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading eyebrow="Connected teams" lead="One change. Everyone who needs to know," accent="knows." sub="Pick an event below. Watch which teams are notified, then switch to another team's view and see what landed there." />
        <WorkspaceDemo record={ledger.record} />
      </section>

      {/* 4. ACCOUNTABILITY */}
      <section id="accountability-section" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading eyebrow="Review before AI. Accountability for people." lead="The agent can write the PR." accent="It cannot approve it." sub="Try merging before anyone has signed. The server refuses and tells you who is missing. Then sign the gates in order." />
        <AccountabilityDemo record={ledger.record} />
      </section>

      {/* 5. QA INTELLIGENCE */}
      <section id="qa-section" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading eyebrow="QA intelligence" lead="Let the agent find the suspects." accent="You make the call." sub="The QA agent reads the code and tests, then proposes bugs with steps and file evidence. Reproduce it and a bug goes to the developer. Disagree and you must say why." />
        <QAIntelligenceDemo record={ledger.record} />
      </section>

      {/* 6. IDEAQ */}
      <section id="ideaq-section" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading eyebrow="IdeaQ" lead="Ask your codebase." accent="Get a proposal with citations." sub="Every answer points to files and lines. Save a good one as an idea and it lands in Reviews for a decision." />
        <IdeaQDemo record={ledger.record} />
      </section>

      {/* 7. PIPELINE */}
      <section id="services-section" className={`${CONTAINER} pb-24 space-y-10 relative z-20`}>
        <SectionHeading eyebrow="Idea to production" lead="How work moves" accent="between teams." sub="Each stage has an owner and produces evidence before the next one can start." />
        <ul className={`border-t ${BORDER}`}>
          {STAGES.map((st, idx) => {
            const on = activeStage === idx;
            return (
              <li key={st.name} onClick={() => setActiveStage(idx)} className={`px-4 sm:px-6 py-5 sm:py-6 border-b ${BORDER} cursor-pointer transition-colors ${on ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between gap-6">
                  <span className={`text-2xl sm:text-5xl font-semibold tracking-tight transition-colors ${on ? 'text-[#2f5bff]' : 'text-white'}`}>{st.name}</span>
                  <span className="hidden sm:inline px-3 py-1 rounded-full border border-white/15 text-xs text-slate-300 shrink-0">{st.who}</span>
                </div>
                {on && <p className="mt-3 text-sm text-slate-400 max-w-2xl leading-relaxed mk-fade">{st.desc}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 8. ROLES */}
      <section id="preview-stage" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading eyebrow="Role-aware workspaces" lead="Everyone gets the station they" accent="actually need." />
        <div className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-[#0d0e14] border ${BORDER}`}>
          {ROLE_TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveRoleTab(tab.id)} className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${activeRoleTab === tab.id ? 'bg-[#075bff] text-white' : 'text-slate-400 hover:text-white'}`}>{tab.label}</button>
          ))}
        </div>
        <div key={activeRoleTab} className={`p-8 sm:p-10 rounded-2xl bg-[#0d0e14] border ${BORDER} space-y-5 mk-fade`}>
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b ${BORDER} pb-4`}>
            <div>
              <span className="text-sm text-[#7fa4ff] font-medium">{role.badge}</span>
              <h3 className="text-xl font-semibold text-white mt-1">{role.title}</h3>
            </div>
            <button onClick={onGetStarted} className="px-4 py-2 bg-[#075bff] hover:bg-[#075bff]/90 text-white rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors">Open as {ROLE_TABS.find((t) => t.id === activeRoleTab)!.label}</button>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">{role.desc}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {role.features.map((f) => (
              <div key={f} className={`p-3 rounded-xl bg-white/[0.02] border ${BORDER} flex items-center gap-2.5`}><Check className="w-3.5 h-3.5 text-[#075bff] shrink-0" /><span className="text-xs text-slate-300 font-medium">{f}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. LEDGER */}
      <section id="testimonial-section" className={`${CONTAINER} pb-24 space-y-6 relative z-20`}>
        <SectionHeading eyebrow="Proof, not promises" lead="Every action you took above is a" accent="block in the chain." sub="Verify it. Then tamper with a past entry and verify again." />
        <LedgerPanel entries={ledger.entries} verify={ledger.verify} tamper={ledger.tamper} reset={ledger.reset} broken={ledger.broken} verifying={ledger.verifying} />
      </section>

      {/* 10. FINAL CTA */}
      <section className={`${CONTAINER} pb-24 relative z-20`}>
        <div className="text-center space-y-6 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight text-white">Stop reconciling six tools. Start shipping with proof.</h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-md mx-auto leading-relaxed">Open the sandbox, take a role, approve something, and watch the rest of the team react.</p>
          <div className="flex items-center justify-center pt-2">
            <SpecularButton size="lg" radius={16} tint="#075bff" tintOpacity={0.3} lineColor="#ffffff" baseColor="#075bff" intensity={1.2} glow={1.2} onClick={getStartedBusy ? undefined : onGetStarted} className="font-semibold">
              <span>{getStartedBusy ? 'Preparing your workspace…' : 'Try the live workspace'}</span>
              <ArrowRight className="w-4 h-4 ml-2 inline-block" />
            </SpecularButton>
          </div>
        </div>
      </section>

      <footer className={`border-t ${BORDER} py-10 text-slate-500 text-xs relative z-20`}>
        <div className={`${CONTAINER} flex flex-col sm:flex-row items-center justify-between gap-4`}>
          <div className="space-y-1 text-center sm:text-left">
            <div className="text-slate-300 font-semibold text-sm">Software Karkhana</div>
            <div>An enterprise platform that connects teams from idea to product.</div>
          </div>
          <div className="text-[11px] text-slate-600">&copy; {new Date().getFullYear()} Software Karkhana. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default MarketingLandingPage;
