/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * ProductWorkspaceView: Comprehensive Product Detail & Engineering Studio.
 * Houses enrolled Projects, Ideas Hub with multi-signature approvals & PRD exports,
 * and Architectural Specifications & ADR Decision Records.
 */

import React, { useState, useMemo } from 'react';
import {
  Layers,
  Plus,
  FolderGit2,
  Sparkles,
  GitPullRequest,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Shield,
  Activity,
  FileText,
  Search,
  Filter,
  Printer,
  Download,
  UserCheck,
  AlertCircle,
  X,
  Check,
  Rocket,
  Code2,
  AlertTriangle,
  BookOpen,
  Share2,
  HelpCircle,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { Idea, ProductKnowledge, ADR } from '../../types/factory';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';
import { IdeaApprovalPanel } from './IdeaApprovalPanel';
import { IdeaReportModal } from '../workspace/DocumentModal';
import { downloadIdeaReportPdf, reportLabel, startIdeaReport } from '../../lib/ideaReports';

interface ProductWorkspaceViewProps {
  state: FactoryState;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string; border: string }> = {
  draft: { label: 'Draft', bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
  pending_approval: { label: 'In Review', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/25' },
  evaluating: { label: 'Evaluating', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/25' },
  needs_evidence: { label: 'Needs Evidence', bg: 'bg-[#075BFF]/10', text: 'text-[#5B8FFF]', border: 'border-[#075BFF]/25' },
  approved: { label: 'Approved', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  rejected: { label: 'Rejected', bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/25' },
  promoted: { label: 'Project Created', bg: 'bg-[#075BFF]/10', text: 'text-[#5B8FFF]', border: 'border-[#075BFF]/25' },
};

export const ProductWorkspaceView: React.FC<ProductWorkspaceViewProps> = ({ state }) => {
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'projects' | 'ideas' | 'docs'>('ideas');

  // Filter & Search states for Ideas
  const [ideaSearch, setIdeaSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [proposeIdeaModalOpen, setProposeIdeaModalOpen] = useState(false);
  const [reviewModalIdea, setReviewModalIdea] = useState<Idea | null>(null);
  const [reportIdea, setReportIdea] = useState<Idea | null>(null);
  const [createAdrModalOpen, setCreateAdrModalOpen] = useState(false);

  // New Idea Form State
  const [newTitle, setNewTitle] = useState('');
  const [newProblem, setNewProblem] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newUser, setNewUser] = useState('Enterprise Developers & Systems Leads');
  const [newComplexity, setNewComplexity] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [newTagsStr, setNewTagsStr] = useState('Automation, Architecture, Core-Platform');

  // New ADR Form State
  const [adrTitle, setAdrTitle] = useState('');
  const [adrContext, setAdrContext] = useState('');
  const [adrDecision, setAdrDecision] = useState('');
  const [adrStatus, setAdrStatus] = useState<'proposed' | 'accepted' | 'superseded'>('accepted');

  const activeProduct = state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  if (!activeProduct) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-4 animate-fade-in">
        <h2 className="text-2xl font-semibold text-white">No Product Selected</h2>
        <p className="text-sm text-[#827D8E] font-light">Create a product first to view its engineering workspace.</p>
        <button
          onClick={() => factoryStore.setScreen('workspace_home')}
          className="k-btn-primary px-5 py-2.5 bg-[#075BFF] text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-[#075BFF]/20"
        >
          Return to Overview
        </button>
      </div>
    );
  }

  const enrolledProjects = state.projects.filter((p) => p.productId === activeProduct.id);
  const enrolledIdeas = state.ideas.filter((i) => i.productId === activeProduct.id);
  const productDocs = state.knowledge.filter((k) => k.productId === activeProduct.id);
  const productAdrs = state.adrs.filter((a) => {
    const proj = state.projects.find((p) => p.id === a.projectId);
    return proj?.productId === activeProduct.id;
  });

  const displayAdrs = productAdrs.map((a) => ({
    code: `ADR-${String(a.number).padStart(3, '0')}`,
    title: a.title,
    status: a.status.toUpperCase(),
    context: a.context,
    decision: a.decision,
  }));
  const reportedIdeas = enrolledIdeas.filter((i) => i.reviewReport?.status === 'ready');

  // Filtered Ideas
  const filteredIdeas = useMemo(() => {
    return enrolledIdeas.filter((idea) => {
      const matchSearch =
        idea.title.toLowerCase().includes(ideaSearch.toLowerCase()) ||
        idea.problemStatement.toLowerCase().includes(ideaSearch.toLowerCase()) ||
        idea.expectedValue.toLowerCase().includes(ideaSearch.toLowerCase()) ||
        idea.tags.some((t) => t.toLowerCase().includes(ideaSearch.toLowerCase()));

      if (!matchSearch) return false;
      if (statusFilter === 'all') return true;
      return idea.status === statusFilter;
    });
  }, [enrolledIdeas, ideaSearch, statusFilter]);

  // Idea stats
  const approvedIdeasCount = enrolledIdeas.filter((i) => i.status === 'approved' || i.status === 'promoted').length;
  const inReviewIdeasCount = enrolledIdeas.filter((i) => i.status === 'pending_approval' || i.status === 'evaluating').length;
  const promotedIdeasCount = enrolledIdeas.filter((i) => i.status === 'promoted' || i.promotedProjectId).length;

  const handleProposeIdea = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newProblem.trim()) return;

    const tags = newTagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const createdIdea: Idea = {
      id: `idea-${Date.now()}`,
      productId: activeProduct.id,
      workspaceId: activeProduct.workspaceId || state.workspace.id,
      title: newTitle.trim(),
      problemStatement: newProblem.trim(),
      expectedValue: newValue.trim() || 'Accelerates product velocity and engineering reliability.',
      targetUser: newUser.trim() || 'Enterprise Developers & Systems Architects',
      authorId: state.currentUser?.id || 'usr-lead',
      status: 'pending_approval',
      complexity: newComplexity,
      tags: tags.length > 0 ? tags : ['Automation', 'Core-Platform'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'manual',
    };

    factoryStore.addIdea(createdIdea);

    // Reset and close
    setNewTitle('');
    setNewProblem('');
    setNewValue('');
    setProposeIdeaModalOpen(false);
  };

  // Ready: open it. Not written yet: start it; the store re-syncs when it is done.
  const handleReport = async (idea: Idea) => {
    const token = state.token ?? '';
    if (idea.reviewReport?.status === 'ready') {
      setReportIdea(idea);
      return;
    }
    if (idea.reviewReport?.status === 'running') return;
    try {
      await startIdeaReport(idea.id, token);
      factoryStore.syncSessionFromServer();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDownloadReport = async (idea: Idea) => {
    try {
      await downloadIdeaReportPdf(idea.id, idea.title, state.token ?? '');
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="animate-fade-in p-6 sm:p-8 lg:p-10 max-w-7xl mx-auto space-y-8">
      {/* Modals */}
      <CreateProjectModal
        isOpen={createProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
        state={state}
      />

      {reportIdea && (
        <IdeaReportModal ideaId={reportIdea.id} title={reportIdea.title} token={state.token ?? ''} onClose={() => setReportIdea(null)} />
      )}

      {/* Review / Approvals Modal */}
      {reviewModalIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-[#0C0D14] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between pb-4 border-b border-white/[0.08]">
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#075BFF]">
                  Multi-Signature Approvals & Sign-off
                </span>
                <h3 className="text-xl font-semibold text-white">{reviewModalIdea.title}</h3>
                <p className="text-xs text-[#827D8E]">
                  Enforce zero-trust review discipline before promoting this idea into an active project.
                </p>
              </div>
              <button
                onClick={() => setReviewModalIdea(null)}
                className="p-2 text-[#827D8E] hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <IdeaApprovalPanel
              idea={reviewModalIdea}
              token={state.token ?? ''}
              workspaceId={activeProduct.workspaceId || state.workspace.id}
              currentUserId={state.currentUser?.id ?? 'usr-lead'}
            />
          </div>
        </div>
      )}

      {/* Propose Idea Modal */}
      {proposeIdeaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-[#0C0D14] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between pb-4 border-b border-white/[0.08]">
              <div>
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#075BFF]">
                  Idea Proposal
                </span>
                <h3 className="text-xl font-semibold text-white">Propose Feature Idea</h3>
                <p className="text-xs text-[#827D8E]">
                  Attach a new high-leverage initiative to {activeProduct.name} ({activeProduct.code}).
                </p>
              </div>
              <button
                onClick={() => setProposeIdeaModalOpen(false)}
                className="p-2 text-[#827D8E] hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProposeIdea} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                  Idea Title *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Distributed Task Queue & Telemetry Streamer"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                  Problem Solved / Bottleneck *
                </label>
                <textarea
                  required
                  rows={3}
                  value={newProblem}
                  onChange={(e) => setNewProblem(e.target.value)}
                  placeholder="What core operational friction or architectural bottleneck does this solve?"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                  Expected ROI / Value Realization
                </label>
                <textarea
                  rows={2}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="e.g. Cuts worker latency by 40% and provides real-time gate auditability."
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                    Target Users
                  </label>
                  <input
                    type="text"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    placeholder="e.g. Systems Architects, SREs"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                    Complexity Level
                  </label>
                  <select
                    value={newComplexity}
                    onChange={(e) => setNewComplexity(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Low">Low Complexity</option>
                    <option value="Medium">Medium Complexity</option>
                    <option value="High">High Complexity</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#B5B1C0] uppercase font-mono mb-1.5">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={newTagsStr}
                  onChange={(e) => setNewTagsStr(e.target.value)}
                  placeholder="Automation, Infrastructure, Backend"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setProposeIdeaModalOpen(false)}
                  className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="k-btn-primary px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Submit for Review</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Hero Header */}
      <SpotlightCard className="p-8 sm:p-10 space-y-6" spotlightColor="rgba(7, 91, 255, 0.15)">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
              <span>{activeProduct.code}</span>
              <span>·</span>
              <span className="text-[#075BFF]">{activeProduct.domain}</span>
              <span>·</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                <span>{activeProduct.status.toUpperCase()}</span>
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white">
              {activeProduct.name}
            </h1>

            <p className="text-sm text-[#B5B1C0] leading-relaxed font-light">
              {activeProduct.description}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <button
              onClick={() => factoryStore.setScreen('ideaq')}
              className="px-4 py-2.5 border bg-[#075BFF]/10 border-[#075BFF]/30 text-[#5B8FFF] font-medium text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer hover:bg-[#075BFF]/20 shadow-md"
              title="Open IdeaQ Autonomous AI Ideation Lab in full-screen"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Open IdeaQ ↗</span>
            </button>
            <button
              onClick={() => setProposeIdeaModalOpen(true)}
              className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.12] text-white font-medium text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer border border-white/[0.1]"
            >
              <Plus className="w-3.5 h-3.5 text-[#5B8FFF]" />
              <span>Propose Idea</span>
            </button>
            <button
              onClick={() => setCreateProjectModalOpen(true)}
              className="k-btn-primary px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#075BFF]/20 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Project</span>
            </button>
          </div>
        </div>

        {/* Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-white/[0.08]">
          <div className="space-y-1">
            <div className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
              Projects
            </div>
            <div className="text-3xl sm:text-4xl font-light tracking-tight text-white font-sans">
              {enrolledProjects.length}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
              Ideas Hub
            </div>
            <div className="text-3xl sm:text-4xl font-light tracking-tight text-white font-sans">
              {enrolledIdeas.length}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
              Repositories
            </div>
            <div className="text-3xl sm:text-4xl font-light tracking-tight text-white font-sans">
              {activeProduct.repositories.length}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
              Docs & reports
            </div>
            <div className="text-3xl sm:text-4xl font-light tracking-tight text-white font-sans">
              {displayAdrs.length + reportedIdeas.length + productDocs.length}
            </div>
          </div>
        </div>
      </SpotlightCard>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <button
          onClick={() => setActiveTab('ideas')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'ideas'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Ideas Hub ({enrolledIdeas.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'projects'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          <span>Projects ({enrolledProjects.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'docs'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Docs, ADRs & reports ({displayAdrs.length + reportedIdeas.length + productDocs.length})</span>
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: IDEAS HUB (Clean, High-Grade Management Hub - No Chatbox)            */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'ideas' && (
        <div className="space-y-6">
          {/* Quick Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <GlassCard className="p-4 space-y-1">
              <div className="text-[11px] font-mono text-[#827D8E] uppercase">Total Ideas</div>
              <div className="text-2xl font-semibold text-white">{enrolledIdeas.length}</div>
            </GlassCard>
            <GlassCard className="p-4 space-y-1">
              <div className="text-[11px] font-mono text-amber-400 uppercase">Under Review</div>
              <div className="text-2xl font-semibold text-amber-400">{inReviewIdeasCount}</div>
            </GlassCard>
            <GlassCard className="p-4 space-y-1">
              <div className="text-[11px] font-mono text-emerald-400 uppercase">Approved</div>
              <div className="text-2xl font-semibold text-emerald-400">{approvedIdeasCount}</div>
            </GlassCard>
            <GlassCard className="p-4 space-y-1">
              <div className="text-[11px] font-mono text-[#5B8FFF] uppercase">Promoted to Projects</div>
              <div className="text-2xl font-semibold text-[#5B8FFF]">{promotedIdeasCount}</div>
            </GlassCard>
          </div>

          {/* Search, Filter & Action Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#827D8E]" />
                <input
                  type="text"
                  value={ideaSearch}
                  onChange={(e) => setIdeaSearch(e.target.value)}
                  placeholder="Search ideas, problem statements, tags..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-white/[0.08] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#075BFF]"
                />
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'all', label: 'All' },
                { id: 'pending_approval', label: 'In Review' },
                { id: 'approved', label: 'Approved' },
                { id: 'promoted', label: 'Promoted' },
                { id: 'draft', label: 'Draft' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setStatusFilter(pill.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === pill.id
                      ? 'bg-white/10 text-white border border-white/20'
                      : 'text-[#827D8E] hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Ideas List / Grid */}
          {filteredIdeas.length === 0 ? (
            <GlassCard className="p-12 text-center space-y-4">
              <Sparkles className="w-10 h-10 text-[#075BFF] mx-auto" />
              <h3 className="text-lg font-semibold text-white">No feature ideas found</h3>
              <p className="text-xs text-[#827D8E] font-light max-w-md mx-auto">
                Propose your first feature idea manually or launch autonomous codebase scanning with IdeaQ.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setProposeIdeaModalOpen(true)}
                  className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  Propose Idea
                </button>
                <button
                  onClick={() => factoryStore.setScreen('ideaq')}
                  className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-[#5B8FFF] rounded-xl text-xs font-medium cursor-pointer border border-[#075BFF]/30"
                >
                  Scan in IdeaQ ↗
                </button>
              </div>
            </GlassCard>
          ) : (
            <div className="space-y-4">
              {filteredIdeas.map((idea) => {
                const badge = STATUS_BADGE[idea.status] || STATUS_BADGE.draft;
                const linkedProject = state.projects.find((p) => p.id === idea.promotedProjectId || p.productId === idea.productId && p.name.includes(idea.title));
                const author = state.members.find((m) => m.id === idea.authorId)?.name || 'Workspace Lead';

                return (
                  <SpotlightCard
                    key={idea.id}
                    className="p-6 space-y-5 border border-white/[0.08] hover:border-[#075BFF]/40 transition-all"
                    spotlightColor="rgba(7, 91, 255, 0.12)"
                  >
                    {/* Top Row: Title, Badges, Status */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border ${badge.bg} ${badge.text} ${badge.border}`}>
                            {badge.label}
                          </span>
                          <span className="text-[11px] font-mono text-[#827D8E]">
                            {idea.source === 'agent' ? 'IdeaQ Scan' : 'Manual Proposal'}
                          </span>
                          <span className="text-[11px] font-mono text-[#827D8E]">·</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/[0.04] text-[#B5B1C0] border border-white/[0.06]">
                            {idea.complexity} Complexity
                          </span>
                        </div>
                        <h3 className="text-lg font-semibold text-white tracking-tight">{idea.title}</h3>
                      </div>

                      {/* Linked Project Banner */}
                      {linkedProject ? (
                        <button
                          onClick={() => {
                            factoryStore.selectProject(linkedProject.id);
                            factoryStore.setScreen('projects');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-[#075BFF]/10 border border-[#075BFF]/25 text-[#5B8FFF] hover:bg-[#075BFF]/10 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                          title="Open Linked Project"
                        >
                          <FolderGit2 className="w-3.5 h-3.5" />
                          <span>Project: {linkedProject.code}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : idea.status === 'approved' ? (
                        <button
                          onClick={() => setCreateProjectModalOpen(true)}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                        >
                          <Rocket className="w-3.5 h-3.5" />
                          <span>Launch Project</span>
                        </button>
                      ) : null}
                    </div>

                    {/* Problem Statement & Expected Value */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-1">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-rose-400 font-semibold">
                          Problem Statement
                        </div>
                        <p className="text-[#B5B1C0] leading-relaxed line-clamp-2">
                          {idea.problemStatement}
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-1">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                          Expected Value / ROI
                        </div>
                        <p className="text-[#B5B1C0] leading-relaxed line-clamp-2">
                          {idea.expectedValue}
                        </p>
                      </div>
                    </div>

                    {/* Tags & Assignee */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.06] text-xs">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-[#827D8E]">
                          <UserCheck className="w-3.5 h-3.5 text-[#5B8FFF]" />
                          <span>Assignee / Author:</span>
                          <span className="text-white font-medium">{author}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {idea.tags.map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded bg-white/[0.04] text-[#827D8E] text-[10px] font-mono">
                              #{t}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Approvals Review Button */}
                        <button
                          onClick={() => setReviewModalIdea(idea)}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-white/[0.08]"
                          title="Manage approvals and reviewer sign-offs"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                          <span>Review & Approvals</span>
                        </button>

                        {/* Evaluation report (written by the server, grounded in the repository) */}
                        <button
                          onClick={() => handleReport(idea)}
                          disabled={idea.reviewReport?.status === 'running'}
                          className="px-3 py-1.5 rounded-lg bg-[#075BFF]/10 hover:bg-[#075BFF]/20 text-[#5B8FFF] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-[#075BFF]/25 disabled:opacity-60"
                          title={idea.reviewReport?.status === 'failed' ? idea.reviewReport.error : 'Evaluation report'}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{reportLabel(idea.reviewReport)}</span>
                        </button>

                        {idea.reviewReport?.status === 'ready' && (
                          <button
                            onClick={() => handleDownloadReport(idea)}
                            className="k-btn-primary px-3 py-1.5 rounded-lg bg-[#075BFF] hover:bg-[#075BFF]/90 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-[#075BFF]/20"
                            title="Download the evaluation report as PDF"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>PDF</span>
                          </button>
                        )}

                        {/* Brainstorm in IdeaQ */}
                        <button
                          onClick={() => {
                            factoryStore.selectIdea(idea.id);
                            factoryStore.setScreen('ideaq');
                          }}
                          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-[#827D8E] hover:text-white transition-colors cursor-pointer"
                          title="Open in IdeaQ Brainstorm Chat"
                        >
                          <Sparkles className="w-4 h-4 text-[#5B8FFF]" />
                        </button>
                      </div>
                    </div>
                  </SpotlightCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: PROJECTS                                                            */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'projects' && (
        <div className="w-full space-y-6">
          {enrolledProjects.length === 0 ? (
            <GlassCard className="p-10 text-center space-y-4">
              <FolderGit2 className="w-8 h-8 text-[#075BFF] mx-auto" />
              <h3 className="text-base font-semibold text-white">No projects enrolled in this product</h3>
              <p className="text-xs text-[#827D8E] font-light max-w-sm mx-auto">
                Enroll microservices, backend APIs, or web applications to this product anchor.
              </p>
              <button
                onClick={() => setCreateProjectModalOpen(true)}
                className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Enroll First Project
              </button>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {enrolledProjects.map((proj) => (
                <SpotlightCard
                  key={proj.id}
                  className="p-6 space-y-4 cursor-pointer hover:border-[#075BFF]/40 transition-all border border-white/[0.08]"
                  onClick={() => {
                    factoryStore.selectProject(proj.id);
                    factoryStore.setScreen('projects');
                  }}
                  spotlightColor="rgba(7, 91, 255, 0.15)"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-[#075BFF] font-semibold">{proj.code}</span>
                      <h3 className="text-lg font-semibold text-white mt-0.5">{proj.name}</h3>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-[#B5B1C0] border border-white/[0.08]">
                      {proj.phase}
                    </span>
                  </div>
                  <p className="text-xs text-[#827D8E] line-clamp-2 font-light">{proj.description}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] text-xs text-[#827D8E]">
                    <span>Repository: {proj.repositoryUrl ? 'Connected' : 'Workspace'}</span>
                    <span className="text-[#075BFF] flex items-center gap-1 font-medium">
                      <span>Open Workspace</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </SpotlightCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: SPECIFICATIONS, ADRs & PRDs STUDIO                                   */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'docs' && (
        <div className="space-y-8">
          {/* Evaluation reports */}
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#075BFF]" />
                <span>Idea evaluation reports</span>
              </h3>
              <p className="text-xs text-[#827D8E]">
                Written from the repository and reviewed before approval. PRDs are drafted when an approved idea becomes a project.
              </p>
            </div>

            {reportedIdeas.length === 0 ? (
              <GlassCard className="p-8 text-center space-y-2">
                <FileText className="w-8 h-8 text-[#827D8E] mx-auto" />
                <p className="text-xs text-[#827D8E]">No reports yet. Use "Evaluate" on an idea.</p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reportedIdeas.map((idea) => {
                  const r = idea.reviewReport!;
                  return (
                    <SpotlightCard key={idea.id} className="p-5 space-y-4 border border-white/[0.08]" spotlightColor="rgba(7, 91, 255, 0.12)">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-base font-semibold text-white">{idea.title}</h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 whitespace-nowrap">
                          {r.report?.verdict} · {r.meta?.overallScore.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-xs text-[#827D8E] line-clamp-3">{r.report?.executive_summary}</p>
                      <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
                        <button
                          onClick={() => setReportIdea(idea)}
                          className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#B5B1C0] hover:text-white text-xs font-medium transition-colors cursor-pointer"
                        >
                          Read
                        </button>
                        <button
                          onClick={() => handleDownloadReport(idea)}
                          className="k-btn-primary px-3 py-1.5 rounded-lg bg-[#075BFF] hover:bg-[#075BFF]/90 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Printer className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </div>
                    </SpotlightCard>
                  );
                })}
              </div>
            )}
          </div>

          {/* ADRs Section */}
          <div className="space-y-4 pt-4 border-t border-white/[0.08]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#5B8FFF]" />
                  <span>Architecture Decision Records (ADRs)</span>
                </h3>
                <p className="text-xs text-[#827D8E]">
                  Formal decision registry documenting technical trade-offs, boundaries, and consensus.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayAdrs.map((adr) => (
                <SpotlightCard
                  key={adr.code}
                  className="p-5 space-y-3 border border-white/[0.08]"
                  spotlightColor="rgba(7, 91, 255, 0.12)"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#075BFF]">{adr.code}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                      {adr.status}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-white">{adr.title}</h4>
                  <p className="text-xs text-[#827D8E] leading-relaxed">
                    <strong className="text-[#B5B1C0]">Decision:</strong> {adr.decision}
                  </p>
                  <div className="pt-2 text-[11px] text-[#6E6A7A] border-t border-white/[0.04]">
                    Context: {adr.context}
                  </div>
                </SpotlightCard>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
