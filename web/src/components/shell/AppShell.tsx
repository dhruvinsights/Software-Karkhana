import React, { useState } from 'react';
import {
  Layers,
  Search,
  Plus,
  FolderGit2,
  GitPullRequest,
  CheckCircle2,
  Shield,
  Terminal,
  Cpu,
  ChevronDown,
  LayoutGrid,
  GitBranch,
  Bug,
  Server,
  Activity,
  BookOpen,
  Sliders,
  LogOut,
  ExternalLink,
  Sparkles,
  Command,
  Check,
  ChevronRight,
  Workflow,
  Radio,
} from 'lucide-react';
import { factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole, ScreenId } from '../../types/factory';
import { AICompanion } from './AICompanion';
import { CommandPalette } from './CommandPalette';
import { CreateProductModal } from '../workspace/CreateProductModal';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { WorkspaceInviteModal } from '../workspace/WorkspaceInviteModal';
import { LiquidEther } from '../reactbits/LiquidEther';
import { UserPlus } from 'lucide-react';

interface AppShellProps {
  state: FactoryState;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ state, children }) => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const activeRole = ROLE_CONFIGS[state.currentRole];
  const activeProduct = state.products.find((p) => p.id === state.selectedProductId) || state.products[0];
  const activeProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];

  // Map screenId → display label for the breadcrumb
  const SCREEN_LABELS: Partial<Record<ScreenId, string>> = {
    workspace_home: 'Overview', products: 'Products', product_detail: 'Product Detail',
    ideas: 'Idea Lab', idea_detail: 'Idea Detail', idea_generate: 'AI Brainstorm',
    projects: 'Project Hub', project_detail: 'Project Detail',
    approvals: 'Approvals', portfolio: 'Portfolio',
    roadmap: 'Roadmap', epics: 'Epics', issues: 'Issues', board: 'Sprint Board',
    developer_dashboard: 'Engineering & Agents', pull_requests: 'Pull Requests',
    system_design: 'System Architecture', adrs: 'ADRs', prototype_studio: 'Design System',
    qa_dashboard: 'QA Verification', security_dashboard: 'Security & AppSec',
    pipeline_studio: 'CI/CD Pipelines', release_dashboard: 'Releases & Canary',
    feedback_inbox: 'Incidents & Triage', knowledge_hub: 'Knowledge Base',
    rule_governance: 'Factory Governance', workflow_templates: 'Workflow Admin',
  };
  const currentScreenLabel = SCREEN_LABELS[state.currentScreen] ?? state.currentScreen.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Curated, modern navigation structure - sleek, minimal, zero slop
  const navSections = [
    {
      title: 'Workspace',
      items: [
        { id: 'workspace_home' as ScreenId, label: 'Overview', icon: LayoutGrid },
        { id: 'products' as ScreenId, label: 'Products', icon: Layers, count: state.products.length },
        { id: 'projects' as ScreenId, label: 'Project Hub', icon: FolderGit2, count: state.projects.length },
        { id: 'ideas' as ScreenId, label: 'Idea Lab', icon: Sparkles, count: state.ideas.length },
      ],
    },
    {
      title: 'Build & Code',
      items: [
        { id: 'developer_dashboard' as ScreenId, label: 'Engineering & Agents', icon: Terminal },
        { id: 'pull_requests' as ScreenId, label: 'Pull Requests', icon: GitPullRequest, count: state.pullRequests.length },
        { id: 'system_design' as ScreenId, label: 'System Architecture', icon: Workflow },
        { id: 'prototype_studio' as ScreenId, label: 'Design System', icon: Cpu },
      ],
    },
    {
      title: 'Quality & Ops',
      items: [
        { id: 'qa_dashboard' as ScreenId, label: 'QA Verification', icon: CheckCircle2 },
        { id: 'security_dashboard' as ScreenId, label: 'Security & AppSec', icon: Shield, count: state.securityFindings.length },
        { id: 'pipeline_studio' as ScreenId, label: 'CI/CD Pipelines', icon: Server },
        { id: 'release_dashboard' as ScreenId, label: 'Releases & Canary', icon: Radio },
      ],
    },
    {
      title: 'Knowledge',
      items: [
        { id: 'feedback_inbox' as ScreenId, label: 'Incidents & Triage', icon: Activity },
        { id: 'knowledge_hub' as ScreenId, label: 'Knowledge Base', icon: BookOpen },
        { id: 'rule_governance' as ScreenId, label: 'Factory Governance', icon: Sliders },
      ],
    },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#07070B] text-[#F6F5FA] antialiased font-sans select-none">
      {/* Full-viewport LiquidEther background — covers sidebar + content */}
      <LiquidEther
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
        colors={['#2a00ff', '#5300ff', '#b497cf']}
        mouseForce={42}
        cursorSize={55}
        persistence={0.78}
        autoDemo
        autoSpeed={0.5}
        autoIntensity={1.4}
        intensity={1.6}
        viscosity={0}
        resolution={0.5}
        clickBurst
        bounceEdges={false}
        intro
        lightMode={false}
      />
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <CreateProductModal isOpen={createProductOpen} onClose={() => setCreateProductOpen(false)} />
      <CreateProjectModal isOpen={createProjectOpen} onClose={() => setCreateProjectOpen(false)} state={state} />
      <WorkspaceInviteModal isOpen={inviteModalOpen} onClose={() => setInviteModalOpen(false)} state={state} />

      {/* Dark Editorial Sidebar */}
      <aside className="w-64 bg-[#0A0A0F]/75 backdrop-blur-md text-[#B5B1C0] flex flex-col shrink-0 border-r border-white/[0.08] z-20">
        {/* Workspace Brand & Switcher Header - Pure typography, NO icon badge */}
        <div className="p-4 border-b border-white/[0.08]">
          <div className="mb-3 px-1 flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight text-white">Software Karkhana</span>
            <span className="text-[10px] font-mono tracking-widest text-[#075BFF] uppercase px-1.5 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">v2.4</span>
          </div>
          <button
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-[#101016] hover:bg-[#17151D] border border-white/[0.08] transition-colors group text-left"
          >
            <div className="min-w-0">
              <span className="text-[12px] font-medium text-[#F6F5FA] truncate block leading-tight">
                {state.workspace.name}
              </span>
              <span className="text-[10px] text-[#827D8E] block leading-tight truncate mt-0.5 font-mono">
                {state.workspace.isDemo ? 'Autonomous Engine' : 'Production Unit'}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#827D8E] group-hover:text-white transition-colors shrink-0" />
          </button>

          {workspaceMenuOpen && (
            <div className="mt-2 bg-[#16181d] rounded-xl border border-neutral-700/80 p-1.5 shadow-2xl text-xs space-y-1">
              <div className="px-2.5 py-1 text-[10px] uppercase font-mono tracking-wider text-neutral-400 font-medium">
                Workspaces
              </div>
              {state.workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    factoryStore.switchWorkspace(ws.id);
                    setWorkspaceMenuOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                    ws.id === state.workspace.id
                      ? 'bg-neutral-800 text-white font-medium'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                  }`}
                >
                  <span className="truncate">{ws.name}</span>
                  {ws.id === state.workspace.id && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
              <div className="h-px bg-neutral-800 my-1" />
              <button
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  factoryStore.startOnboarding();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 font-medium"
              >
                + New Workspace
              </button>
            </div>
          )}
        </div>

        {/* Quick Search Bar */}
        <div className="px-4 pt-3 pb-1">
          <button
            onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-900/60 hover:bg-neutral-800/80 border border-neutral-800/80 text-neutral-400 hover:text-neutral-200 transition-colors text-xs"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              <span>Search or jump to...</span>
            </div>
            <kbd className="font-mono text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">⌘K</kbd>
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              <div className="px-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                {section.title}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = state.currentScreen === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => factoryStore.setScreen(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-all group ${
                      isActive
                        ? 'bg-neutral-800 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-neutral-400 group-hover:text-neutral-300'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={`text-[11px] font-mono ${isActive ? 'text-neutral-300' : 'text-neutral-400'}`}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Session Footer */}
        <div className="p-3 border-t border-white/[0.08] space-y-2 bg-[#0A0A0F]">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#101016] border border-white/[0.06]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-xs text-white shrink-0">
              {(state.currentUser?.display_name || state.members[0]?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate leading-tight">
                {state.currentUser?.display_name || state.members[0]?.name || 'Dhruv Chaturvedi'}
              </div>
              <div className="text-[10px] text-[#075BFF] font-mono truncate mt-0.5">
                {state.currentUser?.role ? state.currentUser.role.replace('_', ' ').toUpperCase() : activeRole.label}
              </div>
            </div>
          </div>

          <button
            onClick={() => setInviteModalOpen(true)}
            className="w-full py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Invite to Workspace</span>
          </button>

          {/* Quick links */}
          <div className="flex items-center justify-between pt-1 px-1">
            <button
              onClick={() => factoryStore.setScreen('landing')}
              className="text-[11px] text-[#827D8E] hover:text-white transition-colors flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Public Landing</span>
            </button>
            <button
              onClick={() => factoryStore.signOut()}
              className="text-[11px] text-[#827D8E] hover:text-rose-400 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Stage */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Atmospheric Glow in background */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(7,91,255,0.06)_0%,_transparent_65%)]" />

        {/* Dark Editorial Top Navigation Header */}
        <header className="h-14 bg-[#0A0A0F]/90 backdrop-blur-md border-b border-white/[0.08] px-6 flex items-center justify-between shrink-0 z-10">
          {/* Breadcrumb Path — always reflects current screen */}
            <div className="flex items-center gap-2 text-sm overflow-hidden">
              <button
                onClick={() => factoryStore.setScreen('workspace_home')}
                className="font-semibold text-[#B5B1C0] hover:text-white transition-colors truncate shrink-0"
              >
                {state.workspace.name}
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-[#827D8E] shrink-0" />
              <span className="font-medium text-[#F6F5FA] truncate">{currentScreenLabel}</span>
              {(state.currentScreen === 'project_detail' || state.currentScreen === 'pull_requests') && activeProject && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-[#827D8E] shrink-0" />
                  <span className="font-medium text-[#B5B1C0] truncate max-w-[160px]">{activeProject.name}</span>
                </>
              )}
            </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-3">
            {/* Invite Button in Topbar */}
            <button
              onClick={() => setInviteModalOpen(true)}
              className="h-8 px-3 rounded-lg bg-[#101016] hover:bg-[#17151D] border border-white/[0.08] text-indigo-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Invite</span>
            </button>

            {/* Create Dropdown */}
            <div className="relative">
              <button
                onClick={() => setCreateMenuOpen(!createMenuOpen)}
                className="h-8 px-3 rounded-lg bg-[#075BFF] hover:bg-[#075BFF]/90 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create</span>
              </button>

              {createMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-[#101016] rounded-xl shadow-2xl border border-white/[0.12] p-1.5 z-50 text-xs space-y-0.5">
                  <button
                    onClick={() => {
                      setCreateProductOpen(true);
                      setCreateMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] flex items-center gap-2"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#075BFF]" />
                    <span>New Product</span>
                  </button>
                  <button
                    onClick={() => {
                      setCreateProjectOpen(true);
                      setCreateMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] flex items-center gap-2"
                  >
                    <FolderGit2 className="w-3.5 h-3.5 text-[#075BFF]" />
                    <span>New Project</span>
                  </button>
                  <button
                    onClick={() => {
                      factoryStore.setScreen('idea_generate');
                      setCreateMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] flex items-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#514CE8]" />
                    <span>Propose Innovation</span>
                  </button>
                </div>
              )}
            </div>

            {/* AI Companion Toggle */}
            <button
              onClick={() => factoryStore.toggleCompanion()}
              className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                state.companionOpen
                  ? 'bg-white text-black border-white font-semibold'
                  : 'bg-[#101016] text-[#B5B1C0] border-white/[0.1] hover:text-white hover:bg-[#17151D]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Companion</span>
            </button>

            {/* User Profile */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/20 focus:outline-none"
              >
                <img
                  src={state.members[0]?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces'}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#101016] rounded-xl shadow-2xl border border-white/[0.12] p-2 z-50 text-xs space-y-1">
                  <div className="px-2.5 py-1.5 border-b border-white/[0.08]">
                    <div className="font-semibold text-white">{state.members[0]?.name || 'Factory Lead'}</div>
                    <div className="text-[11px] text-[#827D8E] font-mono">{state.members[0]?.email || 'lead@karkhana.internal'}</div>
                  </div>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      factoryStore.setScreen('landing');
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] flex items-center gap-2"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#827D8E]" />
                    <span>Public Landing Page</span>
                  </button>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      factoryStore.signOut();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Viewport Workspace Content and Companion */}
        <div className="flex-1 flex overflow-hidden relative z-1">
          <main className="flex-1 overflow-y-auto p-8 lg:p-10 min-w-0 bg-[#07070B]/80 backdrop-blur-sm text-[#F6F5FA] relative z-1">
            {children}
          </main>
          <AICompanion state={state} />
        </div>
      </div>
    </div>
  );
};
