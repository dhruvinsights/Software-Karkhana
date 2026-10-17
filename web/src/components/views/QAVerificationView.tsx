import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Play,
  Plus,
  Sparkles,
  RefreshCw,
  Check,
  X,
  FileCheck,
  Copy,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { stationsApi, useStationList, ApiTestScenario, QaQueueItem } from '../../lib/stationsApi';
import { StationLoadState, StationWriteError } from './StationBanners';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface QAVerificationViewProps {
  state: FactoryState;
}

const RESULTS = [
  ['passed', 'Pass', Check, 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', 'hover:text-emerald-400 hover:border-emerald-500/30'],
  ['failed', 'Fail', X, 'bg-rose-500/20 text-rose-300 border-rose-500/40', 'hover:text-rose-400 hover:border-rose-500/30'],
  ['blocked', 'Blocked', AlertTriangle, 'bg-amber-500/20 text-amber-300 border-amber-500/40', 'hover:text-amber-400 hover:border-amber-500/30'],
] as const;

export const QAVerificationView: React.FC<QAVerificationViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'queue' | 'scenarios'>('queue');
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [newTestTitle, setNewTestTitle] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queue, setQueue] = useState<QaQueueItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const scenarios = useStationList<ApiTestScenario>(selectedProject?.id, stationsApi.listScenarios);
  const queueList = useStationList<QaQueueItem>(selectedProject?.id, stationsApi.qaQueue);
  useEffect(() => setQueue(queueList.items), [queueList.items]);
  const passedCount = scenarios.items.filter((t) => t.status === 'passed').length;
  const totalCount = scenarios.items.length;
  const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  // The AI drafts manual steps and a runnable script for one finished story; the server saves them.
  const handleGenerate = async (item: QaQueueItem) => {
    if (scenarios.offline) return;
    setGeneratingFor(item.id);
    setWriteError(null);
    try {
      const made = await stationsApi.synthesizeScenarios(item.id);
      made.forEach((m) => scenarios.upsert(m));
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, scenarios: q.scenarios + made.length } : q)));
      if (made.length) setExpanded(made[0].id);
      setActiveTab('scenarios');
    } catch (e) {
      setWriteError((e as Error).message);
    } finally {
      setGeneratingFor(null);
    }
  };

  // QA's gate: the server refuses unless every scenario of the story passed.
  const handleSignoff = async (item: QaQueueItem) => {
    setWriteError(null);
    try {
      const done = await stationsApi.qaSignoff(item.id);
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: done.status } : q)));
    } catch (e) {
      setWriteError((e as Error).message);
    }
  };

  const handleCreateManualTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTestTitle.trim() || !selectedProject || scenarios.offline) return;
    setSaving(true);
    setWriteError(null);
    try {
      const created = await stationsApi.createScenario(selectedProject.id, {
        title: newTestTitle.trim(),
        type: 'Functional',
        priority: 'P1',
      });
      scenarios.upsert(created);
      setNewTestTitle('');
    } catch (err) {
      setWriteError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const recordResult = async (tc: ApiTestScenario, result: 'passed' | 'failed' | 'blocked') => {
    setWriteError(null);
    try {
      scenarios.upsert(await stationsApi.updateScenario(tc.id, { status: result }));
    } catch (err) {
      setWriteError((err as Error).message);
    }
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
            Every story a developer finishes lands here. AI drafts manual test steps and an automation script; you run them and record the result.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'queue' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Finished stories ({queue.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'scenarios' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Test Runner ({totalCount})
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
          <div className="text-xs uppercase font-mono tracking-wider text-[#5B8FFF] font-medium">
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
            {totalCount > 0 && passRate >= 90 ? 'Passed' : 'Pending'}
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
            disabled={!newTestTitle.trim() || saving || scenarios.offline}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0 transition-all shadow-md shadow-blue-600/20"
          >
            {saving ? 'Adding…' : '+ Add Test'}
          </button>
        </form>
        <StationWriteError error={writeError} />
      </GlassCard>

      {/* Scenarios List */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          <StationLoadState loading={scenarios.loading} error={scenarios.error} offline={scenarios.offline} onRetry={scenarios.reload} noun="test scenarios" />
          {scenarios.loading || scenarios.error ? null : totalCount === 0 ? (
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
              {scenarios.items.map((tc) => (
                <div key={tc.id} className="hover:bg-white/[0.02] transition-colors">
                  <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <button
                      onClick={() => setExpanded(expanded === tc.id ? null : tc.id)}
                      className="space-y-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                        {expanded === tc.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className="text-blue-400">{tc.type}</span>
                        <span>·</span>
                        <span className="text-[#5B8FFF]">{tc.priority}</span>
                        {tc.automationScript && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-400">script</span>
                          </>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-white">{tc.title}</div>
                      {tc.expectedResult && <div className="text-xs text-slate-400">Expected: {tc.expectedResult}</div>}
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {RESULTS.map(([result, label, Icon, on, off]) => (
                        <button
                          key={result}
                          onClick={() => recordResult(tc, result)}
                          className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                            tc.status === result
                              ? on
                              : `bg-[#10131d] text-slate-400 border-white/10 ${off}`
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {expanded === tc.id && (
                    <div className="px-5 pb-5 space-y-4">
                      {tc.steps.length > 0 && (
                        <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300">
                          {tc.steps.map((st, n) => (
                            <li key={n}>{st}</li>
                          ))}
                        </ol>
                      )}
                      {tc.automationScript && (
                        <div className="rounded-xl border border-white/10 bg-[#0a0c12] overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 text-xs font-mono text-slate-400">
                            <span>automation script (pytest)</span>
                            <button
                              onClick={() => void navigator.clipboard.writeText(tc.automationScript ?? '')}
                              className="inline-flex items-center gap-1.5 hover:text-white"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </button>
                          </div>
                          <pre className="p-4 text-xs text-slate-200 overflow-x-auto">{tc.automationScript}</pre>
                        </div>
                      )}
                      {!tc.steps.length && !tc.automationScript && (
                        <div className="text-xs text-slate-500">No steps or script saved for this scenario.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Finished stories */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <StationLoadState loading={queueList.loading} error={queueList.error} offline={queueList.offline} onRetry={queueList.reload} noun="finished stories" />
          {queueList.loading || queueList.error ? null : queue.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">Nothing waiting for QA</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                When a developer moves a story to Ready for QA it shows up here.
              </p>
            </GlassCard>
          ) : (
            <div className="divide-y divide-white/5 bg-[#0c0f18]/90 rounded-2xl border border-white/10 overflow-hidden">
              {queue.map((item) => (
                <div key={item.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <span className="text-blue-400">{item.key}</span>
                      <span>·</span>
                      <span>{item.status.replace(/_/g, ' ')}</span>
                      <span>·</span>
                      <span>{item.scenarios} scenario{item.scenarios === 1 ? '' : 's'}</span>
                    </div>
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    {item.acceptanceCriteria.length > 0 && (
                      <div className="text-xs text-slate-400">{item.acceptanceCriteria.length} acceptance criteria</div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                  {item.status !== 'done' && item.scenarios > 0 && (
                    <button
                      onClick={() => void handleSignoff(item)}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      <span>Sign off</span>
                    </button>
                  )}
                  <button
                    onClick={() => void handleGenerate(item)}
                    disabled={generatingFor !== null || scenarios.offline}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/30 flex items-center gap-2 shrink-0"
                  >
                    {generatingFor === item.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>{generatingFor === item.id ? 'Drafting…' : item.scenarios ? 'Draft more' : 'Generate tests'}</span>
                  </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
