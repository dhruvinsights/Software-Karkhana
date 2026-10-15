import React, { useState } from 'react';
import {
  Activity,
  ShieldAlert,
  Bug,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Plus,
  Radio,
  Trash2,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface FeedbackIncidentsViewProps {
  state: FactoryState;
}

export const FeedbackIncidentsView: React.FC<FeedbackIncidentsViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'feedback' | 'incidents'>('incidents');
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'SEV0' | 'SEV1' | 'SEV2'>('SEV1');
  const [incidentSummary, setIncidentSummary] = useState('');

  const handleCreateIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentTitle.trim()) return;

    factoryStore.logIncident({
      title: incidentTitle.trim(),
      severity: incidentSeverity,
      summary: incidentSummary.trim() || 'Triggered incident postmortem commander.',
      affectedServices: ['API Gateway', 'Core Service'],
    });

    setIncidentTitle('');
    setIncidentSummary('');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
            Production Triage & Reliability
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Incidents & Customer Feedback
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Real-time telemetry alarms, automated root cause analysis, customer sentiment clustering, and SEV postmortems.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('incidents')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'incidents' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Incidents ({state.incidents.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'feedback' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Feedback Inbox ({state.feedback.length})</span>
          </button>
        </div>
      </div>

      {/* Log Incident Form */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Log Operational Incident</h3>
          <span className="text-xs font-mono text-slate-400">War Room Dispatch</span>
        </div>

        <form onSubmit={handleCreateIncident} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <select
              value={incidentSeverity}
              onChange={(e) => setIncidentSeverity(e.target.value as any)}
              className="text-xs p-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 font-mono transition-colors"
            >
              <option value="SEV0">SEV0 - Critical Outage</option>
              <option value="SEV1">SEV1 - Degraded Service</option>
              <option value="SEV2">SEV2 - Minor Warning</option>
            </select>

            <input
              type="text"
              placeholder="Incident title (e.g. Memory saturation on worker node runner)..."
              value={incidentTitle}
              onChange={(e) => setIncidentTitle(e.target.value)}
              className="sm:col-span-3 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={!incidentTitle.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/20"
          >
            + Log Incident
          </button>
        </form>
      </GlassCard>

      {/* Incidents List */}
      {activeTab === 'incidents' && (
        <div className="space-y-4">
          {state.incidents.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h3 className="text-lg font-bold text-white">Zero Active Incidents</h3>
              <p className="text-xs text-slate-400">All systems operating within defined SLO / latency budgets.</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {state.incidents.map((inc) => (
                <SpotlightCard key={inc.id} className="p-6 space-y-3 bg-[#0c0f18]/90 border border-white/10">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold ${
                      inc.severity === 'SEV0'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : inc.severity === 'SEV1'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}>
                      {inc.severity}
                    </span>
                    <span className="text-xs font-mono text-slate-400 uppercase">{inc.status}</span>
                  </div>
                  <h4 className="text-base font-bold text-white">{inc.title}</h4>
                  <p className="text-xs text-slate-300">{inc.summary}</p>
                  <div className="text-[11px] font-mono text-slate-400 pt-3 border-t border-white/5 flex justify-between">
                    <span>Affected: {inc.affectedServices.join(', ')}</span>
                    <span>Started: {inc.startedAt?.split('T')[0]}</span>
                  </div>
                </SpotlightCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Customer Feedback List */}
      {activeTab === 'feedback' && (
        <div className="space-y-4">
          {state.feedback.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-3">
              <MessageSquare className="w-8 h-8 text-blue-400 mx-auto" />
              <h3 className="text-lg font-bold text-white">Feedback Inbox Clean</h3>
              <p className="text-xs text-slate-400">All customer feedback signals triaged into user stories.</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {state.feedback.map((fb) => (
                <SpotlightCard key={fb.id} className="p-6 space-y-2 bg-[#0c0f18]/90 border border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-blue-400">{fb.source}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300">
                      Sentiment: {fb.sentiment}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 italic">"{fb.content}"</p>
                  <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-white/5">
                    Reporter: {fb.reporter}
                  </div>
                </SpotlightCard>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
