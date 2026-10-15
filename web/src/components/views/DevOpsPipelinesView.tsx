import React, { useState } from 'react';
import {
  Server,
  Play,
  RotateCcw,
  CheckCircle2,
  Cpu,
  Layers,
  ArrowRight,
  Code2,
  Terminal,
  Activity,
  AlertTriangle,
  Plus,
  GitBranch,
  CloudUpload,
  Workflow,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface DevOpsPipelinesViewProps {
  state: FactoryState;
}

export const DevOpsPipelinesView: React.FC<DevOpsPipelinesViewProps> = ({ state }) => {
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const activePipeline = state.pipelines.find((p) => p.projectId === selectedProject?.id) || state.pipelines[0];

  const handleRunPipeline = () => {
    if (!activePipeline) return;
    setRunningPipeline(true);
    setTimeout(() => {
      setRunningPipeline(false);
      factoryStore.logAudit('Executed CI/CD Pipeline', `Pipeline "${activePipeline.name}" ran all stages to green status.`);
    }, 1800);
  };

  const handleCreatePipeline = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPipelineName.trim()) return;

    factoryStore.createPipeline({
      name: newPipelineName.trim(),
      projectId: selectedProject?.id,
    });
    setNewPipelineName('');
  };

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
          CI/CD Pipelines
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          No Project Selected
        </h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to construct visual multi-stage CI/CD pipelines.
        </p>
        <button
          onClick={() => factoryStore.setScreen(state.products.length > 0 ? 'projects' : 'workspace_home')}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Go to Projects</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            <span>{selectedProject.code}</span>
            <span>·</span>
            <span>{selectedProject.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            CI/CD & DevOps Orchestrator
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Visual pipeline DAGs, automated ephemeral test containers, and cryptographic deployment sign-off.
          </p>
        </div>

        {activePipeline && (
          <button
            onClick={handleRunPipeline}
            disabled={runningPipeline}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shrink-0 shadow-lg shadow-blue-600/30"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{runningPipeline ? 'Running DAG...' : 'Run Pipeline'}</span>
          </button>
        )}
      </div>

      {/* Quick Create Pipeline Form */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Configure CI/CD Pipeline</h3>
          <span className="text-xs font-mono text-slate-400">Declarative DAG Workflow</span>
        </div>
        <form onSubmit={handleCreatePipeline} className="flex gap-2">
          <input
            type="text"
            placeholder="Pipeline name (e.g. Production Release DAG)..."
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            className="flex-1 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!newPipelineName.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0 transition-all shadow-md shadow-blue-600/20"
          >
            + Create Pipeline
          </button>
        </form>
      </GlassCard>

      {/* Pipeline DAG Visualization */}
      {activePipeline ? (
        <SpotlightCard className="p-8 space-y-6 bg-[#0c0f18]/90 border border-white/10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2">
                <Workflow className="w-4 h-4 text-blue-400" />
                <h3 className="text-base font-bold text-white">{activePipeline.name}</h3>
              </div>
              <span className="text-xs font-mono text-slate-400">Trigger: On Pull Request Merge to main</span>
            </div>
            <span className={`text-xs px-3 py-1 rounded-full font-mono font-medium ${
              runningPipeline ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            }`}>
              {runningPipeline ? 'EXECUTING' : 'GREEN / READY'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-[#10131d] rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-blue-400 uppercase">STAGE 1</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="font-semibold text-xs text-white">Lint & AST Parse</div>
              <div className="text-[11px] text-slate-400">Ruff, ESLint, TypeCheck</div>
            </div>

            <div className="p-4 bg-[#10131d] rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-blue-400 uppercase">STAGE 2</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="font-semibold text-xs text-white">Invariant Verification</div>
              <div className="text-[11px] text-slate-400">Property & Mutation Tests</div>
            </div>

            <div className="p-4 bg-[#10131d] rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-blue-400 uppercase">STAGE 3</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="font-semibold text-xs text-white">Docker Build & Sign</div>
              <div className="text-[11px] text-slate-400">Cosign Cryptographic Attestation</div>
            </div>

            <div className="p-4 bg-[#10131d] rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-blue-400 uppercase">STAGE 4</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="font-semibold text-xs text-white">Canary Deployment</div>
              <div className="text-[11px] text-slate-400">10% Traffic Rollout</div>
            </div>
          </div>
        </SpotlightCard>
      ) : (
        <GlassCard className="p-12 text-center space-y-3">
          <Server className="w-8 h-8 text-blue-400 mx-auto" />
          <h3 className="text-lg font-bold text-white">No Pipelines Configured</h3>
          <p className="text-xs text-slate-400">Configure a visual DAG pipeline above to orchestrate builds.</p>
        </GlassCard>
      )}
    </div>
  );
};
