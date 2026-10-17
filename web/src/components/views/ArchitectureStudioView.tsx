import React, { useState } from 'react';
import {
  Layers,
  FileText,
  Shield,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Code2,
  ArrowRight,
  Terminal,
  Cpu,
  Database,
  Cloud,
  Network,
  Sparkles,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { ADR } from '../../types/factory';
import { stationsApi, useStationList, ApiAdr } from '../../lib/stationsApi';
import { StationLoadState, StationWriteError } from './StationBanners';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

const ADR_STATUS_STYLE: Record<ADR['status'], string> = {
  proposed: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  rejected: 'bg-rose-500/10 border-rose-500/20 text-rose-300',
  superseded: 'bg-slate-500/10 border-slate-500/20 text-slate-400',
};

interface ArchitectureStudioViewProps {
  state: FactoryState;
}

export const ArchitectureStudioView: React.FC<ArchitectureStudioViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'adrs' | 'diagram' | 'contracts'>('adrs');
  const [newAdrTitle, setNewAdrTitle] = useState('');
  const [newAdrDecision, setNewAdrDecision] = useState('');
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const adrs = useStationList<ApiAdr>(selectedProject?.id, stationsApi.listAdrs);

  const handleCreateAdr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdrTitle.trim() || !selectedProject || adrs.offline) return;
    setSaving(true);
    setWriteError(null);
    try {
      const created = await stationsApi.createAdr(selectedProject.id, {
        title: newAdrTitle.trim(),
        decision: newAdrDecision.trim(),
      });
      adrs.upsert(created);
      setNewAdrTitle('');
      setNewAdrDecision('');
    } catch (err) {
      setWriteError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (adr: ApiAdr, status: ADR['status']) => {
    setWriteError(null);
    try {
      adrs.upsert(await stationsApi.updateAdr(adr.id, { status }));
    } catch (err) {
      setWriteError((err as Error).message);
    }
  };

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
          System Architecture
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          No Project Selected
        </h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to record Architecture Decision Records (ADRs) and container diagrams.
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
            Architecture Studio
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Living architectural blueprints, container C4 diagrams, bounded contexts, and durable decision records.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('adrs')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'adrs' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            ADR Registry ({adrs.items.length})
          </button>
          <button
            onClick={() => setActiveTab('diagram')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'diagram' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            C4 Container Map
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'contracts' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Service Contracts
          </button>
        </div>
      </div>

      {/* Record ADR Form */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Record Architecture Decision (ADR)</h3>
          </div>
          <span className="text-xs font-mono text-slate-400">Saved to the project and recorded in the ledger</span>
        </div>
        <form onSubmit={handleCreateAdr} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="ADR Title (e.g. Adopt gRPC over HTTP for internal microservices)..."
              value={newAdrTitle}
              onChange={(e) => setNewAdrTitle(e.target.value)}
              className="text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
            <input
              type="text"
              placeholder="Decision summary & trade-offs..."
              value={newAdrDecision}
              onChange={(e) => setNewAdrDecision(e.target.value)}
              className="text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!newAdrTitle.trim() || saving || adrs.offline}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/20"
          >
            {saving ? 'Recording…' : '+ Record ADR'}
          </button>
          <StationWriteError error={writeError} />
        </form>
      </GlassCard>

      {activeTab === 'adrs' && (
        <div className="space-y-4">
          <StationLoadState loading={adrs.loading} error={adrs.error} offline={adrs.offline} onRetry={adrs.reload} noun="ADRs" />
          {adrs.loading || adrs.error ? null : adrs.items.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">No ADRs Recorded Yet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Architecture Decision Records capture context, trade-offs, and consequences for durable team governance.
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {adrs.items.map((adr) => (
                <SpotlightCard key={adr.id} className="p-6 space-y-3 bg-[#0c0f18]/90 border border-white/10 hover:border-blue-500/30">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-blue-400 font-semibold">{adr.key}</span>
                    <span className={`text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full border font-medium ${ADR_STATUS_STYLE[adr.status]}`}>
                      {adr.status}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white">{adr.title}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{adr.decision}</p>
                  <div className="text-[11px] font-mono text-slate-400 pt-3 border-t border-white/5 flex justify-between items-center">
                    <span>Author: {adr.author}</span>
                    <span>Date: {adr.date}</span>
                  </div>
                  {adr.status === 'proposed' && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => changeStatus(adr, 'accepted')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
                        Accept
                      </button>
                      <button onClick={() => changeStatus(adr, 'rejected')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-500/30 text-rose-300 hover:bg-rose-500/10">
                        Reject
                      </button>
                    </div>
                  )}
                  {adr.status === 'accepted' && (
                    <button onClick={() => changeStatus(adr, 'superseded')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-white/10 text-slate-300 hover:bg-white/5">
                      Mark superseded
                    </button>
                  )}
                </SpotlightCard>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'diagram' && (
        <GlassCard className="p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <h3 className="text-lg font-bold text-white">C4 Container Overview</h3>
              <span className="text-xs text-blue-400 font-mono">Service Boundaries & Ingestion Topologies</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              Topology: Multi-Region High Availability
            </span>
          </div>

          <div className="p-8 bg-[#0a0c12] rounded-xl border border-white/10 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 bg-[#10131d] rounded-xl border border-blue-500/20 text-center space-y-2">
                <Network className="w-5 h-5 text-blue-400 mx-auto" />
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">INGESTION / API GATEWAY</span>
                <div className="font-bold text-sm text-white">{selectedProject.name}</div>
                <div className="text-[11px] text-slate-400">FastAPI / Envoy Proxy</div>
              </div>
              <div className="p-5 bg-[#10131d] rounded-xl border border-[#075BFF]/25 text-center space-y-2">
                <Cpu className="w-5 h-5 text-[#5B8FFF] mx-auto" />
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">AGENT WORKER SWARM</span>
                <div className="font-bold text-sm text-white">Distributed Runners</div>
                <div className="text-[11px] text-slate-400">Celery / Redis Broker</div>
              </div>
              <div className="p-5 bg-[#10131d] rounded-xl border border-emerald-500/20 text-center space-y-2">
                <Database className="w-5 h-5 text-emerald-400 mx-auto" />
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">DURABLE LEDGER</span>
                <div className="font-bold text-sm text-white">PostgreSQL + pgvector</div>
                <div className="text-[11px] text-slate-400">Audit-backed append ledger</div>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {activeTab === 'contracts' && (
        <GlassCard className="p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <h3 className="text-lg font-bold text-white">Interface & API Contracts</h3>
              <span className="text-xs text-blue-400 font-mono">OpenAPI 3.1 & gRPC Proto Definitions</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
              Status: Validated & Invariant Checked
            </span>
          </div>

          <div className="p-4 bg-[#0a0c12] rounded-xl border border-white/10 font-mono text-xs text-slate-300 space-y-2 overflow-x-auto">
            <div className="text-blue-400 font-semibold">// protobuf / v1 / factory_events.proto</div>
            <div className="text-slate-400">syntax = "proto3";</div>
            <div className="text-[#5B8FFF]">package karkhana.v1;</div>
            <br />
            <div>message TaskExecutionEvent &#123;</div>
            <div className="pl-4 text-emerald-400">string task_id = 1;</div>
            <div className="pl-4 text-emerald-400">string gate_status = 2;</div>
            <div className="pl-4 text-emerald-400">bytes cryptographic_hash = 3;</div>
            <div className="pl-4 text-emerald-400">int64 timestamp_ns = 4;</div>
            <div>&#125;</div>
          </div>
        </GlassCard>
      )}
    </div>
  );
};
