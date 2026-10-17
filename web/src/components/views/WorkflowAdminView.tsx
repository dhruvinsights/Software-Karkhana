import React, { useState } from 'react';
import {
  Sliders,
  FileText,
  Cpu,
  Layers,
  ArrowRight,
  Shield,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Lock,
  Database,
  Terminal,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface WorkflowAdminViewProps {
  state: FactoryState;
}

export const WorkflowAdminView: React.FC<WorkflowAdminViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'workflow_designer' | 'audit_log'>('workflow_designer');
  const [searchAudit, setSearchAudit] = useState('');

  const filteredAudit = state.auditLogs.filter((log) =>
    log.action.toLowerCase().includes(searchAudit.toLowerCase()) ||
    log.actor.toLowerCase().includes(searchAudit.toLowerCase()) ||
    log.details.toLowerCase().includes(searchAudit.toLowerCase())
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
            Factory Governance & Ledger
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Governance & Ledger
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Configurable lifecycle execution paths, quality invariant enforcement, and cryptographic immutable audit ledger.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('workflow_designer')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'workflow_designer' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Lifecycle Architecture
          </button>
          <button
            onClick={() => setActiveTab('audit_log')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'audit_log' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Tamper-Evident Ledger ({state.auditLogs.length})
          </button>
        </div>
      </div>

      {activeTab === 'workflow_designer' && (
        <SpotlightCard className="p-8 space-y-6 bg-[#0c0f18]/90 border border-white/10">
          <div className="border-b border-white/10 pb-4">
            <h3 className="text-xl font-bold text-white">Canonical 5-Phase Factory Pipeline</h3>
            <p className="text-xs text-slate-400 mt-1">Automated cryptographic quality gates connecting each phase.</p>
          </div>

          <div className="p-6 bg-[#080a10] rounded-xl border border-white/10 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
              <div className="p-4 bg-[#10131d] rounded-xl border border-blue-500/20 space-y-1">
                <span className="text-[10px] uppercase font-mono text-blue-400">PHASE 1</span>
                <div className="font-bold text-white">Discovery</div>
                <div className="text-[11px] text-slate-400">Radar & Viability</div>
              </div>
              <div className="p-4 bg-[#10131d] rounded-xl border border-[#075BFF]/25 space-y-1">
                <span className="text-[10px] uppercase font-mono text-[#5B8FFF]">PHASE 2</span>
                <div className="font-bold text-white">Definition</div>
                <div className="text-[11px] text-slate-400">Epics & ADR Contracts</div>
              </div>
              <div className="p-4 bg-[#10131d] rounded-xl border border-[#075BFF]/25 space-y-1">
                <span className="text-[10px] uppercase font-mono text-[#5B8FFF]">PHASE 3</span>
                <div className="font-bold text-white">Autonomous Dev</div>
                <div className="text-[11px] text-slate-400">AST Review & Sandbox</div>
              </div>
              <div className="p-4 bg-[#10131d] rounded-xl border border-emerald-500/20 space-y-1">
                <span className="text-[10px] uppercase font-mono text-emerald-400">PHASE 4</span>
                <div className="font-bold text-white">Verification</div>
                <div className="text-[11px] text-slate-400">Invariant QA & SAST</div>
              </div>
              <div className="p-4 bg-[#10131d] rounded-xl border border-amber-500/20 space-y-1">
                <span className="text-[10px] uppercase font-mono text-amber-400">PHASE 5</span>
                <div className="font-bold text-white">Release & Canary</div>
                <div className="text-[11px] text-slate-400">Quorum Multi-Sig</div>
              </div>
            </div>
          </div>
        </SpotlightCard>
      )}

      {activeTab === 'audit_log' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search cryptographic ledger by actor, hash or action..."
                value={searchAudit}
                onChange={(e) => setSearchAudit(e.target.value)}
                className="w-full text-xs pl-10 pr-4 py-2.5 bg-[#0c0f18] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
              />
            </div>
          </div>

          <div className="divide-y divide-white/5 bg-[#0c0f18]/90 rounded-2xl border border-white/10 overflow-hidden font-mono text-xs">
            {filteredAudit.map((log) => (
              <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.02]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-bold">{log.action}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-slate-400">{log.actor}</span>
                  </div>
                  <div className="text-slate-400 text-[11px] font-sans">{log.details}</div>
                </div>
                <div className="text-slate-500 text-[10px] shrink-0">{log.timestamp}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
