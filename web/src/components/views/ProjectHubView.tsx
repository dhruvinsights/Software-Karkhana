import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createInvite } from '../../lib/invites';
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
  MessageSquare,
  AtSign,
  Send,
  Loader2,
  Mic,
  MicOff,
  ListTree,
} from 'lucide-react';
import { factoryStore, FactoryState, ROLE_CONFIGS } from '../../store/factoryStore';
import { FactoryRole, ScreenId, ProjectComment } from '../../types/factory';
import { PRReviewPanel } from './PRReviewPanel';
import { ProjectStationBoard, StationBar, ProjectMemberRow, StationTab } from './ProjectStationBoard';
import {
  fetchProjectComments,
  postProjectComment,
  fetchWorkspaceMembers,
  useChatFrames,
  type WorkspaceMember,
} from '../../lib/chatSocket';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { ProjectPlanPanel } from './ProjectPlanPanel';
import { ProjectDesignPanel } from './ProjectDesignPanel';
import { stationsApi, useStationList, ApiTestScenario } from '../../lib/stationsApi';

/** Server-side QA scenario count for the project card. */
const ScenarioSummary: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { items, loading, error, offline } = useStationList<ApiTestScenario>(projectId, stationsApi.listScenarios);
  if (offline) return <>No server record yet.</>;
  if (loading) return <>Loading scenarios…</>;
  if (error) return <>Scenarios unavailable.</>;
  const passed = items.filter((t) => t.status === 'passed').length;
  return <>{items.length} scenarios · {passed} passed.</>;
};

/** Idea text can arrive as raw markdown; show it as plain words. */
const plainTitle = (text: string | undefined): string =>
  (text ?? '')
    .replace(/[#*_`|>]+/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface ProjectHubViewProps {
  state: FactoryState;
}

export const ProjectHubView: React.FC<ProjectHubViewProps> = ({ state }) => {
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [activeStationTab, setActiveStationTab] = useState<StationTab>('overview');
  const [projectMembers, setProjectMembers] = useState<ProjectMemberRow[]>([]);
  const [myStations, setMyStations] = useState<string[]>([]);

  // ── Comments state ────────────────────────────────────────────────────────
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<string[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = state.token ?? '';
  const [isDeleting, setIsDeleting] = useState(false);

  const [copiedProjectLink, setCopiedProjectLink] = useState(false);
  const [projectInviteError, setProjectInviteError] = useState<string | null>(null);
  const [inviteStations, setInviteStations] = useState<string[]>([]);
  const [accessInfo, setAccessInfo] = useState<{ access: string; canManage: boolean; isLead: boolean } | null>(null);
  const [inviteRole, setInviteRole] = useState<FactoryRole>('developer');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const activeProduct = selectedProject
    ? state.products.find((p) => p.id === selectedProject.productId)
    : state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  // ── Load comments + members when switching to comments tab ───────────────
  useEffect(() => {
    if (activeStationTab !== 'comments' || !selectedProject) return;
    setCommentsLoading(true);
    Promise.all([
      fetchProjectComments(selectedProject.id, token).catch(() => state.projectComments.filter((c: ProjectComment) => c.projectId === selectedProject.id)),
      fetchWorkspaceMembers(token).catch(() => state.members.map((m) => ({ id: m.id, displayName: m.name, email: m.email, avatarUrl: m.avatar, online: m.availability === 'online' }))),
    ]).then(([cmts, mems]) => {
      setComments(cmts as ProjectComment[]);
      setMembers(mems as WorkspaceMember[]);
    }).finally(() => setCommentsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStationTab, selectedProject?.id]);

  // Live: receive new project comments over WebSocket
  useChatFrames('project_comment', (frame) => {
    if (!selectedProject || frame.projectId !== selectedProject.id) return;
    const newComment: ProjectComment = {
      id: frame.id, projectId: frame.projectId, authorId: frame.authorId,
      authorName: frame.authorName, authorAvatar: frame.authorAvatar,
      body: frame.body, mentions: frame.mentions, createdAt: frame.createdAt,
    };
    setComments((prev) => prev.some((c) => c.id === newComment.id) ? prev : [...prev, newComment]);
  }, [selectedProject?.id]);

  const handleDeleteCurrentProject = async () => {
    if (!selectedProject) return;
    if (!window.confirm(`Are you sure you want to delete "${selectedProject.name}"? This will permanently archive the project and remove it from DB and cache for all members.`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await factoryStore.deleteProject(selectedProject.id);
    } catch (e: any) {
      alert(`Failed to delete project: ${e?.message || e}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSendComment = async () => {
    if (!commentText.trim() || !selectedProject) return;
    const body = commentText.trim();
    setCommentText(''); setPendingMentions([]); setMentionQuery(null);
    try {
      const result = await postProjectComment(selectedProject.id, body, pendingMentions, token) as ProjectComment;
      setComments((prev) => prev.some((c) => c.id === result.id) ? prev : [...prev, result]);
      factoryStore.addProjectComment(result);
    } catch {
      const localCmt: ProjectComment = {
        id: `cmt-${Date.now()}`, projectId: selectedProject.id,
        authorId: state.currentUser?.id ?? 'usr-lead', authorName: state.currentUser?.display_name ?? 'You',
        body, mentions: pendingMentions, createdAt: new Date().toISOString(),
      };
      setComments((prev) => [...prev, localCmt]);
      factoryStore.addProjectComment(localCmt);
    }
  };

  const toggleVoiceComment = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Web Speech API not supported in this browser.'); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    recognitionRef.current = rec;
    let final = commentText;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += (final ? ' ' : '') + ev.results[i][0].transcript;
        else interim = ev.results[i][0].transcript;
      }
      setCommentText(final + (interim ? ` ${interim}` : ''));
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    rec.start(); setListening(true);
  };

  const handleCommentInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCommentText(val);
    const match = val.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const insertCommentMention = (m: WorkspaceMember) => {
    setCommentText((t) => t.replace(/@(\w*)$/, `@${m.displayName} `));
    setPendingMentions((prev) => [...prev, m.id]);
    setMentionQuery(null);
  };

  const STATION_LABELS: Record<string, string> = {
    product: 'Product', design: 'Design', architecture: 'Architecture', developer: 'Developer',
    qa: 'QA', devops: 'DevOps', security: 'Security', release: 'Release',
  };

  useEffect(() => {
    const pid = selectedProject?.id;
    if (!pid || !token || pid.length !== 36) {
      setAccessInfo(null);
      return;
    }
    fetch(`/api/projects/${pid}/access`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        setAccessInfo(a ? { access: a.access, canManage: a.canManage, isLead: !!a.isLead } : null);
        setMyStations(a?.stations ?? []);
      })
      .catch(() => setAccessInfo(null));
  }, [selectedProject?.id, token]);

  const loadProjectMembers = useCallback(() => {
    const pid = selectedProject?.id;
    if (!pid || !token || pid.length !== 36) {
      setProjectMembers([]);
      return;
    }
    fetch(`/api/projects/${pid}/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setProjectMembers(rows as ProjectMemberRow[]))
      .catch(() => setProjectMembers([]));
  }, [selectedProject?.id, token]);

  useEffect(() => { loadProjectMembers(); }, [loadProjectMembers]);
  // Anyone joining, leaving or changing station triggers a workspace_sync: refresh the teams live.
  useChatFrames('workspace_sync', () => { loadProjectMembers(); }, [loadProjectMembers]);
  useChatFrames('reconnected', () => { loadProjectMembers(); }, [loadProjectMembers]);

  const toggleProjectAccess = async () => {
    if (!selectedProject || !accessInfo) return;
    setProjectInviteError(null);
    const next = accessInfo.access === 'restricted' ? 'open' : 'restricted';
    const res = await fetch(`/api/projects/${selectedProject.id}/access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ access: next }),
    });
    if (res.ok) {
      const a = await res.json();
      setAccessInfo({ access: a.access, canManage: a.canManage, isLead: !!a.isLead });
    } else {
      const j = await res.json().catch(() => ({}));
      setProjectInviteError(typeof j.detail === 'string' ? j.detail : 'Could not change access.');
    }
  };

  const handleCopyProjectInvite = async () => {
    if (!selectedProject) return;
    setProjectInviteError(null);
    try {
      const inv = await createInvite(token, state.activeWorkspaceId, {
        role: inviteRole,
        project_id: selectedProject.id,
        stations: inviteStations.length ? inviteStations : undefined,
      });
      await navigator.clipboard.writeText(inv.inviteLink);
      setCopiedProjectLink(true);
      setTimeout(() => setCopiedProjectLink(false), 3000);
    } catch (e) {
      setProjectInviteError((e as Error).message);
    }
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
            className="k-btn-primary px-6 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
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
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white line-clamp-2" title={selectedProject.name}>
            <ShinyText text={plainTitle(selectedProject.name)} speed={5} />
          </h1>
          <p className="text-sm text-[#827D8E] max-w-2xl font-light line-clamp-2">
            {plainTitle(selectedProject.description) || 'Coordinating multi-discipline engineering delivery and station access.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {factoryStore.canDeleteProject(selectedProject) && (
            <button
              onClick={handleDeleteCurrentProject}
              disabled={isDeleting}
              className="px-3.5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              title="Delete project from DB and cache"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              <span>Delete Project</span>
            </button>
          )}
          <button
            onClick={() => setCreateProjectModalOpen(true)}
            className="k-btn-primary px-4 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-[#075BFF]/20 transition-all cursor-pointer"
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

      {/* Station screens: the board is home; each station opens as its own screen. */}
      {activeStationTab !== 'overview' && (
        <StationBar
          tab={activeStationTab}
          members={projectMembers}
          canInvite={!!accessInfo && (accessInfo.canManage || accessInfo.isLead)}
          token={token}
          workspaceId={state.activeWorkspaceId}
          projectId={selectedProject.id}
          onBack={() => setActiveStationTab('overview')}
          onOpenTeam={() => setActiveStationTab('team_access')}
        />
      )}

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
                  className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Launch Agent Swarm</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] font-mono text-xs flex flex-wrap gap-4 text-[#827D8E]">
              <div>Repository: <span className="text-[#5B8FFF]">{selectedProject.repositoryUrl}</span></div>
              <div>Health: <span className="text-emerald-400 capitalize">{selectedProject.health}</span></div>
              <div>Target Release: <span className="text-white">{selectedProject.targetReleaseDate}</span></div>
            </div>
          </SpotlightCard>

          {/* One card per station, each with its own team and reviewers */}
          <ProjectStationBoard
            members={projectMembers}
            visible={(station) => station === null || myStations.includes(station)}
            counts={{
              plan: `${projectEpics.length} epics`,
              product: `${projectEpics.length} epics defined`,
              developer: `${projectTasks.length} tasks · ${projectPRs.length} PRs`,
              team_access: `${projectMembers.length} people`,
            }}
            onOpen={setActiveStationTab}
          />
        </div>
      )}

      {/* Plan: epics and stories, approved by a lead */}
      {activeStationTab === 'plan' && (
        <ProjectPlanPanel
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          canEdit={!!accessInfo && (accessInfo.canManage || accessInfo.isLead)}
        />
      )}

      {/* Design: contracts and screens, approved by the design station */}
      {activeStationTab === 'design' && (
        <ProjectDesignPanel projectId={selectedProject.id} canDesign={myStations.includes('design')} />
      )}

      {/* Tab 2: Product & Epics */}
      {activeStationTab === 'product' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Product Scope & Epics</h2>
            <button
              onClick={() => factoryStore.setScreen('roadmap')}
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
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
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
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
          {/* Sub-header with Studio link */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Developer Station & Swarm Control</h2>
            <button
              onClick={() => factoryStore.setScreen('developer_dashboard')}
              className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Open Developer Studio</span>
            </button>
          </div>

          {/* Quick-stats bar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 bg-[#0c0e15]/90 border border-white/[0.08] rounded-2xl">
              <p className="text-xs font-mono text-[#827D8E] uppercase tracking-wider mb-1">Open PRs</p>
              <p className="text-2xl font-mono font-bold text-white">
                {state.pullRequests.filter((pr) => pr.projectId === selectedProject.id && pr.status === 'open').length}
              </p>
            </div>
            <div className="p-4 bg-[#0c0e15]/90 border border-white/[0.08] rounded-2xl">
              <p className="text-xs font-mono text-[#827D8E] uppercase tracking-wider mb-1">Merged</p>
              <p className="text-2xl font-mono font-bold" style={{ color: 'var(--purple)' }}>
                {state.pullRequests.filter((pr) => pr.projectId === selectedProject.id && pr.status === 'merged').length}
              </p>
            </div>
            <div className="p-4 bg-[#0c0e15]/90 border border-white/[0.08] rounded-2xl">
              <p className="text-xs font-mono text-[#827D8E] uppercase tracking-wider mb-1">Tasks in flight</p>
              <p className="text-2xl font-mono font-bold" style={{ color: 'var(--accent)' }}>
                {projectTasks.filter((i) => i.status === 'in_progress').length}
              </p>
            </div>
          </div>

          {/* Full PR review engine */}
          <div className="p-6 bg-[#0c0e15]/90 border border-white/[0.08] rounded-2xl">
            <div className="flex items-center gap-2 mb-5">
              <GitPullRequest className="w-4 h-4 text-[#5B8FFF]" />
              <h3 className="text-sm font-semibold text-white">Pull Request Review Engine</h3>
              <span className="text-xs font-mono text-[#075BFF] ml-auto">Karkhana AI · Better than CodeRabbit</span>
            </div>
            <PRReviewPanel
              projectId={selectedProject.id}
              token={token}
            />
          </div>
        </div>
      )}

      {/* Tab 5: QA & Verification */}
      {activeStationTab === 'qa' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">QA Verification & Defect Gates</h2>
            <button
              onClick={() => factoryStore.setScreen('qa_dashboard')}
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
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
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
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
              className="k-btn-secondary px-4 py-2 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs font-medium hover:border-white/20 transition-colors cursor-pointer"
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
              <Link className="w-4 h-4 text-[#5B8FFF]" />
              <span>Copy Project Invite Link</span>
            </h3>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as FactoryRole)}
                className="px-3.5 py-2.5 bg-[#07070B] border border-white/[0.08] rounded-xl text-xs text-white focus:outline-none focus:border-[#075BFF]/25"
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
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STATION_LABELS).map(([id, label]) => {
                const on = inviteStations.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInviteStations((s) => (on ? s.filter((x) => x !== id) : [...s, id]))}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
                      on ? 'bg-[#075BFF]/20 border-[#075BFF]/25 text-white' : 'border-white/[0.1] text-[#827D8E]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#827D8E]">
              {inviteStations.length ? 'They will only see the selected stations.' : 'No station selected: they get the default stations for their role.'}
            </p>
            {accessInfo && (
              <div className="flex items-center justify-between rounded-xl border border-white/[0.08] px-3.5 py-2.5">
                <div className="text-[12px] text-white">
                  {accessInfo.access === 'restricted' ? 'Restricted to the project team' : 'Open to the whole workspace'}
                </div>
                {accessInfo.canManage && (
                  <button
                    type="button"
                    onClick={toggleProjectAccess}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white cursor-pointer"
                  >
                    {accessInfo.access === 'restricted' ? 'Open to workspace' : 'Restrict to team'}
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-[#827D8E]">
              Anyone who opens this link and signs in joins the workspace and this project with the chosen role. The link works for 14 days.
            </p>
            {projectInviteError && <p className="text-[11px] text-red-400">{projectInviteError}</p>}
          </GlassCard>

          {/* Assigned Workspace Members */}
          <GlassCard className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Project team and stations</h3>
            <div className="divide-y divide-white/[0.08]">
              {projectMembers.length === 0 && (
                <p className="py-3 text-xs text-[#827D8E]">No one is on this project yet. Copy an invite link above.</p>
              )}
              {projectMembers.map((member) => (
                <div key={member.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#075BFF] to-blue-600 flex items-center justify-center text-white font-semibold text-xs overflow-hidden">
                      {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="w-full h-full object-cover" /> : member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">{member.name}</div>
                      <div className="text-[11px] text-[#827D8E] font-mono">{member.email}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-mono uppercase px-2 py-1 bg-white/[0.06] text-white rounded-lg border border-white/[0.08]">
                      {member.role}{member.isLead ? ' · lead' : ''}
                    </span>
                    {member.stations.map((st) => (
                      <span key={st} className="text-[10px] px-2 py-1 rounded-full border border-white/[0.1] text-[#B5B1C0]">
                        {STATION_LABELS[st] ?? st}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Tab 9: Comments & @Mentions */}
      {activeStationTab === 'comments' && (
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[#5B8FFF]" />
              Project Comments
            </h2>
            <span className="text-xs text-[#827D8E] font-mono">{comments.length} comment{comments.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Comments list */}
          <div className="space-y-3">
            {commentsLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 text-[#827D8E] animate-spin" />
              </div>
            )}
            {!commentsLoading && comments.length === 0 && (
              <div className="text-center py-10 text-[#827D8E] text-sm">
                No comments yet. Start the conversation below.
              </div>
            )}
            {comments.map((c) => {
              const isMe = c.authorId === (state.currentUser?.id ?? 'usr-lead');
              const renderBody = (body: string) =>
                body.split(/(@\w[\w\s]*)/).map((part, i) =>
                  part.startsWith('@')
                    ? <span key={i} className="text-[#00d9a6] font-semibold bg-[#00d9a6]/10 rounded px-0.5">{part}</span>
                    : <span key={i}>{part}</span>
                );
              return (
                <div key={c.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#075BFF] to-[#5B8FFF] flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {(c.authorName || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className={`flex-1 max-w-[80%] ${isMe ? 'items-end' : ''} flex flex-col gap-1`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-white">{c.authorName}</span>
                      <span className="text-[10px] text-[#4e5668] font-mono">
                        {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isMe
                        ? 'bg-[#075BFF]/20 border border-[#075BFF]/30 text-[#d0d4de]'
                        : 'bg-white/[0.05] border border-white/[0.08] text-[#d0d4de]'
                    }`}>
                      {renderBody(c.body)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comment composer */}
          <div className="relative pt-2 border-t border-white/[0.08]">
            {/* @mention picker */}
            {mentionQuery !== null && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#131720] border border-white/[0.12] rounded-xl overflow-hidden shadow-2xl z-10">
                <div className="px-3 py-1.5 text-[10px] uppercase font-mono tracking-wider text-[#4e5668]">Members</div>
                {members
                  .filter((m) => m.displayName.toLowerCase().includes(mentionQuery.toLowerCase()))
                  .slice(0, 5)
                  .map((m) => (
                    <button key={m.id} onClick={() => insertCommentMention(m)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors text-sm text-[#d0d4de]"
                    >
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#075BFF] to-[#5B8FFF] flex items-center justify-center text-[9px] font-bold text-white">{m.displayName.charAt(0)}</div>
                      <span className="font-medium">{m.displayName}</span>
                      <span className="text-[10px] text-[#4e5668] ml-auto font-mono">{m.email}</span>
                    </button>
                  ))}
              </div>
            )}

            <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.1] rounded-2xl px-3 py-2 mt-2">
              <textarea
                value={commentText}
                onChange={handleCommentInput}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
                placeholder="Add a comment... @mention teammates"
                rows={2}
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-white placeholder-[#4e5668] leading-relaxed"
                style={{ fontFamily: 'var(--font-sans)' }}
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={toggleVoiceComment} title={listening ? 'Stop recording' : 'Voice input'}
                  className={`p-1.5 rounded-lg border transition-all ${listening ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-transparent border-transparent text-[#4e5668] hover:text-white'}`}
                >
                  {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setCommentText((t) => t + '@')} title="Mention"
                  className="p-1.5 rounded-lg border border-transparent text-[#4e5668] hover:text-white transition-colors"
                >
                  <AtSign className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleSendComment}
                  disabled={!commentText.trim()}
                  className={`k-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${commentText.trim() ? 'bg-[#075BFF] text-white cursor-pointer' : 'bg-white/[0.05] text-[#4e5668] cursor-not-allowed'}`}
                >
                  <Send className="w-3 h-3" /> Post
                </button>
              </div>
            </div>
            <p className="text-[10px] text-[#4e5668] mt-1.5 font-mono">Enter to post · Shift+Enter for new line · @ to mention</p>
          </div>
        </div>
      )}
    </div>
  );
};
