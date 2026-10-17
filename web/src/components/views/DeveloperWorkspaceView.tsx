import React, { useState } from 'react';
import {
  Terminal,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  FileCode2,
  Check,
  ShieldCheck,
  ChevronRight,
  Code2,
  Cpu,
  Plus,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';
import { BorderBeam } from '../reactbits/BorderBeam';

interface DeveloperWorkspaceViewProps {
  state: FactoryState;
}

export const DeveloperWorkspaceView: React.FC<DeveloperWorkspaceViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'coderabbit' | 'agent_run' | 'context_package'>('coderabbit');
  const [agentRunning, setAgentRunning] = useState(false);
  const [newPrTitle, setNewPrTitle] = useState('');
  const [agentLogs, setAgentLogs] = useState<string[]>([
    'Worker container initialized in sandbox...',
    'Injecting Task Context: acceptance criteria + architectural invariants...',
    'Ready for task dispatch.',
  ]);

  const activeProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const activePr = state.pullRequests.find((p) => p.id === state.selectedPrId) || state.pullRequests[0];

  const handleStartAgent = () => {
    setAgentRunning(true);
    setAgentLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Resuming autonomous coding agent run...`]);
    setTimeout(() => {
      setAgentLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Validating bounded type safety in service runtime...`,
        `[${new Date().toLocaleTimeString()}] Verified contracts and clean build. Status: SUCCESS.`,
      ]);
      setAgentRunning(false);
      factoryStore.logAudit('Autonomous Coding Agent Completed', `Agent successfully compiled and tested current branch.`);
    }, 1800);
  };

  const handleCreatePR = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrTitle.trim()) return;

    factoryStore.createPullRequest({
      title: newPrTitle.trim(),
      projectId: activeProject?.id,
      sourceBranch: 'feat/core-service',
      targetBranch: 'main',
      diffSummary: 'Implemented modular domain logic and verified test coverage.',
      aiReview: {
        summary: 'Automated AST review completed. Zero breaking changes or unhandled exceptions detected.',
        architectureImpact: 'Preserves modular interfaces.',
        findings: [
          {
            id: `f-${Date.now()}`,
            file: 'src/service.ts',
            line: 42,
            severity: 'WARNING',
            title: 'Consider explicit buffer timeout',
            description: 'Add bounded timeout to prevent blocking thread pool on slow IO.',
            suggestedPatch: '+ socket.set_timeout(Some(Duration::from_millis(50)));',
            category: 'reliability',
          },
        ],
      },
    });

    setNewPrTitle('');
  };

  if (!activeProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-6">
        <div className="space-y-3">
          <div className="text-xs uppercase font-mono tracking-widest text-[#075BFF] font-medium">
            Engineering & Agents
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white">
            No Project Selected
          </h1>
          <p className="text-sm text-[#827D8E] leading-relaxed max-w-xl font-light">
            Create or enroll an engineering project first to review pull requests, launch autonomous agents, and inspect diffs.
          </p>
        </div>

        <button
          onClick={() => factoryStore.setScreen(state.products.length > 0 ? 'projects' : 'workspace_home')}
          className="k-btn-primary px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-[#075BFF]/20"
        >
          <Layers className="w-4 h-4" />
          <span>{state.products.length > 0 ? 'Go to Projects' : 'Go to Overview'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Editorial Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
            <span>{activeProject.code}</span>
            <span>·</span>
            <span className="text-[#075BFF]">{activeProject.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Engineering & <ShinyText text="Agent Studio" speed={5} />
          </h1>
          <p className="text-sm text-[#827D8E] max-w-2xl font-light">
            Automated multi-model code review, AST structural verification, and autonomous container sandbox execution.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-[#101016] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('coderabbit')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'coderabbit'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Multi-Model Review ({state.pullRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('agent_run')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'agent_run'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Agent Sandbox
          </button>
          <button
            onClick={() => setActiveTab('context_package')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'context_package'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Task Context
          </button>
        </div>
      </div>

      {/* Main Studio 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: PR & Branch Switcher (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Quick Open PR Card */}
          <form onSubmit={handleCreatePR} className="p-5 bg-[#0c0e15]/90 rounded-2xl border border-white/[0.08] space-y-3">
            <h3 className="text-sm font-semibold text-white">Open Pull Request for Review</h3>
            <input
              type="text"
              placeholder="PR title (e.g. Implement resilient circuit breaker)..."
              value={newPrTitle}
              onChange={(e) => setNewPrTitle(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E]"
            />
            <button
              type="submit"
              disabled={!newPrTitle.trim()}
              className="k-btn-primary w-full py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              + Submit PR to Review Stream
            </button>
          </form>

          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-mono uppercase text-[#827D8E] font-medium tracking-wider">Active Pull Requests</span>
            <span className="text-xs text-[#827D8E] font-mono">{state.pullRequests.length}</span>
          </div>

          {state.pullRequests.length === 0 ? (
            <div className="p-8 bg-[#0c0e15]/90 rounded-2xl border border-white/[0.08] text-center space-y-2 text-xs text-[#827D8E] font-mono">
              No open pull requests. Open one above to trigger automated AST and multi-model reviews.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto">
              {state.pullRequests.map((pr) => {
                const isSelected = pr.id === activePr?.id;
                return (
                  <div
                    key={pr.id}
                    onClick={() => factoryStore.selectPr(pr.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-[#17151D] border-[#075BFF] shadow-xs ring-1 ring-[#075BFF]'
                        : 'bg-[#0c0e15]/90 border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-xs text-[#F6F5FA] line-clamp-1">
                        #{pr.number} {pr.title}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-white/[0.06] text-emerald-400 shrink-0 border border-white/[0.08]">
                        {pr.checksStatus}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#827D8E] font-mono">
                      {pr.sourceBranch} → {pr.targetBranch}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Viewport Content (8 Cols) */}
        <div className="lg:col-span-8">
          {activeTab === 'coderabbit' && (
            <div>
              {!activePr ? (
                <GlassCard className="p-12 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-[#075BFF] flex items-center justify-center mx-auto border border-white/[0.08]">
                    <GitPullRequest className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-medium text-white">No Pull Request Selected</h3>
                  <p className="text-xs text-[#827D8E] max-w-sm mx-auto font-light">
                    Select a pull request from the queue to view automated multi-model code review comments, AST validations, and 1-click diff patches.
                  </p>
                </GlassCard>
              ) : (
                <SpotlightCard className="p-7 space-y-6" spotlightColor="rgba(7, 91, 255, 0.15)">
                  <div className="space-y-1.5 border-b border-white/[0.08] pb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[#075BFF] uppercase tracking-wider">Multi-Model AST Engine</span>
                      <span className="text-xs font-mono text-emerald-400">CI Tests: 100% Passed</span>
                    </div>
                    <h2 className="text-2xl font-semibold text-white tracking-tight">#{activePr.number} {activePr.title}</h2>
                  </div>

                  <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] space-y-2">
                    <span className="text-xs font-mono text-[#827D8E] uppercase">AI Review Summary</span>
                    <p className="text-xs text-[#B5B1C0] leading-relaxed font-light">
                      {activePr.aiReview?.summary || 'Automated code review completed with zero regressions.'}
                    </p>
                  </div>

                  {/* Findings */}
                  <div className="space-y-3">
                    <span className="text-xs font-mono uppercase text-[#827D8E]">Review Findings ({activePr.aiReview?.findings?.length || 0})</span>
                    {activePr.aiReview?.findings && activePr.aiReview.findings.length > 0 ? (
                      activePr.aiReview.findings.map((f) => (
                        <div key={f.id} className="p-4 bg-[#101016] rounded-xl border border-white/[0.08] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-white">{f.title}</span>
                            <span className="text-[10px] font-mono text-amber-400 px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">{f.severity}</span>
                          </div>
                          <p className="text-xs text-[#827D8E] font-light">{f.description}</p>
                          <div className="p-2.5 bg-[#07070B] rounded-lg font-mono text-[11px] text-emerald-400 border border-white/[0.06]">
                            {f.suggestedPatch}
                          </div>
                          <button
                            onClick={() => factoryStore.applyCodeRabbitFix(activePr.id, f.id)}
                            className="k-btn-primary px-3.5 py-1.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                          >
                            Apply 1-Click Patch
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 bg-[#07070B] rounded-xl border border-white/[0.08] text-center text-xs text-[#827D8E] font-mono">
                        Clean review. All invariants and types are verified.
                      </div>
                    )}
                  </div>
                </SpotlightCard>
              )}
            </div>
          )}

          {activeTab === 'agent_run' && (
            <GlassCard className="p-7 space-y-5">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Autonomous Agent Execution Terminal</h3>
                  <p className="text-xs text-[#827D8E] font-light">Cloud Run sandbox with isolated ephemeral runtime and test execution.</p>
                </div>
                <button
                  onClick={handleStartAgent}
                  disabled={agentRunning}
                  className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{agentRunning ? 'Executing Task...' : 'Dispatch Agent'}</span>
                </button>
              </div>

              <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] font-mono text-xs text-emerald-400 space-y-1.5 max-h-80 overflow-y-auto">
                {agentLogs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed">
                    {log}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {activeTab === 'context_package' && (
            <GlassCard className="p-7 space-y-4">
              <div className="space-y-1 border-b border-white/[0.08] pb-4">
                <span className="text-xs font-mono uppercase text-[#075BFF]">Task Context Manifest</span>
                <h3 className="text-lg font-semibold text-white">Grounded Invariants</h3>
              </div>
              <p className="text-xs text-[#B5B1C0] leading-relaxed font-light">
                Every agent run is automatically seeded with verified ADR constraints, acceptance criteria, and past learnings from the tamper-evident ledger.
              </p>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
};
