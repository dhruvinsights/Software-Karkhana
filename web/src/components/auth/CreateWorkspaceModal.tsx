import React, { useState } from 'react';
import {
  Building,
  User,
  Users,
  ArrowRight,
  Check,
  Copy,
  Link,
  Shield,
  Layers,
  Sparkles,
  X,
  CheckCircle2,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { ShinyText } from '../reactbits/ShinyText';

export interface CreateWorkspaceModalProps {
  state: FactoryState;
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceCreated: (workspaceId: string, workspaceName: string) => void;
}

export const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  state,
  isOpen,
  onClose,
  onWorkspaceCreated,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [workspaceName, setWorkspaceName] = useState('');
  const [fullName, setFullName] = useState(state.currentUser?.display_name || '');
  const [discipline, setDiscipline] = useState('Product Management & Engineering');
  const [teammateEmails, setTeammateEmails] = useState<string[]>([]);
  const [currentEmailInput, setCurrentEmailInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAddEmail = (e: React.KeyboardEvent | React.MouseEvent) => {
    if (e.type === 'keydown' && (e as React.KeyboardEvent).key !== 'Enter') return;
    if (e.type === 'keydown') e.preventDefault();

    const clean = currentEmailInput.trim().toLowerCase();
    if (clean && clean.includes('@') && !teammateEmails.includes(clean)) {
      setTeammateEmails([...teammateEmails, clean]);
      setCurrentEmailInput('');
    }
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setTeammateEmails(teammateEmails.filter((e) => e !== emailToRemove));
  };

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(`https://karkhana.enterprise.internal/join/${workspaceName.toLowerCase().replace(/\s+/g, '-') || 'workspace'}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    const wsName = workspaceName.trim() || 'My Enterprise Workspace';
    const cleanSlug = wsName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    try {
      const token = state.token;
      let newWsId = `ws-${Date.now()}`;

      if (token) {
        const res = await fetch('/api/workspaces/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: wsName,
            slug: cleanSlug,
            user_name: fullName.trim() || 'Workspace Owner',
            user_role: 'product_manager',
            invited_emails: teammateEmails,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.id) {
            newWsId = data.id;
          }
        }
      }

      // Local store update
      factoryStore.createWorkspace(wsName, cleanSlug, 'empty', undefined, teammateEmails);

      setIsSubmitting(false);
      onWorkspaceCreated(newWsId, wsName);
    } catch (e) {
      console.warn('Backend workspace creation failed, falling back to local store', e);
      setIsSubmitting(false);
      onWorkspaceCreated(`ws-${Date.now()}`, wsName);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 selection:bg-[#075bff] selection:text-white animate-fade-in select-none">
      <div className="max-w-xl w-full bg-[#0a0d16] border border-white/10 rounded-3xl shadow-2xl overflow-hidden relative flex flex-col max-h-[90vh]">
        {/* Top bar with progress indicator */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#075bff]/20 border border-[#075bff]/30 text-[#075bff] flex items-center justify-center font-bold text-xs">
              {step} / 3
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-mono uppercase tracking-wider">
                Workspace Setup
              </span>
              <span className="text-sm font-semibold text-white">
                {step === 1 && 'Name your workspace'}
                {step === 2 && 'Your Profile & Discipline'}
                {step === 3 && 'Invite your teammates'}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step dots */}
        <div className="grid grid-cols-3 gap-1 px-6 pt-4">
          <div className={`h-1 rounded-full ${step >= 1 ? 'bg-[#075bff]' : 'bg-white/10'}`} />
          <div className={`h-1 rounded-full ${step >= 2 ? 'bg-[#075bff]' : 'bg-white/10'}`} />
          <div className={`h-1 rounded-full ${step >= 3 ? 'bg-[#075bff]' : 'bg-white/10'}`} />
        </div>

        {/* Step Body */}
        <div className="p-6 sm:p-8 flex-1 overflow-y-auto space-y-6">
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  What’s the name of your company or team?
                </h2>
                <p className="text-xs text-slate-400">
                  This will be the name of your Software Karkhana workspace — choose something your team recognizes.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium text-slate-300">Workspace name</label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    required
                    autoFocus
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Ex: Acme Inc, Cloud Engineering, Core Systems"
                    className="w-full pl-10 pr-4 py-3 bg-[#06080e] border border-white/10 rounded-2xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#075bff] transition-colors"
                  />
                </div>
                {workspaceName.trim() && (
                  <p className="text-[11px] font-mono text-cyan-400 pt-1">
                    Workspace URL: https://{workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'workspace'}.internal
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  What’s your name and discipline?
                </h2>
                <p className="text-xs text-slate-400">
                  Adding your name and role helps your team recognize and collaborate with you.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Your full name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      autoFocus
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex: Alex Mercer"
                      className="w-full pl-10 pr-4 py-3 bg-[#06080e] border border-white/10 rounded-2xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#075bff] transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Role / Discipline</label>
                  <select
                    value={discipline}
                    onChange={(e) => setDiscipline(e.target.value)}
                    className="w-full px-4 py-3 bg-[#06080e] border border-white/10 rounded-2xl text-xs text-white focus:outline-none focus:border-[#075bff] transition-colors cursor-pointer"
                  >
                    <option value="Product Management & Engineering">Product Management & Engineering</option>
                    <option value="Executive & Leadership">Executive & Leadership</option>
                    <option value="Systems Architecture">Systems Architecture</option>
                    <option value="Software Development">Software Development</option>
                    <option value="QA & Verification">QA & Verification</option>
                    <option value="AppSec & Security">AppSec & Security</option>
                    <option value="DevOps & SRE">DevOps & SRE</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Who else is on your team?
                </h2>
                <p className="text-xs text-slate-400">
                  Invite your colleagues to join <strong className="text-white">{workspaceName || 'this workspace'}</strong>.
                </p>
              </div>

              {/* Email Chips input */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium text-slate-300">Invite teammates by email</label>
                <div className="p-2 bg-[#06080e] border border-white/10 rounded-2xl flex flex-wrap gap-2 items-center min-h-[48px]">
                  {teammateEmails.map((email) => (
                    <span
                      key={email}
                      className="px-2.5 py-1 bg-[#075bff]/20 text-cyan-300 border border-[#075bff]/30 rounded-xl text-[11px] font-mono flex items-center gap-1.5"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => handleRemoveEmail(email)}
                        className="hover:text-rose-400 cursor-pointer text-xs"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={currentEmailInput}
                    onChange={(e) => setCurrentEmailInput(e.target.value)}
                    onKeyDown={handleAddEmail}
                    placeholder={teammateEmails.length === 0 ? "name@company.com (press Enter)" : "Add another..."}
                    className="flex-1 min-w-[140px] bg-transparent text-xs text-white placeholder-slate-600 focus:outline-none px-2 py-1"
                  />
                  {currentEmailInput && (
                    <button
                      type="button"
                      onClick={handleAddEmail}
                      className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-xs text-white rounded-lg cursor-pointer"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>

              {/* Copy shareable invite link */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="w-full p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-between text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Link className="w-4 h-4 text-cyan-400" />
                    <span>Copy shareable invite link</span>
                  </div>
                  {copiedLink ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <Check className="w-3.5 h-3.5" /> Copied!
                    </span>
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-6 border-t border-white/10 bg-[#06080e]/60 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as any)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-3">
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 && !workspaceName.trim()}
                onClick={() => setStep((s) => (s + 1) as any)}
                className="px-5 py-2.5 bg-[#075bff] hover:bg-[#075bff]/90 disabled:opacity-40 text-white font-semibold text-xs rounded-xl flex items-center gap-2 transition-all shadow-md shadow-[#075bff]/20 cursor-pointer"
              >
                <span>Next Step</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinalSubmit}
                className="px-6 py-2.5 bg-gradient-to-r from-[#075bff] to-cyan-500 hover:opacity-90 disabled:opacity-40 text-white font-semibold text-xs rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/20 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isSubmitting ? 'Creating Workspace...' : 'Launch Workspace'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
