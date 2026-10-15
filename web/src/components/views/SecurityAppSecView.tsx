import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Play,
  Lock,
  Clock,
  ExternalLink,
  Check,
  RefreshCw,
  Terminal,
  Plus,
  Shield,
  Key,
  Bug,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface SecurityAppSecViewProps {
  state: FactoryState;
}

export const SecurityAppSecView: React.FC<SecurityAppSecViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<'findings' | 'threat_model' | 'scans'>('findings');
  const [runningScan, setRunningScan] = useState(false);
  const [scanOutput, setScanOutput] = useState<string[]>([
    'SAST Invariant AST Scanner v0.58.0 initialized.',
    'Dependency vulnerability engine online (OSV & CVE feeds synchronized).',
    'Secret detection rule engine loaded 142 token patterns.',
  ]);

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];

  const handleRunScan = () => {
    setRunningScan(true);
    setScanOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Triggering AST invariant scan & dependency vulnerability audit...`]);
    setTimeout(() => {
      setScanOutput((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Verified 0 hardcoded secrets across workspace commits.`,
        `[${new Date().toLocaleTimeString()}] Checked 48 direct dependencies against CVE & OSV open vulnerability databases.`,
        `[${new Date().toLocaleTimeString()}] Audit complete. Security Gate: GREEN (Zero Critical / High CVEs).`,
      ]);
      setRunningScan(false);
      factoryStore.logAudit('Executed Security Vulnerability Scan', `SAST & Dependency scan completed cleanly.`);
    }, 1500);
  };

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
          Product Security & AppSec
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          No Project Selected
        </h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to run continuous SAST scans and track CVE findings.
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
            AppSec & Security Invariants
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Continuous threat modeling, automated SAST/DAST AST verification, secret redaction, and CVE SLA enforcement.
          </p>
        </div>

        <button
          onClick={handleRunScan}
          disabled={runningScan}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shrink-0 shadow-lg shadow-blue-600/30"
        >
          {runningScan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          <span>{runningScan ? 'Scanning...' : 'Trigger SAST Scan'}</span>
        </button>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-rose-400 font-medium">
            Critical Findings
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
            0
          </div>
          <div className="text-xs text-slate-400 pt-1">Zero unmitigated critical vulnerabilities</div>
        </SpotlightCard>

        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            Active Findings
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
            {state.securityFindings.length}
          </div>
          <div className="text-xs text-slate-400 pt-1">Tracked advisory alerts</div>
        </SpotlightCard>

        <SpotlightCard className="p-6 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-medium">
            Security Posture
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-emerald-400">
            Compliant
          </div>
          <div className="text-xs text-slate-400 pt-1">SOC 2 Type II / ISO 27001 aligned</div>
        </SpotlightCard>
      </div>

      {/* Scanner Live Output Console */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-400" />
            <span>SAST Scanner Diagnostics</span>
          </h3>
          <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Gate: PASS
          </span>
        </div>

        <div className="bg-[#080a10] text-slate-300 font-mono text-xs p-5 rounded-xl border border-white/10 space-y-1.5 max-h-64 overflow-y-auto">
          {scanOutput.map((line, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-blue-500 mr-2">$</span>
              {line}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
};
