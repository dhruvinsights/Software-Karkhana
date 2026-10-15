import React, { useState } from 'react';
import { X, Sparkles, LayoutDashboard, Sliders, Check, RotateCcw, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { DashboardWidget } from '../../types/factory';

interface DashboardCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

export const DashboardCustomizerModal: React.FC<DashboardCustomizerModalProps> = ({
  isOpen,
  onClose,
  state,
}) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('ai');
  const [widgets, setWidgets] = useState<DashboardWidget[]>(state.dashboardWidgets);
  const [prompt, setPrompt] = useState('Focus on my active tasks, autonomous agent runs, failing tests, and blocking PR reviews.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiRationale, setAiRationale] = useState('');
  const [proposedWidgets, setProposedWidgets] = useState<DashboardWidget[] | null>(null);

  if (!isOpen) return null;

  const toggleWidget = (id: string) => {
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)));
  };

  const handleApplyManual = () => {
    factoryStore.updateDashboardWidgets(widgets);
    onClose();
  };

  const handleAskAI = async () => {
    setIsGenerating(true);
    setAiRationale('');
    try {
      const res = await fetch('/api/gemini/dashboard-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          userRole: state.currentRole,
          currentWidgets: widgets,
        }),
      });
      const data = await res.json();
      if (data.proposedWidgets) {
        const transformed: DashboardWidget[] = data.proposedWidgets.map((pw: any, i: number) => ({
          id: pw.id || `w-${i}`,
          title: pw.title,
          category: pw.category || 'tasks',
          enabled: pw.visible !== false,
          order: i + 1,
        }));
        setProposedWidgets(transformed);
        setAiRationale(data.rationale || 'Tailored layout generated based on your operational requirements.');
      }
    } catch (err) {
      console.error('Failed to generate AI layout:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyAI = () => {
    if (proposedWidgets) {
      factoryStore.updateDashboardWidgets(proposedWidgets);
      onClose();
    }
  };

  const handleRestoreDefaults = () => {
    const defaults: DashboardWidget[] = [
      { id: 'w-assigned-tasks', title: 'My Work & Assigned Tasks', category: 'tasks', enabled: true, order: 1 },
      { id: 'w-agent-runs', title: 'Active Autonomous Agent Runs', category: 'activity', enabled: true, order: 2 },
      { id: 'w-prs-review', title: 'CodeRabbit PR Reviews', category: 'approvals', enabled: true, order: 3 },
      { id: 'w-pipelines', title: 'CI/CD Multi-Stage Canary Health', category: 'system', enabled: true, order: 4 },
    ];
    setWidgets(defaults);
    factoryStore.updateDashboardWidgets(defaults);
    setProposedWidgets(null);
    setAiRationale('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md">
            <LayoutDashboard className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Customize Workspace Dashboard</h3>
            <p className="text-[11px] text-slate-400">Configure layout manually or describe your ideal workspace to Gemini AI</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 mb-5">
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'ai' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>AI Layout Assistant</span>
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'manual' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Manual Widgets</span>
          </button>
        </div>

        {/* Tab 1: AI Customizer */}
        {activeTab === 'ai' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Describe how you want your dashboard organized:
              </label>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Focus on my assigned tasks, active agent runs, failing tests, pull requests awaiting review and blocked dependencies."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 leading-relaxed"
              />
            </div>

            <button
              onClick={handleAskAI}
              disabled={isGenerating || !prompt.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {isGenerating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Synthesizing tailored layout with Gemini 3.8 Flash...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Generate Personalized Layout</span>
                </>
              )}
            </button>

            {aiRationale && proposedWidgets && (
              <div className="p-4 bg-slate-950 rounded-xl border border-blue-500/30 space-y-3">
                <div className="text-xs font-mono text-blue-400 flex items-center justify-between">
                  <span>PROPOSED DASHBOARD PREVIEW</span>
                  <span className="text-emerald-400 font-semibold">{proposedWidgets.length} WIDGETS</span>
                </div>
                <p className="text-xs text-slate-300 italic">{aiRationale}</p>
                <div className="space-y-1.5 pt-1">
                  {proposedWidgets.map((pw) => (
                    <div key={pw.id} className="flex items-center justify-between p-2 bg-slate-900 rounded-lg text-xs">
                      <span className="text-white font-medium">{pw.title}</span>
                      <span className="text-[10px] text-slate-500 font-mono uppercase">{pw.category}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleApplyAI}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Apply Proposed Layout
                  </button>
                  <button
                    onClick={() => setProposedWidgets(null)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Manual Customizer */}
        {activeTab === 'manual' && (
          <div className="space-y-3">
            <span className="text-xs text-slate-400 block mb-2">
              Toggle widget visibility to streamline your workspace view:
            </span>
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs"
              >
                <div>
                  <h4 className="text-white font-medium">{widget.title}</h4>
                  <span className="text-[10px] text-slate-500 font-mono uppercase">{widget.category}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleWidget(widget.id)}
                  className={`p-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                    widget.enabled
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                      : 'bg-slate-900 border-slate-800 text-slate-600'
                  }`}
                >
                  {widget.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            ))}

            <div className="pt-3">
              <button
                type="button"
                onClick={handleApplyManual}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl"
              >
                Save Layout Changes
              </button>
            </div>
          </div>
        )}

        {/* Modal Footer Controls */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs mt-4">
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="text-slate-400 hover:text-white flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Default Layout</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
