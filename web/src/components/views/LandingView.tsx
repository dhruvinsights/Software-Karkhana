import React from 'react';
import {
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Cpu,
  GitPullRequest,
  CheckCircle2,
  Terminal,
  Activity,
  Server,
  Zap,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';

interface LandingViewProps {
  state: FactoryState;
}

export const LandingView: React.FC<LandingViewProps> = ({ state }) => {
  const lifecycleSteps = [
    { num: '01', title: 'Product Discovery', role: 'Product Manager', desc: 'Context-grounded ideation & multi-vector feasibility radar.' },
    { num: '02', title: 'Capital & Quorum Gate', role: 'Executive Committee', desc: 'Transparent multi-signature approvals with immutable rationale.' },
    { num: '03', title: 'Cross-Discipline Setup', role: 'Program Office', desc: 'Automated 11-discipline onboarding and repository linking.' },
    { num: '04', title: 'Architecture & Design', role: 'Architect & Designer', desc: 'Mermaid C4 diagrams, ADRs, and Google DeepMind design tokens.' },
    { num: '05', title: 'Autonomous Coding Agents', role: 'Lead Developer', desc: 'Task context packages executed via Google Antigravity-style workers.' },
    { num: '06', title: 'CodeRabbit PR Review', role: 'Engineering Lead', desc: 'Semantic AST diff analysis with 1-click memory & security patches.' },
    { num: '07', title: 'Continuous QA / QC', role: 'QA Lead', desc: 'Gemini-synthesized test plans and automated scenario execution.' },
    { num: '08', title: 'AppSec & Threat SLAs', role: 'Security Engineer', desc: 'Continuous SAST scans, boundary checks, and CVSS remediation.' },
    { num: '09', title: 'Cloud Run CI/CD', role: 'DevOps & SRE', desc: 'Visual pipeline DAGs, Google Cloud Run environments, and zero-downtime rollouts.' },
    { num: '10', title: '4-Eye Release Gate', role: 'Release Manager', desc: 'Cryptographic SBOM verification and automated canary traffic shifts.' },
    { num: '11', title: 'Production Feedback', role: 'Support & Ops', desc: 'P0 incident commander and institutional rule distillation.' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-16 py-8">
      {/* Hero Section */}
      <section className="text-center space-y-6 pt-6">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Software Karkhana · Google DeepMind Light Design System</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight max-w-4xl mx-auto leading-tight">
          A Unified Software Factory for the Autonomous Engineering Era
        </h1>

        <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
          From product discovery and architecture to autonomous coding agents, CodeRabbit PR reviews, QA verification, and Google Cloud Run deployments—all on one shared project truth.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <button
            onClick={() => factoryStore.setScreen('workspace_home')}
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-md hover:shadow-lg flex items-center space-x-2"
          >
            <span>Enter Factory Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => factoryStore.setScreen('ai_code_review')}
            className="px-6 py-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors shadow-xs flex items-center space-x-2"
          >
            <GitPullRequest className="w-4 h-4 text-blue-600" />
            <span>Explore CodeRabbit Review</span>
          </button>
        </div>
      </section>

      {/* Interactive Factory Lifecycle Blueprint */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">The 11-Discipline Factory Lifecycle</h2>
            <p className="text-xs text-slate-500 mt-0.5">Every phase feeds verifiable evidence into the next without context loss.</p>
          </div>
          <span className="text-xs text-neutral-700 font-mono bg-neutral-100 px-2.5 py-1 rounded-md border border-neutral-200">
            Real-time Execution
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lifecycleSteps.map((step) => (
            <div
              key={step.num}
              className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition-all hover:shadow-xs group"
            >
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-mono text-blue-600 font-bold">{step.num}</span>
                <span className="text-[11px] text-slate-400 font-medium">{step.role}</span>
              </div>
              <h3 className="font-semibold text-sm text-slate-900 group-hover:text-blue-700 transition-colors">
                {step.title}
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Production Infrastructure Architecture Callout */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">Google GenAI & Gemini 3.8</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Live server-side `@google/genai` calls power multidimensional feasibility scoring, CodeRabbit PR AST reviews, and automated QA test generation.
          </p>
        </div>

        <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Server className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">Cloud Run & Cloud SQL</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Engineered for containerized serverless deployment on Google Cloud Run with scale-to-zero capabilities and Cloud SQL PostgreSQL connection pooling.
          </p>
        </div>

        <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">Evidence-Backed Gates</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Zero blind merges. Releases enforce 4-eye signoffs across Product, QA, AppSec, and DevOps with tamper-evident audit logs.
          </p>
        </div>
      </section>
    </div>
  );
};
