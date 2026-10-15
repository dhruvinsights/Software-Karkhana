import React, { useState } from 'react';
import {
  GitBranch,
  Layers,
  Bug,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ArrowRight,
  GitPullRequest,
  Check,
  Trash2,
  Kanban,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { Issue } from '../../types/factory';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface PlanningRoadmapViewProps {
  state: FactoryState;
}

export const PlanningRoadmapView: React.FC<PlanningRoadmapViewProps> = ({ state }) => {
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueType, setNewIssueType] = useState<Issue['type']>('story');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const projectIssues = state.issues.filter((i) => i.projectId === selectedProject?.id);

  const columns: { id: Issue['status']; title: string }[] = [
    { id: 'todo', title: 'To Do' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'in_review', title: 'In Review' },
    { id: 'done', title: 'Done' },
  ];

  const handleCreateIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueTitle.trim()) return;

    factoryStore.createIssue({
      projectId: selectedProject?.id,
      title: newIssueTitle.trim(),
      type: newIssueType,
      status: 'todo',
    });

    setNewIssueTitle('');
  };

  if (!selectedProject) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-4">
        <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
          Planning & Roadmap
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          No Project Selected
        </h1>
        <p className="text-sm text-slate-400 max-w-md">
          Enroll an engineering project first to manage backlog work items, sprints, and Kanban columns.
        </p>
        <button
          onClick={() => factoryStore.setScreen(state.products.length > 0 ? 'projects' : 'workspace_home')}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Go to Projects</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-blue-400 font-medium">
            <span>{selectedProject.code}</span>
            <span>·</span>
            <span>{selectedProject.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Planning & Agile Board
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Autonomous backlog decomposition, sprint planning, task assignment, and real-time kanban tracking.
          </p>
        </div>
      </div>

      {/* Add Issue Form */}
      <GlassCard className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Create Work Item</h3>
          <span className="text-xs font-mono text-slate-400">Backlog Ingest</span>
        </div>
        <form onSubmit={handleCreateIssue} className="flex flex-col sm:flex-row gap-2">
          <select
            value={newIssueType}
            onChange={(e) => setNewIssueType(e.target.value as any)}
            className="text-xs p-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 font-mono transition-colors"
          >
            <option value="story">Story</option>
            <option value="task">Task</option>
            <option value="bug">Bug</option>
          </select>
          <input
            type="text"
            placeholder="Issue title (e.g. Implement distributed session token caching)..."
            value={newIssueTitle}
            onChange={(e) => setNewIssueTitle(e.target.value)}
            className="flex-1 text-xs px-4 py-2.5 bg-[#0a0c12] border border-white/10 rounded-xl outline-none focus:border-blue-500 text-slate-200 placeholder:text-slate-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!newIssueTitle.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0 transition-all shadow-md shadow-blue-600/20"
          >
            + Create Issue
          </button>
        </form>
      </GlassCard>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((col) => {
          const colIssues = projectIssues.filter((i) => i.status === col.id);
          return (
            <div key={col.id} className="space-y-3 bg-[#0a0c12]/60 p-4 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-xs font-mono uppercase text-slate-400 font-bold">{col.title}</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {colIssues.length}
                </span>
              </div>

              <div className="space-y-2.5 min-h-[160px]">
                {colIssues.map((issue) => (
                  <SpotlightCard key={issue.id} className="p-3.5 space-y-2 bg-[#0c0f18]/90 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase text-blue-400">{issue.type}</span>
                      <span className="text-[10px] font-mono text-slate-500">#{issue.id.slice(-4)}</span>
                    </div>
                    <div className="text-xs font-semibold text-white leading-snug">{issue.title}</div>
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <span className="text-[10px] text-slate-400">{issue.assigneeId || 'Agent Pool'}</span>
                      {col.id !== 'done' && (
                        <button
                          onClick={() => {
                            const nextStatus: Issue['status'] =
                              col.id === 'todo' ? 'in_progress' : col.id === 'in_progress' ? 'in_review' : 'done';
                            factoryStore.updateIssueStatus(issue.id, nextStatus);
                          }}
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-mono"
                        >
                          Advance &rarr;
                        </button>
                      )}
                    </div>
                  </SpotlightCard>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
