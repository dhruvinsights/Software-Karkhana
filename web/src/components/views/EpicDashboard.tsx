/**
 * EpicDashboard — project-level epic overview.
 *
 * Shows all epics with their child stories, assignees and progress.
 * Stories are editable in-place; a content change (title/description/criteria)
 * requires a mandatory edit comment from the editor.
 * Every edit shows "last edited by X · time ago" inline.
 *
 * Sits at the top of any project view and can be opened standalone via the
 * 'epics' / 'epic_detail' screen.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  UserCircle2,
  Clock,
  Layers,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { Issue } from '../../types/factory';
import { friendlyStatus } from '../../lib/friendlyErrors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EpicRow {
  id: string;
  title: string;
  description: string;
  position: number;
  stories: IssueDetail[];
}

interface IssueDetail extends Issue {
  lastEditedByName?: string | null;
  lastEditedAt?: string | null;
  editComment?: string;
  acceptanceCriteria: string[];
}

interface Member {
  userId: string;
  name: string;
  email: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ff4d4f',
  P1: '#f0a500',
  P2: '#3b9eff',
  P3: '#4e5668',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  backlog: 'Backlog',
  draft: 'Draft',
};

// ── Edit-comment modal ────────────────────────────────────────────────────────

const EditCommentModal: React.FC<{
  fieldLabel: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}> = ({ fieldLabel, onConfirm, onCancel }) => {
  const [comment, setComment] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 60, backdropFilter: 'blur(4px)',
    }}>
      <div className="card-elevated animate-fade-in" style={{
        maxWidth: 440, width: '100%', padding: 24, borderRadius: 'var(--radius-lg)',
      }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Why are you changing <span style={{ color: 'var(--accent)' }}>{fieldLabel}</span>?
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          Content edits are visible to the whole team. A short reason keeps the change traceable.
          <br />Experienced contributors own this field — your note explains the intent.
        </p>
        <textarea
          ref={ref}
          className="input"
          rows={3}
          placeholder="e.g. Clarified scope after arch review on 14 Jun"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            disabled={!comment.trim()}
            onClick={() => onConfirm(comment.trim())}
          >
            Save change
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Inline editable field ─────────────────────────────────────────────────────

const InlineEdit: React.FC<{
  value: string;
  fieldLabel: string;
  multiline?: boolean;
  onSave: (next: string, comment: string) => Promise<string | null>;
}> = ({ value, fieldLabel, multiline, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [awaitingComment, setAwaitingComment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const startEdit = () => { setDraft(value); setEditing(true); setError(null); };
  const cancel = () => { setEditing(false); setAwaitingComment(false); };

  const tryCommit = () => {
    if (draft.trim() === value.trim()) { cancel(); return; }
    setAwaitingComment(true);
  };

  const commit = async (comment: string) => {
    setAwaitingComment(false);
    setSaving(true);
    const err = await onSave(draft.trim(), comment);
    setSaving(false);
    if (err) { setError(err); } else { setEditing(false); }
  };

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 4, cursor: 'text' }}
        onDoubleClick={startEdit}
        title="Double-click to edit"
      >
        <span>{value || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}</span>
        <button
          onClick={startEdit}
          style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
          title={`Edit ${fieldLabel}`}
        >
          <Pencil size={11} />
        </button>
      </span>
    );
  }

  return (
    <>
      <span style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            className="input"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ fontSize: 'inherit', resize: 'vertical', minWidth: 240 }}
            onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ fontSize: 'inherit', minWidth: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') tryCommit(); if (e.key === 'Escape') cancel(); }}
          />
        )}
        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={tryCommit} disabled={saving}>
          {saving ? '…' : <Check size={12} />}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={cancel}>
          <X size={12} />
        </button>
      </span>
      {error && <p style={{ color: 'var(--error)', fontSize: 11, marginTop: 4 }}>{error}</p>}
      {awaitingComment && (
        <EditCommentModal fieldLabel={fieldLabel} onConfirm={commit} onCancel={cancel} />
      )}
    </>
  );
};

// ── Assignee picker ───────────────────────────────────────────────────────────

const AssigneePicker: React.FC<{
  current: { id: string; name: string } | null;
  members: Member[];
  onAssign: (userId: string | null) => void;
}> = ({ current, members, onAssign }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          color: current ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 11, padding: '2px 4px', borderRadius: 4,
        }}
        title="Assign"
      >
        <UserCircle2 size={13} />
        {current ? current.name : 'Unassigned'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 20,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 8, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          overflow: 'hidden',
        }}>
          <button
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            onClick={() => { onAssign(null); setOpen(false); }}
          >
            Unassign
          </button>
          {members.map((m) => (
            <button
              key={m.userId}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 11,
                background: m.userId === current?.id ? 'var(--accent-dim)' : 'none',
                border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
              }}
              onClick={() => { onAssign(m.userId); setOpen(false); }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Story row ─────────────────────────────────────────────────────────────────

const StoryRow: React.FC<{
  story: IssueDetail;
  members: Member[];
  token: string;
  onRefresh: () => void;
}> = ({ story, members, token, onRefresh }) => {
  const [expanded, setExpanded] = useState(false);

  const patch = async (body: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch(`/api/issues/${story.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return typeof json.detail === 'string' ? json.detail : friendlyStatus(res.status);
      onRefresh();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const editField = (field: string) => async (value: string, comment: string) =>
    patch({ [field]: value, edit_comment: comment });

  const assignStory = (userId: string | null) =>
    patch({ assignee_id: userId }).then(() => {});

  const currentAssignee = story.assigneeId
    ? { id: story.assigneeId, name: story.assigneeName ?? story.assigneeId }
    : null;

  return (
    <li style={{
      borderBottom: '1px solid var(--border-subtle)',
      padding: '10px 0',
    }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button
          onClick={() => setExpanded((o) => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 0', flexShrink: 0 }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {story.key ?? story.id.slice(0, 8)}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
              <InlineEdit value={story.title} fieldLabel="title" onSave={editField('title')} />
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
            {/* Priority chip */}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: PRIORITY_COLOR[story.priority] ?? 'var(--text-muted)' }}>
              {story.priority}
            </span>
            {/* Status chip */}
            <span style={{ fontSize: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 6px', color: 'var(--text-secondary)' }}>
              {STATUS_LABEL[story.status] ?? story.status}
            </span>
            {/* Assignee */}
            <AssigneePicker
              current={currentAssignee}
              members={members}
              onAssign={(uid) => assignStory(uid)}
            />
            {/* Last edited */}
            {story.lastEditedAt && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }} title={story.editComment}>
                <Clock size={10} />
                edited by <strong style={{ color: 'var(--text-secondary)' }}>{story.lastEditedByName ?? 'someone'}</strong>
                &nbsp;{timeAgo(story.lastEditedAt)}
                {story.editComment && <span style={{ color: 'var(--text-muted)' }}> · "{story.editComment}"</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ paddingLeft: 21, marginTop: 10 }} className="animate-fade-in">
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Description</p>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <InlineEdit
              value={story.description ?? ''}
              fieldLabel="description"
              multiline
              onSave={editField('description')}
            />
          </div>
          {story.acceptanceCriteria?.length > 0 && (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 0 4px' }}>Acceptance criteria</p>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {story.acceptanceCriteria.map((c, idx) => (
                  <li key={idx} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
};

// ── Epic card ─────────────────────────────────────────────────────────────────

const EpicCard: React.FC<{
  epic: EpicRow;
  members: Member[];
  token: string;
  onRefresh: () => void;
}> = ({ epic, members, token, onRefresh }) => {
  const [open, setOpen] = useState(true);
  const done = epic.stories.filter((s) => s.status === 'done').length;
  const total = epic.stories.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="card" style={{ marginBottom: 12, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {/* Epic header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
          background: 'var(--bg-surface)', border: 'none', cursor: 'pointer',
          padding: '14px 16px', borderBottom: open ? '1px solid var(--border-subtle)' : 'none',
        }}
      >
        <Layers size={14} style={{ color: 'var(--purple)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{epic.title}</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {done}/{total} done
        </span>
        <div style={{ width: 60, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--accent)' : 'var(--purple)', transition: 'width .3s' }} />
        </div>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {/* Stories */}
      {open && (
        <div style={{ padding: '0 16px 4px' }}>
          {epic.stories.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>No stories yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {epic.stories.map((s) => (
                <StoryRow key={s.id} story={s} members={members} token={token} onRefresh={onRefresh} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main export ───────────────────────────────────────────────────────────────

export const EpicDashboard: React.FC<{ state: FactoryState }> = ({ state }) => {
  const project = state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const [epics, setEpics] = useState<EpicRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = state.token ?? '';

  const load = async () => {
    if (!project?.id || !token) return;
    setLoading(true);
    setError(null);
    try {
      const [planRes, membersRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/plan`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/projects/${project.id}/members`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!planRes.ok) throw new Error(friendlyStatus(planRes.status));
      const plan = await planRes.json();
      setEpics(
        (plan.epics ?? []).map((e: { id: string; title: string; description: string; position: number; stories?: IssueDetail[] }) => ({
          ...e,
          stories: (e.stories ?? []) as IssueDetail[],
        })),
      );
      if (membersRes.ok) setMembers(await membersRes.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [project?.id, token]);

  if (!project) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Layers size={28} style={{ marginBottom: 8 }} />
        <p>No project selected.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Layers size={18} style={{ color: 'var(--purple)' }} />
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Epics
          </h2>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            {project.name} · {epics.length} epic{epics.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,77,79,.1)', border: '1px solid rgba(255,77,79,.3)', marginBottom: 16, fontSize: 12, color: 'var(--error)' }}>
          <AlertTriangle size={13} /> {error}
          <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 11 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12 }}>Loading epics…</div>
      )}

      {/* Epics list */}
      {!loading && epics.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <Layers size={24} style={{ marginBottom: 8, opacity: .5 }} />
          <p style={{ fontSize: 13 }}>No epics yet. Run the plan builder to generate them from the approved idea.</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, fontSize: 12 }}
            onClick={() => factoryStore.setScreen('project_onboarding')}
          >
            <Plus size={13} /> Go to plan builder
          </button>
        </div>
      )}

      {!loading && epics.map((epic) => (
        <EpicCard key={epic.id} epic={epic} members={members} token={token} onRefresh={load} />
      ))}
    </div>
  );
};
