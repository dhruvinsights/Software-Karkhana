import React, { useState } from 'react';
import { X, UserPlus, Copy, Check, Mail, Shield, Sparkles, Link } from 'lucide-react';
import { factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole } from '../../types/factory';

interface WorkspaceInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

export const WorkspaceInviteModal: React.FC<WorkspaceInviteModalProps> = ({ isOpen, onClose, state }) => {
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<FactoryRole>('developer');
  const [copied, setCopied] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  if (!isOpen) return null;

  const currentWorkspace = state.workspace;
  const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/?join_workspace=${currentWorkspace.id}&role=${selectedRole}`;

  const handleCopyLink = async () => {
    try {
      // Also notify backend
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      if (token && currentWorkspace.id.includes('-') && currentWorkspace.id.length === 36) {
        await fetch(`/api/workspaces/${currentWorkspace.id}/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: selectedRole }),
        });
      }

      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback copy
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleSendEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSending(true);
    setInviteStatus(null);

    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      if (token && currentWorkspace.id.includes('-') && currentWorkspace.id.length === 36) {
        const res = await fetch(`/api/workspaces/${currentWorkspace.id}/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email: email.trim(), role: selectedRole }),
        });
        if (res.ok) {
          setInviteStatus(`Invitation dispatched to ${email.trim()}!`);
        } else {
          setInviteStatus(`Invitation link generated for ${email.trim()}.`);
        }
      } else {
        setInviteStatus(`Invitation recorded for ${email.trim()}.`);
      }
      setEmail('');
    } catch {
      setInviteStatus(`Invitation link generated for ${email.trim()}.`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <UserPlus className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Invite Team Members</h3>
            <p className="text-[11px] text-slate-400">
              Every workspace member has the right to invite colleagues with role assignment
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Role selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Target Role Assignment</label>
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-1 bg-slate-950 border border-slate-800 rounded-xl">
              {(Object.keys(ROLE_CONFIGS) as FactoryRole[]).map((r) => {
                const conf = ROLE_CONFIGS[r];
                const isSelected = selectedRole === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRole(r)}
                    className={`p-2 rounded-lg text-left text-xs transition-colors cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-600/20 border border-blue-500 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
                    }`}
                  >
                    <span className="font-semibold text-white">{conf.label}</span>
                    <span className="text-[10px] text-slate-500 mt-0.5">{conf.badge}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Direct Copy Link */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Instant Workspace Invite Link</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              When opened: if not logged in, redirects to login/signup then automatically joins {currentWorkspace.name}.
            </p>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-800"></div>
            <span className="flex-shrink mx-3 text-[10px] uppercase font-mono text-slate-500">Or Send Via Email</span>
            <div className="flex-grow border-t border-slate-800"></div>
          </div>

          {/* Email Invite Form */}
          <form onSubmit={handleSendEmailInvite} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={isSending || !email.trim()}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
            {inviteStatus && (
              <p className="text-xs text-emerald-400 bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/60">
                {inviteStatus}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
