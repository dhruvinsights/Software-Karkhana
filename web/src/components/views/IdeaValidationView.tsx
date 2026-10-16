import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ChevronRight,
  TrendingUp,
  ShieldAlert,
  Clock,
  Trash2,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { Idea } from '../../types/factory';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { IdeaApprovalPanel } from './IdeaApprovalPanel';
import { GlassCard } from '../reactbits/GlassCard';
import { GlassSurface } from '../reactbits/GlassSurface';
import { ShinyText } from '../reactbits/ShinyText';
import { Terminal } from '../reactbits/Terminal';
import { SpecularButton } from '../reactbits/SpecularButton';
import { authJsonHeaders } from '../../lib/authHeaders';

interface IdeaValidationViewProps {
  state: FactoryState;
}

export const IdeaValidationView: React.FC<IdeaValidationViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'validation' | 'report' | 'brainstorm'>('validation');
  const [evaluating, setEvaluating] = useState(false);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [brainstormPrompt, setBrainstormPrompt] = useState('');

  // Quick submit idea state
  const [newIdeaTitle, setNewIdeaTitle] = useState('');
  const [newIdeaProblem, setNewIdeaProblem] = useState('');
  const [newIdeaValue, setNewIdeaValue] = useState('');

  const selectedIdea = state.ideas.find((i) => i.id === state.selectedIdeaId) || state.ideas[0];
  const activeProduct = selectedIdea
    ? state.products.find((p) => p.id === selectedIdea.productId)
    : state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  const handleRunEvaluation = async () => {
    if (!selectedIdea) return;
    setEvaluating(true);
    try {
      const res = await fetch('/api/gemini/evaluate', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          title: selectedIdea.title,
          problem: selectedIdea.problemStatement,
          description: selectedIdea.expectedValue,
          productContext: activeProduct?.description || '',
        }),
      });
      const data = await res.json();
      if (data.assessment) {
        selectedIdea.assessment = data.assessment;
        factoryStore.logAudit('Evaluated Feature Idea', `Ran feasibility audit for "${selectedIdea.title}" (Score: ${data.assessment.overallScore}/100).`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setEvaluating(false);
    }
  };

  const handleGenerateIdeas = async () => {
    setGeneratingIdeas(true);
    try {
      const res = await fetch('/api/gemini/ideas', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          prompt: brainstormPrompt || 'Scalable enterprise cloud systems and automated workflows',
          productContext: activeProduct?.description || 'Autonomous Cloud Software Factory',
          count: 3,
        }),
      });
      const data = await res.json();
      if (data.ideas && data.ideas.length > 0) {
        data.ideas.forEach((newIdeaData: any) => {
          const newIdea: Idea = {
            id: `idea-gen-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            productId: activeProduct?.id || state.products[0]?.id || '',
            title: newIdeaData.title,
            problemStatement: newIdeaData.problemStatement,
            targetUser: newIdeaData.targetUser,
            expectedValue: newIdeaData.expectedValue,
            authorId: state.members[0]?.id || 'usr-lead',
            status: 'draft',
            complexity: newIdeaData.complexity || 'Medium',
            tags: newIdeaData.tags || ['Generated', 'Gemini'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          factoryStore.addIdea(newIdea);
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingIdeas(false);
      setBrainstormPrompt('');
    }
  };

  const handleCreateManualIdea = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdeaTitle.trim()) return;

    const newIdea: Idea = {
      id: `idea-${Date.now()}`,
      productId: activeProduct?.id || state.products[0]?.id || '',
      title: newIdeaTitle.trim(),
      problemStatement: newIdeaProblem.trim() || 'Identified customer requirement.',
      targetUser: 'Enterprise Users',
      expectedValue: newIdeaValue.trim() || 'Improved workflow and velocity.',
      authorId: state.members[0]?.id || 'usr-lead',
      status: 'draft',
      complexity: 'Medium',
      tags: ['Proposal'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    factoryStore.addIdea(newIdea);
    setNewIdeaTitle('');
    setNewIdeaProblem('');
    setNewIdeaValue('');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header with Product Scope & Tab Bar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
            <span>{activeProduct?.code || 'PRD'}</span>
            <span>·</span>
            <span className="text-[#075BFF]">{activeProduct?.name || 'All Products'}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Idea Lab & <ShinyText text="Discovery Studio" speed={5} />
          </h1>
          <p className="text-sm text-[#827D8E] max-w-2xl font-light">
            Evaluate commercial viability, technical feasibility, and architectural fit before committing engineering resources.
          </p>
        </div>

        {/* View Segmented Tabs */}
        <div className="flex items-center gap-1 bg-[#101016] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('validation')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'validation'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Validation Radar ({state.ideas.length})
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'report'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Brief Document
          </button>
          <button
            onClick={() => setActiveTab('brainstorm')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'brainstorm'
                ? 'bg-[#075BFF] text-white shadow-xs'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Brainstorm</span>
          </button>
        </div>
      </div>

      {/* Main Studio 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Idea Directory & Create Form (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Quick Submit Idea Card */}
          <form onSubmit={handleCreateManualIdea} className="p-5 bg-[#0c0e15]/90 rounded-2xl border border-white/[0.08] space-y-3">
            <h3 className="text-sm font-semibold text-white">Propose New Feature Idea</h3>
            <input
              type="text"
              placeholder="Title (e.g. Distributed Caching Layer)..."
              value={newIdeaTitle}
              onChange={(e) => setNewIdeaTitle(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E]"
            />
            <input
              type="text"
              placeholder="Problem statement..."
              value={newIdeaProblem}
              onChange={(e) => setNewIdeaProblem(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E]"
            />
            <button
              type="submit"
              disabled={!newIdeaTitle.trim()}
              className="w-full py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            >
              + Submit Idea
            </button>
          </form>

          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-mono uppercase text-[#827D8E] font-medium tracking-wider">Candidate Ideas</span>
            <span className="text-xs text-[#827D8E] font-mono">{state.ideas.length}</span>
          </div>

          {state.ideas.length === 0 ? (
            <div className="p-8 bg-[#0c0e15]/90 rounded-2xl border border-white/[0.08] text-center space-y-2 text-xs text-[#827D8E] font-mono">
              No ideas yet. Submit a proposal above or run AI Brainstorm.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto">
              {state.ideas.map((idea) => {
                const isSelected = idea.id === selectedIdea?.id;
                return (
                  <div
                    key={idea.id}
                    onClick={() => factoryStore.selectIdea(idea.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-[#17151D] border-[#075BFF] shadow-xs ring-1 ring-[#075BFF]'
                        : 'bg-[#0c0e15]/90 border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-xs text-[#F6F5FA] line-clamp-1">
                        {idea.title}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-white/[0.06] text-[#B5B1C0] shrink-0 border border-white/[0.08]">
                        {idea.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#827D8E] line-clamp-2 leading-relaxed font-light">
                      {idea.problemStatement}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-mono text-[#075BFF]">
                        Complexity: {idea.complexity}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          factoryStore.deleteIdea(idea.id);
                        }}
                        className="text-[#827D8E] hover:text-rose-400 p-0.5 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Tab Viewport (8 Cols) */}
        <div className="lg:col-span-8">
          {activeTab === 'validation' && (
            <div>
              {!selectedIdea ? (
                <GlassCard className="p-12 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-[#075BFF] flex items-center justify-center mx-auto border border-white/[0.08]">
                    <Layers className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-medium text-white">No Idea Selected</h3>
                  <p className="text-xs text-[#827D8E] max-w-sm mx-auto font-light">
                    Select an idea from the list to review validation metrics, run Gemini feasibility evaluations, or promote to an active project.
                  </p>
                </GlassCard>
              ) : (
                <SpotlightCard className="p-7 space-y-6" spotlightColor="rgba(7, 91, 255, 0.15)">
                  <div className="space-y-1.5 border-b border-white/[0.08] pb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[#075BFF] uppercase tracking-wider">Discovery Candidate</span>
                      <span className="text-xs font-mono text-[#827D8E]">Created {new Date(selectedIdea.createdAt).toLocaleDateString()}</span>
                    </div>
                    <h2 className="text-2xl font-semibold text-white tracking-tight">{selectedIdea.title}</h2>
                  </div>

                  <div className="space-y-4">
                    <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] space-y-1">
                      <span className="text-xs font-mono text-[#827D8E] uppercase">Problem Statement</span>
                      <p className="text-xs text-[#B5B1C0] leading-relaxed font-light">{selectedIdea.problemStatement}</p>
                    </div>

                    <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] space-y-1">
                      <span className="text-xs font-mono text-[#827D8E] uppercase">Expected Value / ROI</span>
                      <p className="text-xs text-[#B5B1C0] leading-relaxed font-light">{selectedIdea.expectedValue}</p>
                    </div>
                  </div>

                  {/* Assessment Results or Trigger */}
                  {selectedIdea.assessment ? (
                    <div className="p-5 bg-[#17151D] rounded-xl border border-[#075BFF]/30 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono uppercase text-[#075BFF] font-semibold">Gemini 3.8 Feasibility Radar</span>
                        <span className="text-sm font-mono font-bold text-emerald-400">
                          {selectedIdea.assessment.overallScore}/100
                        </span>
                      </div>
                      <p className="text-xs text-[#B5B1C0] leading-relaxed font-light">
                        {selectedIdea.assessment.executiveSummary}
                      </p>
                    </div>
                  ) : (
                    <div className="p-5 bg-[#07070B] rounded-xl border border-white/[0.08] flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-white">Automated Feasibility Assessment</div>
                        <div className="text-[11px] text-[#827D8E] font-light">Evaluate technical dependencies, cloud cost, and architecture risks.</div>
                      </div>
                      <button
                        onClick={handleRunEvaluation}
                        disabled={evaluating}
                        className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                      >
                        {evaluating ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Evaluating...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Run Evaluation</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Actions */}
                  {state.token && state.currentUser ? (
                    <IdeaApprovalPanel
                      idea={selectedIdea}
                      token={state.token}
                      workspaceId={state.activeWorkspaceId}
                      currentUserId={state.currentUser.id}
                    />
                  ) : (
                    <div className="pt-2 flex items-center gap-3">
                      <button
                        onClick={() => void factoryStore.promoteIdeaToProject(selectedIdea.id, `${selectedIdea.title} Service`)}
                        className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-[#075BFF]/20"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Promote to Engineering Project (demo)</span>
                      </button>
                    </div>
                  )}
                </SpotlightCard>
              )}
            </div>
          )}

          {activeTab === 'report' && (
            <GlassCard className="p-8 space-y-6">
              <div className="space-y-1 border-b border-white/[0.08] pb-4">
                <span className="text-xs font-mono uppercase text-[#075BFF]">Product Requirement Brief</span>
                <h2 className="text-xl font-semibold text-white">{selectedIdea ? selectedIdea.title : 'Discovery Specification'}</h2>
              </div>
              <div className="space-y-3 text-xs text-[#B5B1C0] leading-relaxed font-light">
                <p>
                  <strong>Target Audience:</strong> {selectedIdea?.targetUser || 'Enterprise Cloud Engineers'}
                </p>
                <p>
                  <strong>Strategic Invariant:</strong> Zero regressive architectural coupling, automated continuous verification.
                </p>
                <p>
                  <strong>Governance SLA:</strong> Requires 4-eye multi-signature gate authorization before main branch merge.
                </p>
              </div>
            </GlassCard>
          )}

          {activeTab === 'brainstorm' && (
            <div className="space-y-6">
              <Terminal
                title="karkhana-ai-ideation-terminal"
                placeholder="Describe a feature area or press Enter to synthesize autonomous proposals..."
                suggestedCommands={[
                  { label: '🚀 Canary SRE Engine', command: 'synthesize-feature --domain "Zero-downtime canary rollback for Cloud Run"' },
                  { label: '🔒 Multi-sig RBAC', command: 'synthesize-feature --domain "Hardware security key & webauthn multi-sig approvals"' },
                  { label: '⚡ Real-time Telemetry', command: 'synthesize-feature --domain "eBPF-based distributed tracing & latency anomaly detector"' },
                ]}
                onExecute={async (cmd) => {
                  setGeneratingIdeas(true);
                  try {
                    const res = await fetch('/api/gemini/ideas', {
                      method: 'POST',
                      headers: authJsonHeaders(),
                      body: JSON.stringify({
                        prompt: cmd || 'Scalable enterprise cloud systems and automated workflows',
                        productContext: activeProduct?.description || 'Autonomous Cloud Software Factory',
                        count: 3,
                      }),
                    });
                    const data = await res.json();
                    if (data.ideas && data.ideas.length > 0) {
                      data.ideas.forEach((newIdeaData: any) => {
                        const newIdea: Idea = {
                          id: `idea-gen-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                          productId: activeProduct?.id || state.products[0]?.id || '',
                          title: newIdeaData.title,
                          problemStatement: newIdeaData.problemStatement,
                          targetUser: newIdeaData.targetUser,
                          expectedValue: newIdeaData.expectedValue,
                          authorId: state.members[0]?.id || 'usr-lead',
                          status: 'draft',
                          complexity: newIdeaData.complexity || 'Medium',
                          tags: newIdeaData.tags || ['Generated', 'Gemini'],
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        };
                        factoryStore.addIdea(newIdea);
                      });
                      return `✓ Synthesized ${data.ideas.length} candidate proposals and registered them in the Discovery Radar.`;
                    }
                  } catch (e: any) {
                    // Fallback local synthesis
                    const fallbackTitle = cmd.replace(/^synthesize-feature\s+--domain\s+"?|"?$/g, '') || 'Distributed Microservice Mesh';
                    const newIdea: Idea = {
                      id: `idea-gen-${Date.now()}`,
                      productId: activeProduct?.id || state.products[0]?.id || '',
                      title: fallbackTitle,
                      problemStatement: `High latency and cascading failures under heavy load in ${fallbackTitle}.`,
                      targetUser: 'Enterprise Cloud Engineers',
                      expectedValue: 'Sub-millisecond routing and automated circuit breakers.',
                      authorId: state.members[0]?.id || 'usr-lead',
                      status: 'draft',
                      complexity: 'High',
                      tags: ['AI-Generated', 'Architecture'],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    };
                    factoryStore.addIdea(newIdea);
                    return `✓ [Fallback AI]: Created candidate proposal "${fallbackTitle}" and added to workspace backlog.`;
                  } finally {
                    setGeneratingIdeas(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
