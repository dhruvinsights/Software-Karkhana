import React, { useState } from 'react';
import {
  BookOpen,
  Award,
  Cpu,
  Plus,
  CheckCircle2,
  Search,
  Filter,
  Shield,
  FileText,
  Sparkles,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface KnowledgeLearningViewProps {
  state: FactoryState;
}

export const KnowledgeLearningView: React.FC<KnowledgeLearningViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'knowledge'>('rules');
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRulePattern, setNewRulePattern] = useState('');

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleTitle.trim()) return;

    state.rules.push({
      id: `rul-${Date.now()}`,
      category: 'architecture',
      title: newRuleTitle.trim(),
      pattern: newRulePattern.trim() || 'Enforce modular service boundaries',
      rationale: 'Maintain maintainability and prevent circular dependencies.',
      enforcedBy: 'ci_pipeline',
      version: '1.0',
      status: 'active',
    });

    factoryStore.logAudit('Added Factory Rule', `Defined invariant "${newRuleTitle.trim()}"`);
    setNewRuleTitle('');
    setNewRulePattern('');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
            Institutional Memory & Invariants
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Factory Rules & Knowledge
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Distilling AST review learnings, architectural invariants, and institutional knowledge into executable agent governance.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'rules' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Rules & Invariants ({state.rules.length})
          </button>
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'knowledge' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Knowledge Base ({state.knowledge.length})
          </button>
        </div>
      </div>

      {/* Define Rule Form */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Define Factory Invariant Rule</h3>
          <span className="text-xs font-mono text-slate-400">Agent Linters</span>
        </div>
        <form onSubmit={handleCreateRule} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Rule title (e.g. Reject Raw SQL in Handlers)..."
              value={newRuleTitle}
              onChange={(e) => setNewRuleTitle(e.target.value)}
              className="text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
            <input
              type="text"
              placeholder="AST pattern or regex (e.g. query\(.*SELECT)...\)"
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
              className="text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 font-mono transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!newRuleTitle.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/20"
          >
            + Register Invariant
          </button>
        </form>
      </GlassCard>

      {/* Rules Grid */}
      {activeTab === 'rules' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {state.rules.map((r) => (
            <SpotlightCard key={r.id} className="p-6 space-y-3 bg-[#0c0f18]/90 border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                  {r.category}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {r.status}
                </span>
              </div>
              <h4 className="text-base font-bold text-white">{r.title}</h4>
              <p className="text-xs text-slate-300 font-mono bg-[#080a10] p-2.5 rounded-lg border border-white/5">
                Pattern: {r.pattern}
              </p>
              <div className="text-[11px] text-slate-400">
                Rationale: {r.rationale}
              </div>
            </SpotlightCard>
          ))}
        </div>
      )}

      {/* Knowledge Articles */}
      {activeTab === 'knowledge' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {state.knowledge.map((k) => (
            <SpotlightCard key={k.id} className="p-6 space-y-3 bg-[#0c0f18]/90 border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-blue-400">{k.category}</span>
                <span className="text-xs font-mono text-slate-400">Author: {k.author}</span>
              </div>
              <h4 className="text-base font-bold text-white">{k.title}</h4>
              <p className="text-xs text-slate-300 line-clamp-3">{k.content}</p>
            </SpotlightCard>
          ))}
        </div>
      )}
    </div>
  );
};
