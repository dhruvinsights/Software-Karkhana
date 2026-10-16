import React, { useState, useEffect } from 'react';
import { X, UserPlus, Copy, Check, Mail, Users } from 'lucide-react';
import { factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole } from '../../types/factory';
import { createInvite } from '../../lib/invites';

interface WorkspaceInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
  joined_at?: string | null;
}

export const WorkspaceInviteModal: React.FC<WorkspaceInviteModalProps> = ({ isOpen, onClose, state }) => {
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<FactoryRole>('developer');
  const [copied, setCopied] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'invite' | 'members'>('members');

  const currentWorkspace = state.workspace;

  const token = state.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null);
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Load real workspace members when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setMembersLoading(true);
    const wsId = currentWorkspace.id;

    // Only hit real API if this looks like a real UUID workspace id
    const isRealId = wsId.includes('-') && wsId.length === 36;
    if (isRealId) {
      fetch(`/api/workspaces/${wsId}/members`, { headers: authHeaders })
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: WorkspaceMember[]) => setMembers(data))
        .catch(() => setMembers(_localMembers(state)))
        .finally(() => setMembersLoading(false));
    } else {
      // Local / demo workspace — pull from factoryStore members
      setMembers(_localMembers(state));
      setMembersLoading(false);
    }
  }, [isOpen, currentWorkspace.id]);

  if (!isOpen) return null;

  const canUseApi = !!token && currentWorkspace.id.includes('-') && currentWorkspace.id.length === 36;

  const handleCopyLink = async () => {
    setInviteStatus(null);
    if (!canUseApi || !token) {
      setInviteStatus('Sign in to a real workspace to create invite links.');
      return;
    }
    try {
      const inv = await createInvite(token, currentWorkspace.id, { role: selectedRole });
      setGeneratedLink(inv.inviteLink);
      await navigator.clipboard.writeText(inv.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      setInviteStatus((e as Error).message);
    }
  };

  const handleSendEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviteStatus(null);
    if (!canUseApi || !token) {
      setInviteStatus('Sign in to a real workspace to send invitations.');
      return;
    }
    setIsSending(true);
    try {
      const inv = await createInvite(token, currentWorkspace.id, { email: email.trim(), role: selectedRole });
      if (inv.emailSent) {
        setInviteStatus(`✓ Invitation emailed to ${inv.email}`);
      } else {
        await navigator.clipboard.writeText(inv.inviteLink).catch(() => undefined);
        setInviteStatus(`Invite created for ${inv.email}, but the email could not be sent. The link is copied: share it directly.`);
      }
      setEmail('');
    } catch (err) {
      setInviteStatus((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const roleColor = (role: string) => {
    if (role === 'admin' || role === 'owner') return '#f0a500';
    if (role === 'developer' || role === 'lead') return '#075BFF';
    return '#9b6dff';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="card-elevated animate-fade-in" style={{ width: '100%', maxWidth: 520, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(7,91,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(7,91,255,0.3)' }}>
              <UserPlus size={16} style={{ color: '#075BFF' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Team &amp; Invites</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{currentWorkspace.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
            <X size={14} />
          </button>
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {(['members', 'invite'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 500,
                color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab ? '2px solid #075BFF' : '2px solid transparent',
                background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'color .15s',
              }}
            >
              {tab === 'members' ? <Users size={13} /> : <Mail size={13} />}
              {tab === 'members' ? `Members (${members.length})` : 'Invite'}
            </button>
          ))}
        </div>

        {/* Members Tab */}
        {activeTab === 'members' && (
          <div style={{ padding: '12px 24px 20px' }}>
            {membersLoading ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                Loading members…
              </div>
            ) : members.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12 }}>
                <Users size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <p>No members yet. Invite your team.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {members.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${roleColor(m.role)}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: roleColor(m.role), flexShrink: 0 }}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt={m.name} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                        : initials(m.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 4, background: `${roleColor(m.role)}18`, color: roleColor(m.role), border: `1px solid ${roleColor(m.role)}33`, flexShrink: 0 }}>
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setActiveTab('invite')}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                <UserPlus size={14} />
                Invite Someone
              </button>
            </div>
          </div>
        )}

        {/* Invite Tab */}
        {activeTab === 'invite' && (
          <div style={{ padding: '20px 24px' }}>
            {/* Role selector */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Role to assign
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {(['developer', 'product_manager', 'qa', 'devops', 'architect', 'admin'] as FactoryRole[]).map((r) => {
                  const conf = ROLE_CONFIGS[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRole(r)}
                      style={{
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontSize: 11, cursor: 'pointer',
                        background: selectedRole === r ? 'rgba(7,91,255,0.12)' : 'var(--bg-elevated)',
                        border: selectedRole === r ? '1px solid rgba(7,91,255,0.5)' : '1px solid var(--border-subtle)',
                        color: selectedRole === r ? 'var(--text-primary)' : 'var(--text-secondary)',
                        transition: 'all .15s',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{conf.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{conf.badge}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Copy link */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Invite Link
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={generatedLink} placeholder="Press Copy to create a link"  className="input" style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                <button onClick={handleCopyLink} className="btn btn-ghost" style={{ flexShrink: 0 }}>
                  {copied ? <Check size={14} style={{ color: 'var(--accent)' }} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>or email</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            {/* Email invite */}
            <form onSubmit={handleSendEmailInvite}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  style={{ flex: 1 }}
                />
                <button type="submit" disabled={isSending || !email.trim()} className="btn btn-primary" style={{ flexShrink: 0 }}>
                  <Mail size={13} />
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
              {inviteStatus && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', background: 'rgba(0,217,166,.06)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(0,217,166,.2)' }}>
                  {inviteStatus}
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// Fallback: build member list from factoryStore state for local/demo workspaces
function _localMembers(state: FactoryState): WorkspaceMember[] {
  return state.members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.roles[0] || 'developer',
    avatar_url: m.avatar || null,
  }));
}
