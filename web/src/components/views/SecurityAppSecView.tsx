import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Check,
  Download,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SecurityFinding } from '../../types/factory';
import {
  stationsApi,
  useStationList,
  isServerProject,
  ApiSecurityFinding,
  ProjectPerson,
  SecurityScan,
  SecuritySummary,
  Severity,
} from '../../lib/stationsApi';
import { StationLoadState, StationWriteError } from './StationBanners';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
  HIGH: 'bg-orange-500/15 border-orange-500/30 text-orange-300',
  MEDIUM: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  LOW: 'bg-slate-500/15 border-slate-500/30 text-slate-300',
};

const STATUS_LABEL: Record<SecurityFinding['status'], string> = {
  open: 'Open',
  in_remediation: 'In remediation',
  verified_fixed: 'Verified fixed',
  waived: 'Waived',
};

const TRIGGER_LABEL: Record<SecurityScan['trigger'], string> = {
  manual: 'Manual',
  pr: 'Pull request',
  merge: 'After merge',
  schedule: 'Scheduled',
  rescan: 'Rescan',
};

const ACTIVE_SCAN = new Set<SecurityScan['status']>(['queued', 'running']);

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

interface SecurityAppSecViewProps {
  state: FactoryState;
}

export const SecurityAppSecView: React.FC<SecurityAppSecViewProps> = ({ state }) => {
  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const projectId = selectedProject?.id;
  const live = isServerProject(projectId);

  const findings = useStationList<ApiSecurityFinding>(projectId, stationsApi.listFindings);
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [scans, setScans] = useState<SecurityScan[]>([]);
  const [people, setPeople] = useState<ProjectPerson[]>([]);
  const [isLead, setIsLead] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const [filterSeverity, setFilterSeverity] = useState<Severity | 'ALL'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'open' | 'all' | SecurityFinding['status']>('open');
  const [openFix, setOpenFix] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const reloadFindings = findings.reload;

  const refresh = useCallback(async () => {
    if (!isServerProject(projectId)) return;
    try {
      const [s, h] = await Promise.all([stationsApi.securitySummary(projectId), stationsApi.listScans(projectId)]);
      setSummary(s);
      setScans(h);
      setSummaryError(null);
    } catch (e) {
      setSummaryError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    setSummary(null);
    setScans([]);
    void refresh();
    if (!isServerProject(projectId)) return;
    stationsApi.projectMembers(projectId).then(setPeople).catch(() => setPeople([]));
    stationsApi
      .projectAccess(projectId)
      .then((a) => setIsLead(!!(a.canManage || a.isLead)))
      .catch(() => setIsLead(false));
  }, [projectId, refresh]);

  // A scan runs on the server; poll the newest unfinished one until it ends, then reload what it changed.
  const running = scans.find((s) => ACTIVE_SCAN.has(s.status));
  const runningId = running?.id;
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!runningId) return;
    timer.current = window.setInterval(async () => {
      try {
        const s = await stationsApi.getScan(runningId);
        if (!ACTIVE_SCAN.has(s.status)) {
          window.clearInterval(timer.current);
          await Promise.all([refresh(), reloadFindings()]);
        }
      } catch (e) {
        window.clearInterval(timer.current);
        setWriteError((e as Error).message);
      }
    }, 2000);
    return () => window.clearInterval(timer.current);
  }, [runningId, refresh, reloadFindings]);

  const startScan = async (kind: 'scan' | 'rescan') => {
    if (!isServerProject(projectId)) return;
    setWriteError(null);
    try {
      const s = kind === 'rescan' ? await stationsApi.rescan(projectId) : await stationsApi.startScan(projectId);
      setScans((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
    } catch (e) {
      setWriteError((e as Error).message);
    }
  };

  const personName = (id: string | null | undefined) => people.find((p) => p.userId === id)?.name;

  const assign = async (f: ApiSecurityFinding, assigneeId: string) => {
    setWriteError(null);
    try {
      findings.upsert(await stationsApi.assignFinding(f.id, assigneeId || null));
    } catch (e) {
      setWriteError((e as Error).message);
    }
  };

  const suggestFix = async (f: ApiSecurityFinding) => {
    setWriteError(null);
    setFixBusy(f.id);
    try {
      const aiFix = await stationsApi.fixSuggestion(f.id);
      findings.upsert({ ...f, aiFix });
      setOpenFix(f.id);
    } catch (e) {
      setWriteError((e as Error).message);
    } finally {
      setFixBusy(null);
    }
  };

  const moveFinding = async (f: ApiSecurityFinding, status: SecurityFinding['status']) => {
    setWriteError(null);
    let reason: string | undefined;
    if (status === 'waived') {
      reason = window.prompt('Why is this risk accepted? (recorded in the ledger)')?.trim();
      if (!reason) return;
    }
    try {
      findings.upsert(await stationsApi.updateFinding(f.id, { status, ...(reason ? { reason } : {}) }));
      void refresh();
    } catch (e) {
      setWriteError((e as Error).message);
    }
  };

  const downloadReport = async () => {
    if (!isServerProject(projectId)) return;
    setWriteError(null);
    try {
      const r = await stationsApi.securityReport(projectId);
      download(`security-report-${r.project.name.replace(/\W+/g, '-').toLowerCase()}.md`, r.markdown, 'text/markdown');
    } catch (e) {
      setWriteError((e as Error).message);
    }
  };

  const visible = useMemo(
    () =>
      findings.items.filter((f) => {
        if (filterSeverity !== 'ALL' && f.severity !== filterSeverity) return false;
        if (filterStatus === 'open') return f.status === 'open' || f.status === 'in_remediation';
        return filterStatus === 'all' || f.status === filterStatus;
      }),
    [findings.items, filterSeverity, filterStatus],
  );

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">Security & Assurance</div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">No Project Selected</h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to scan its dependencies and track vulnerabilities.
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

  const gateOpen = summary?.gate.open;
  const last = summary?.lastScan ?? null;

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            <span>{selectedProject.code}</span>
            <span>·</span>
            <span>{selectedProject.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Security & Assurance</h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Dependencies are scanned with Google OSV-Scanner when a build opens a pull request and again after a merge. Critical
            findings close the gate: nothing moves to QA sign-off or merge until they are fixed or waived.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void downloadReport()}
            disabled={!live}
            className="px-4 py-2.5 border border-white/10 hover:bg-white/5 disabled:opacity-40 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Report</span>
          </button>
          <button
            onClick={() => void startScan(last ? 'rescan' : 'scan')}
            disabled={!live || !!running || summary?.scannerReady === false}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/30"
          >
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>{running ? (running.status === 'queued' ? 'Queued…' : 'Scanning…') : last ? 'Rescan' : 'Scan dependencies'}</span>
          </button>
        </div>
      </div>

      <StationWriteError error={writeError || summaryError} />
      {!live && (
        <StationLoadState loading={false} error={null} offline onRetry={() => undefined} noun="security scans" />
      )}
      {live && summary?.scannerReady === false && (
        <div role="note" className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-100 text-xs">
          This project has no repository connected, so there is nothing to scan. Connect GitHub in Product Setup first.
        </div>
      )}

      {summary && (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            gateOpen ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {gateOpen ? <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-300" /> : <ShieldAlert className="w-5 h-5 shrink-0 text-rose-300" />}
          <div className="text-xs space-y-1">
            <div className="font-semibold text-sm">{gateOpen ? 'Security gate open' : 'Security gate closed'}</div>
            <div>
              {gateOpen
                ? 'No open finding blocks QA sign-off or merge.'
                : `Blocked: ${summary.gate.blockers.join('; ')}. QA sign-off and merge stay refused until this clears.`}
            </div>
            <div className="text-[11px] opacity-80">
              Blocks on {summary.policy.blockSeverities.join(', ')}
              {summary.policy.requireScan ? ' · a completed scan is required' : ''}
              {summary.policy.autoScan ? ' · pull requests are scanned automatically' : ' · automatic scans are off'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {SEVERITIES.map((sv) => (
          <SpotlightCard key={sv} className="p-5 space-y-1 bg-[#0c0f18]/90 border border-white/10">
            <div className={`text-[11px] uppercase font-mono tracking-wider font-medium ${SEVERITY_STYLE[sv].split(' ').pop()}`}>{sv}</div>
            <div className="text-4xl font-bold tracking-tight text-white">{summary ? summary.open[sv] : '–'}</div>
            <div className="text-[11px] text-slate-400">open</div>
          </SpotlightCard>
        ))}
        <SpotlightCard className="p-5 space-y-1 bg-[#0c0f18]/90 border border-white/10">
          <div className="text-[11px] uppercase font-mono tracking-wider text-emerald-400 font-medium">Fixed</div>
          <div className="text-4xl font-bold tracking-tight text-white">{summary ? summary.fixed : '–'}</div>
          <div className="text-[11px] text-slate-400">
            {summary ? `${summary.waived} waived · ${summary.overdue} past SLA` : ''}
          </div>
        </SpotlightCard>
      </div>

      {/* Latest scan */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <span>Latest scan</span>
          </h3>
          {isLead && live && (
            <button
              onClick={() => setShowPolicy((v) => !v)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-white/10 text-slate-300 hover:bg-white/5 flex items-center gap-1.5"
            >
              <Settings2 className="w-3.5 h-3.5" /> Gate settings
            </button>
          )}
        </div>
        {showPolicy && summary && projectId && (
          <PolicyForm
            projectId={projectId}
            policy={summary.policy}
            onSaved={() => {
              setShowPolicy(false);
              void refresh();
            }}
            onError={setWriteError}
          />
        )}
        {!last && live && summary && (
          <div className="text-xs text-slate-400">
            No scan has run yet. Press “Scan dependencies” to check this project’s repository, or open a pull request and it is scanned
            automatically.
          </div>
        )}
        {last && <ScanLine scan={last} personName={personName} />}
        {last?.status === 'failed' && last.error && (
          <div role="alert" className="text-xs text-rose-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {last.error} A failed scan never counts as a pass. Fix the problem and rescan.
            </span>
          </div>
        )}
        {scans.length > 1 && (
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer text-slate-300">Scan history ({scans.length})</summary>
            <div className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
              {scans.map((s) => (
                <div key={s.id} className="p-3">
                  <ScanLine scan={s} personName={personName} />
                </div>
              ))}
            </div>
          </details>
        )}
      </GlassCard>

      {/* Findings */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Bug className="w-4 h-4 text-rose-400" />
            <span>Findings</span>
            <span className="text-xs font-mono text-slate-500">{visible.length} shown</span>
          </h3>
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by severity"
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value as Severity | 'ALL')}
              className="text-xs px-3 py-2 bg-[#0a0c12] border border-white/10 rounded-xl text-slate-200"
            >
              <option value="ALL">All severities</option>
              {SEVERITIES.map((sv) => (
                <option key={sv} value={sv}>{sv}</option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="text-xs px-3 py-2 bg-[#0a0c12] border border-white/10 rounded-xl text-slate-200"
            >
              <option value="open">Needs work</option>
              <option value="all">Everything</option>
              <option value="verified_fixed">Verified fixed</option>
              <option value="waived">Waived</option>
            </select>
          </div>
        </div>

        <StationLoadState loading={findings.loading} error={findings.error} offline={findings.offline} onRetry={findings.reload} noun="security findings" />
        {!findings.loading && !findings.error && !findings.offline && visible.length === 0 && (
          <div className="text-xs text-slate-400 py-6 text-center">
            {findings.items.length === 0 ? 'No findings yet. Run a scan to check the dependencies.' : 'Nothing matches these filters.'}
          </div>
        )}

        {visible.length > 0 && (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
            {visible.map((f) => (
              <FindingRow
                key={f.id}
                f={f}
                people={people}
                isLead={isLead}
                assigneeName={personName(f.assigneeId)}
                fixOpen={openFix === f.id}
                fixBusy={fixBusy === f.id}
                onToggleFix={() => setOpenFix(openFix === f.id ? null : f.id)}
                onSuggest={() => void suggestFix(f)}
                onAssign={(id) => void assign(f, id)}
                onMove={(s) => void moveFinding(f, s)}
              />
            ))}
          </div>
        )}

        <div className="pt-2">
          <button onClick={() => setShowManual((v) => !v)} className="text-[11px] text-slate-400 hover:text-slate-200 underline">
            {showManual ? 'Hide' : 'Raise a finding by hand (pen test, code review, audit)'}
          </button>
          {showManual && projectId && live && (
            <ManualFinding
              projectId={projectId}
              onCreated={(c) => {
                findings.upsert(c);
                void refresh();
              }}
              onError={setWriteError}
            />
          )}
        </div>
      </GlassCard>
    </div>
  );
};

const ScanLine: React.FC<{ scan: SecurityScan; personName: (id: string | null | undefined) => string | undefined }> = ({ scan, personName }) => {
  const tone =
    scan.status === 'failed' ? 'text-rose-300' : scan.status === 'succeeded' ? (scan.gate === 'blocked' ? 'text-rose-300' : 'text-emerald-300') : 'text-amber-300';
  const label = scan.status === 'succeeded' ? (scan.gate === 'blocked' ? 'Gate blocked' : 'Gate passed') : scan.status === 'failed' ? 'Failed' : scan.status === 'queued' ? 'Queued' : 'Running';
  const by = personName(scan.startedBy);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
      <span className={`font-semibold ${tone}`}>{label}</span>
      <span>{TRIGGER_LABEL[scan.trigger]}</span>
      <span className="font-mono text-slate-400">{scan.ref ?? 'base branch'}</span>
      {scan.commitSha && <span className="font-mono text-slate-500">{scan.commitSha.slice(0, 7)}</span>}
      {scan.status === 'succeeded' && (
        <span className="text-slate-400">
          {scan.packagesAffected} package(s) affected · {scan.newFindings} new · {scan.resolvedFindings} fixed
        </span>
      )}
      {by && <span className="text-slate-500">by {by}</span>}
      <span className="text-slate-500">{when(scan.finishedAt || scan.createdAt)}</span>
      {scan.scannerVersion && <span className="text-slate-600">OSV-Scanner {scan.scannerVersion}</span>}
    </div>
  );
};

const FindingRow: React.FC<{
  f: ApiSecurityFinding;
  people: ProjectPerson[];
  isLead: boolean;
  assigneeName?: string;
  fixOpen: boolean;
  fixBusy: boolean;
  onToggleFix: () => void;
  onSuggest: () => void;
  onAssign: (userId: string) => void;
  onMove: (status: SecurityFinding['status']) => void;
}> = ({ f, people, isLead, assigneeName, fixOpen, fixBusy, onToggleFix, onSuggest, onAssign, onMove }) => {
  const isOpen = f.status === 'open' || f.status === 'in_remediation';
  const pkg = f.packageName ? `${f.packageName}${f.packageVersion ? `@${f.packageVersion}` : ''}` : f.affectedComponent;
  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className={`px-2 py-0.5 rounded border ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
            {f.cvssScore > 0 && <span className="text-slate-400">CVSS {f.cvssScore.toFixed(1)}</span>}
            {f.osvId && <span className="text-slate-400">{f.osvId}</span>}
            {!f.osvId && f.cveId && <span className="text-slate-400">{f.cveId}</span>}
            {f.cweCategory && <span className="text-slate-500">{f.cweCategory}</span>}
            <span className="text-slate-500">· {STATUS_LABEL[f.status]}</span>
            {f.slaDaysRemaining !== null && isOpen && (
              <span className={f.slaDaysRemaining < 0 ? 'text-rose-300' : 'text-slate-500'}>
                · SLA {f.slaDaysRemaining < 0 ? `${-f.slaDaysRemaining}d overdue` : `${f.slaDaysRemaining}d left`}
              </span>
            )}
            {f.ref && <span className="text-slate-500">· {f.ref}</span>}
          </div>
          <div className="text-sm font-semibold text-white break-words">{f.title}</div>
          <div className="text-xs text-slate-300">
            <span className="font-mono">{pkg}</span>
            {f.manifestPath && <span className="text-slate-500"> in {f.manifestPath}</span>}
          </div>
          {f.fixedVersion && isOpen && (
            <div className="text-xs text-emerald-300">
              Fix: upgrade to <span className="font-mono">{f.fixedVersion}</span> or later
            </div>
          )}
          {!f.fixedVersion && isOpen && f.remediationAdvice && <div className="text-xs text-slate-400">{f.remediationAdvice}</div>}
          {f.statusReason && <div className="text-xs text-slate-400">Reason: {f.statusReason}</div>}
          {f.source === 'osv' && f.references && f.references.length > 0 && (
            <a href={f.references[0]} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline">
              Advisory
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isOpen && (
            <>
              <select
                aria-label={`Assign ${f.title}`}
                value={f.assigneeId ?? ''}
                onChange={(e) => onAssign(e.target.value)}
                className="text-[11px] px-2 py-1.5 bg-[#0a0c12] border border-white/10 rounded-lg text-slate-200 max-w-[10rem]"
              >
                <option value="">{assigneeName ? 'Unassign' : 'Assign to…'}</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={f.aiFix ? onToggleFix : onSuggest}
                disabled={fixBusy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 flex items-center gap-1 disabled:opacity-50"
              >
                {fixBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {f.aiFix ? (fixOpen ? 'Hide fix' : 'Show fix') : 'Suggest fix'}
              </button>
              {f.source !== 'osv' && (
                <button onClick={() => onMove('verified_fixed')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Verified fixed
                </button>
              )}
              {isLead && (
                <button onClick={() => onMove('waived')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-white/10 text-slate-300 hover:bg-white/5">
                  Waive…
                </button>
              )}
            </>
          )}
          {!isOpen && (
            <button onClick={() => onMove('open')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-white/10 text-slate-300 hover:bg-white/5">
              Reopen
            </button>
          )}
        </div>
      </div>
      {assigneeName && isOpen && <div className="text-[11px] text-slate-400">Assigned to {assigneeName}. A board issue tracks the fix.</div>}
      {fixOpen && f.aiFix && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-violet-300">{f.aiFix.label}</span>
            {f.aiFix.model && <span className="text-slate-500">{f.aiFix.model}</span>}
          </div>
          {f.aiFix.note && <div className="text-[11px] text-amber-300">{f.aiFix.note}</div>}
          <pre className="whitespace-pre-wrap text-xs text-slate-200 font-sans leading-relaxed">{f.aiFix.markdown}</pre>
          <div className="text-[11px] text-slate-500">After upgrading, press Rescan. The finding closes itself when the scanner no longer reports it.</div>
          <button onClick={onSuggest} disabled={fixBusy} className="text-[11px] text-slate-400 hover:text-slate-200 underline">
            Ask again
          </button>
        </div>
      )}
    </div>
  );
};

const PolicyForm: React.FC<{
  projectId: string;
  policy: SecuritySummary['policy'];
  onSaved: () => void;
  onError: (message: string | null) => void;
}> = ({ projectId, policy, onSaved, onError }) => {
  const [block, setBlock] = useState<Severity[]>(policy.blockSeverities);
  const [requireScan, setRequireScan] = useState(policy.requireScan);
  const [autoScan, setAutoScan] = useState(policy.autoScan);
  const [saving, setSaving] = useState(false);

  const toggle = (sv: Severity) => setBlock((b) => (b.includes(sv) ? b.filter((x) => x !== sv) : [...b, sv]));

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await stationsApi.setSecurityPolicy(projectId, { block_severities: block, require_scan: requireScan, auto_scan: autoScan });
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 p-4 space-y-3 text-xs text-slate-300">
      <div className="space-y-1.5">
        <div className="font-semibold text-slate-200">Severities that close the gate</div>
        <div className="flex flex-wrap gap-3">
          {SEVERITIES.map((sv) => (
            <label key={sv} className="flex items-center gap-1.5">
              <input type="checkbox" checked={block.includes(sv)} disabled={sv === 'CRITICAL'} onChange={() => toggle(sv)} />
              <span>{sv}</span>
            </label>
          ))}
        </div>
        <div className="text-[11px] text-slate-500">Critical findings always block.</div>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={requireScan} onChange={(e) => setRequireScan(e.target.checked)} />
        <span>Require a completed scan before QA sign-off and merge (an unscanned or failed-scan project stays blocked)</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
        <span>Scan every pull request automatically, and the base branch after each merge</span>
      </label>
      <button
        onClick={() => void save()}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
      >
        {saving ? 'Saving…' : 'Save gate settings'}
      </button>
    </div>
  );
};

const ManualFinding: React.FC<{
  projectId: string;
  onCreated: (f: ApiSecurityFinding) => void;
  onError: (message: string | null) => void;
}> = ({ projectId, onCreated, onError }) => {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [cwe, setCwe] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    onError(null);
    try {
      onCreated(await stationsApi.createFinding(projectId, { title: title.trim(), severity, cwe_category: cwe.trim() }));
      setTitle('');
      setCwe('');
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 mt-3">
      <input
        type="text"
        placeholder="Finding title (e.g. SQL injection in search endpoint)…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="flex-1 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500"
      />
      <input
        type="text"
        placeholder="CWE (e.g. CWE-89)"
        value={cwe}
        onChange={(e) => setCwe(e.target.value)}
        className="sm:w-36 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500"
      />
      <select
        aria-label="Severity"
        value={severity}
        onChange={(e) => setSeverity(e.target.value as Severity)}
        className="text-xs px-3 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl text-slate-200"
      >
        {SEVERITIES.map((sv) => (
          <option key={sv} value={sv}>{sv}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!title.trim() || saving}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0"
      >
        {saving ? 'Raising…' : '+ Raise finding'}
      </button>
    </form>
  );
};
