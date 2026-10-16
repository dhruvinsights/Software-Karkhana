import React from 'react';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';

/** Loading, error and offline-demo states for a server-backed station list. */
export const StationLoadState: React.FC<{
  loading: boolean;
  error: string | null;
  offline: boolean;
  onRetry: () => void;
  noun: string;
}> = ({ loading, error, offline, onRetry, noun }) => {
  if (offline) {
    return (
      <div role="status" className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
        This project has no server record yet, so {noun} cannot be saved. Create or open a project from the Project Hub.
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Could not load {noun}: {error}</span>
        </span>
        <button onClick={onRetry} className="px-3 py-1.5 rounded-lg border border-rose-400/40 hover:bg-rose-500/20 font-semibold">
          Retry
        </button>
      </div>
    );
  }
  if (loading) {
    return (
      <div role="status" className="p-4 text-xs text-slate-400 flex items-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Loading {noun}…</span>
      </div>
    );
  }
  return null;
};

/** Inline write error under a form. */
export const StationWriteError: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <div role="alert" className="text-xs text-rose-300 flex items-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5" />
      <span>{error}</span>
    </div>
  ) : null;

/** Small pill used in navigation for stations that are not server-backed yet. */
export const ComingSoonBadge: React.FC = () => (
  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
    Soon
  </span>
);

/**
 * Read-only banner for stations whose data still lives only in this browser.
 * Their content is a preview: it is not shared with the team and never reaches the ledger.
 */
export const ComingSoonBanner: React.FC<{ station: string }> = ({ station }) => (
  <div role="note" className="max-w-6xl mx-auto mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-100 text-xs flex items-start gap-3">
    <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
    <div className="space-y-0.5">
      <div className="font-semibold text-amber-200">{station}: coming soon (preview only)</div>
      <div className="text-amber-100/80">
        This station is not connected to the server yet. What you see here is sample data stored in this browser only: it is not
        shared with your team, not audited in the ledger, and does not count toward any gate.
      </div>
    </div>
  </div>
);

/** Stations whose data still lives in factoryStore (browser storage). */
export const COMING_SOON_SCREENS = new Set<string>([
  'devops_dashboard', 'pipeline_studio', 'infra_manager', 'deployment_readiness', 'deployment_history',
  'release_dashboard', 'release_detail', 'release_notes', 'release_signoff', 'release_execution',
  'feedback_inbox', 'feedback_detail', 'public_portal', 'incidents',
  'knowledge_hub', 'learning_capture', 'rule_governance', 'skills_library', 'memory_inspector',
]);
