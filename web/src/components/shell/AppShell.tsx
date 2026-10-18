import React, { useEffect, useState, lazy, Suspense, useRef } from 'react';
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
  MessageSquare,
  Bell,
  UserPlus,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';

const ProductIdeaLab = lazy(() => import('../views/ProductIdeaLab').then((m) => ({ default: m.ProductIdeaLab })));
import { ACCESS_LABEL, factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole, ScreenId } from '../../types/factory';
import { AICompanion } from './AICompanion';
import { CommandPalette } from './CommandPalette';
import { ChatPanel, openChatChannel } from './ChatPanel';
import { ActivityFeedPanel } from './ActivityFeedPanel';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { WorkspaceInviteModal } from '../workspace/WorkspaceInviteModal';
import { WorkspaceAdminPanel } from '../workspace/WorkspaceAdminPanel';
import { LiquidEther } from '../reactbits/LiquidEther';
import { chatSocket, fetchUnreadCounts } from '../../lib/chatSocket';

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
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [otherToolsOpen, setOtherToolsOpen] = useState(false);
  // Team Chat takes the full width: fold the nav on entry, restore it on exit.
  const navBeforeChat = useRef<boolean | null>(null);
  useEffect(() => {
    if (state.currentScreen === 'team_chat' && navBeforeChat.current === null) {
      navBeforeChat.current = sidebarCollapsed;
      setSidebarCollapsed(true);
    } else if (state.currentScreen !== 'team_chat' && navBeforeChat.current !== null) {
      setSidebarCollapsed(navBeforeChat.current);
      navBeforeChat.current = null;
    }
  }, [state.currentScreen]);
  const [ideaqOpen, setIdeaqOpen] = useState(false);

  // Open IdeaQ overlay when screen transitions to 'ideaq'
  useEffect(() => {
    if (state.currentScreen === 'ideaq') setIdeaqOpen(true);
  }, [state.currentScreen]);

  // Which stations the signed-in person may use on the selected project.
  // null = unknown or unrestricted, so nothing is hidden.
  const [stationAccess, setStationAccess] = useState<{ stations: string[]; restricted: boolean } | null>(null);
  useEffect(() => {
    const pid = state.selectedProjectId;
    const jwt = state.token;
    if (!pid || !jwt || pid.length !== 36) {
      setStationAccess(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${pid}/access`, { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        if (cancelled) return;
        setStationAccess(a ? { stations: a.stations as string[], restricted: a.access === 'restricted' } : null);
      })
      .catch(() => !cancelled && setStationAccess(null));
    return () => {
      cancelled = true;
    };
  }, [state.selectedProjectId, state.token]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const isWorkspaceAdmin = state.myAccess === 'owner' || state.myAccess === 'admin';
  // Guides and reviewers are read-only on project work.
  const isGuide = state.myAccess === 'guide' || state.myAccess === 'reviewer';

  // Connect WebSocket for the active workspace when authenticated
  const wsIsReal = state.activeWorkspaceId.length === 36 && state.activeWorkspaceId.includes('-');
  useEffect(() => {
    if (state.token) {
      chatSocket.connect(state.token, wsIsReal ? state.activeWorkspaceId : undefined);
      factoryStore.ensureGeneralChannel();
    }
  }, [state.token, state.activeWorkspaceId, wsIsReal]);

  // Header badges come from the server, refreshed whenever something arrives live
  // (a message, a mention or review request, a new channel) or the socket reconnects.
  useEffect(() => {
    if (!state.token || !wsIsReal) return;
    const token = state.token;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fetchUnreadCounts(token).then(factoryStore.setUnreadCounts).catch(() => {});
      }, 300);
    };
    refresh();
    const unsubscribe = chatSocket.subscribe((frame) => {
      if (['activity', 'message', 'channel_created', 'reconnected', 'project_comment'].includes(frame.type)) refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [state.token, state.activeWorkspaceId, wsIsReal, chatOpen, activityOpen]);

  // When anyone in the workspace creates/deletes a project or product, or changes
  // someone's access, the server tells every open tab to re-sync from it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = chatSocket.subscribe((frame) => {
      if (frame.type !== 'workspace_sync' && frame.type !== 'reconnected') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => factoryStore.syncSessionFromServer(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const chatUnread = state.chatUnreadTotal ?? 0;
  const activityUnread = state.activityUnreadTotal ?? 0;

  const activeRole = ROLE_CONFIGS[state.currentRole];
  const activeProduct = state.products.find((p) => p.id === state.selectedProductId) || state.products[0];
  const activeProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];

  // Map screenId → display label for the breadcrumb
  const SCREEN_LABELS: Partial<Record<ScreenId, string>> = {
    workspace_home: 'Overview', team_chat: 'Team Chat', products: 'Products', product_detail: 'Product Detail', product_create: 'Create Product',
    ideas: 'Idea Lab', idea_detail: 'Idea Detail', idea_generate: 'AI Brainstorm',
    projects: 'Project Hub', project_detail: 'Project Detail',
    approvals: 'Reviewer Space', portfolio: 'Portfolio',
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
        { id: 'approvals' as ScreenId, label: 'Reviews', icon: ShieldCheck },
        { id: 'team_chat' as ScreenId, label: 'Team Chat', icon: MessageSquare, count: chatUnread || undefined },
      ],
    },
    {
      title: 'Build & Code',
      items: [
        { station: 'developer', id: 'developer_dashboard' as ScreenId, label: 'Engineering & Agents', icon: Terminal },
        { station: 'developer', id: 'pull_requests' as ScreenId, label: 'Pull Requests', icon: GitPullRequest, count: state.pullRequests.length },
        { station: 'architecture', id: 'system_design' as ScreenId, label: 'System Architecture', icon: Workflow },
        { station: 'design', id: 'prototype_studio' as ScreenId, label: 'Design System', icon: Cpu },
      ],
    },
    {
      title: 'Quality & Ops',
      items: [
        { station: 'qa', id: 'qa_dashboard' as ScreenId, label: 'QA Verification', icon: CheckCircle2 },
        { station: 'security', id: 'security_dashboard' as ScreenId, label: 'Security & AppSec', icon: Shield },
        { station: 'devops', id: 'pipeline_studio' as ScreenId, label: 'CI/CD Pipelines', icon: Server },
        { station: 'release', id: 'release_dashboard' as ScreenId, label: 'Releases', icon: Radio },
      ],
    },
    {
      title: 'Knowledge',
      items: [
        { id: 'feedback_inbox' as ScreenId, label: 'Incidents', icon: Activity },
        { id: 'knowledge_hub' as ScreenId, label: 'Knowledge Base', icon: BookOpen },
        { id: 'rule_governance' as ScreenId, label: 'Factory Governance', icon: Sliders },
      ],
    },
  ];

  // Role-focused sidebar: everyone gets the shared spaces; each role adds its own
  // stations. The rest stays reachable under "Other tools", never removed.
  // Reviews is shared: any member can be named a reviewer, and the inbox only
  // lists what is assigned to the person looking at it.
  const SHARED_NAV: ScreenId[] = ['workspace_home', 'products', 'projects', 'approvals', 'team_chat', 'knowledge_hub'];
  const ROLE_NAV: Record<string, ScreenId[]> = {
    developer: ['developer_dashboard', 'pull_requests', 'system_design', 'prototype_studio', 'qa_dashboard', 'pipeline_studio', 'release_dashboard'],
    designer: ['prototype_studio', 'qa_dashboard'],
    product_manager: ['approvals', 'prototype_studio', 'qa_dashboard', 'release_dashboard'],
    architect: ['approvals', 'developer_dashboard', 'pull_requests', 'system_design', 'security_dashboard', 'rule_governance'],
    qa: ['pull_requests', 'qa_dashboard', 'release_dashboard', 'feedback_inbox'],
    security: ['approvals', 'pull_requests', 'system_design', 'security_dashboard'],
    devops: ['developer_dashboard', 'pull_requests', 'pipeline_studio', 'release_dashboard', 'feedback_inbox'],
    release_manager: ['pull_requests', 'qa_dashboard', 'pipeline_studio', 'release_dashboard', 'feedback_inbox'],
    executive: ['approvals', 'release_dashboard', 'rule_governance'],
    support: ['feedback_inbox'],
  };
  const seesEverything = isWorkspaceAdmin || state.currentRole === 'admin';
  // The role you were invited with in this workspace wins over the account-level role.
  const ROLE_ALIAS: Record<string, string> = { pm: 'product_manager', director: 'executive', lead: 'architect', release: 'release_manager', ops: 'devops' };
  const rawRole = state.workspaceMembers.find((m) => m.id === state.currentUser?.id)?.role || state.currentRole;
  const navRole = ROLE_ALIAS[rawRole] ?? rawRole;
  const roleNav = new Set<ScreenId>([...SHARED_NAV, ...(ROLE_NAV[navRole] ?? ROLE_NAV.developer)]);
  const stationAllowed = (item: { station?: string }) =>
    !(stationAccess?.restricted && item.station && !stationAccess.stations.includes(item.station));
  const inRole = (id: ScreenId) => seesEverything || roleNav.has(id) || state.currentScreen === id;
  const visibleSections = navSections
    .map((sec) => ({ ...sec, items: sec.items.filter((i) => stationAllowed(i as { station?: string }) && inRole(i.id)) }))
    .filter((sec) => sec.items.length > 0);
  const otherTools = navSections.flatMap((sec) => sec.items.filter((i) => stationAllowed(i as { station?: string }) && !inRole(i.id)));

  const renderNavItem = (item: (typeof navSections)[number]['items'][number]) => {
                const Icon = item.icon;
                const isActive = state.currentScreen === item.id;
                const count = (item as { count?: number }).count;
                return (
                  <button
                    key={item.id}
                    data-tour={`nav-${item.id}`}
                    onClick={() => factoryStore.setScreen(item.id)}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-1' : 'justify-between px-3'} py-2.5 rounded-lg text-[15px] font-medium transition-all group ${
                      isActive
                        ? 'bg-neutral-800 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900/60'
                    }`}
                  >
                    <div className={`flex items-center ${sidebarCollapsed ? '' : 'gap-2.5 truncate'}`}>
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-neutral-400 group-hover:text-neutral-300'}`} />
                      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {!sidebarCollapsed && count !== undefined && count > 0 && (
                      <span className={`text-[12px] font-mono ${isActive ? 'text-neutral-300' : 'text-neutral-400'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
  };

  return (
    <div className="app-zoom flex overflow-hidden bg-[#07070B] text-[#F6F5FA] antialiased font-sans select-none">
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
      <CreateProjectModal isOpen={createProjectOpen} onClose={() => setCreateProjectOpen(false)} state={state} />
      {state.inviteNotice && (
        <div
          role="status"
          style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 80, maxWidth: 480, padding: '12px 16px', borderRadius: 12, background: '#0f1a2e', border: '1px solid rgba(7,91,255,.5)', color: '#fff', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center' }}
        >
          <span>{state.inviteNotice}</span>
          <button onClick={() => factoryStore.dismissInviteNotice()} style={{ opacity: 0.7, cursor: 'pointer' }} aria-label="Dismiss">✕</button>
        </div>
      )}
      <WorkspaceInviteModal isOpen={inviteModalOpen} onClose={() => setInviteModalOpen(false)} state={state} />
      <WorkspaceAdminPanel isOpen={adminPanelOpen} onClose={() => setAdminPanelOpen(false)} state={state} />

      {/* Dark Editorial Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-72'} bg-[#0A0A0F]/75 backdrop-blur-md text-[#B5B1C0] flex flex-col shrink-0 border-r border-white/[0.08] z-20 overflow-hidden transition-[width] duration-300 ease-in-out`}>
        {/* Workspace Brand & Switcher Header - Pure typography, NO icon badge */}
        <div className={`p-4 border-b border-white/[0.08] ${sidebarCollapsed ? 'px-2' : ''}`}>
          {!sidebarCollapsed && (
          <div className="mb-3 px-1 flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight text-white">Software Karkhana</span>
            <span className="text-[10px] font-mono tracking-widest text-[#075BFF] uppercase px-1.5 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">v2.4</span>
          </div>
          )}
          {!sidebarCollapsed && (
          <button
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-[#101016] hover:bg-[#17151D] border border-white/[0.08] transition-colors group text-left"
          >
            <div className="min-w-0">
              <span className="text-[12px] font-medium text-[#F6F5FA] truncate block leading-tight">
                {state.workspace.name}
              </span>
              <span className="text-[11.5px] text-[#827D8E] block leading-tight truncate mt-0.5 font-mono">
                {state.workspace.isDemo ? 'Autonomous Engine' : 'Production Unit'}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#827D8E] group-hover:text-white transition-colors shrink-0" />
          </button>
          )}

          {!sidebarCollapsed && workspaceMenuOpen && (
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

        {/* Quick Search Bar — hidden when collapsed */}
        {!sidebarCollapsed && (
        <div className="px-4 pt-3 pb-1">
          <button
            onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-900/60 hover:bg-neutral-800/80 border border-neutral-800/80 text-neutral-400 hover:text-neutral-200 transition-colors text-[13.5px]"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              <span>Search or jump to...</span>
            </div>
            <kbd className="font-mono text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">⌘K</kbd>
          </button>
        </div>
        )}

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-5">
          {/* AI Companion lives in the sidebar now (was in the topbar) */}
          <button
            onClick={() => factoryStore.toggleCompanion()}
            title="AI Companion"
            className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-1' : 'gap-2.5 px-3'} py-2.5 rounded-lg text-[15px] font-medium border transition-all ${
              state.companionOpen
                ? 'bg-[#075BFF]/15 border-[#075BFF]/45 text-white'
                : 'bg-white/[0.03] border-white/[0.08] text-neutral-300 hover:text-white hover:border-[#075BFF]/40 hover:bg-[#075BFF]/10'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0 text-[#5B8FFF]" />
            {!sidebarCollapsed && <span className="truncate">AI Companion</span>}
          </button>

          {visibleSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {!sidebarCollapsed && (
              <div className="px-3 text-[11.5px] font-semibold text-neutral-400 uppercase tracking-wider">
                {section.title}
              </div>
              )}
              {section.items.map(renderNavItem)}
            </div>
          ))}

          {otherTools.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => setOtherToolsOpen((o) => !o)}
                title="Tools outside your role"
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-1' : 'justify-between px-3'} py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors`}
              >
                {sidebarCollapsed ? <ChevronDown className={`w-4 h-4 transition-transform ${otherToolsOpen ? '' : '-rotate-90'}`} /> : (
                  <>
                    <span>Other tools ({otherTools.length})</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${otherToolsOpen ? '' : '-rotate-90'}`} />
                  </>
                )}
              </button>
              {otherToolsOpen && otherTools.map(renderNavItem)}
            </div>
          )}
        </nav>

        {/* User Session Footer */}
        <div className="p-3 border-t border-white/[0.08] space-y-2 bg-[#0A0A0F]">
          {/* Sidebar collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full py-1.5 px-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors text-[#827D8E] hover:text-white"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <><PanelLeftClose className="w-3.5 h-3.5" /><span>Collapse</span></>}
          </button>

          {!sidebarCollapsed && (
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#101016] border border-white/[0.06]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-xs text-white shrink-0">
              {(state.currentUser?.display_name || state.members[0]?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-white truncate leading-tight">
                {state.currentUser?.display_name || state.members[0]?.name || 'Dhruv Chaturvedi'}
              </div>
              <div className="text-[11.5px] text-[#075BFF] font-mono truncate mt-0.5">
                {(state.workspaceMembers.find((m) => m.id === state.currentUser?.id)?.role ?? state.currentUser?.role)
                  ? (state.workspaceMembers.find((m) => m.id === state.currentUser?.id)?.role ?? state.currentUser!.role).replace(/_/g, ' ').toUpperCase()
                  : activeRole.label}
              </div>
              {state.myAccess && state.myAccess !== 'member' && (
                <span
                  className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${
                    state.myAccess === 'guide'
                      ? 'text-[#9b6dff] bg-[#9b6dff]/10 border-[#9b6dff]/30'
                      : state.myAccess === 'reviewer'
                      ? 'text-[#00d9a6] bg-[#00d9a6]/10 border-[#00d9a6]/30'
                      : 'text-[#f0a500] bg-[#f0a500]/10 border-[#f0a500]/30'
                  }`}
                  title={ACCESS_LABEL[state.myAccess]}
                >
                  <ShieldCheck className="w-2.5 h-2.5" />
                  {state.myAccess === 'owner' ? 'Workspace Admin' : ACCESS_LABEL[state.myAccess]}
                </span>
              )}
            </div>
          </div>
          )}

          {!sidebarCollapsed && isWorkspaceAdmin && (
            <button
              onClick={() => setAdminPanelOpen(true)}
              className="w-full py-1.5 px-2 bg-[#f0a500]/10 hover:bg-[#f0a500]/20 text-[#f0a500] border border-[#f0a500]/30 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin Panel</span>
            </button>
          )}

          {!sidebarCollapsed && (
          <button
            onClick={() => setInviteModalOpen(true)}
            className="w-full py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Invite to Workspace</span>
          </button>
          )}

          {/* Quick links */}
          {!sidebarCollapsed && (
          <div className="flex items-center justify-between pt-1 px-1">
            <button
              onClick={() => factoryStore.setScreen('landing')}
              className="text-[12.5px] text-[#827D8E] hover:text-white transition-colors flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Public Landing</span>
            </button>
            <button
              onClick={() => factoryStore.signOut()}
              className="text-[12.5px] text-[#827D8E] hover:text-rose-400 transition-colors"
            >
              Sign Out
            </button>
          </div>
          )}
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
            {/* Activity Feed */}
            <button
              onClick={() => { setActivityOpen((o) => !o); if (chatOpen) setChatOpen(false); }}
              className={`relative h-8 w-8 rounded-lg flex items-center justify-center transition-colors border cursor-pointer ${activityOpen ? 'bg-[#f0a500]/15 border-[#f0a500]/40 text-[#f0a500]' : 'bg-[#101016] border-white/[0.08] text-[#827D8E] hover:text-white hover:bg-[#17151D]'}`}
              title="Activity & Mentions"
            >
              <Bell className="w-4 h-4" />
              {activityUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#f0a500] text-black text-[9px] font-bold rounded-full flex items-center justify-center font-mono leading-none">{activityUnread > 9 ? '9+' : activityUnread}</span>
              )}
            </button>

            {/* Chat */}
            <button
              onClick={() => { if (state.currentScreen === 'team_chat') return; setChatOpen((o) => !o); if (activityOpen) setActivityOpen(false); }}
              className={`relative h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border cursor-pointer ${chatOpen || state.currentScreen === 'team_chat' ? 'bg-[#075BFF]/20 border-[#075BFF]/50 text-[#75aaff]' : 'bg-[#101016] border-white/[0.08] text-[#827D8E] hover:text-white hover:bg-[#17151D]'}`}
              title="Team Chat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
              {chatUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#075BFF] text-white text-[9px] font-bold rounded-full flex items-center justify-center font-mono leading-none">{chatUnread > 9 ? '9+' : chatUnread}</span>
              )}
            </button>

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
                  {isWorkspaceAdmin && (
                  <button
                    onClick={() => {
                      factoryStore.setScreen('product_create');
                      setCreateMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] flex items-center gap-2"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#075BFF]" />
                    <span>New Product</span>
                  </button>
                  )}
                  {!isGuide && (
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
                  )}
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
          <main data-tour="main" className={`flex-1 overflow-y-auto min-w-0 bg-[#07070B]/80 backdrop-blur-sm text-[#F6F5FA] relative z-1 select-text ${['ideas', 'idea_detail', 'idea_generate', 'idea_compare', 'research_evidence', 'idea_report', 'product_detail'].includes(state.currentScreen) ? '' : state.currentScreen === 'team_chat' ? 'overflow-hidden!' : 'p-8 lg:p-10'}`}>
            {children}
          </main>
          <AICompanion state={state} />
        </div>
      </div>

      {/* Chat Panel (slides in from right) */}
      {chatOpen && state.currentScreen !== 'team_chat' && (
        <ChatPanel
          onClose={() => setChatOpen(false)}
          onExpand={() => { setChatOpen(false); factoryStore.setScreen('team_chat'); }}
        />
      )}

      {/* Activity Feed Panel (slides in from right) */}
      {activityOpen && (
        <ActivityFeedPanel
          onClose={() => setActivityOpen(false)}
          onNavigate={(screen, targetId) => {
            setActivityOpen(false);
            if (screen === 'chat_channel') {
              // Mentions and channel events open the full-screen chat on that channel.
              if (targetId) openChatChannel(targetId);
              setChatOpen(false);
              factoryStore.setScreen('team_chat');
              return;
            }
            factoryStore.setScreen(screen as any);
            if (targetId) factoryStore.selectProject(targetId);
          }}
        />
      )}

      {/* ── IdeaQ Full-Page Overlay ───────────────────────────────────────── */}
      {ideaqOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-[5vh_5vw]"
          style={{ padding: '5vh 5vw' }}
        >
          <div
            className="relative w-full h-full rounded-2xl overflow-hidden border border-white/[0.1] shadow-2xl"
            style={{ width: '90vw', height: '90vh' }}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setIdeaqOpen(false);
                // Navigate back if we came from ideaq screen
                if (state.currentScreen === 'ideaq') factoryStore.setScreen('product_detail');
              }}
              className="absolute top-4 right-4 z-50 w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.18] border border-white/[0.12] flex items-center justify-center text-[#B5B1C0] hover:text-white transition-all cursor-pointer"
              title="Close IdeaQ"
            >
              <X className="w-4 h-4" />
            </button>

            <Suspense fallback={<div className="flex items-center justify-center h-full bg-[#0A0A0F] text-[#827D8E] text-sm font-mono">Loading IdeaQ…</div>}>
              <ProductIdeaLab state={state} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
};
