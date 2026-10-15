import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Terminal,
  Server,
  Cpu,
  GitPullRequest,
  CheckCircle2,
  Shield,
  Activity,
  Workflow,
  Sparkles,
  Quote,
  Check,
  Code2,
  Layers,
  Lock,
  Boxes,
  Zap,
  Globe,
  Database,
} from 'lucide-react';
import { MarketingNavbar } from './MarketingNavbar';
import { HorizonBloom } from '../reactbits/HorizonBloom';
import { LuminousType } from '../reactbits/LuminousType';
import { MagicTransform } from '../reactbits/MagicTransform';
import { ExpandingGrid } from '../reactbits/ExpandingGrid';
import { ContactSheet } from '../reactbits/ContactSheet';
import { ShaderCard } from '../reactbits/ShaderCard';
import { FrameBorder } from '../reactbits/FrameBorder';
import { ShinyText } from '../reactbits/ShinyText';
import { LaserFlow } from '../reactbits/LaserFlow';
import { SpecularButton } from '../reactbits/SpecularButton';
import { GlassSurface } from '../reactbits/GlassSurface';
import { AnimatedList } from '../reactbits/AnimatedList';

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
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  const PILLARS = [
    {
      id: '01',
      title: 'Autonomous Swarm Workers',
      desc: 'Isolated, disposable AI worker agents execute deep implementation tasks inside deterministic sandboxes with AST invariant checks.',
      metric: '100% Attested Builds',
      flame: 'rgba(7, 91, 255, 0.5)',
    },
    {
      id: '02',
      title: 'Zero-Defect Quality Gates',
      desc: 'Gemini 3.8 Flash synthesizes boundary and chaos fault-injection test matrices before any commit is promoted to staging.',
      metric: '0 Unmitigated CVEs',
      flame: 'rgba(168, 85, 247, 0.5)',
    },
    {
      id: '03',
      title: 'Cryptographic Audit Ledger',
      desc: 'Every architecture decision, diff patch, reviewer signature, and deployment hash is immutably recorded for SOC 2 Type II compliance.',
      metric: 'Immutable Audit Trail',
      flame: 'rgba(56, 189, 248, 0.5)',
    },
    {
      id: '04',
      title: 'Canary SRE Auto-Rollback',
      desc: 'Real-time telemetry assertions automatically detect regressions and execute sub-second traffic rollback to guarantee 99.999% uptime.',
      metric: '<1s Rollback SLA',
      flame: 'rgba(16, 185, 129, 0.5)',
    },
  ];

  return (
    <div className="min-h-screen bg-[#050609] text-[#f7f8fc] font-sans antialiased selection:bg-[#075bff] selection:text-white">
      <MarketingNavbar
        onGetStarted={onGetStarted}
        onSignIn={onSignIn}
        onExploreDemo={onExploreDemo}
      />

      {/* =================================================================== */}
      {/* 1. HERO SECTION WITH HORIZON BLOOM & LUMINOUS TYPE */}
      {/* =================================================================== */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <HorizonBloom className="min-h-[640px] flex items-center justify-center">
          <div className="max-w-[1280px] mx-auto px-6 lg:px-12 text-center space-y-8 relative z-10 pt-12">
            
            {/* Top Pill / Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs font-mono text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span>Software Karkhana v2.4 &bull; Production Ready</span>
            </div>

            {/* Luminous Drifting Spotlight Headline */}
            <div className="max-w-4xl mx-auto">
              <LuminousType
                text="The Autonomous Software Factory for High-Velocity Engineering"
                highlightWords={['Autonomous', 'Software', 'Factory', 'High-Velocity']}
                className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.08] text-white"
              />
            </div>

            {/* Subtitle */}
            <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto font-light leading-relaxed">
              Connect PRDs, architectures, worker swarms, chaos QA verification, and multi-sig canary rollouts in an immutable cryptographic delivery engine.
            </p>

            {/* CTA Buttons with Specular Light Effect */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <SpecularButton
                size="lg"
                radius={18}
                tint="#075bff"
                tintOpacity={0.2}
                lineColor="#ffffff"
                baseColor="#075bff"
                intensity={1.2}
                glow={1.2}
                followMouse
                proximity={250}
                onClick={onGetStarted}
                className="w-full sm:w-auto shadow-[0_0_30px_rgba(7,91,255,0.5)]"
              >
                <span>Launch Software Factory</span>
                <ArrowRight className="w-4 h-4 ml-1 inline-block" />
              </SpecularButton>

              <SpecularButton
                size="lg"
                radius={18}
                tint="#ffffff"
                tintOpacity={0.05}
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
        </HorizonBloom>

        {/* Laser Flow Descending into Floating Dashboard Tracker */}
        <div className="relative max-w-[1100px] mx-auto px-6 -mt-8 pt-6 z-20">
          {/* Laser Beam Canvas Shooting Down from Top Center */}
          <div className="absolute inset-x-0 -top-40 h-[360px] pointer-events-none z-0">
            <LaserFlow
              className="w-full h-full"
              beamColor="#a5c4ff"
              glowColor="#3b82f6"
              secondaryGlow="#8b5cf6"
              particleCount={160}
              intensity={1.2}
              flareSize={1.1}
            />
          </div>

          {/* Floating MacOS Dashboard Tracker Preview */}
          <GlassSurface
            rounded="2xl"
            blur={24}
            opacity={0.08}
            borderOpacity={0.16}
            glow
            glowColor="rgba(59, 130, 246, 0.35)"
            className="relative z-10 shadow-2xl bg-[#08090f]/90 border border-white/15 overflow-hidden"
          >
            {/* macOS Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0d1019]/90 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <span className="text-xs font-medium text-slate-400 font-mono">Software Karkhana · Autonomous Tracker</span>
              <div className="w-12" />
            </div>

            {/* Split Tracker Layout: Sidebar + Animated Issue List */}
            <div className="grid grid-cols-1 md:grid-cols-12 min-h-[300px]">
              {/* Left Sidebar */}
              <div className="md:col-span-3 p-4 border-r border-white/10 bg-[#06080d]/80 space-y-2 text-xs font-medium text-slate-400">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                  <Layers className="w-4 h-4 text-slate-400" />
                  <span>Inbox</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/15 border border-blue-500/30 text-white font-semibold cursor-pointer">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>My issues</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-mono">5</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                  <Boxes className="w-4 h-4 text-slate-400" />
                  <span>Projects</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:bg-white/5 cursor-pointer">
                  <Activity className="w-4 h-4 text-slate-400" />
                  <span>Ledger Views</span>
                </div>
              </div>

              {/* Right Content: Animated Issues List */}
              <div className="md:col-span-9 p-5 bg-[#090b12]/60 space-y-4">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Active Swarm Tasks</span>
                    <span className="text-slate-500 font-mono">(5 Assigned)</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 text-xs">
                    <span className="cursor-pointer hover:text-white">Search</span>
                    <span className="cursor-pointer hover:text-white">Filter</span>
                  </div>
                </div>

                <AnimatedList
                  stagger={70}
                  className="space-y-2"
                  itemClassName="p-3 rounded-xl bg-[#0d101a]/70 border border-white/5 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                    <span className="text-slate-200 font-medium">Polish the autonomous onboarding flow</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>APP-142</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">MK</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-slate-200 font-medium">Sync cryptographic ledger drafts across nodes</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>APP-139</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">JL</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-slate-200 font-medium">Audit design tokens & CSS contracts</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>APP-131</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">AR</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-slate-200 font-medium">Ship keyboard shortcuts & Command Palette</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>APP-127</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">DS</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span className="text-slate-200 font-medium">Cosign SBOM attestation & CVE scan gate</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
                    <span>APP-118</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300">SEC</span>
                  </div>
                </AnimatedList>
              </div>
            </div>
          </GlassSurface>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 2. THE MAGIC TRANSFORM PIPELINE (RAG & Autonomous Transformation) */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16">
        <FrameBorder>
          <MagicTransform />
        </FrameBorder>
      </section>

      {/* =================================================================== */}
      {/* 3. 4 CORE PILLARS WITH SHADER CARDS */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16 space-y-8">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-400 font-semibold">
            Engineered Invariants
          </span>
          <h3 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Built for Zero-Defect Enterprise Scale
          </h3>
          <p className="text-sm text-slate-400">
            Every step of code production is bounded by mathematical invariant checks and AST analyzers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PILLARS.map((p) => (
            <ShaderCard key={p.id} flameColor={p.flame} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-blue-400 font-bold">PILLAR {p.id}</span>
                <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                  {p.metric}
                </span>
              </div>
              <h4 className="text-xl font-bold text-white">{p.title}</h4>
              <p className="text-xs text-slate-300 leading-relaxed">{p.desc}</p>
            </ShaderCard>
          ))}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 4. EXPANDING GRID: CONNECTING ALL TEAMS, PROJECTS & PRODUCTS */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16">
        <FrameBorder>
          <div className="p-8">
            <ExpandingGrid />
          </div>
        </FrameBorder>
      </section>

      {/* =================================================================== */}
      {/* 5. LIVE CONTACT SHEET (Streamed Engineering Artifacts) */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-16">
        <ContactSheet />
      </section>

      {/* =================================================================== */}
      {/* 6. TRANSPARENT PRICING & DEPLOYMENT TIERS */}
      {/* =================================================================== */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-12 py-20 space-y-10">
        <div className="text-center space-y-3 max-w-xl mx-auto">
          <h3 className="text-3xl sm:text-4xl font-bold text-white">
            Deployment & Scaling Tiers
          </h3>
          <p className="text-sm text-slate-400">
            From single-repo startup agility to isolated air-gapped VPC enterprise swarms.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Startup Tier */}
          <div className="p-8 bg-[#0a0c14] border border-white/10 rounded-3xl space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-mono text-blue-400 uppercase font-semibold">Startups & Labs</span>
              <h4 className="text-2xl font-bold text-white">Fast Swarm</h4>
              <p className="text-xs text-slate-400">Autonomous workers for fast shipping teams.</p>
              <div className="text-3xl font-extrabold text-white font-mono">$199<span className="text-xs text-slate-400 font-sans font-normal"> / month</span></div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Up to 5 Autonomous Agents</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Gemini 3.8 AST Reviews</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Automated Canary Verification</li>
              </ul>
            </div>
            <button
              onClick={onGetStarted}
              className="w-full py-3 bg-[#101422] hover:bg-[#161c30] border border-white/10 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Start Free Trial
            </button>
          </div>

          {/* Scale Tier */}
          <div className="p-8 bg-[#0d1222] border-2 border-blue-500 rounded-3xl space-y-6 flex flex-col justify-between shadow-[0_0_40px_rgba(7,91,255,0.25)] relative">
            <span className="absolute -top-3 right-6 bg-blue-600 text-white text-[10px] font-mono px-3 py-1 rounded-full uppercase font-bold">
              Most Popular
            </span>
            <div className="space-y-4">
              <span className="text-xs font-mono text-cyan-400 uppercase font-semibold">Scale Companies</span>
              <h4 className="text-2xl font-bold text-white">Full Factory</h4>
              <p className="text-xs text-slate-300">Unlimited agent swarms with custom AST linting.</p>
              <div className="text-3xl font-extrabold text-white font-mono">$799<span className="text-xs text-slate-400 font-sans font-normal"> / month</span></div>
              <ul className="space-y-2 text-xs text-slate-200">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 25 Parallel Worker Runners</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Full C4 & ADR Sync</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Multi-Sig Quorum Sign-offs</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Cryptographic Ledger Attestation</li>
              </ul>
            </div>
            <button
              onClick={onGetStarted}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/30 cursor-pointer"
            >
              Deploy Factory
            </button>
          </div>

          {/* Enterprise Tier */}
          <div className="p-8 bg-[#0a0c14] border border-white/10 rounded-3xl space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-mono text-purple-400 uppercase font-semibold">Enterprise & Defense</span>
              <h4 className="text-2xl font-bold text-white">Air-Gapped VPC</h4>
              <p className="text-xs text-slate-400">Dedicated on-premises or private cloud deployment.</p>
              <div className="text-3xl font-extrabold text-white font-mono">Custom</div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Self-Hosted Ollama / DeepSeek</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Air-Gapped Zero-Egress VPC</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 99.999% SLA & Dedicated Support</li>
              </ul>
            </div>
            <button
              onClick={onGetStarted}
              className="w-full py-3 bg-[#101422] hover:bg-[#161c30] border border-white/10 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Contact Solutions Architect
            </button>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 7. FOOTER */}
      {/* =================================================================== */}
      <footer className="border-t border-white/10 py-12 text-center text-xs text-slate-500 font-mono space-y-2">
        <div className="text-slate-300 font-bold font-sans text-sm">Software Karkhana</div>
        <div>Autonomous Software Delivery Factory &bull; Invariant Verification &bull; Cryptographic Ledger</div>
        <div className="text-[11px] text-slate-600">&copy; {new Date().getFullYear()} Software Karkhana. All rights reserved.</div>
      </footer>
    </div>
  );
};
