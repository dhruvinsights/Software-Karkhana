import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowRight,
  Terminal,
  Cpu,
  GitPullRequest,
  CheckCircle2,
  Shield,
  Activity,
  Workflow,
  Sparkles,
  Layers,
  Lock,
  Boxes,
  Zap,
  Globe,
  Database,
  Radio,
  Server,
  Code2,
  RefreshCw,
  Search,
  Filter,
  Check,
  ChevronRight,
  ShieldCheck,
  FileCode,
  Sliders,
} from 'lucide-react';
import { MarketingNavbar } from './MarketingNavbar';
import { LaserFlow } from '../reactbits/LaserFlow';
import { SpecularButton } from '../reactbits/SpecularButton';
import { GlassSurface } from '../reactbits/GlassSurface';
import { AnimatedList } from '../reactbits/AnimatedList';
import { ShaderCard } from '../reactbits/ShaderCard';
import { ShinyText } from '../reactbits/ShinyText';
import { LuminousType } from '../reactbits/LuminousType';
import { FrameBorder } from '../reactbits/FrameBorder';

interface MarketingLandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onExploreDemo: () => void;
}

export const MarketingLandingPage: React.FC<MarketingLandingPageProps> = ({
  onGetStarted,
  onSignIn,
  onExploreDemo,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [activeRoleTab, setActiveRoleTab] = useState<'exec' | 'arch' | 'dev' | 'qa' | 'sec'>('dev');
  const [activeStageIndex, setActiveStageIndex] = useState(2);
  const [activeIssue, setActiveIssue] = useState('APP-142');

  // Live Simulated Ledger Events
  const [ledgerEntries, setLedgerEntries] = useState([
    { seq: '0842', stage: 'CODE_GEN', actor: 'ADK Coder Worker #4', hash: '8f92a1...bc40', status: 'VERIFIED' },
    { seq: '0843', stage: 'CHAOS_TEST', actor: 'QA Gemini 3.8', hash: '3e110c...7d91', status: 'VERIFIED' },
    { seq: '0844', stage: 'APPSEC_GATE', actor: 'Cosign Verifier', hash: 'a45e99...112e', status: 'ATTESTED' },
    { seq: '0845', stage: 'CANARY_DEPLOY', actor: 'Cloud Run Engine', hash: '56d702...f488', status: 'ACTIVE' },
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStageIndex((prev) => (prev + 1) % 5);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const ROLES = {
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
    { name: '1. Discovery & PRD', desc: 'JTBD viability scoring & grounded citation synthesis' },
    { name: '2. Architecture ADR', desc: 'API contracts & AST boundary invariant verification' },
    { name: '3. Autonomous Coder', desc: 'Worker sandbox patch generation & isolated pytest run' },
    { name: '4. AppSec & QA Gate', desc: 'Cosign image signing, SBOM audit & chaos matrix' },
    { name: '5. Canary Release', desc: 'Zero-downtime blue/green rollout with sub-second rollback' },
  ];

  return (
    <div className="min-h-screen bg-[#050609] text-[#f7f8fc] font-sans antialiased selection:bg-[#075bff] selection:text-white">
      {/* Fixed Sticky Minimalist Navbar */}
      <MarketingNavbar
        onGetStarted={onGetStarted}
        onSignIn={onSignIn}
        onExploreDemo={onExploreDemo}
      />

      {/* =================================================================== */}
      {/* 1. HERO SECTION WITH OFFICIAL WEBG2 LASER FLOW & FLOATING TRACKER   */}
      {/* =================================================================== */}
      <section className="relative pt-28 pb-16 overflow-hidden">
        {/* Top Centered Header Content */}
        <div className="max-w-[1280px] mx-auto px-6 lg:px-12 text-center space-y-6 relative z-20 pt-8">
          {/* Top Status Pill */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs font-mono text-blue-400">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>Software Karkhana v2.4 &bull; Production Ready</span>
          </div>

          {/* Main Headline */}
          <div className="max-w-4xl mx-auto">
            <LuminousType
              text="The Autonomous Software Factory for High-Velocity Engineering"
              highlightWords={['Autonomous', 'Software', 'Factory', 'High-Velocity']}
              className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.08] text-white"
            />
          </div>

          {/* Subtitle */}
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto font-light leading-relaxed">
            Unify business intent, system architectures, worker swarms, deterministic QA, and multi-sig canary rollouts in an immutable cryptographic delivery engine.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <SpecularButton
              size="lg"
              radius={18}
              tint="#075bff"
              tintOpacity={0.25}
              lineColor="#ffffff"
              baseColor="#075bff"
              intensity={1.2}
              glow={1.2}
              followMouse
              proximity={250}
              onClick={onGetStarted}
              className="w-full sm:w-auto shadow-[0_0_30px_rgba(7,91,255,0.45)]"
            >
              <span>Launch Software Factory</span>
              <ArrowRight className="w-4 h-4 ml-1 inline-block" />
            </SpecularButton>

            <SpecularButton
              size="lg"
              radius={18}
              tint="#ffffff"
              tintOpacity={0.06}
              lineColor="#60a5fa"
              baseColor="#1e293b"
              intensity={0.9}
              glow={0.8}
              followMouse
              proximity={250}
              onClick={onExploreDemo}
              className="w-full sm:w-auto"
            >
              <Terminal className="w-4 h-4 mr-1 text-blue-400 inline-block" />
              <span>Explore Live Workspace</span>
            </SpecularButton>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* LASER FLOW STAGE: Laser light falling into the Dashboard UI Card  */}
        {/* ----------------------------------------------------------------- */}
        <div className="relative max-w-[1200px] h-[640px] sm:h-[700px] mx-auto mt-6 px-4 sm:px-8 z-10">
          {/* LaserFlow WebGL2 Beam Canvas */}
          <LaserFlow
            surfaceRef={cardRef}
            beamPosition={0.5}
            surfaceLevel={0.42}
            color="#3847ff"
            intensity={1.8}
            flare={1.5}
            spread={1.5}
            spill={1}
            fog={0.2}
            dust={1.6}
            beamWidth={1.5}
            streaks={1.5}
            dots={1}
            pulse={1.5}
            speed={1.5}
            seed={3}
            mouseInteraction
            intro
          />

          {/* The Target Surface Card: Real Interactive Software Karkhana Dashboard */}
          <div
            ref={cardRef}
            className="absolute left-4 right-4 sm:left-12 sm:right-12 top-[42%] bottom-0 rounded-2xl bg-[#090b14]/95 border border-white/20 shadow-[0_20px_80px_rgba(0,0,0,0.9),0_0_50px_rgba(56,71,255,0.2)] overflow-hidden backdrop-blur-2xl flex flex-col z-20"
          >
            {/* macOS Window Titlebar */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0d101a]/95 border-b border-white/10 select-none">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-semibold text-white">Software Karkhana Control Plane</span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400">Swarm Active (12 Nodes)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  SHA-256 Validated
                </span>
              </div>
            </div>

            {/* Main Interactive Dashboard Viewport */}
            <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
              {/* Left Sidebar */}
              <div className="hidden md:flex md:col-span-3 p-4 border-r border-white/10 bg-[#07090e]/90 flex-col justify-between text-xs font-medium text-slate-400">
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono uppercase text-slate-500 px-3 py-1 tracking-wider">
                    Core Modules
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                    <Layers className="w-4 h-4 text-slate-400" />
                    <span>Inbox & Telemetry</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-blue-500/15 border border-blue-500/30 text-white font-semibold cursor-pointer">
                    <CheckCircle2 className="w-4 h-4 text-blue-400" />
                    <span>My Issues & Tasks</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-mono">5</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                    <Boxes className="w-4 h-4 text-slate-400" />
                    <span>Projects & Repos</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                    <Shield className="w-4 h-4 text-slate-400" />
                    <span>Security & SBOM</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1 font-mono text-[11px]">
                  <div className="text-slate-400">Current Node:</div>
                  <div className="text-blue-400 font-bold">worker-iad-04.karkhana</div>
                  <div className="text-slate-500 text-[10px]">Memory: 84MB / CPU: 4%</div>
                </div>
              </div>

              {/* Center & Right Task Viewport */}
              <div className="col-span-12 md:col-span-9 p-5 bg-[#090b12]/80 flex flex-col justify-between overflow-y-auto space-y-4">
                {/* Search & Action Bar */}
                <div className="flex items-center justify-between text-xs pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Active Swarm Pipeline</span>
                    <span className="text-slate-500 font-mono">(Autonomous Execution)</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 text-xs">
                    <span className="flex items-center gap-1 cursor-pointer hover:text-white">
                      <Search className="w-3.5 h-3.5" /> Filter
                    </span>
                    <span className="flex items-center gap-1 cursor-pointer hover:text-white">
                      <Sliders className="w-3.5 h-3.5" /> Density
                    </span>
                  </div>
                </div>

                {/* Animated List of Active Swarm Issues */}
                <AnimatedList
                  stagger={60}
                  className="space-y-2"
                  itemClassName="p-3 rounded-xl bg-[#0e1220]/80 hover:bg-[#12172a] border border-white/10 flex items-center justify-between text-xs transition-all cursor-pointer"
                >
                  <div
                    onClick={() => setActiveIssue('APP-142')}
                    className={`flex items-center justify-between w-full ${activeIssue === 'APP-142' ? 'text-white' : 'text-slate-300'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
                      <span className="font-medium">Polish autonomous onboarding flow & Slack-style wizard</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                      <span className="text-blue-400">IN PROGRESS</span>
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">APP-142</span>
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-[10px] flex items-center justify-center text-white font-bold">MK</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveIssue('APP-139')}
                    className={`flex items-center justify-between w-full ${activeIssue === 'APP-139' ? 'text-white' : 'text-slate-300'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                      <span className="font-medium">Sync cryptographic ledger drafts across advisory-locked nodes</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                      <span className="text-purple-400">REVIEW</span>
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">APP-139</span>
                      <span className="w-5 h-5 rounded-full bg-purple-600 text-[10px] flex items-center justify-center text-white font-bold">JL</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveIssue('APP-131')}
                    className={`flex items-center justify-between w-full ${activeIssue === 'APP-131' ? 'text-white' : 'text-slate-300'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <span className="font-medium">Audit design tokens & CSS contracts for Google DeepMind UI</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                      <span className="text-amber-400">TESTING</span>
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">APP-131</span>
                      <span className="w-5 h-5 rounded-full bg-amber-600 text-[10px] flex items-center justify-center text-white font-bold">AR</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveIssue('APP-127')}
                    className={`flex items-center justify-between w-full ${activeIssue === 'APP-127' ? 'text-white' : 'text-slate-300'}`}
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-medium">Ship keyboard shortcuts & Command Palette (Ctrl+K)</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                      <span className="text-emerald-400">MERGED</span>
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">APP-127</span>
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-[10px] flex items-center justify-center text-white font-bold">DS</span>
                    </div>
                  </div>
                </AnimatedList>

                {/* Bottom Live Simulated Worker Output Stream */}
                <div className="p-3 bg-black/60 rounded-xl border border-white/5 font-mono text-[11px] text-slate-400 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-slate-300">
                      ADK Worker #4: <span className="text-emerald-400">12/12 pytest assertions passing</span> · Diff hash:{' '}
                      <span className="text-blue-400">0x8a2f91bc</span>
                    </span>
                  </div>
                  <span className="text-slate-500 text-[10px]">Latency: 1.2s</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 2. THE 5-STAGE AUTONOMOUS PIPELINE WITH LIVE INVARIANT VERIFICATION */}
      {/* =================================================================== */}
      <section id="services-section" className="max-w-[1280px] mx-auto px-6 lg:px-12 py-24 space-y-12">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-400 font-semibold">
            Deterministic Delivery
          </span>
          <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
            How Software Karkhana Ships Zero-Defect Code
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed font-light">
            Each stage produces non-bypassable evidence, signed by AI workers and authorized leads, recorded into the hash-chained ledger.
          </p>
        </div>

        {/* Stepper Pipeline Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {STAGES.map((st, idx) => {
            const isActive = activeStageIndex === idx;
            return (
              <div
                key={idx}
                onClick={() => setActiveStageIndex(idx)}
                className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer space-y-3 ${
                  isActive
                    ? 'bg-blue-600/15 border-blue-500/60 shadow-[0_0_30px_rgba(7,91,255,0.25)] translate-y-[-4px]'
                    : 'bg-[#0a0d17]/60 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono font-bold ${isActive ? 'text-blue-400' : 'text-slate-500'}`}>
                    PHASE 0{idx + 1}
                  </span>
                  {isActive && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
                </div>
                <h3 className="text-sm font-semibold text-white">{st.name}</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-light">{st.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 3. 4 PILLARS OF MATHEMATICAL INVARIANTS (SHADER CARDS)             */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16 space-y-8">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-400 font-semibold">
            Core Invariants
          </span>
          <h3 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Engineered for Absolute Enterprise Reliability
          </h3>
          <p className="text-sm text-slate-400 font-light">
            Every step of production is bounded by mathematical invariant checks and AST analyzers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ShaderCard flameColor="rgba(7, 91, 255, 0.45)" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-blue-400 font-bold">INVARIANT 01</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                100% Attested Builds
              </span>
            </div>
            <h4 className="text-xl font-bold text-white">Autonomous Swarm Sandboxes</h4>
            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Isolated, disposable AI worker agents execute deep implementation tasks inside deterministic sandboxes with AST invariant checks.
            </p>
          </ShaderCard>

          <ShaderCard flameColor="rgba(168, 85, 247, 0.45)" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-purple-400 font-bold">INVARIANT 02</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                Zero Escaped Faults
              </span>
            </div>
            <h4 className="text-xl font-bold text-white">Zero-Defect Quality Gates</h4>
            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Gemini 3.8 Flash synthesizes boundary and chaos fault-injection test matrices before any commit is promoted to staging.
            </p>
          </ShaderCard>

          <ShaderCard flameColor="rgba(56, 189, 248, 0.45)" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-cyan-400 font-bold">INVARIANT 03</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                SOC 2 / ISO 27001 Ready
              </span>
            </div>
            <h4 className="text-xl font-bold text-white">Cryptographic Audit Ledger</h4>
            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Every architecture decision, diff patch, reviewer signature, and deployment hash is immutably recorded in a SHA-256 hash chain.
            </p>
          </ShaderCard>

          <ShaderCard flameColor="rgba(16, 185, 129, 0.45)" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-emerald-400 font-bold">INVARIANT 04</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                &lt;1s Rollback SLA
              </span>
            </div>
            <h4 className="text-xl font-bold text-white">Canary SRE Auto-Rollback</h4>
            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Real-time telemetry assertions automatically detect regressions and execute sub-second traffic rollback to guarantee 99.999% uptime.
            </p>
          </ShaderCard>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 4. ROLE-BASED ENTERPRISE WORKSPACE PREVIEW                         */}
      {/* =================================================================== */}
      <section id="preview-stage" className="max-w-[1280px] mx-auto px-6 lg:px-12 py-20 space-y-10">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-400 font-semibold">
            Role-Aware Surfaces
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Tailored Workspaces for Every Engineering Discipline
          </h2>
        </div>

        {/* Role Switcher Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl bg-[#0c0f1d] border border-white/10 max-w-2xl mx-auto">
          {[
            { id: 'exec', label: 'Executive' },
            { id: 'arch', label: 'Architect' },
            { id: 'dev', label: 'Staff Developer' },
            { id: 'qa', label: 'QA Lead' },
            { id: 'sec', label: 'AppSec / SRE' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveRoleTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeRoleTab === tab.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Role Content Preview Card */}
        <GlassSurface
          rounded="2xl"
          blur={20}
          opacity={0.06}
          borderOpacity={0.15}
          className="p-8 sm:p-10 max-w-4xl mx-auto bg-[#0a0d18]/80 border border-white/10 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
            <div>
              <span className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">
                {ROLES[activeRoleTab].badge}
              </span>
              <h3 className="text-2xl font-bold text-white mt-1">{ROLES[activeRoleTab].title}</h3>
            </div>
            <SpecularButton
              size="sm"
              radius={14}
              tint="#075bff"
              tintOpacity={0.2}
              onClick={onGetStarted}
            >
              Open Workspace
            </SpecularButton>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed font-light">{ROLES[activeRoleTab].desc}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {ROLES[activeRoleTab].features.map((feat, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-200 font-medium">{feat}</span>
              </div>
            ))}
          </div>
        </GlassSurface>
      </section>

      {/* =================================================================== */}
      {/* 5. LIVE CRYPTOGRAPHIC EVIDENCE LEDGER LOG STREAM                    */}
      {/* =================================================================== */}
      <section id="testimonial-section" className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-widest text-blue-400 font-semibold">
              Tamper-Evident Ledger
            </span>
            <h3 className="text-3xl font-bold text-white tracking-tight mt-1">
              Cryptographically Chained Evidence
            </h3>
          </div>
          <div className="text-xs font-mono text-slate-400">
            Advisory Lock: <span className="text-emerald-400">ACQUIRED</span> &bull; SHA-256 Digest Active
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[#070912] border border-white/10 font-mono text-xs space-y-3 overflow-x-auto shadow-2xl">
          <div className="grid grid-cols-12 text-slate-500 text-[11px] uppercase tracking-wider pb-2 border-b border-white/10">
            <span className="col-span-2">Seq #</span>
            <span className="col-span-3">Phase / Stage</span>
            <span className="col-span-3">Attested Actor</span>
            <span className="col-span-2">SHA-256 Block</span>
            <span className="col-span-2 text-right">Verification</span>
          </div>

          {ledgerEntries.map((e, idx) => (
            <div key={idx} className="grid grid-cols-12 items-center text-slate-300 py-1.5 hover:bg-white/[0.02] rounded px-1 transition-colors">
              <span className="col-span-2 text-blue-400 font-bold">#{e.seq}</span>
              <span className="col-span-3 text-white font-medium">{e.stage}</span>
              <span className="col-span-3 text-slate-400">{e.actor}</span>
              <span className="col-span-2 text-purple-400">{e.hash}</span>
              <span className="col-span-2 text-right">
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">
                  {e.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 6. FINAL CINEMATIC CTA                                              */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-24">
        <GlassSurface
          rounded="3xl"
          blur={28}
          opacity={0.08}
          borderOpacity={0.2}
          glow
          glowColor="rgba(7, 91, 255, 0.4)"
          className="p-12 sm:p-20 text-center space-y-8 bg-gradient-to-b from-[#0e1630] to-[#060810] border border-blue-500/30"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-xs font-mono text-blue-300">
            <Sparkles className="w-3.5 h-3.5 text-blue-300" />
            <span>Ready for Enterprise Autonomous Engineering</span>
          </div>

          <h2 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight max-w-3xl mx-auto leading-tight">
            Bring Ideas to Verifiable Production Software Today
          </h2>

          <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto font-light leading-relaxed">
            Eliminate communication silos, stop unverified AI hallucinations, and govern every line of code with mathematical evidence.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <SpecularButton
              size="xl"
              radius={20}
              tint="#075bff"
              tintOpacity={0.3}
              lineColor="#ffffff"
              baseColor="#075bff"
              intensity={1.3}
              glow={1.3}
              onClick={onGetStarted}
              className="w-full sm:w-auto shadow-[0_0_40px_rgba(7,91,255,0.6)]"
            >
              <span>Create Your Factory Workspace</span>
              <ArrowRight className="w-4 h-4 ml-2 inline-block" />
            </SpecularButton>
          </div>
        </GlassSurface>
      </section>

      {/* =================================================================== */}
      {/* 7. CLEAN EDITORIAL FOOTER                                           */}
      {/* =================================================================== */}
      <footer className="border-t border-white/10 bg-[#030408] py-12 text-slate-500 text-xs font-mono">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center sm:text-left">
            <div className="text-slate-300 font-bold font-sans text-sm">Software Karkhana</div>
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
