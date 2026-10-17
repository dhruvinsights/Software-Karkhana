import React, { useState } from 'react';
import { BookOpen, ClipboardCheck, Crown, ShieldCheck, User, X } from 'lucide-react';
import {
  ACCESS_LABEL,
  factoryStore,
  FactoryState,
  WorkspaceAccessLevel,
  WorkspaceMemberRecord,
} from '../../store/factoryStore';

interface WorkspaceAdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

type Assignable = Exclude<WorkspaceAccessLevel, 'owner'>;

const ACCESS_STYLE: Record<WorkspaceAccessLevel, { color: string; icon: React.ReactNode; hint: string }> = {
  owner: { color: '#f0a500', icon: <Crown size={12} />, hint: 'Created this workspace. Full control.' },
  admin: { color: '#f0a500', icon: <ShieldCheck size={12} />, hint: 'Manages members, guides, the product and every project.' },
  reviewer: { color: '#00d9a6', icon: <ClipboardCheck size={12} />, hint: 'Reviews and decides ideas; read-only overview of every project.' },
  guide: { color: '#9b6dff', icon: <BookOpen size={12} />, hint: 'Read-only advisor: sees every project and idea, can comment.' },
  member: { color: '#075BFF', icon: <User size={12} />, hint: 'Works on the projects they are invited to.' },
};

const OPTIONS: Assignable[] = ['admin', 'reviewer', 'guide', 'member'];
const ORDER: WorkspaceAccessLevel[] = ['owner', 'admin', 'reviewer', 'guide', 'member'];

/**
 * Workspace Admin Panel: the owner (and admins) decide who else is an admin or a guide.
 * The server enforces the same rules; only the owner can add or remove admins.
 */
export const WorkspaceAdminPanel: React.FC<WorkspaceAdminPanelProps> = ({ isOpen, onClose, state }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOwner = state.myAccess === 'owner';
  const members = [...state.workspaceMembers].sort(
    (a, b) => ORDER.indexOf(a.access) - ORDER.indexOf(b.access),
  );
  const counts = {
    admin: members.filter((m) => m.access === 'owner' || m.access === 'admin').length,
    reviewer: members.filter((m) => m.access === 'reviewer').length,
    guide: members.filter((m) => m.access === 'guide').length,
  };

  const canChange = (m: WorkspaceMemberRecord, to: Assignable) => {
    if (m.access === 'owner' || m.id === state.currentUser?.id) return false;
    if ((to === 'admin' || m.access === 'admin') && !isOwner) return false;
    return true;
  };

  const change = async (m: WorkspaceMemberRecord, to: Assignable) => {
    if (m.access === to) return;
    setBusyId(m.id);
    setError(null);
    try {
      await factoryStore.setMemberAccess(m.id, to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="card-elevated animate-fade-in" style={{ width: '100%', maxWidth: 680, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(240,165,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(240,165,0,0.3)' }}>
              <ShieldCheck size={16} style={{ color: '#f0a500' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Workspace Admin Panel</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {state.workspace.name} · {counts.admin} admin{counts.admin === 1 ? '' : 's'} · {counts.reviewer} reviewer{counts.reviewer === 1 ? '' : 's'} · {counts.guide} guide{counts.guide === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {OPTIONS.map((a) => (
            <div key={a} style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: ACCESS_STYLE[a].color, fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>
                {ACCESS_STYLE[a].icon}
                {ACCESS_LABEL[a]}
              </div>
              {ACCESS_STYLE[a].hint}
            </div>
          ))}
        </div>

        {/* Members */}
        <div style={{ padding: '12px 24px 20px' }}>
          {members.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Loading members…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
              {members.map((m) => {
                const style = ACCESS_STYLE[m.access];
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', opacity: busyId === m.id ? 0.6 : 1 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${style.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: style.color, flexShrink: 0 }}>
                      {m.avatar ? <img src={m.avatar} alt={m.name} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} referrerPolicy="no-referrer" /> : initials(m.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                        {m.id === state.currentUser?.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (you)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.email} · {m.role.replace(/_/g, ' ')}
                      </div>
                    </div>
                    {m.access === 'owner' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: `${style.color}18`, color: style.color, border: `1px solid ${style.color}33`, flexShrink: 0 }}>
                        {style.icon} {ACCESS_LABEL.owner}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {OPTIONS.map((a) => {
                          const active = m.access === a;
                          const allowed = active || canChange(m, a);
                          return (
                            <button
                              key={a}
                              type="button"
                              disabled={!allowed || busyId !== null}
                              onClick={() => change(m, a)}
                              title={allowed ? `Make ${m.name} ${ACCESS_LABEL[a].toLowerCase()}` : a === 'admin' ? 'Only the workspace owner can add or remove admins' : ''}
                              style={{
                                fontSize: 10, fontFamily: 'var(--font-mono)', padding: '4px 8px', borderRadius: 4, cursor: allowed ? 'pointer' : 'not-allowed',
                                background: active ? `${ACCESS_STYLE[a].color}22` : 'transparent',
                                color: active ? ACCESS_STYLE[a].color : allowed ? 'var(--text-secondary)' : 'var(--text-muted)',
                                border: active ? `1px solid ${ACCESS_STYLE[a].color}55` : '1px solid var(--border-subtle)',
                                opacity: allowed ? 1 : 0.45,
                                transition: 'all .15s',
                              }}
                            >
                              {ACCESS_LABEL[a]}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#fda4af', background: 'rgba(244,63,94,.08)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(244,63,94,.25)' }}>
              {error}
            </div>
          )}
          {!isOwner && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>Only the workspace owner can add or remove admins.</div>
          )}
        </div>
      </div>
    </div>
  );
};
