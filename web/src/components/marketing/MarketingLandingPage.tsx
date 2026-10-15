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

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <button
                onClick={onGetStarted}
                className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl text-sm transition-all shadow-[0_0_30px_rgba(7,91,255,0.4)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Launch Software Factory</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={onExploreDemo}
                className="w-full sm:w-auto px-8 py-3.5 bg-[#101422] hover:bg-[#141a2e] border border-white/10 hover:border-blue-500/30 text-slate-200 font-semibold rounded-2xl text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Terminal className="w-4 h-4 text-blue-400" />
                <span>Explore Live Workspace</span>
              </button>
            </div>
          </div>
        </HorizonBloom>
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
