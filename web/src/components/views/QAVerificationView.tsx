import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Play,
  Plus,
  Sparkles,
  Bug,
  RefreshCw,
  Check,
  X,
  FileCheck,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { TestScenario } from '../../types/factory';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface QAVerificationViewProps {
  state: FactoryState;
}

export const QAVerificationView: React.FC<QAVerificationViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'scenarios' | 'generator'>('scenarios');
  const [generating, setGenerating] = useState(false);
  const [userStoryPrompt, setUserStoryPrompt] = useState('');
  const [newTestTitle, setNewTestTitle] = useState('');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const passedCount = state.testScenarios.filter((t) => t.status === 'passed').length;
  const totalCount = state.testScenarios.length;
  const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 100;

  const handleGenerateScenarios = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/gemini/test-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyTitle: userStoryPrompt || selectedProject?.name || 'Distributed Service Endpoint',
          acceptanceCriteria: 'Response latency < 50ms. Zero unhandled exceptions under concurrency.',
          technicalDetails: 'Modern web & cloud architecture',
        }),
      });
      const data = await res.json();
      if (data.scenarios && data.scenarios.length > 0) {
        data.scenarios.forEach((sc: any) => {
          const newScenario: TestScenario = {
            id: `tc-${Date.now().toString().slice(-4)}`,
            projectId: selectedProject?.id || '',
            title: sc.title,
            type: sc.type,
            priority: sc.priority,
            steps: sc.steps || ['Execute scenario assertions.'],
            expectedResult: sc.expectedResult,
            status: 'not_run',
            automationScript: sc.automationScript,
          };
          factoryStore.addTestScenario(newScenario);
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
      setUserStoryPrompt('');
    }
  };

  const handleCreateManualTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTestTitle.trim()) return;

    factoryStore.addTestScenario({
      title: newTestTitle.trim(),
      projectId: selectedProject?.id,
      type: 'Functional',
      priority: 'P1',
      expectedResult: 'Asserts contract constraints successfully.',
    });
    setNewTestTitle('');
  };

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
          QA Verification
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          No Project Selected
        </h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to coordinate manual runners and automated verification plans.
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
            QA & Verification Studio
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Test scenario runners, automated AI synthesis, invariant regression proofs, and verifiable quality gates.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'scenarios' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Test Runner ({state.testScenarios.length})
          </button>
          <button
            onClick={() => setActiveTab('generator')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'generator' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Test Synthesizer</span>
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            Test Pass Rate
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
            {passRate}%
          </div>
          <div className="text-xs text-slate-400 pt-1">{passedCount} of {totalCount} verified scenarios</div>
        </SpotlightCard>

        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-purple-400 font-medium">
            Total Scenarios
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
            {totalCount}
          </div>
          <div className="text-xs text-slate-400 pt-1">Integration, E2E & regression cases</div>
        </SpotlightCard>

        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-medium">
            Quality Gate State
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-emerald-400">
            {passRate >= 90 ? 'Passed' : 'Pending'}
          </div>
          <div className="text-xs text-slate-400 pt-1">Release sign-off verification</div>
        </SpotlightCard>
      </div>

      {/* Manual Quick Add Form */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Add QA Test Scenario</h3>
          <span className="text-xs font-mono text-slate-400">Manual / Automated Assertion</span>
        </div>
        <form onSubmit={handleCreateManualTest} className="flex gap-2">
          <input
            type="text"
            placeholder="Test title (e.g. Verify token expiration triggers 401 unauthorized)..."
            value={newTestTitle}
            onChange={(e) => setNewTestTitle(e.target.value)}
            className="flex-1 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!newTestTitle.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0 transition-all shadow-md shadow-blue-600/20"
          >
            + Add Test
          </button>
        </form>
      </GlassCard>

      {/* Scenarios List */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          {state.testScenarios.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
                <FileCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">No Test Scenarios Yet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Add manual test assertions above or use AI Test Synthesizer to generate test cases.
              </p>
            </GlassCard>
          ) : (
            <div className="divide-y divide-white/5 bg-[#0c0f18]/90 rounded-2xl border border-white/10 overflow-hidden">
              {state.testScenarios.map((tc) => (
                <div key={tc.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <span className="text-blue-400">{tc.type}</span>
                      <span>·</span>
                      <span className="text-purple-400">{tc.priority}</span>
                    </div>
                    <div className="text-sm font-semibold text-white">{tc.title}</div>
                    <div className="text-xs text-slate-400">Expected: {tc.expectedResult}</div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => factoryStore.runTestScenario(tc.id, 'passed')}
                      className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                        tc.status === 'passed'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-[#10131d] text-slate-400 border-white/10 hover:text-emerald-400 hover:border-emerald-500/30'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      <span>Pass</span>
                    </button>
                    <button
                      onClick={() => factoryStore.runTestScenario(tc.id, 'failed')}
                      className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                        tc.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-[#10131d] text-slate-400 border-white/10 hover:text-rose-400 hover:border-rose-500/30'
                      }`}
                    >
                      <X className="w-4 h-4" />
                      <span>Fail</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Test Synthesizer */}
      {activeTab === 'generator' && (
        <GlassCard className="p-8 space-y-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-400" />
              <span>AI QA Synthesis Engine</span>
            </h3>
            <p className="text-xs text-slate-400">
              Generate comprehensive boundary, fault-injection, and invariant test matrices using Gemini Flash.
            </p>
          </div>

          <div className="space-y-3">
            <textarea
              rows={4}
              placeholder="Enter User Story, API contract specification, or acceptance criteria..."
              value={userStoryPrompt}
              onChange={(e) => setUserStoryPrompt(e.target.value)}
              className="w-full text-xs p-4 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
            <button
              onClick={handleGenerateScenarios}
              disabled={generating}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/30 flex items-center gap-2"
            >
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              <span>{generating ? 'Synthesizing Test Matrix...' : 'Synthesize Test Plan'}</span>
            </button>
          </div>
        </GlassCard>
      )}
    </div>
  );
};
