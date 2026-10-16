/**
 * PRReviewPanel — Full-fledged Karkhana PR review UI
 *
 * Features:
 *   • Lists all PRs for the selected project (polling every 5 s)
 *   • Per-PR: CI check-run status (live from GitHub), test results, diff stats
 *   • AI review findings with inline severity badges — triage per comment
 *   • GitHub OAuth device-flow launcher when no token is present
 *   • Trigger CI check-run on GitHub
 *   • Approve / Request Changes / Merge controls
 *   • "Add PR" creates a new PR via the backend (for repos we own)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest,
  GitMerge,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Play,
  Loader2,
  ChevronDown,
  ChevronRight,
  Bot,
  Smartphone,
  Lock,
  Plus,
  Minus,
  FileCode2,
  Terminal,
  Info,
} from 'lucide-react';
import { PRDiffViewer } from './PRDiffViewer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrRow {
  id: string;
  number: number;
  url: string;
  branch: string;
  status: 'open' | 'merged' | 'closed' | 'draft';
  tests_passed: boolean;
  reviewed: boolean;
  review_engine: string | null;
  review_model: string | null;
  review_summary: string | null;
  open_comments: number;
  total_comments: number;
  task_id: string;
  task_key: string;
  task_title: string;
  project_id: string;
  project_name: string;
}

interface PrComment {
  id: string;
  path: string;
  line: number | null;
  severity: 'high' | 'medium' | 'low';
  body: string;
  triage: 'open' | 'valid' | 'dismissed';
  triage_reason: string | null;
}

interface PrDetail {
  id: string;
  task_id: string;
  number: number;
  url: string;
  branch: string;
  status: string;
  tests_passed: boolean;
  reviewed_at: string | null;
  review_engine: string | null;
  review_model: string | null;
  review_summary: string | null;
  comments: PrComment[];
  can_merge: boolean;
  merge_blockers: string[];
}

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

interface GHStatus {
  pr_number: number;
  pr_url: string;
  head_sha: string;
  ci_status: string;
  ci_description: string;
  check_runs: CheckRun[];
  tests_passed: boolean;
  reviewed: boolean;
  review_engine: string | null;
  open_comments: number;
  can_merge: boolean;
}

interface DeviceFlow {
  user_code: string;
  verification_uri: string;
  device_code: string;
  expires_in: number;
  interval: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ciColor(status: string): string {
  if (status === 'success') return 'var(--accent)';
  if (status === 'failure' || status === 'error') return 'var(--error)';
  return 'var(--warn)';
}

function ciLabel(status: string): string {
  if (status === 'success') return 'CI passed';
  if (status === 'failure') return 'CI failed';
  if (status === 'pending') return 'CI pending';
  return status;
}

function severityColor(s: string) {
  return s === 'high' ? 'var(--error)' : s === 'medium' ? 'var(--warn)' : 'var(--info)';
}

function triageStyle(t: string) {
  if (t === 'valid') return { color: 'var(--accent)', background: 'var(--accent-dim)' };
  if (t === 'dismissed') return { color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)' };
  return { color: 'var(--warn)', background: 'rgba(240,165,0,.12)' };
}

// ── Sub-component: DeviceFlow modal ──────────────────────────────────────────

function DeviceFlowModal({
  token,
  onGranted,
  onDismiss,
}: {
  token: string;
  onGranted: () => void;
  onDismiss: () => void;
}) {
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/github/auth/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data: DeviceFlow = await res.json();
      setFlow(data);
      setPolling(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    if (!polling || !flow) return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, (flow.interval + 1) * 1000));
        try {
          const res = await fetch(
            `/api/github/auth/poll?device_code=${encodeURIComponent(flow.device_code)}`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await res.json();
          // The token is stored encrypted server-side and never sent back.
          if (data.status === 'granted') {
            stopped = true;
            setPolling(false);
            onGranted();
            return;
          }
          if (data.status === 'error') {
            stopped = true;
            setPolling(false);
            setError(data.error || 'OAuth error');
          }
        } catch (e: any) {
          stopped = true;
          setPolling(false);
          setError(e.message);
        }
      }
    };
    poll();
    return () => { stopped = true; };
  }, [polling, flow, token, onGranted]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
      backdropFilter: 'blur(6px)',
    }}>
      <div className="card-elevated animate-fade-in" style={{
        maxWidth: 440, width: '100%', padding: 28, borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Lock size={18} style={{ color: 'var(--accent)' }} />
          <h2 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600 }}>
            Authenticate with GitHub
          </h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          No GitHub token found. Use the OAuth Device Flow to grant Karkhana access to your repositories.
        </p>

        {!flow ? (
          <button
            onClick={start}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <Smartphone size={14} />
            Start Device Flow
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
              padding: '16px', textAlign: 'center',
            }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                ENTER THIS CODE AT
              </p>
              <a
                href={flow.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: 12, display: 'block', marginBottom: 12 }}
              >
                {flow.verification_uri}
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(flow.user_code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700,
                  color: 'var(--text-primary)', letterSpacing: '0.15em',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                {flow.user_code}
              </button>
              {copied && <p style={{ color: 'var(--accent)', fontSize: 11, marginTop: 4 }}>Copied!</p>}
            </div>
            {polling && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Waiting for authorization…
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,77,79,.1)', borderRadius: 6, color: 'var(--error)', fontSize: 12 }}>
            {error}
          </div>
        )}

        <button
          onClick={onDismiss}
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Sub-component: Comment card ───────────────────────────────────────────────

function CommentCard({
  comment,
  token,
  onTriaged,
}: {
  comment: PrComment;
  token: string;
  onTriaged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);

  const triage = async (verdict: 'valid' | 'dismissed') => {
    if (verdict === 'dismissed' && !dismissReason.trim()) { setShowDismiss(true); return; }
    setLoading(true);
    try {
      await fetch(`/api/comments/${comment.id}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ triage: verdict, reason: dismissReason || null }),
      });
      onTriaged();
    } finally {
      setLoading(false);
      setShowDismiss(false);
      setDismissReason('');
    }
  };

  return (
    <div style={{
      borderLeft: `3px solid ${severityColor(comment.severity)}`,
      paddingLeft: 14, paddingTop: 10, paddingBottom: 10,
      marginBottom: 10,
      background: comment.triage !== 'open' ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.04)',
      borderRadius: '0 var(--radius-md) var(--radius-md) 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
              color: severityColor(comment.severity), textTransform: 'uppercase',
            }}>
              {comment.severity}
            </span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {comment.path}{comment.line ? `:${comment.line}` : ''}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20,
              textTransform: 'uppercase',
              ...triageStyle(comment.triage),
            }}>
              {comment.triage}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
            {comment.body}
          </p>
          {comment.triage_reason && (
            <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6 }}>
              Reason: {comment.triage_reason}
            </p>
          )}
        </div>

        {comment.triage === 'open' && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => triage('valid')}
              disabled={loading}
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={12} />}
              Valid
            </button>
            <button
              onClick={() => setShowDismiss((v) => !v)}
              disabled={loading}
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              <XCircle size={12} />
              Dismiss
            </button>
          </div>
        )}
      </div>

      {showDismiss && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Reason for dismissing…"
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            style={{ flex: 1, fontSize: 12 }}
          />
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11 }}
            onClick={() => triage('dismissed')}
          >
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface PRReviewPanelProps {
  projectId: string;
  token: string;
}

export const PRReviewPanel: React.FC<PRReviewPanelProps> = ({ projectId, token }) => {
  const [prs, setPrs] = useState<PrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrId, setSelectedPrId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [ghStatus, setGhStatus] = useState<GHStatus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeviceFlow, setShowDeviceFlow] = useState(false);
  const [ghConnected, setGhConnected] = useState(false);
  const [showAddPR, setShowAddPR] = useState(false);
  const [newPrBranch, setNewPrBranch] = useState('');
  const [newPrTitle, setNewPrTitle] = useState('');

  const authHeaders = (extra?: Record<string, string>) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra,
  });

  // ── Fetch PR list ──────────────────────────────────────────────────────────

  const fetchPrs = useCallback(async () => {
    try {
      const res = await fetch(`/api/prs?project_id=${projectId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: PrRow[] = await res.json();
      setPrs(data);
      if (!selectedPrId && data.length > 0) setSelectedPrId(data[0].id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, token, ghConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/github/auth/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setGhConnected(Boolean(d.connected || d.server_token)); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    fetchPrs();
    const t = setInterval(fetchPrs, 5000);
    return () => clearInterval(t);
  }, [fetchPrs]);

  // ── Fetch PR detail + live GH status when selection changes ───────────────

  useEffect(() => {
    if (!selectedPrId) return;
    setDetailLoading(true);
    Promise.all([
      fetch(`/api/tasks/${prs.find((p) => p.id === selectedPrId)?.task_id}/pr`, {
        headers: authHeaders(),
      }).then((r) => r.ok ? r.json() : null),
      fetch(`/api/github/prs/${selectedPrId}/status`, {
        headers: authHeaders(),
      }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([d, g]) => {
        setDetail(d);
        setGhStatus(g);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedPrId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────

  const rerunReview = async (prId: string) => {
    setActionLoading('review');
    setError(null);
    try {
      const res = await fetch(`/api/prs/${prId}/review`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json();
        const msg = body.detail || 'Review failed';
        if (msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('token')) {
          setShowDeviceFlow(true);
        } else {
          setError(msg);
        }
        return;
      }
      const updated: PrDetail = await res.json();
      setDetail(updated);
      await fetchPrs();
    } finally {
      setActionLoading(null);
    }
  };

  const triggerCI = async (prId: string) => {
    setActionLoading('ci');
    setError(null);
    try {
      const res = await fetch(`/api/github/prs/${prId}/ci`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json();
        const msg = body.detail || 'CI trigger failed';
        if (msg.toLowerCase().includes('not configured')) setShowDeviceFlow(true);
        else setError(msg);
        return;
      }
      const g = await fetch(`/api/github/prs/${prId}/status`, { headers: authHeaders() });
      if (g.ok) setGhStatus(await g.json());
    } finally {
      setActionLoading(null);
    }
  };

  const mergePR = async (prId: string) => {
    setActionLoading('merge');
    setError(null);
    try {
      const res = await fetch(`/api/prs/${prId}/merge`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.detail || 'Merge failed');
        return;
      }
      await fetchPrs();
      setDetail(null);
      setGhStatus(null);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedPr = prs.find((p) => p.id === selectedPrId);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: 20, minHeight: 500 }}>
      {/* Device flow modal */}
      {showDeviceFlow && (
        <DeviceFlowModal
          token={token}
          onGranted={() => { setGhConnected(true); setShowDeviceFlow(false); }}
          onDismiss={() => setShowDeviceFlow(false)}
        />
      )}

      {/* PR list sidebar */}
      <div style={{
        width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
            letterSpacing: '.06em', textTransform: 'uppercase',
          }}>
            Pull Requests
          </h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => fetchPrs()}
              className="btn btn-ghost"
              style={{ padding: '3px 7px', fontSize: 11 }}
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => setShowAddPR((v) => !v)}
              className="btn btn-ghost"
              style={{ padding: '3px 7px', fontSize: 11 }}
              title="Add PR manually"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        {/* Add PR quick-form */}
        {showAddPR && (
          <div className="card-elevated animate-fade-in" style={{ padding: 12, marginBottom: 4 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              PRs are opened automatically by agent runs. To link an existing branch:
            </p>
            <input
              className="input"
              placeholder="Branch name…"
              value={newPrBranch}
              onChange={(e) => setNewPrBranch(e.target.value)}
              style={{ fontSize: 11, marginBottom: 6 }}
            />
            <input
              className="input"
              placeholder="PR title…"
              value={newPrTitle}
              onChange={(e) => setNewPrTitle(e.target.value)}
              style={{ fontSize: 11, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, fontSize: 11, justifyContent: 'center' }}
                disabled={!newPrBranch.trim() || !newPrTitle.trim()}
                onClick={() => {
                  // Trigger a run that will create the PR — for now just show info
                  setError('To open a PR, assign a task to the agent from the Board tab. The agent pushes a branch and opens the PR automatically.');
                  setShowAddPR(false);
                }}
              >
                <GitPullRequest size={12} />
                Open PR
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setShowAddPR(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Authenticate button when no GH config */}
        {!ghConnected && (
          <button
            onClick={() => setShowDeviceFlow(true)}
            className="btn btn-ghost"
            style={{ fontSize: 11, justifyContent: 'flex-start', gap: 8, marginBottom: 4 }}
          >
            <Lock size={12} style={{ color: 'var(--accent)' }} />
            Connect GitHub
          </button>
        )}

        {/* PR rows */}
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : prs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            No pull requests yet. Assign a task to the agent to create one.
          </div>
        ) : (
          prs.map((pr) => {
            const isSelected = pr.id === selectedPrId;
            const statusColor =
              pr.status === 'merged' ? 'var(--purple)' :
              pr.status === 'open' ? (pr.tests_passed ? 'var(--accent)' : 'var(--warn)') :
              'var(--text-muted)';

            return (
              <button
                key={pr.id}
                onClick={() => setSelectedPrId(pr.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${isSelected ? 'var(--border-default)' : 'transparent'}`,
                  cursor: 'pointer', transition: 'all .15s',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: statusColor }}>
                    #{pr.number} · {pr.status}
                  </span>
                  {pr.status === 'open' && pr.open_comments > 0 && (
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: 'rgba(240,165,0,.15)', color: 'var(--warn)', fontWeight: 600,
                    }}>
                      {pr.open_comments} to triage
                    </span>
                  )}
                </div>
                <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 500, lineHeight: 1.3 }}>
                  {pr.task_key}: {pr.task_title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <GitBranch size={10} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                    {pr.branch.replace('karkhana/', '')}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--border-subtle)', flexShrink: 0 }} />

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedPr ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 20 }}>
            Select a pull request from the list.
          </div>
        ) : detailLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Loading…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Header */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <GitPullRequest size={18} style={{ color: selectedPr.status === 'merged' ? 'var(--purple)' : 'var(--accent)' }} />
                <h2 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600 }}>
                  PR #{selectedPr.number} · {selectedPr.task_key}: {selectedPr.task_title}
                </h2>
                {selectedPr.url && !selectedPr.url.startsWith('local://') && (
                  <a href={selectedPr.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  <GitBranch size={11} style={{ display: 'inline', marginRight: 4 }} />
                  {selectedPr.branch}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600,
                  color: selectedPr.tests_passed ? 'var(--accent)' : 'var(--error)',
                  background: selectedPr.tests_passed ? 'var(--accent-dim)' : 'rgba(255,77,79,.12)',
                  padding: '2px 8px', borderRadius: 20,
                }}>
                  {selectedPr.tests_passed ? '✓ Tests passed' : '✗ Tests failed'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600,
                  color: 'var(--text-muted)', background: 'rgba(255,255,255,.05)',
                  padding: '2px 8px', borderRadius: 20,
                }}>
                  {selectedPr.status}
                </span>
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div style={{
                padding: '10px 14px', background: 'rgba(255,77,79,.08)',
                border: '1px solid rgba(255,77,79,.25)', borderRadius: 'var(--radius-md)',
                color: 'var(--error)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
                <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)' }}>✕</button>
              </div>
            )}

            {/* CI / Check-runs */}
            {ghStatus && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    CI Status
                  </h3>
                  <button
                    onClick={() => triggerCI(selectedPrId!)}
                    disabled={actionLoading === 'ci'}
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '3px 10px' }}
                  >
                    {actionLoading === 'ci'
                      ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      : <Play size={12} />
                    }
                    Trigger CI
                  </button>
                </div>

                {/* Combined status pill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 20,
                    color: ciColor(ghStatus.ci_status),
                    background: `${ciColor(ghStatus.ci_status)}18`,
                  }}>
                    {ciLabel(ghStatus.ci_status)}
                  </span>
                  {ghStatus.ci_description && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{ghStatus.ci_description}</span>
                  )}
                </div>

                {/* Check runs list */}
                {ghStatus.check_runs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ghStatus.check_runs.map((cr) => {
                      const color = cr.conclusion === 'success' ? 'var(--accent)'
                        : cr.conclusion === 'failure' ? 'var(--error)'
                        : 'var(--warn)';
                      return (
                        <div key={cr.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 10px', background: 'var(--bg-elevated)',
                          borderRadius: 'var(--radius-sm)', fontSize: 12,
                        }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: cr.status === 'in_progress' ? 'var(--warn)' : color,
                            animation: cr.status === 'in_progress' ? 'pulse 1.5s ease-in-out infinite' : 'none',
                          }} />
                          <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{cr.name}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color }}>
                            {cr.conclusion || cr.status}
                          </span>
                          {cr.html_url && (
                            <a href={cr.html_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* AI Review */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bot size={15} style={{ color: 'var(--accent)' }} />
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Karkhana AI Review
                  </h3>
                  {detail?.review_engine && (
                    <span className="tag tag-accent" style={{ fontSize: 10 }}>{detail.review_engine}</span>
                  )}
                  {detail?.review_model && (
                    <span className="tag" style={{ fontSize: 10 }}>{detail.review_model}</span>
                  )}
                </div>
                <button
                  onClick={() => rerunReview(selectedPrId!)}
                  disabled={actionLoading === 'review'}
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '3px 10px' }}
                >
                  {actionLoading === 'review'
                    ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : <RefreshCw size={12} />
                  }
                  Re-run Review
                </button>
              </div>

              {detail?.review_summary && (
                <div style={{
                  padding: '10px 14px', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', marginBottom: 14,
                  color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55,
                }}>
                  {detail.review_summary}
                </div>
              )}

              {!detail?.reviewed_at ? (
                <div style={{ color: 'var(--warn)', fontSize: 12 }}>
                  <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6 }} />
                  No AI review yet. Click "Re-run Review" to generate one.
                </div>
              ) : detail.comments.length === 0 ? (
                <div style={{ color: 'var(--accent)', fontSize: 12 }}>
                  <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 6 }} />
                  Clean review — no findings.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    {(['high', 'medium', 'low'] as const).map((sev) => {
                      const cnt = detail.comments.filter((c) => c.severity === sev).length;
                      if (!cnt) return null;
                      return (
                        <span key={sev} style={{
                          fontSize: 11, padding: '2px 9px', borderRadius: 20,
                          fontWeight: 600, color: severityColor(sev),
                          background: `${severityColor(sev)}18`,
                        }}>
                          {cnt} {sev}
                        </span>
                      );
                    })}
                    <span style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600,
                      color: 'var(--warn)', background: 'rgba(240,165,0,.12)',
                    }}>
                      {detail.comments.filter((c) => c.triage === 'open').length} open
                    </span>
                  </div>

                  {detail.comments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      token={token}
                      onTriaged={() => {
                        // Refresh detail
                        if (selectedPrId) {
                          fetch(`/api/tasks/${selectedPr?.task_id}/pr`, { headers: authHeaders() })
                            .then((r) => r.ok ? r.json() : null)
                            .then((d) => d && setDetail(d));
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Files changed, with the AI review's comments as inline threads */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <FileCode2 size={15} style={{ color: 'var(--accent)' }} />
                <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Files changed
                </h3>
              </div>
              <PRDiffViewer
                prId={selectedPrId!}
                token={token}
                reloadKey={(detail?.comments ?? []).map((c) => `${c.id}:${c.triage}`).join(',')}
                renderComment={(c) => (
                  <CommentCard
                    comment={c}
                    token={token}
                    onTriaged={() => {
                      fetch(`/api/tasks/${selectedPr?.task_id}/pr`, { headers: authHeaders() })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((d) => d && setDetail(d));
                    }}
                  />
                )}
              />
            </div>

            {/* Merge blockers + merge button */}
            {detail && selectedPr.status === 'open' && (
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
                  Merge Readiness
                </h3>

                {detail.merge_blockers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {detail.merge_blockers.map((b, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn)', fontSize: 12 }}>
                        <AlertTriangle size={12} />
                        {b}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldCheck size={14} />
                    All checks passed — ready to merge.
                  </div>
                )}

                <button
                  onClick={() => mergePR(selectedPrId!)}
                  disabled={!detail.can_merge || actionLoading === 'merge'}
                  className="btn btn-primary"
                  style={{ opacity: detail.can_merge ? 1 : 0.45 }}
                >
                  {actionLoading === 'merge'
                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    : <GitMerge size={14} />
                  }
                  Merge Pull Request
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PRReviewPanel;
