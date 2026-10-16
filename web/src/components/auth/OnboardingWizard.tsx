import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Building,
  Users,
  Sparkles,
  Code2,
  Cpu,
  Shield,
  HelpCircle,
  Plus,
  Trash2,
  FolderGit2,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ChromaWaves } from '../reactbits/ChromaWaves';
import { WorkspaceTemplate } from '../../types/factory';

interface OnboardingWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<number>(1);

  // Step 1: Decision
  const [intent, setIntent] = useState<'create' | 'join'>('create');

  // Step 2: Workspace Info
  const [workspaceName, setWorkspaceName] = useState('Nexus Autonomous Systems');
  const [workspaceSlug, setWorkspaceSlug] = useState('nexus-systems');
  const [displayName, setDisplayName] = useState('Principal Architect');
  const [orgName, setOrgName] = useState('Nexus Corp');

  // Step 3: Goal
  const [primaryGoal, setPrimaryGoal] = useState<string>('build_new');

  // Step 4: Template (Default is empty!)
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate>('empty');

  // Step 5: Invites
  const [teammateEmails, setTeammateEmails] = useState<string[]>(['sarah.eng@nexus.internal', 'alex.qa@nexus.internal']);
  const [newEmail, setNewEmail] = useState('');

  // Step 6: Git & Stack
  const [repoUrl, setRepoUrl] = useState('github.com/nexus-corp/core-service');
  const [primaryStack, setPrimaryStack] = useState('TypeScript & Go');

  const handleAddEmail = () => {
    if (newEmail.trim() && !teammateEmails.includes(newEmail.trim())) {
      setTeammateEmails([...teammateEmails, newEmail.trim()]);
      setNewEmail('');
    }
  };

  const handleRemoveEmail = (email: string) => {
    setTeammateEmails(teammateEmails.filter((e) => e !== email));
  };

  const handleFinalize = async () => {
    const token = factoryStore.getState().token;
    try {
      if (token) {
        await fetch('/api/workspaces/onboard', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            workspace_name: workspaceName,
            workspace_slug: workspaceSlug,
            domain: `${workspaceSlug}.internal`,
            security_posture: 'STANDARD',
            role: factoryStore.getState().currentUser?.role || 'product_manager',
            product_name: `${workspaceName} Core`,
            product_domain: 'Cloud Services',
          }),
        });
      }
    } catch (e) {
      console.warn('Backend sync failed, storing locally', e);
    }
    factoryStore.createWorkspace(
      workspaceName,
      workspaceSlug,
      selectedTemplate,
      primaryGoal,
      teammateEmails
    );
    onComplete();
  };

  return (
    <div className="min-h-screen cinematic-glow-bg text-[#f7f8fc] flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-12 selection:bg-[#075bff] selection:text-white relative overflow-hidden">
      {/* Dynamic Chromatic Waves Background */}
      <ChromaWaves />

      {/* Top Header - Editorial Dark */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-white/10">
        <div className="flex items-center">
          <span className="text-base font-semibold text-white tracking-tight">Software Karkhana</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-[#a7acb8] font-mono">
            <span>Step {step} of 6</span>
          </div>
          <button
            onClick={onCancel}
            className="text-xs text-[#a7acb8] hover:text-white px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Main Multi-Step Form */}
      <div className="max-w-2xl mx-auto w-full py-8 my-auto">
        
        {/* STEP 1: DECIDE WHAT TO DO */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center mb-8 space-y-2">
              <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight">
                How will you use <span className="font-serif-italic text-[#075bff]">Software Karkhana?</span>
              </h2>
              <p className="text-sm text-[#a7acb8] max-w-md mx-auto">
                Choose whether you are establishing a new software factory or connecting to an existing organization.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                onClick={() => setIntent('create')}
                className={`p-6 rounded-2xl border cursor-pointer transition-all ${
                  intent === 'create'
                    ? 'bg-[#17181d] border-[#075bff] shadow-xl shadow-[#075bff]/15'
                    : 'bg-[#111216] border-white/10 hover:border-white/20'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-[#075bff]/15 border border-[#075bff]/30 flex items-center justify-center text-[#075bff] mb-4">
                  <Building className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">Create a Workspace</h3>
                <p className="text-xs text-[#a7acb8] leading-relaxed">
                  For your company, engineering squad, or independent autonomous software studio.
                </p>
              </div>

              <div
                onClick={() => setIntent('join')}
                className={`p-6 rounded-2xl border cursor-pointer transition-all ${
                  intent === 'join'
                    ? 'bg-[#17181d] border-[#075bff] shadow-xl shadow-[#075bff]/15'
                    : 'bg-[#111216] border-white/10 hover:border-white/20'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-[#5747d9]/15 border border-[#5747d9]/30 flex items-center justify-center text-[#5747d9] mb-4">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">Join a Workspace</h3>
                <p className="text-xs text-[#a7acb8] leading-relaxed">
                  Continue with an invitation code, token, or link provided by your team lead.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: WORKSPACE IDENTITY & PROFILE */}
        {step === 2 && (
          <div className="space-y-6 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Name your software workspace</h2>
              <p className="text-xs text-[#a7acb8]">
                This is the canonical namespace for your products, architecture ADRs, and autonomous agent executions.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-[#a7acb8] mb-1.5">Workspace Name</label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => {
                    setWorkspaceName(e.target.value);
                    setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  className="w-full px-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-[#075bff] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-[#a7acb8] mb-1.5">Organization / Entity (Optional)</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Systems Inc."
                  className="w-full px-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-[#075bff] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-[#a7acb8] mb-1.5">Personal Identity Label</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-[#075bff] transition-colors"
                />
              </div>

              {/* Live Preview Card */}
              <div className="p-4 bg-[#111216] rounded-xl border border-white/10 mt-2">
                <span className="text-[10px] font-mono text-[#a7acb8] uppercase block mb-2">Canonical Domain Preview</span>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#075bff] text-white flex items-center justify-center font-bold text-xs">
                    {workspaceName.charAt(0) || 'W'}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{workspaceName || 'My Workspace'}</h4>
                    <p className="text-xs font-mono text-[#075bff]">
                      https://factory.internal/{workspaceSlug || 'my-workspace'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: WHAT ARE YOU TRYING TO DO? */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">What is your team aiming to accomplish?</h2>
              <p className="text-xs text-[#a7acb8]">
                Customizes initial workspace lenses without restricting any platform capabilities.
              </p>
            </div>

            <div className="space-y-2.5">
              {[
                { id: 'build_new', title: 'Build a new software product from scratch', desc: 'Discovery hypotheses, ADR architecture, autonomous agent coding, and test synthesis.' },
                { id: 'manage_existing', title: 'Manage an existing brownfield codebase', desc: 'Connect repositories, run CodeRabbit PR audits, and automate canary release cutover.' },
                { id: 'coordinate_multi', title: 'Coordinate cross-functional engineering disciplines', desc: '11-discipline governance, roadmap epics, and multi-sig 4-eye release gates.' },
                { id: 'ai_factory', title: 'Deploy an AI-native autonomous execution swarm', desc: 'Harness Gemini 3.8 Flash task context packages and isolated Docker sandbox runs.' },
              ].map((goal) => (
                <div
                  key={goal.id}
                  onClick={() => setPrimaryGoal(goal.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${
                    primaryGoal === goal.id
                      ? 'bg-[#17181d] border-[#075bff] shadow-md'
                      : 'bg-[#111216] border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                    primaryGoal === goal.id ? 'border-[#075bff] bg-[#075bff] text-white' : 'border-white/20'
                  }`}>
                    {primaryGoal === goal.id && <Check className="w-3 h-3" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{goal.title}</h4>
                    <p className="text-xs text-[#a7acb8] mt-0.5 leading-relaxed">{goal.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: CHOOSE HOW TO START (EMPTY BY DEFAULT!) */}
        {step === 4 && (
          <div className="space-y-6 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Choose your starting template</h2>
              <p className="text-xs text-[#a7acb8]">
                In Software Karkhana, workspaces are empty by default with zero mock noise.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {[
                {
                  id: 'empty',
                  title: 'Start Empty (Recommended)',
                  badge: 'Pristine Clean Slate',
                  desc: 'Genuine zero-clutter start. Direct jump into your first real product creation flow.',
                },
                {
                  id: 'solo_builder',
                  title: 'Solo Builder',
                  badge: 'Agile & Fast',
                  desc: 'Streamlined flow optimized for single founders and full-stack developers.',
                },
                {
                  id: 'product_team',
                  title: 'Product & Engineering Team',
                  badge: 'Cross-functional',
                  desc: 'Configures Product Manager, Developer, and QA verification workflows.',
                },
                {
                  id: 'engineering_org',
                  title: 'Engineering Organization',
                  badge: 'Full Governance',
                  desc: 'Pre-configures 11 specialist roles, approval gates, and multi-team portfolios.',
                },
              ].map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedTemplate(tmpl.id as WorkspaceTemplate)}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                    selectedTemplate === tmpl.id
                      ? 'bg-[#17181d] border-[#075bff] shadow-lg shadow-[#075bff]/10'
                      : 'bg-[#111216] border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-[#075bff] border border-[#075bff]/30">
                        {tmpl.badge}
                      </span>
                      {selectedTemplate === tmpl.id && <Check className="w-4 h-4 text-[#075bff]" />}
                    </div>
                    <h3 className="text-sm font-semibold text-white">{tmpl.title}</h3>
                    <p className="text-xs text-[#a7acb8] leading-relaxed">{tmpl.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 5: INVITE TEAM MEMBERS */}
        {step === 5 && (
          <div className="space-y-6 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Invite initial team members</h2>
              <p className="text-xs text-[#a7acb8]">
                Collaborate with named architects, engineers, QA leads, and directors.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddEmail();
                    }
                  }}
                  placeholder="colleague@company.com"
                  className="flex-1 px-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-[#075bff] transition-colors"
                />
                <button
                  type="button"
                  onClick={handleAddEmail}
                  className="px-5 py-3 bg-[#075bff] hover:bg-[#176bff] text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </div>

              <div className="space-y-2">
                <span className="text-[11px] font-mono text-[#a7acb8] uppercase block">
                  Pending Invitations ({teammateEmails.length})
                </span>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {teammateEmails.map((email) => (
                    <div
                      key={email}
                      className="p-3 bg-[#111216] rounded-xl border border-white/10 flex items-center justify-between text-xs"
                    >
                      <span className="font-mono text-white">{email}</span>
                      <button
                        onClick={() => handleRemoveEmail(email)}
                        className="text-[#a7acb8] hover:text-red-400 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: REPO & STACK CONNECTION */}
        {step === 6 && (
          <div className="space-y-6 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Connect repository & primary stack</h2>
              <p className="text-xs text-[#a7acb8]">
                Configures git synchronization, CodeRabbit review triggers, and CI/CD pipelines.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-[#a7acb8] mb-1.5">Primary Git Repository</label>
                <div className="relative">
                  <FolderGit2 className="w-4 h-4 text-[#a7acb8] absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-[#075bff]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-[#a7acb8] mb-1.5">Tech Stack & Frameworks</label>
                <input
                  type="text"
                  value={primaryStack}
                  onChange={(e) => setPrimaryStack(e.target.value)}
                  className="w-full px-4 py-3 bg-[#111216] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-[#075bff]"
                />
              </div>

              <div className="p-4 bg-[#111216] rounded-xl border border-[#075bff]/40 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#075bff]">
                  <Check className="w-4 h-4" />
                  <span>Factory Readiness Check Complete</span>
                </div>
                <p className="text-xs text-[#a7acb8] leading-relaxed">
                  Workspace <b>{workspaceName}</b> is ready with 11 linked disciplines, unlazy gate verifier, and real evidence ledger.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-8 mt-8 border-t border-white/10">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <div />
          )}

          {step < 6 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#075bff] hover:bg-[#176bff] text-white text-xs font-semibold transition-all shadow-md shadow-[#075bff]/25 active:scale-95"
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleFinalize}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#075bff] hover:bg-[#176bff] text-white text-xs font-semibold transition-all shadow-lg shadow-[#075bff]/30 active:scale-95"
            >
              <span>Launch Factory Workspace</span>
              <Sparkles className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom Footer Note */}
      <div className="max-w-4xl mx-auto w-full pt-6 border-t border-white/10 text-center text-xs text-[#a7acb8]">
        Software Karkhana · Autonomous Delivery Lifecycle & Deterministic Verification
      </div>
    </div>
  );
};
