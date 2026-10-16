import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowRight,
  Terminal,
  Plus,
  FolderGit2,
  GitPullRequest,
  CheckCircle2,
  Shield,
  Workflow,
  Sparkles,
  Layers,
  Boxes,
  Code2,
  Search,
  Check,
  ChevronRight,
} from 'lucide-react';
import { MarketingNavbar } from './MarketingNavbar';
import { LaserFlow } from '../reactbits/LaserFlow';
import { SpecularButton } from '../reactbits/SpecularButton';
import { LiquidEther } from '../reactbits/LiquidEther';

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

type DemoScreen = 'overview' | 'engineering' | 'architecture' | 'qa' | 'security';
type RoleTab = 'exec' | 'arch' | 'dev' | 'qa' | 'sec';
type DemoTab = 'products' | 'projects' | 'ledger';

/* ------------------------------------------------------------------ */
/* Static content                                                      */
/* ------------------------------------------------------------------ */

const DEMO_SCREENS: DemoScreen[] = ['overview', 'engineering', 'architecture', 'qa', 'security'];

const LEDGER_ENTRIES = [
  { seq: '0842', stage: 'CODE_GEN', actor: 'ADK Coder Worker #4', hash: '8f92a1...bc40', status: 'VERIFIED' },
  { seq: '0843', stage: 'CHAOS_TEST', actor: 'QA Gemini 3.8', hash: '3e110c...7d91', status: 'VERIFIED' },
  { seq: '0844', stage: 'APPSEC_GATE', actor: 'Cosign Verifier', hash: 'a45e99...112e', status: 'ATTESTED' },
  { seq: '0845', stage: 'CANARY_DEPLOY', actor: 'Cloud Run Engine', hash: '56d702...f488', status: 'ACTIVE' },
];

const ROLE_TABS: { id: RoleTab; label: string }[] = [
  { id: 'exec', label: 'Executive' },
  { id: 'arch', label: 'Architect' },
  { id: 'dev', label: 'Developer' },
  { id: 'qa', label: 'QA Lead' },
  { id: 'sec', label: 'AppSec' },
];

const ROLES: Record<RoleTab, { title: string; desc: string; features: string[]; badge: string }> = {
  exec: {
    title: 'Executive & Portfolio Governance',
    desc: 'Real-time capital allocation, ROI tracking, and non-bypassable multi-sig phase gates across all engineering initiatives.',
    features: ['Portfolio Burn Radar', 'Budget Gate Controls', 'SOC 2 Cryptographic Proofs'],
    badge: 'Director Authority',
  },
  arch: {
    title: 'System Architecture & ADR Studio',
    desc: 'Formulate typed API contracts, define cross-service boundary invariants, and publish immutable Architecture Decision Records.',
    features: ['OpenAPI / gRPC Registry', 'AST Invariant Boundary Rules', 'Threat Model Graphs'],
    badge: 'Architectural Lock',
  },
  dev: {
    title: 'Autonomous Swarm Developer Workspace',
    desc: 'Isolated, disposable AI workers write code inside confined sandboxes, executing real test suites before opening audited pull requests.',
    features: ['ADK Coder Sandboxes', 'Side-by-side AST Diff Inspector', 'Deterministic HMAC Attestation'],
    badge: 'Staff Engineer',
  },
  qa: {
    title: 'Deterministic QA & Chaos Verification',
    desc: 'Multi-agent test synthesis generates positive, negative, boundary, and fault-injection suites with zero human test script boilerplate.',
    features: ['Chaos Fault Matrices', 'Live Pytest / E2E Runner', 'Zero-Escape Defect Tracking'],
    badge: 'QA Lead',
  },
  sec: {
    title: 'AppSec & Cryptographic Ledger Security',
    desc: 'Continuous SBOM auditing, CVE automated patching, and hardware-secured Cosign container image signatures.',
    features: ['Real-time Dependency Audits', 'Cosign Signature Verification', 'Immutable Hash Chaining'],
    badge: 'AppSec Lead',
  },
};

const STAGES = [
  { name: 'Discovery & PRD', tag: 'JTBD Spec', desc: 'Viability scoring, requirements breakdown, and grounded citation synthesis.' },
  { name: 'Architecture ADR', tag: 'Contract Lock', desc: 'OpenAPI contracts, boundary invariants, and threat models.' },
  { name: 'Autonomous Coder', tag: 'ADK Swarm', desc: 'Worker sandbox patch generation with isolated test verification.' },
  { name: 'AppSec & QA Gate', tag: 'Cosign Signed', desc: 'Container signing, SBOM dependency scan, and chaos test matrices.' },
  { name: 'Canary Release', tag: '<1s Rollback', desc: 'Zero-downtime blue/green rollout with automated telemetry guards.' },
];

const PILLARS = [
  {
    badge: 'Attested Builds',
    title: 'Autonomous Swarm Sandboxes',
    desc: 'Isolated, disposable AI worker agents execute deep implementation tasks inside deterministic sandboxes with AST invariant checks.',
  },
  {
    badge: 'Zero Escape',
    title: 'Zero-Defect Quality Gates',
    desc: 'Gemini 3.8 Flash synthesizes positive, negative, boundary, and chaos fault-injection test matrices before any commit is promoted.',
  },
  {
    badge: 'SOC 2 Ready',
    title: 'Cryptographic Audit Ledger',
    desc: 'Every architecture decision, diff patch, reviewer signature, and deployment hash is immutably recorded in a SHA-256 hash chain.',
  },
  {
    badge: '<1s Rollback',
    title: 'Canary SRE Auto-Rollback',
    desc: 'Real-time telemetry assertions automatically detect regressions and execute sub-second traffic rollback to guarantee 99.999% uptime.',
  },
];

const METRICS = [
  { label: 'Products', value: '1', note: 'Active core products', icon: Layers },
  { label: 'Projects', value: '1', note: 'Engineering streams', icon: FolderGit2 },
  { label: 'Pull Requests', value: '0', note: 'Code review pipelines', icon: GitPullRequest },
  { label: 'Feature Ideas', value: '0', note: 'Discovery evaluations', icon: Sparkles },
];

const DEMO_TABS: { id: DemoTab; label: string }[] = [
  { id: 'products', label: 'Products (1)' },
  { id: 'projects', label: 'Projects (1)' },
  { id: 'ledger', label: 'Audit Ledger (7)' },
];

/* Sidebar groups. `screen` is the demo screen a click switches to;
   `tracked` items show an active state when that screen is showing. */
const SIDEBAR_GROUPS: {
  title: string;
  items: { label: string; icon: React.ElementType; screen: DemoScreen; tracked?: boolean; count?: string }[];
}[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Overview', icon: Layers, screen: 'overview', tracked: true },
      { label: 'Products', icon: Boxes, screen: 'overview', count: '1' },
      { label: 'Project Hub', icon: FolderGit2, screen: 'overview', count: '1' },
      { label: 'Idea Lab', icon: Sparkles, screen: 'overview', count: '0' },
    ],
  },
  {
    title: 'Build & Code',
    items: [
      { label: 'Engineering & Agents', icon: Terminal, screen: 'engineering', tracked: true },
      { label: 'System Architecture', icon: Workflow, screen: 'architecture', tracked: true },
    ],
  },
  {
    title: 'Quality & Ops',
    items: [
      { label: 'QA Verification', icon: CheckCircle2, screen: 'qa', tracked: true },
      { label: 'Security & AppSec', icon: Shield, screen: 'security', tracked: true },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Shared styles                                                       */
/* ------------------------------------------------------------------ */

const CONTAINER = 'max-w-[1280px] mx-auto px-6 lg:px-12';
const BORDER = 'border-white/[0.08]';

const SectionHeading: React.FC<{ lead: string; accent: string; sub?: string }> = ({ lead, accent, sub }) => (
  <div className="space-y-2">
    <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
      {lead} <span className="font-serif italic font-normal text-[#2f5bff]">{accent}</span>
    </h2>
    {sub && <p className="text-sm text-slate-400 max-w-xl leading-relaxed">{sub}</p>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export const MarketingLandingPage: React.FC<MarketingLandingPageProps> = ({
  onGetStarted,
  onSignIn,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [activeRoleTab, setActiveRoleTab] = useState<RoleTab>('dev');
  const [activeStageIndex, setActiveStageIndex] = useState(2);
  const [demoScreen, setDemoScreen] = useState<DemoScreen>('overview');
  const [demoTab, setDemoTab] = useState<DemoTab>('products');

  // Automated carousel cycling across live demo screens
  useEffect(() => {
    const timer = setInterval(() => {
      setDemoScreen((prev) => DEMO_SCREENS[(DEMO_SCREENS.indexOf(prev) + 1) % DEMO_SCREENS.length]);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Automated pipeline stage highlight
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const role = ROLES[activeRoleTab];

  return (
    <div className="min-h-screen text-[#f7f8fc] font-sans antialiased selection:bg-[#075bff] selection:text-white relative overflow-x-hidden" style={{ background: '#05010f' }}>
      {/* Fixed full-screen LiquidEther background */}
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
      <MarketingNavbar onGetStarted={onGetStarted} onSignIn={onSignIn} />

      {/* =================================================================== */}
      {/* 1. HERO: LaserFlow is the only background effect                     */}
      {/* =================================================================== */}
      <section className="relative pt-24 pb-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none z-0">
          <LaserFlow
            surfaceRef={cardRef}
            beamPosition={0.72}
            surfaceLevel={0.25}
            color="#3847ff"
            intensity={1.8}
            mouseInteraction
            intro
          />
        </div>

        <div className={`${CONTAINER} relative z-20 pt-8`}>
          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08] text-white">
              The Autonomous Software Factory for High-Velocity Engineering
            </h1>
            <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
              Unify business intent, system architectures, worker swarms, deterministic QA, and multi-sig canary rollouts in an immutable cryptographic delivery engine.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <SpecularButton
                size="md"
                radius={14}
                tint="#075bff"
                tintOpacity={0.3}
                lineColor="#ffffff"
                baseColor="#075bff"
                intensity={1.2}
                glow={1.2}
                followMouse
                proximity={250}
                onClick={onGetStarted}
                className="font-semibold"
              >
                <span>Launch Software Factory</span>
                <ArrowRight className="w-4 h-4 ml-1 inline-block" />
              </SpecularButton>

              <SpecularButton
                size="md"
                radius={14}
                tint="#ffffff"
                tintOpacity={0.08}
                lineColor="#60a5fa"
                baseColor="#111524"
                intensity={0.9}
                glow={0.8}
                followMouse
                proximity={250}
                onClick={onSignIn}
                className="font-medium"
              >
                <span>Sign In</span>
              </SpecularButton>
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Workspace dashboard demo (laser beam lands on this surface)        */}
        {/* ----------------------------------------------------------------- */}
        <div className={`relative max-w-[1400px] h-[720px] sm:h-[760px] lg:h-[800px] mx-auto mt-16 px-4 sm:px-8 z-20`}>
          <div
            ref={cardRef}
            className={`w-full h-full rounded-2xl bg-[#0a0b12] border border-white/15 overflow-hidden flex flex-col`}
          >
            {/* Top header bar (matches AppShell.tsx) */}
            <div className={`flex items-center justify-between px-4 py-2.5 bg-[#0a0d16] border-b ${BORDER} select-none text-xs`}>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-[#827D8E] pl-2 border-l border-white/10">
                  <span className="text-white font-semibold">Workspace Alpha</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[#075BFF] font-medium">Google Gemini</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-300">Software Factory</span>
                </div>
              </div>

              <div
                onClick={onGetStarted}
                className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-black/40 border border-white/[0.08] text-slate-400 text-xs font-mono cursor-pointer hover:border-white/20"
              >
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span>Search or run command...</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300">Ctrl + K</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onGetStarted}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Product</span>
                </button>
                <button
                  onClick={onGetStarted}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#101016] border border-white/[0.1] hover:bg-[#17151D] text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-[#075BFF]" />
                  <span>New Project</span>
                </button>
                <button
                  onClick={onGetStarted}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] text-slate-100 text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#075BFF]" />
                  <span>AI Companion</span>
                </button>
              </div>
            </div>

            {/* Workspace layout */}
            <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
              {/* Sidebar (matches AppShell.tsx) */}
              <div className={`hidden md:flex md:col-span-3 lg:col-span-2 p-3 border-r ${BORDER} bg-[#07070b] flex-col justify-between text-xs font-medium text-[#B5B1C0] select-none overflow-y-auto`}>
                <div className="space-y-4">
                  <div className={`space-y-2 pb-2 border-b ${BORDER}`}>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-bold tracking-tight text-white">Software Karkhana</span>
                      <span className="text-[10px] font-mono text-[#075BFF] px-1.5 py-0.5 rounded bg-[#075BFF]/10">v2.4</span>
                    </div>
                    <div className={`flex items-center justify-between p-2 rounded-lg bg-[#101016] border ${BORDER} text-[11px] text-white font-medium`}>
                      <div className="truncate">
                        <div className="font-semibold text-white">Workspace Alpha</div>
                        <div className="text-[10px] text-[#827D8E]">Autonomous Unit</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                  </div>

                  {SIDEBAR_GROUPS.map((group) => (
                    <div key={group.title} className="space-y-1">
                      <div className="text-[11px] text-[#827D8E] px-2 font-semibold">{group.title}</div>
                      {group.items.map(({ label, icon: Icon, screen, tracked, count }) => {
                        const isActive = tracked && demoScreen === screen;
                        return (
                          <button
                            key={label}
                            onClick={() => setDemoScreen(screen)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[#075BFF]/15 border border-[#075BFF]/30 text-white font-semibold'
                                : 'text-[#B5B1C0] hover:bg-white/5'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#075BFF]' : 'text-slate-400'}`} />
                              <span>{label}</span>
                            </div>
                            {count !== undefined && (
                              <span className="text-[10px] font-mono px-1.5 rounded bg-white/10 text-slate-300">{count}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1 font-mono text-[10px]">
                  <div className="text-slate-400">Node Status:</div>
                  <div className="text-blue-400 font-bold truncate">worker-iad-04.karkhana</div>
                  <div className="text-emerald-400">12 / 12 Nodes Healthy</div>
                </div>
              </div>

              {/* Dynamic workspace viewport */}
              <div className="col-span-12 md:col-span-9 lg:col-span-10 p-4 sm:p-6 bg-[#08090e] flex flex-col justify-between overflow-y-auto space-y-5">
                {/* SCREEN: OVERVIEW (matches WorkspaceHomeView.tsx) */}
                {demoScreen === 'overview' && (
                  <div className="space-y-5 animate-fade-in">
                    <div className={`pb-4 border-b ${BORDER} space-y-1`}>
                      <div className="flex items-center gap-2 text-xs text-[#827D8E]">
                        <span className="text-[#075BFF] font-semibold">Workspace Alpha</span>
                        <span>&bull; Autonomous Factory Unit</span>
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Factory Overview</h2>
                      <p className="text-xs text-[#B5B1C0] max-w-2xl font-light leading-relaxed">
                        Autonomous software delivery lifecycle — unified across product discovery, AI agent execution, multi-model reviews, and release verification.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {METRICS.map(({ label, value, note, icon: Icon }) => (
                        <div key={label} className={`p-3.5 rounded-xl bg-[#0c0e15] border ${BORDER} space-y-1`}>
                          <div className="text-[11px] text-[#827D8E] font-medium flex items-center justify-between">
                            <span>{label}</span>
                            <Icon className="w-3.5 h-3.5 text-[#075BFF]" />
                          </div>
                          <div className="text-3xl font-light text-white mt-1">{value}</div>
                          <div className="text-[11px] text-[#827D8E]">{note}</div>
                        </div>
                      ))}
                    </div>

                    <div className={`rounded-2xl bg-[#0c0e15] border ${BORDER} p-4 text-[#F6F5FA] space-y-2.5`}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-white">Quick Real-Time Creation</h3>
                        <span className="text-[11px] text-[#827D8E]">Instant Execution</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value="Google Gemini AI Engine"
                            className={`flex-1 px-3 py-1.5 rounded-xl border ${BORDER} text-xs text-white bg-[#07070B]`}
                          />
                          <button
                            onClick={onGetStarted}
                            className="px-3 py-1.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-medium shrink-0 cursor-pointer"
                          >
                            + Add Product
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value="Neural Orchestrator Service"
                            className={`flex-1 px-3 py-1.5 rounded-xl border ${BORDER} text-xs text-white bg-[#07070B]`}
                          />
                          <button
                            onClick={onGetStarted}
                            className="px-3 py-1.5 bg-[#17151D] hover:bg-[#211B2A] border border-white/[0.1] text-white rounded-xl text-xs font-medium shrink-0 cursor-pointer"
                          >
                            + Add Project
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className={`flex items-center gap-4 border-b ${BORDER} pb-2 text-xs`}>
                        {DEMO_TABS.map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setDemoTab(tab.id)}
                            className={`font-semibold pb-2 -mb-2.5 transition-colors cursor-pointer ${
                              demoTab === tab.id ? 'text-white border-b-2 border-[#075BFF]' : 'text-[#827D8E] hover:text-white'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className={`p-4 rounded-xl bg-[#0c0e15] border ${BORDER} hover:border-[#075BFF]/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs`}>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">Google Gemini</span>
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-medium">Active</span>
                            <span className="text-[#827D8E] text-[11px]">Domain: Cloud Services</span>
                          </div>
                          <p className="text-[#B5B1C0] text-xs">
                            Autonomous neural inference orchestrator with cryptographic gate verification & ADR contracts.
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right font-mono text-[10px]">
                            <div className="text-[#827D8E]">1 Project &bull; 0 PRs</div>
                            <div className="text-[#075BFF]">Ledger: 0x9f1a...442d</div>
                          </div>
                          <button
                            onClick={onGetStarted}
                            className="px-3 py-1.5 rounded-lg bg-[#075BFF]/10 hover:bg-[#075BFF]/20 border border-[#075BFF]/30 text-white font-medium flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Open Studio</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SCREEN: ENGINEERING & AGENTS */}
                {demoScreen === 'engineering' && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-[#075BFF]" />
                        <span className="font-bold text-white">Engineering & Worker Swarm</span>
                        <span className="text-slate-500 font-mono">(Live Sandboxed ADK Coder)</span>
                      </div>
                      <span className="text-xs font-mono text-slate-300">12 Sandboxes Active</span>
                    </div>

                    <div className="space-y-2">
                      {[
                        { dot: 'bg-blue-400', text: 'worker-04: Generate AST diff & AST invariant validation for token bucket rate limiter', status: 'PYTEST PASSING (14/14)', color: 'text-blue-400' },
                        { dot: 'bg-emerald-400', text: 'worker-02: Cryptographic HMAC signature attestation over container digest', status: 'COSIGN ATTESTED', color: 'text-emerald-400' },
                        { dot: 'bg-amber-400', text: 'worker-07: Chaos fault injection on Redis cluster partitioned failover', status: 'ZERO ESCAPE VERIFIED', color: 'text-amber-400' },
                      ].map((w) => (
                        <div key={w.text} className={`p-2.5 rounded-xl bg-[#0c0e15] border ${BORDER} flex items-center justify-between gap-3 text-xs`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${w.dot}`} />
                            <span className="font-medium text-slate-200 truncate">{w.text}</span>
                          </div>
                          <span className={`font-mono text-[10px] shrink-0 ${w.color}`}>{w.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SCREEN: SYSTEM ARCHITECTURE */}
                {demoScreen === 'architecture' && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                      <div className="flex items-center gap-2">
                        <Workflow className="w-4 h-4 text-[#075BFF]" />
                        <span className="font-bold text-white">System Architecture & ADR Studio</span>
                        <span className="text-slate-500 font-mono">(AST Boundary Verification)</span>
                      </div>
                      <span className="text-xs font-mono text-slate-300">ADR-042 Locked</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-[#0e1220] border border-white/10 space-y-1.5">
                        <div className="font-bold text-white">ADR-042: Event Invariant Schema</div>
                        <p className="text-slate-400 text-[11px]">
                          Enforcing immutable JSON-Schema contracts across all Swarm worker events.
                        </p>
                        <div className="text-[10px] font-mono text-emerald-400">STATUS: APPROVED & SIGNED</div>
                      </div>
                      <div className="p-3 rounded-xl bg-[#0e1220] border border-white/10 space-y-1.5">
                        <div className="font-bold text-white">OpenAPI Boundary Registry</div>
                        <p className="text-slate-400 text-[11px]">
                          REST & gRPC service interfaces verified for non-breaking forward compatibility.
                        </p>
                        <div className="text-[10px] font-mono text-blue-400">CONTRACT: 100% TYPED</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SCREEN: QA VERIFICATION */}
                {demoScreen === 'qa' && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="font-bold text-white">QA & Chaos Verification Suite</span>
                        <span className="text-slate-500 font-mono">(Multi-Agent Synthesis)</span>
                      </div>
                      <span className="text-xs font-mono text-emerald-400">100% Pass Rate</span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0e1220] border border-emerald-500/20 font-mono text-xs space-y-1.5">
                      {[
                        'pytest tests/unit/test_evaluator.py',
                        'pytest tests/integration/test_golden_path.py',
                        'pytest tests/integration/test_ledger_and_worker.py',
                      ].map((cmd) => (
                        <div key={cmd} className="flex items-center justify-between text-slate-300">
                          <span>{cmd}</span>
                          <span className="text-emerald-400">PASSED [100%]</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SCREEN: SECURITY & APPSEC */}
                {demoScreen === 'security' && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-white">AppSec & Cryptographic Ledger Security</span>
                        <span className="text-slate-500 font-mono">(Cosign Attested)</span>
                      </div>
                      <span className="text-xs font-mono text-cyan-400">Zero Critical CVEs</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-[#0e1220] border border-cyan-500/20 space-y-1">
                        <div className="font-bold text-white">Cosign Container Attestation</div>
                        <div className="font-mono text-[10px] text-cyan-300 truncate">sha256:4f81c9b2e7...61a29d</div>
                        <div className="text-[10px] text-emerald-400">Hardware key verified</div>
                      </div>
                      <div className="p-3 rounded-xl bg-[#0e1220] border border-cyan-500/20 space-y-1">
                        <div className="font-bold text-white">CycloneDX SBOM Audit</div>
                        <div className="font-mono text-[10px] text-slate-400">248 Components Scanned</div>
                        <div className="text-[10px] text-emerald-400">All licenses permissible (MIT/Apache-2.0)</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bottom worker output line */}
                <div className="p-2.5 bg-black/70 rounded-xl border border-white/5 font-mono text-[11px] text-slate-400 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-slate-300">
                      ADK Worker #4: <span className="text-emerald-400">12/12 assertions passing</span> &bull; Diff:{' '}
                      <span className="text-blue-400">0x8a2f91bc</span>
                    </span>
                  </div>
                  <span className="text-slate-500 text-[10px] hidden sm:inline">Latency: 1.2s</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 2. PIPELINE: large type rows, active stage still auto-cycles         */}
      {/* =================================================================== */}
      <section id="services-section" className={`${CONTAINER} py-24 space-y-10 relative z-20`}>
        <SectionHeading
          lead="How it"
          accent="ships"
          sub="Every phase produces non-bypassable cryptographic proof, verified before advancing."
        />
        <ul className={`border-t ${BORDER}`}>
          {STAGES.map((st, idx) => {
            const isActive = activeStageIndex === idx;
            return (
              <li
                key={st.name}
                onClick={() => setActiveStageIndex(idx)}
                className={`flex items-center justify-between gap-6 px-4 sm:px-6 py-5 sm:py-7 border-b ${BORDER} cursor-pointer transition-colors ${
                  isActive ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span
                  className={`text-3xl sm:text-6xl font-semibold tracking-tight transition-colors ${
                    isActive ? 'text-[#2f5bff]' : 'text-white'
                  }`}
                >
                  {st.name}
                </span>
                <div className="hidden md:flex items-center gap-6">
                  <p className="max-w-[260px] text-xs text-slate-400 leading-relaxed">{st.desc}</p>
                  <span className="px-3 py-1 rounded-full border border-white/15 text-xs text-slate-300 shrink-0">
                    {st.tag}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* =================================================================== */}
      {/* 3. CORE GUARANTEES                                                  */}
      {/* =================================================================== */}
      <section className={`${CONTAINER} pb-24 space-y-10 relative z-20`}>
        <SectionHeading
          lead="Engineered for"
          accent="reliability"
          sub="Every step of production is bounded by mathematical invariant checks and AST analyzers."
        />
        <div className={`grid grid-cols-1 md:grid-cols-2 border-t border-l ${BORDER}`}>
          {PILLARS.map((p) => (
            <div key={p.title} className={`p-8 border-r border-b ${BORDER} space-y-3`}>
              <span className="inline-block px-2.5 py-0.5 rounded-full border border-white/15 text-xs text-slate-300">
                {p.badge}
              </span>
              <h4 className="text-lg font-semibold text-white">{p.title}</h4>
              <p className="text-sm text-slate-400 leading-relaxed max-w-md">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 4. ROLE-BASED WORKSPACES                                            */}
      {/* =================================================================== */}
      <section id="preview-stage" className={`${CONTAINER} pb-24 space-y-8 relative z-20`}>
        <SectionHeading lead="Workspaces for every" accent="discipline" />

        <div className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-[#0d0e14] border ${BORDER}`}>
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveRoleTab(tab.id)}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                activeRoleTab === tab.id ? 'bg-[#075bff] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={`p-8 sm:p-10 rounded-2xl bg-[#0d0e14] border ${BORDER} space-y-5`}>
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b ${BORDER} pb-4`}>
            <div>
              <span className="text-sm text-[#7fa4ff] font-medium">{role.badge}</span>
              <h3 className="text-xl font-semibold text-white mt-1">{role.title}</h3>
            </div>
            <button
              onClick={onGetStarted}
              className="px-4 py-2 bg-[#075bff] hover:bg-[#075bff]/90 text-white rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors"
            >
              Open Studio
            </button>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">{role.desc}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {role.features.map((feat) => (
              <div key={feat} className={`p-3 rounded-xl bg-white/[0.02] border ${BORDER} flex items-center gap-2.5`}>
                <Check className="w-3.5 h-3.5 text-[#075bff] shrink-0" />
                <span className="text-xs text-slate-300 font-medium">{feat}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 5. AUDIT LEDGER                                                     */}
      {/* =================================================================== */}
      <section id="testimonial-section" className={`${CONTAINER} pb-24 space-y-6 relative z-20`}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <SectionHeading lead="Cryptographically chained" accent="evidence" />
          <div className="text-xs font-mono text-slate-400">
            Advisory Lock: <span className="text-emerald-400">ACQUIRED</span> &bull; SHA-256 Chain Active
          </div>
        </div>

        <div className={`p-5 sm:p-6 rounded-2xl bg-[#0d0e14] border ${BORDER} font-mono text-xs overflow-x-auto`}>
          <div className="min-w-[560px]">
            <div className={`grid grid-cols-12 text-slate-500 text-[11px] pb-2 border-b ${BORDER}`}>
              <span className="col-span-2">Seq #</span>
              <span className="col-span-3">Stage</span>
              <span className="col-span-3">Actor</span>
              <span className="col-span-2">Hash Block</span>
              <span className="col-span-2 text-right">Verification</span>
            </div>

            {LEDGER_ENTRIES.map((e) => (
              <div key={e.seq} className={`grid grid-cols-12 items-center text-slate-300 py-3 border-b ${BORDER} last:border-0`}>
                <span className="col-span-2 text-slate-500">#{e.seq}</span>
                <span className="col-span-3 text-white font-medium">{e.stage}</span>
                <span className="col-span-3 text-slate-400">{e.actor}</span>
                <span className="col-span-2 text-slate-400">{e.hash}</span>
                <span className="col-span-2 text-right">
                  <span className="px-2 py-0.5 rounded text-[10px] bg-[#075bff]/15 text-[#7fa4ff] font-bold">
                    {e.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 6. FINAL CTA                                                        */}
      {/* =================================================================== */}
      <section className={`${CONTAINER} pb-24 relative z-20`}>
        <div className="text-center space-y-6 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight text-white">
            Bring Ideas to Verifiable Production Software
          </h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-md mx-auto leading-relaxed">
            Eliminate communication silos, stop unverified AI hallucinations, and govern every line of code with mathematical proof.
          </p>
          <div className="flex items-center justify-center pt-2">
            <SpecularButton
              size="lg"
              radius={16}
              tint="#075bff"
              tintOpacity={0.3}
              lineColor="#ffffff"
              baseColor="#075bff"
              intensity={1.2}
              glow={1.2}
              onClick={onGetStarted}
              className="font-semibold"
            >
              <span>Launch Software Factory</span>
              <ArrowRight className="w-4 h-4 ml-2 inline-block" />
            </SpecularButton>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 7. FOOTER                                                           */}
      {/* =================================================================== */}
      <footer className={`border-t ${BORDER} py-10 text-slate-500 text-xs relative z-20`}>
        <div className={`${CONTAINER} flex flex-col sm:flex-row items-center justify-between gap-4`}>
          <div className="space-y-1 text-center sm:text-left">
            <div className="text-slate-300 font-semibold text-sm">Software Karkhana</div>
            <div>Autonomous Software Delivery Factory &bull; Invariant Verification &bull; Cryptographic Ledger</div>
          </div>
          <div className="text-[11px] text-slate-600">
            &copy; {new Date().getFullYear()} Software Karkhana. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MarketingLandingPage;