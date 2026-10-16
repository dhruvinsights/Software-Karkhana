/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * IdeaApprovalPanel: the idea -> approval -> project journey in one place.
 *
 *  1. Request approval: pick reviewers from the workspace.
 *  2. Reviewers approve / reject (all must approve; one rejection stops it).
 *  3. Once approved, a manager creates the project and names the station leads.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock, Send, Rocket, Loader2 } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { Idea } from '../../types/factory';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ApprovalRow {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerEmail: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  note: string | null;
}

interface ApprovalView {
  status: string;
  projectId: string | null;
  approvals: ApprovalRow[];
  approvedCount: number;
  totalReviewers: number;
}

// Roles that can be named as station leads when creating the project.
const LEAD_ROLES = ['designer', 'architect', 'developer', 'qa', 'devops', 'security', 'release_manager'];

interface Props {
  idea: Idea;
  token: string;
  workspaceId: string;
  currentUserId: string;
}

const box: React.CSSProperties = {
  border: '1px solid var(--border, rgba(255,255,255,.1))',
  borderRadius: 12,
  padding: 14,
  marginTop: 12,
};

export const IdeaApprovalPanel: React.FC<Props> = ({ idea, token, workspaceId, currentUserId }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<ApprovalView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState(`${idea.title} Service`);
  const [leads, setLeads] = useState<Record<string, string>>({}); // role -> userId
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = typeof j.detail === 'string' ? j.detail : msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      return res.json();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  const load = useCallback(async () => {
    try {
      setView(await call(`/api/ideas/${idea.id}/approvals`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [call, idea.id]);

  useEffect(() => {
    void load();
  }, [load, idea.status]);

  useEffect(() => {
    call(`/api/workspaces/${workspaceId}/members`)
      .then((m: Member[]) => setMembers(m))
      .catch(() => setMembers([]));
  }, [call, workspaceId]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await factoryStore.syncSessionFromServer();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mine = view?.approvals.find((a) => a.reviewerId === currentUserId);
  const status = view?.status ?? idea.status;
  const others = members.filter((m) => m.id !== currentUserId);

  const requestApproval = () =>
    act(() =>
      call(`/api/ideas/${idea.id}/request-approval`, {
        method: 'POST',
        body: JSON.stringify({ reviewer_ids: picked, note }),
      }),
    ).then(() => setPicked([]));

  const decide = (decision: 'approve' | 'reject') =>
    act(() =>
      call(`/api/ideas/${idea.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reason || null }),
      }),
    );

  const promote = async () => {
    setBusy(true);
    setError(null);
    const res = await factoryStore.promoteIdeaToProject(
      idea.id,
      name,
      Object.entries(leads)
        .filter(([, userId]) => userId)
        .map(([role, userId]) => ({ user_id: userId, role, is_lead: true })),
    );
    if (!res.ok) setError(res.error ?? 'Could not create the project.');
    await load();
    setBusy(false);
  };

  const icon = (s: ApprovalRow['status']) =>
    s === 'approved' ? <CheckCircle2 size={14} color="#2ea043" /> : s === 'rejected' ? <XCircle size={14} color="#f85149" /> : <Clock size={14} color="#f0a500" />;

  return (
    <div style={box}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Approval</div>

      {error && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {view && view.approvals.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
            {view.approvedCount}/{view.totalReviewers} approved
          </div>
          {view.approvals.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
              {icon(a.status)}
              <span>{a.reviewerName}</span>
              <span style={{ opacity: 0.6 }}>{a.status}</span>
              {a.reason && <span style={{ opacity: 0.6 }}>— {a.reason}</span>}
            </div>
          ))}
        </div>
      )}

      {mine?.status === 'pending' && status === 'pending_approval' && (
        <div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required if rejecting)"
            style={{ width: '100%', padding: 8, fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={() => decide('approve')} className="btn btn-primary" style={{ fontSize: 12 }}>
              Approve
            </button>
            <button disabled={busy || !reason.trim()} onClick={() => decide('reject')} className="btn btn-ghost" style={{ fontSize: 12 }}>
              Reject
            </button>
          </div>
        </div>
      )}

      {(status === 'draft' || status === 'evaluating' || status === 'needs_evidence' || status === 'rejected') && (
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
            {status === 'rejected' ? 'Rejected. Revise the idea and request approval again.' : 'Choose who must approve this idea.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {others.length === 0 && <span style={{ fontSize: 12, opacity: 0.6 }}>No other workspace members yet.</span>}
            {others.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                    border: '1px solid var(--border, rgba(255,255,255,.2))',
                    background: on ? 'rgba(7,91,255,.25)' : 'transparent', color: 'inherit',
                  }}
                >
                  {m.name || m.email} · {m.role}
                </button>
              );
            })}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for reviewers (optional)"
            style={{ width: '100%', padding: 8, fontSize: 12, marginBottom: 8 }}
          />
          <button disabled={busy || picked.length === 0} onClick={requestApproval} className="btn btn-primary" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            {busy ? <Loader2 size={13} /> : <Send size={13} />} Request approval
          </button>
        </div>
      )}

      {status === 'approved' && (
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Approved. Create the project and name the leads of each station.</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', padding: 8, fontSize: 12, marginBottom: 8 }}
          />
          {LEAD_ROLES.map((role) => (
            <div key={role} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
              <span style={{ width: 110 }}>{role.replace('_', ' ')} lead</span>
              <select
                value={leads[role] ?? ''}
                onChange={(e) => setLeads((l) => ({ ...l, [role]: e.target.value }))}
                style={{ flex: 1, padding: 4, fontSize: 12 }}
              >
                <option value="">— none yet —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button disabled={busy || name.trim().length < 2} onClick={promote} className="btn btn-primary" style={{ marginTop: 8, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            {busy ? <Loader2 size={13} /> : <Rocket size={13} />} Create project
          </button>
        </div>
      )}

      {status === 'promoted' && view?.projectId && (
        <button
          onClick={() => {
            factoryStore.selectProject?.(view.projectId as string);
            factoryStore.setScreen('projects');
          }}
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
        >
          Open project
        </button>
      )}
    </div>
  );
};
