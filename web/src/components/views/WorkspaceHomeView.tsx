import React, { useState } from 'react';
import {
  Layers,
  ArrowRight,
  Plus,
  FolderGit2,
  GitPullRequest,
  Sparkles,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Trash2,
  CheckCircle2,
  Terminal,
  Activity,
  Workflow,
  Radio,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';
import { BorderBeam } from '../reactbits/BorderBeam';

interface WorkspaceHomeViewProps {
  state: FactoryState;
}

export const WorkspaceHomeView: React.FC<WorkspaceHomeViewProps> = ({ state }) => {
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [quickProductName, setQuickProductName] = useState('');
  const [quickProjectName, setQuickProjectName] = useState('');
  const [activeTab, setActiveTab] = useState<'products' | 'projects' | 'activity'>('products');
  const [actionError, setActionError] = useState<string | null>(null);
  // Server-decided: owners/admins manage the product; guides are read-only.
  const isAdmin = state.myAccess === 'owner' || state.myAccess === 'admin';
  // Guides and reviewers are read-only on project work.
  const isGuide = state.myAccess === 'guide' || state.myAccess === 'reviewer';
  const run = (action: Promise<unknown>) => {
    setActionError(null);
    action.catch((e: Error) => setActionError(e.message || 'Something went wrong.'));
  };

  const workspaceProducts = state.products;
  const workspaceProjects = state.projects;
  const workspacePRs = state.pullRequests;

  const handleQuickAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickProductName.trim()) return;
    run(
      factoryStore
        .createProduct({
          name: quickProductName.trim(),
          domain: 'Cloud Services',
          description: 'Production engineering product deliverable.',
        })
        .then(() => setQuickProductName('')),
    );
  };

  const handleQuickAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickProjectName.trim()) return;
    run(
      factoryStore
        .createProject({
          name: quickProjectName.trim(),
          productId: state.products[0]?.id || '',
          description: 'Core engineering project microservice.',
        })
        .then(() => setQuickProjectName('')),
    );
  };

  return (
    <div className="space-y-10 max-w-6xl mx-auto animate-fade-in pb-16">
      <CreateProjectModal
        isOpen={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        state={state}
      />

      {/* Hero Header with Cinematic Blue Editorial Typography */}
      <div className="relative pb-8 border-b border-white/[0.08] flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-mono text-[#075BFF] font-medium px-2 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">
              {state.workspace.name}
            </span>
            <span className="text-xs text-[#827D8E] font-mono">· Autonomous Factory Unit</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-tight">
            Factory <ShinyText text="Overview" speed={4} />
          </h1>
          <p className="text-sm text-[#B5B1C0] max-w-2xl font-light leading-relaxed">
            Autonomous software delivery lifecycle — unified across product discovery, AI agent execution, multi-model reviews, and release verification.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isAdmin && (
          <button
            onClick={() => factoryStore.setScreen('product_create')}
            className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-[#075BFF]/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Product</span>
          </button>
          )}
          {!isGuide && (
          <button
            onClick={() => setCreateProjectOpen(true)}
            disabled={state.products.length === 0}
            className="px-5 py-2.5 bg-[#101016] border border-white/[0.1] hover:border-white/20 hover:bg-[#17151D] disabled:opacity-40 disabled:cursor-not-allowed text-[#F6F5FA] rounded-xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer"
          >
            <FolderGit2 className="w-4 h-4 text-[#075BFF]" />
            <span>New Project</span>
          </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2.5">{actionError}</div>
      )}

      {/* React Bits Interactive Spotlight Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SpotlightCard
          className="bg-[#0c0e15]/90 border-white/[0.08] space-y-1"
          spotlightColor="rgba(7, 91, 255, 0.2)"
        >
          <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E] font-medium flex items-center justify-between">
            <span>Products</span>
            <Layers className="w-4 h-4 text-[#075BFF]" />
          </div>
          <div className="text-4xl sm:text-5xl font-light tracking-tight text-white font-sans mt-2">
            {workspaceProducts.length}
          </div>
          <div className="text-[11px] text-[#827D8E] pt-1 font-mono">Active core products</div>
        </SpotlightCard>

        <SpotlightCard
          className="bg-[#0c0e15]/90 border-white/[0.08] space-y-1"
          spotlightColor="rgba(81, 76, 232, 0.2)"
        >
          <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E] font-medium flex items-center justify-between">
            <span>Projects</span>
            <FolderGit2 className="w-4 h-4 text-[#514CE8]" />
          </div>
          <div className="text-4xl sm:text-5xl font-light tracking-tight text-white font-sans mt-2">
            {workspaceProjects.length}
          </div>
          <div className="text-[11px] text-[#827D8E] pt-1 font-mono">Engineering streams</div>
        </SpotlightCard>

        <SpotlightCard
          className="bg-[#0c0e15]/90 border-white/[0.08] space-y-1"
          spotlightColor="rgba(6, 182, 212, 0.2)"
        >
          <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E] font-medium flex items-center justify-between">
            <span>Pull Requests</span>
            <GitPullRequest className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-4xl sm:text-5xl font-light tracking-tight text-white font-sans mt-2">
            {workspacePRs.length}
          </div>
          <div className="text-[11px] text-[#827D8E] pt-1 font-mono">Code review pipelines</div>
        </SpotlightCard>

        <SpotlightCard
          className="bg-[#0c0e15]/90 border-white/[0.08] space-y-1"
          spotlightColor="rgba(168, 85, 247, 0.2)"
        >
          <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E] font-medium flex items-center justify-between">
            <span>Feature Ideas</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-4xl sm:text-5xl font-light tracking-tight text-white font-sans mt-2">
            {state.ideas.length}
          </div>
          <div className="text-[11px] text-[#827D8E] pt-1 font-mono">Discovery evaluations</div>
        </SpotlightCard>
      </div>

      {/* Quick Interactive Execution Bar */}
      <div className="relative rounded-2xl bg-[#0c0e15]/90 border border-white/[0.08] p-5 text-[#F6F5FA] space-y-3">
        <BorderBeam size={150} duration={14} colorFrom="#075BFF" colorTo="#514CE8" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#075BFF] animate-ping" />
            <h2 className="text-sm font-semibold text-white tracking-wide">Quick Real-Time Creation</h2>
          </div>
          <span className="text-[11px] font-mono text-[#827D8E]">Instant Execution</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <form onSubmit={handleQuickAddProduct} className="flex gap-2">
            <input
              type="text"
              placeholder={isAdmin ? 'Add product name (e.g. Payment Gateway)...' : 'Only workspace admins can add products'}
              value={quickProductName}
              disabled={!isAdmin}
              onChange={(e) => setQuickProductName(e.target.value)}
              className="flex-1 px-3.5 py-2 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!isAdmin || !quickProductName.trim()}
              className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer"
            >
              + Add Product
            </button>
          </form>

          <form onSubmit={handleQuickAddProject} className="flex gap-2">
            <input
              type="text"
              placeholder={
                isGuide
                  ? `${state.myAccess === 'reviewer' ? 'Reviewers' : 'Guides'} have read-only access`
                  : state.products.length > 0
                  ? "Add project name (e.g. Auth Microservice)..."
                  : "Create a product first to add projects"
              }
              value={quickProjectName}
              disabled={isGuide || state.products.length === 0}
              onChange={(e) => setQuickProjectName(e.target.value)}
              className="flex-1 px-3.5 py-2 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isGuide || !quickProjectName.trim() || state.products.length === 0}
              className="px-4 py-2 bg-[#17151D] hover:bg-[#211B2A] border border-white/[0.1] disabled:opacity-40 text-white rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer"
            >
              + Add Project
            </button>
          </form>
        </div>
      </div>

      {/* Segmented Switcher */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3">
          <button
            onClick={() => setActiveTab('products')}
            className={`text-sm font-medium transition-colors pb-3 -mb-3.5 cursor-pointer ${
              activeTab === 'products'
                ? 'text-white font-semibold border-b-2 border-[#075BFF]'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Products ({workspaceProducts.length})
          </button>
          <button
            onClick={() => setActiveTab('projects')}
            className={`text-sm font-medium transition-colors pb-3 -mb-3.5 cursor-pointer ${
              activeTab === 'projects'
                ? 'text-white font-semibold border-b-2 border-[#075BFF]'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Projects ({workspaceProjects.length})
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`text-sm font-medium transition-colors pb-3 -mb-3.5 cursor-pointer ${
              activeTab === 'activity'
                ? 'text-white font-semibold border-b-2 border-[#075BFF]'
                : 'text-[#827D8E] hover:text-white'
            }`}
          >
            Audit Ledger ({state.auditLogs.length})
          </button>
        </div>

        {/* TAB 1: PRODUCTS */}
        {activeTab === 'products' && (
          <div>
            {workspaceProducts.length === 0 ? (
              <GlassCard className="p-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-[#075BFF] flex items-center justify-center mx-auto border border-white/[0.08]">
                  <Layers className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-medium text-white">No products registered</h3>
                  <p className="text-sm text-[#827D8E] max-w-md mx-auto font-light">
                    Create your first product to anchor engineering projects, code review pipelines, and release gates.
                  </p>
                </div>
                {isAdmin ? (
                <button
                  onClick={() => factoryStore.setScreen('product_create')}
                  className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Product</span>
                </button>
                ) : (
                  <p className="text-xs text-[#827D8E] font-mono">The workspace admin sets up the product.</p>
                )}
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workspaceProducts.map((prod) => (
                  <SpotlightCard
                    key={prod.id}
                    className="p-6 bg-[#0c0e15]/90 border-white/[0.08] hover:border-[#075BFF]/40 transition-all space-y-4 group"
                    spotlightColor="rgba(7, 91, 255, 0.15)"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-mono text-[#827D8E]">
                          <span>{prod.code}</span>
                          <span>·</span>
                          <span className="text-[#075BFF]">{prod.domain}</span>
                        </div>
                        <h3 className="text-2xl font-medium text-white tracking-tight truncate">
                          {prod.name}
                        </h3>
                      </div>
                      {isAdmin && (
                      <button
                        onClick={() => run(factoryStore.deleteProduct(prod.id))}
                        className="text-[#827D8E] hover:text-rose-400 p-1 rounded-md transition-colors cursor-pointer"
                        title="Delete product (removes it for everyone)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      )}
                    </div>

                    <p className="text-xs text-[#B5B1C0] line-clamp-2 leading-relaxed font-light">
                      {prod.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {prod.techStack.map((tech) => (
                        <span
                          key={tech}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.06] text-[#B5B1C0] border border-white/[0.08]"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>

                    <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
                      <div className="text-xs text-[#827D8E] font-mono">
                        {prod.activeProjectCount || 0} projects · {prod.activeIdeaCount || 0} ideas
                      </div>
                      <button
                        onClick={() => {
                          factoryStore.selectProduct(prod.id);
                          factoryStore.setScreen('product_detail');
                        }}
                        className="text-xs font-semibold text-[#075BFF] group-hover:text-blue-400 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Open Workspace</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </SpotlightCard>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PROJECTS */}
        {activeTab === 'projects' && (
          <div>
            {workspaceProjects.length === 0 ? (
              <GlassCard className="p-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-[#075BFF] flex items-center justify-center mx-auto border border-white/[0.08]">
                  <FolderGit2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-medium text-white">No engineering projects yet</h3>
                  <p className="text-sm text-[#827D8E] max-w-md mx-auto font-light">
                    Projects manage repositories, tasks, QA tests, and deployment pipelines.
                  </p>
                </div>
                <button
                  onClick={() => setCreateProjectOpen(true)}
                  disabled={state.products.length === 0}
                  className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Project</span>
                </button>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workspaceProjects.map((proj) => {
                  const product = state.products.find((p) => p.id === proj.productId);
                  return (
                    <SpotlightCard
                      key={proj.id}
                      className="p-6 bg-[#0c0e15]/90 border-white/[0.08] hover:border-[#514CE8]/40 transition-all space-y-4 group"
                      spotlightColor="rgba(81, 76, 232, 0.15)"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs font-mono text-[#827D8E]">
                            <span>{proj.code}</span>
                            <span>·</span>
                            <span className="text-[#514CE8]">{product?.name || 'General Product'}</span>
                          </div>
                          <h3 className="text-2xl font-medium text-white tracking-tight truncate">
                            {proj.name}
                          </h3>
                        </div>
                        {factoryStore.canDeleteProject(proj) && (
                        <button
                          onClick={() => run(factoryStore.deleteProject(proj.id))}
                          className="text-[#827D8E] hover:text-rose-400 p-1 rounded-md transition-colors cursor-pointer"
                          title="Delete project (removes it for everyone)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        )}
                      </div>

                      <p className="text-xs text-[#B5B1C0] line-clamp-2 leading-relaxed font-light">
                        {proj.description}
                      </p>

                      <div className="text-xs font-mono text-[#827D8E]">
                        Repo: <span className="text-cyan-400">{proj.repositoryUrl}</span>
                      </div>

                      <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
                        <span className="text-xs font-mono text-[#827D8E] capitalize">
                          Phase: <span className="text-white">{proj.phase}</span>
                        </span>
                        <button
                          onClick={() => {
                            factoryStore.selectProject(proj.id);
                            factoryStore.setScreen('projects');
                          }}
                          className="text-xs font-semibold text-[#514CE8] group-hover:text-indigo-400 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span>Open Project</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </SpotlightCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVITY AUDIT */}
        {activeTab === 'activity' && (
          <GlassCard className="p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#075BFF]" />
                <h3 className="text-sm font-semibold text-white">Cryptographic Audit Ledger</h3>
              </div>
              <span className="text-xs font-mono text-[#827D8E]">{state.auditLogs.length} events</span>
            </div>

            {state.auditLogs.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#827D8E] font-mono">
                No activity recorded yet. Start by creating a product or project above.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {state.auditLogs.map((log) => (
                  <div key={log.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                    <div>
                      <div className="font-medium text-white">{log.action}</div>
                      <div className="text-[#827D8E] text-[11px] mt-0.5 font-light">{log.details}</div>
                    </div>
                    <span className="text-[10px] font-mono text-[#075BFF] shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  );
};
