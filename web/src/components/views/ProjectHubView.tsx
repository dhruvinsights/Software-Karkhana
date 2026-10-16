import React, { useState } from 'react';
import {
  FolderGit2,
  Plus,
  GitBranch,
  GitPullRequest,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  FileCode2,
  Terminal,
  Trash2,
  Users,
  Shield,
  Workflow,
  Sparkles,
  Link,
  Check,
  Copy,
  Radio,
  Activity,
  Cpu,
  BookOpen,
} from 'lucide-react';
import { factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole, ScreenId } from '../../types/factory';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';
import { CreateProjectModal } from '../workspace/CreateProjectModal';

interface ProjectHubViewProps {
  state: FactoryState;
}

export const ProjectHubView: React.FC<ProjectHubViewProps> = ({ state }) => {
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [activeStationTab, setActiveStationTab] = useState<
    'overview' | 'product' | 'architecture' | 'developer' | 'qa' | 'devops' | 'security' | 'team_access'
  >('overview');

  const [copiedProjectLink, setCopiedProjectLink] = useState(false);
  const [inviteRole, setInviteRole] = useState<FactoryRole>('developer');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const activeProduct = selectedProject
    ? state.products.find((p) => p.id === selectedProject.productId)
    : state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  const handleCopyProjectInvite = () => {
    if (!selectedProject) return;
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/?join_project=${selectedProject.id}&role=${inviteRole}`;
    navigator.clipboard.writeText(url);
    setCopiedProjectLink(true);
    setTimeout(() => setCopiedProjectLink(false), 3000);
  };

  if (state.projects.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-6">
        <CreateProjectModal
          isOpen={createProjectModalOpen}
          onClose={() => setCreateProjectModalOpen(false)}
          state={state}
        />

        <div className="space-y-3">
          <div className="text-xs uppercase font-mono tracking-widest text-[#075BFF] font-medium">
            Project Hub
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white">
            No Projects Enrolled Yet
          </h1>
          <p className="text-sm text-[#827D8E] leading-relaxed max-w-xl font-light">
            Every team member (Developer, PM, Architect, Lead) can create and manage engineering delivery projects.
          </p>
        </div>

        <GlassCard className="p-8 space-y-5">
          <h3 className="text-xl font-semibold text-white">Launch Your First Engineering Project</h3>
          <p className="text-xs text-[#827D8E]">
            Set up isolated stations for requirements, autonomous developer swarms, architectural ADRs, and QA verification.
          </p>
          <button
            onClick={() => setCreateProjectModalOpen(true)}
            className="px-6 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create Engineering Project</span>
          </button>
        </GlassCard>
      </div>
    );
  }

  const projectEpics = state.epics.filter((e) => e.projectId === selectedProject.id);
  const projectTasks = state.issues.filter((i) => i.projectId === selectedProject.id);
  const projectPRs = state.pullRequests.filter((pr) => pr.projectId === selectedProject.id);
  const projectADRs = state.adrs.filter((a) => a.projectId === selectedProject.id);
  const projectTests = state.testScenarios.filter((t) => t.projectId === selectedProject.id);

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      <CreateProjectModal
        isOpen={createProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
        state={state}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
            <span>{activeProduct?.code || 'PRJ'}</span>
            <span>·</span>
            <span className="text-[#075BFF]">{activeProduct?.name || 'Workspace Core'}</span>
            <span>·</span>
            <span className="text-emerald-400 font-mono">LIVE FACTORY</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Project <ShinyText text={selectedProject.name} speed={5} />
          </h1>
          <p className="text-sm text-[#827D8E] max-w-2xl font-light">
            {selectedProject.description || 'Coordinating multi-discipline engineering delivery and station access.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setCreateProjectModalOpen(true)}
            className="px-4 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-[#075BFF]/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Project Switcher Bar if multiple projects exist */}
      {state.projects.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-mono text-[#827D8E] uppercase tracking-wider shrink-0 mr-2">
            Projects:
          </span>
          {state.projects.map((proj) => {
            const isSelected = proj.id === selectedProject.id;
            return (
              <button
                key={proj.id}
                onClick={() => factoryStore.selectProject(proj.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#075BFF] text-white font-semibold shadow-xs'
                    : 'bg-[#101016] text-[#827D8E] hover:text-white border border-white/[0.08]'
                }`}
              >
                {proj.name} ({proj.code})
              </button>
            );
          })}
        </div>
      )}

      {/* Station Navigation Ribbon */}
      <div className="flex items-center gap-2 p-1.5 bg-[#0c0e15]/90 border border-white/[0.08] rounded-2xl overflow-x-auto text-xs">
        <button
          onClick={() => setActiveStationTab('overview')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'overview' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Station Overview</span>
        </button>

        <button
          onClick={() => setActiveStationTab('product')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'product' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Product & Epics</span>
        </button>

        <button
          onClick={() => setActiveStationTab('architecture')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'architecture' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Workflow className="w-3.5 h-3.5 text-purple-400" />
          <span>Architecture & ADRs</span>
        </button>

        <button
          onClick={() => setActiveStationTab('developer')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'developer' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span>Developer Swarm</span>
        </button>

        <button
          onClick={() => setActiveStationTab('qa')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'qa' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>QA & Verification</span>
        </button>

        <button
          onClick={() => setActiveStationTab('devops')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'devops' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-blue-400" />
          <span>CI/CD & Canary</span>
        </button>

        <button
          onClick={() => setActiveStationTab('security')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeStationTab === 'security' ? 'bg-[#075BFF] text-white shadow-xs' : 'text-[#827D8E] hover:text-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-rose-400" />
          <span>AppSec & Governance</span>
        </button>

        <button
          onClick={() => setActiveStationTab('team_access')}
          className={`px-3.5 py-2 rounded-xl font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ml-auto ${
            activeStationTab === 'team_access' ? 'bg-indigo-600 text-white shadow-xs' : 'text-indigo-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Role & Station Access</span>
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeStationTab === 'overview' && (
        <div className="space-y-6">
          <SpotlightCard className="p-8 space-y-6" spotlightColor="rgba(7, 91, 255, 0.15)">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-xs font-mono text-[#827D8E]">
                  <span>Code: {selectedProject.code}</span>
                  <span>·</span>
                  <span className="capitalize text-[#075BFF]">Status: {selectedProject.status}</span>
                  <span>·</span>
                  <span>Phase: {selectedProject.phase}</span>
                </div>
                <h2 className="text-3xl font-semibold tracking-tight text-white">
                  {selectedProject.name}
                </h2>
                <p className="text-sm text-[#B5B1C0] max-w-2xl leading-relaxed font-light">
                  {selectedProject.description || 'Active delivery stream with separated station workspaces.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => factoryStore.setScreen('developer_dashboard')}
                  className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Launch Agent Swarm</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] font-mono text-xs flex flex-wrap gap-4 text-[#827D8E]">
              <div>Repository: <span className="text-cyan-400">{selectedProject.repositoryUrl}</span></div>
              <div>Health: <span className="text-emerald-400 capitalize">{selectedProject.health}</span></div>
              <div>Target Release: <span className="text-white">{selectedProject.targetReleaseDate}</span></div>
            </div>
          </SpotlightCard>

          {/* Station Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              onClick={() => setActiveStationTab('product')}
              className="p-5 bg-[#0c0e15]/90 border border-white/[0.08] hover:border-[#075BFF]/50 rounded-2xl cursor-pointer transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-amber-400 uppercase">Product Station</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Requirements & Epics</h3>
              <p className="text-xs text-[#827D8E]">
                {projectEpics.length} Epics defined · AI feasibility scoring & scope gating.
              </p>
            </div>

            <div
              onClick={() => setActiveStationTab('developer')}
              className="p-5 bg-[#0c0e15]/90 border border-white/[0.08] hover:border-[#075BFF]/50 rounded-2xl cursor-pointer transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-cyan-400 uppercase">Developer Swarm</span>
                <Terminal className="w-4 h-4 text-cyan-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Engineering & Code</h3>
              <p className="text-xs text-[#827D8E]">
                {projectTasks.length} Tasks · {projectPRs.length} PRs opened by autonomous workers.
              </p>
            </div>

            <div
              onClick={() => setActiveStationTab('qa')}
              className="p-5 bg-[#0c0e15]/90 border border-white/[0.08] hover:border-[#075BFF]/50 rounded-2xl cursor-pointer transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-emerald-400 uppercase">QA Verification</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Test Suites & Gates</h3>
              <p className="text-xs text-[#827D8E]">
                {projectTests.length} Automated scenarios · Chaos fault-injection ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Product & Epics */}
      {activeStationTab === 'product' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Product Scope & Epics</h2>
            <button
              onClick={() => factoryStore.setScreen('roadmap')}
              className="px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
            >
              Open Full Roadmap View →
            </button>
          </div>

          <GlassCard className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase font-mono tracking-wider">
              Objective & Requirements Statement
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed font-mono bg-slate-950 p-4 rounded-xl border border-slate-800">
              {selectedProject.description || 'No detailed scope written yet.'}
            </p>
          </GlassCard>
        </div>
      )}

      {/* Tab 3: Architecture & ADRs */}
      {activeStationTab === 'architecture' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Architecture & System Boundaries</h2>
            <button
              onClick={() => factoryStore.setScreen('system_design')}
              className="px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
            >
              Open Mermaid Studio →
            </button>
          </div>

          <GlassCard className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Architecture Decision Records (ADRs)</h3>
            <p className="text-xs text-slate-400">
              Track decisions, system invariants, and data models before code is generated.
            </p>
          </GlassCard>
        </div>
      )}

      {/* Tab 4: Developer Swarm */}
      {activeStationTab === 'developer' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Developer Station & Swarm Control</h2>
            <button
              onClick={() => factoryStore.setScreen('developer_dashboard')}
              className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Open Developer Studio</span>
            </button>
          </div>

          <GlassCard className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-[#075BFF] font-semibold">Autonomous Task Execution</span>
              <span className="text-xs font-mono text-emerald-400">Isolated Sandboxes</span>
            </div>
            <p className="text-xs text-slate-400">
              Deep agents receive task context packages, execute edits in isolated container sandboxes, run test validation, and open pull requests.
            </p>
          </GlassCard>
        </div>
      )}

      {/* Tab 5: QA & Verification */}
      {activeStationTab === 'qa' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">QA Verification & Defect Gates</h2>
            <button
              onClick={() => factoryStore.setScreen('qa_dashboard')}
              className="px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
            >
              Open QA Matrix →
            </button>
          </div>

          <GlassCard className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white">Test Suites & Unlazy Gates</h3>
            <p className="text-xs text-slate-400">
              Deterministic verification guarantees that agent claims are validated against actual exit codes.
            </p>
          </GlassCard>
        </div>
      )}

      {/* Tab 6: CI/CD & Canary */}
      {activeStationTab === 'devops' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">CI/CD Pipelines & Infrastructure</h2>
            <button
              onClick={() => factoryStore.setScreen('pipeline_studio')}
              className="px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
            >
              Open Pipeline DAGs →
            </button>
          </div>
        </div>
      )}

      {/* Tab 7: AppSec */}
      {activeStationTab === 'security' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Security & Threat Modeling</h2>
            <button
              onClick={() => factoryStore.setScreen('security_dashboard')}
              className="px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
            >
              Open AppSec Scanner →
            </button>
          </div>
        </div>
      )}

      {/* Tab 8: Role & Station Access Control */}
      {activeStationTab === 'team_access' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Project Access & Separation of Views</h2>
              <p className="text-xs text-[#827D8E]">
                The project manager or creator decides who handles which station and generates invite links
              </p>
            </div>
          </div>

          {/* Project Invite Generator */}
          <GlassCard className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Link className="w-4 h-4 text-indigo-400" />
              <span>Copy Project Invite Link</span>
            </h3>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as FactoryRole)}
                className="px-3.5 py-2.5 bg-[#07070B] border border-white/[0.08] rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {(Object.keys(ROLE_CONFIGS) as FactoryRole[]).map((r) => (
                  <option key={r} value={r}>
                    Assign Role: {ROLE_CONFIGS[r].label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleCopyProjectInvite}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedProjectLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>Invite Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Project Invite Link</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-[#827D8E]">
              Anyone with this link joining the workspace will be immediately enrolled into this project with the chosen station permissions.
            </p>
          </GlassCard>

          {/* Assigned Workspace Members */}
          <GlassCard className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Enrolled Team Members & Station Permissions</h3>
            <div className="divide-y divide-white/[0.08]">
              {state.members.map((member) => (
                <div key={member.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-semibold text-xs">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">{member.name}</div>
                      <div className="text-[11px] text-[#827D8E] font-mono">{member.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-1 bg-white/[0.06] text-white rounded-lg border border-white/[0.08]">
                      {member.roles[0] || 'Member'}
                    </span>
                    <span className="text-xs text-emerald-400 font-mono">Active</span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
