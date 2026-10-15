import React, { useState, useEffect } from 'react';
import {
  FileText,
  Lightbulb,
  Boxes,
  Users,
  Server,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Cpu,
  ShieldCheck,
  GitBranch,
  Terminal,
} from 'lucide-react';

export const MagicTransform: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [activeStep, setActiveStep] = useState(0);

  const RAW_INPUTS = [
    { title: 'Customer PRDs & Jira Epics', icon: <FileText className="w-4 h-4 text-amber-400" />, desc: 'Vague requirements & user feedback' },
    { title: 'Cross-Functional Teams', icon: <Users className="w-4 h-4 text-purple-400" />, desc: 'Product, Design, SRE, Security' },
    { title: 'Multi-Cloud Environments', icon: <Server className="w-4 h-4 text-blue-400" />, desc: 'AWS, GCP, Kubernetes, On-Prem' },
    { title: 'Raw Feature Ideas', icon: <Lightbulb className="w-4 h-4 text-emerald-400" />, desc: 'Hypotheses & experimental concepts' },
  ];

  const FACTORY_SOLUTIONS = [
    { title: 'Durable ADR & C4 Blueprint', icon: <Boxes className="w-4 h-4 text-blue-400" />, desc: 'Protobuf gRPC interface contracts' },
    { title: 'AST Verified Code Patches', icon: <Terminal className="w-4 h-4 text-cyan-400" />, desc: 'Zero unhandled exceptions or race conditions' },
    { title: 'Chaos QA Test Suite', icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, desc: 'Automated fault-injection & invariants' },
    { title: 'Signed Canary Release', icon: <GitBranch className="w-4 h-4 text-rose-400" />, desc: 'Sub-second auto-rollback & Cosign proof' },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % RAW_INPUTS.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [RAW_INPUTS.length]);

  return (
    <div className={`p-8 bg-[#080a10] rounded-3xl border border-white/10 space-y-6 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white">The Software Karkhana Autonomous Pipeline</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Raw unstructured business inputs transform into cryptographically attested, zero-defect production software.
          </p>
        </div>
        <span className="text-xs font-mono px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold shrink-0">
          Continuous Synthesis &bull; Active
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-center">
        {/* Left Inputs (4 cols) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold mb-2">
            1. Raw Enterprise Inputs
          </div>
          {RAW_INPUTS.map((inp, idx) => {
            const isActive = activeStep === idx;
            return (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border transition-all duration-300 flex items-center gap-3 ${
                  isActive
                    ? 'bg-[#101424] border-blue-500/50 shadow-[0_0_15px_rgba(7,91,255,0.2)]'
                    : 'bg-[#0a0c14] border-white/5 opacity-60'
                }`}
              >
                <div className="p-2 rounded-lg bg-white/5 border border-white/10 shrink-0">
                  {inp.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white">{inp.title}</div>
                  <div className="text-[11px] text-slate-400 truncate">{inp.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Engine (1 col) */}
        <div className="lg:col-span-1 flex flex-col items-center justify-center py-4 lg:py-0">
          <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center animate-pulse shadow-[0_0_20px_rgba(7,91,255,0.4)]">
            <Cpu className="w-5 h-5" />
          </div>
          <ArrowRight className="w-4 h-4 text-blue-400 mt-2 hidden lg:block" />
        </div>

        {/* Right Verified Solutions (5 cols) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold mb-2">
            2. Verified Production Solutions
          </div>
          {FACTORY_SOLUTIONS.map((sol, idx) => {
            const isActive = activeStep === idx;
            return (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border transition-all duration-300 flex items-center gap-3 ${
                  isActive
                    ? 'bg-[#101924] border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                    : 'bg-[#0a0c14] border-white/5 opacity-60'
                }`}
              >
                <div className="p-2 rounded-lg bg-white/5 border border-white/10 shrink-0">
                  {sol.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white">{sol.title}</div>
                  <div className="text-[11px] text-slate-400 truncate">{sol.desc}</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
