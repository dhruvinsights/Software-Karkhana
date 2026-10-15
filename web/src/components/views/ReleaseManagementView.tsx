import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  FileText,
  Clock,
  ShieldCheck,
  Check,
  ArrowRight,
  Server,
  Radio,
  Plus,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface ReleaseManagementViewProps {
  state: FactoryState;
}

export const ReleaseManagementView: React.FC<ReleaseManagementViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'checklist' | 'signoff'>('checklist');
  const [newVersion, setNewVersion] = useState('');
  const [newChangelog, setNewChangelog] = useState('');

  const selectedRelease = state.releases[0];
  const allSigned = selectedRelease ? selectedRelease.signoffs.every((s) => s.signed) : false;

  const handleCreateRelease = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVersion.trim()) return;

    factoryStore.createRelease({
      version: newVersion.trim(),
      changelog: newChangelog.trim() || 'Staged for multi-signature quorum verification.',
    });

    setNewVersion('');
    setNewChangelog('');
  };

  const handleSignRelease = () => {
    if (!selectedRelease) return;
    factoryStore.signoffRelease(selectedRelease.id, 'release_manager', state.members[0]?.name || 'Workspace Lead');
  };

  const handleTriggerCanary = () => {
    if (!selectedRelease) return;
    factoryStore.triggerCanaryDeploy(selectedRelease.id);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            <span>{selectedRelease?.version || 'No Staged Release'}</span>
            <span>·</span>
            <span>Production Quorum</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Release Governance & Canary
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Pre-flight verification, multi-discipline 4-eye sign-offs, and automated canary rollouts with instant rollback triggers.
          </p>
        </div>

        {selectedRelease && (
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleSignRelease}
              className="px-4 py-2.5 bg-[#10131d] border border-white/10 hover:border-emerald-500/30 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Sign-off Gate</span>
            </button>
            <button
              onClick={handleTriggerCanary}
              disabled={selectedRelease.status === 'deploying' || selectedRelease.status === 'released'}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/30"
            >
              <Radio className="w-4 h-4" />
              <span>{selectedRelease.status === 'released' ? 'Released to Production' : 'Deploy Canary (10%)'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Stage New Release Form */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Stage New Release Candidate</h3>
          <span className="text-xs font-mono text-slate-400">Cryptographic Version Tag</span>
        </div>
        <form onSubmit={handleCreateRelease} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Version (e.g. v1.0.0)..."
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              className="text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 font-mono placeholder:text-slate-500 transition-colors"
            />
            <input
              type="text"
              placeholder="Changelog notes summary..."
              value={newChangelog}
              onChange={(e) => setNewChangelog(e.target.value)}
              className="sm:col-span-2 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!newVersion.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-600/20"
          >
            + Stage Release
          </button>
        </form>
      </GlassCard>

      {/* Active Release Dashboard */}
      {selectedRelease ? (
        <SpotlightCard className="p-8 space-y-6 bg-[#0c0f18]/90 border border-white/10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {selectedRelease.version}
                </span>
                <h3 className="text-lg font-bold text-white">Production Release Candidate</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">{selectedRelease.changelog}</p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {selectedRelease.status.toUpperCase()}
            </span>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-mono uppercase text-slate-400 tracking-wider">Multi-Sig Sign-off Quorum</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {selectedRelease.signoffs.map((s, i) => (
                <div key={i} className="p-4 rounded-xl bg-[#10131d] border border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white capitalize">{s.role.replace('_', ' ')}</span>
                    {s.signed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {s.signed ? `Signed by ${s.approverName} on ${s.timestamp?.split('T')[0]}` : 'Awaiting confirmation'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SpotlightCard>
      ) : (
        <GlassCard className="p-12 text-center space-y-3">
          <Radio className="w-8 h-8 text-blue-400 mx-auto" />
          <h3 className="text-lg font-bold text-white">No Active Releases Staged</h3>
          <p className="text-xs text-slate-400">Stage a new release candidate above to begin pre-flight verification.</p>
        </GlassCard>
      )}
    </div>
  );
};
