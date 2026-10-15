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
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';

interface ProjectHubViewProps {
  state: FactoryState;
}

export const ProjectHubView: React.FC<ProjectHubViewProps> = ({ state }) => {
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>(
    state.selectedProductId || state.products[0]?.id || ''
  );
  const [newProjectRepo, setNewProjectRepo] = useState('github.com/org/service');

  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  const activeProduct = selectedProject
    ? state.products.find((p) => p.id === selectedProject.productId)
    : state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    factoryStore.createProject({
      name: newProjectName.trim(),
      productId: selectedProductId || state.products[0]?.id,
      repositoryUrl: newProjectRepo.trim(),
    });

    setNewProjectName('');
  };

  if (state.projects.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 animate-fade-in space-y-6">
        <div className="space-y-3">
          <div className="text-xs uppercase font-mono tracking-widest text-[#075BFF] font-medium">
            Project Hub
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white">
            No Projects Enrolled Yet
          </h1>
          <p className="text-sm text-[#827D8E] leading-relaxed max-w-xl font-light">
            {state.products.length === 0
              ? 'Start by creating your first product. Once created, you can attach repositories, tasks, and CI/CD pipelines.'
              : 'Create your first engineering project below to start tracking pull requests, architecture records, and test plans.'}
          </p>
        </div>

        {state.products.length === 0 ? (
          <GlassCard className="p-8 space-y-4">
            <h3 className="text-lg font-semibold text-white">Product required first</h3>
            <p className="text-xs text-[#827D8E]">Every project belongs to a product anchor.</p>
            <button
              onClick={() => factoryStore.setScreen('workspace_home')}
              className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
            >
              <Plus className="w-4 h-4" />
              <span>Go to Overview to Create Product</span>
            </button>
          </GlassCard>
        ) : (
          <GlassCard className="p-8 space-y-5">
            <h3 className="text-xl font-semibold text-white">Quick Enroll Project</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#B5B1C0] block mb-1">Project Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ingestion Gateway"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full text-xs p-3 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#B5B1C0] block mb-1">Target Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full text-xs p-3 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white"
                >
                  {state.products.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.name} ({prod.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#B5B1C0] block mb-1">Git Repository URL</label>
              <input
                type="text"
                value={newProjectRepo}
                onChange={(e) => setNewProjectRepo(e.target.value)}
                className="w-full text-xs p-3 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={!newProjectName.trim()}
              className="px-6 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075BFF]/20"
            >
              <Plus className="w-4 h-4" />
              <span>Enroll Project</span>
            </button>
          </GlassCard>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase font-mono tracking-wider text-[#827D8E] font-medium">
            <span>{activeProduct?.code || 'PRJ'}</span>
            <span>·</span>
            <span className="text-[#075BFF]">{activeProduct?.name || 'All Products'}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Project <ShinyText text="Hub" speed={5} />
          </h1>
          <p className="text-sm text-[#827D8E] max-w-2xl font-light">
            Coordinating requirements, repositories, pull requests, and automated verification.
          </p>
        </div>

        <button
          onClick={() => {
            const name = prompt('Enter new project name:');
            if (name && name.trim()) {
              factoryStore.createProject({
                name: name.trim(),
                productId: activeProduct?.id || state.products[0]?.id || '',
              });
            }
          }}
          className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-[#075BFF]/20 transition-all cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {/* Selected Project Card */}
      <SpotlightCard className="p-8 space-y-6" spotlightColor="rgba(7, 91, 255, 0.15)">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs font-mono text-[#827D8E]">
              <span>{selectedProject.code}</span>
              <span>·</span>
              <span className="capitalize text-[#075BFF]">{selectedProject.status}</span>
              <span>·</span>
              <span>Phase: {selectedProject.phase}</span>
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {selectedProject.name}
            </h2>
            <p className="text-sm text-[#B5B1C0] max-w-2xl leading-relaxed font-light">
              {selectedProject.description}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                factoryStore.selectProject(selectedProject.id);
                factoryStore.setScreen('developer_dashboard');
              }}
              className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Open Developer Studio</span>
            </button>
          </div>
        </div>

        <div className="p-4 bg-[#07070B] rounded-xl border border-white/[0.08] font-mono text-xs flex flex-wrap gap-4 text-[#827D8E]">
          <div>Repository: <span className="text-cyan-400">{selectedProject.repositoryUrl}</span></div>
          <div>Health: <span className="text-emerald-400 capitalize">{selectedProject.health}</span></div>
          <div>Target: <span className="text-white">{selectedProject.targetReleaseDate}</span></div>
        </div>
      </SpotlightCard>

      {/* Project Switcher Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-mono uppercase text-[#827D8E] font-medium tracking-wider">All Projects ({state.projects.length})</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {state.projects.map((proj) => {
            const isSelected = proj.id === selectedProject.id;
            const product = state.products.find((p) => p.id === proj.productId);
            return (
              <div
                key={proj.id}
                onClick={() => factoryStore.selectProject(proj.id)}
                className={`p-6 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                  isSelected
                    ? 'bg-[#17151D] border-[#075BFF] shadow-xs ring-1 ring-[#075BFF]'
                    : 'bg-[#0c0e15]/90 border-white/[0.08] hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-[#827D8E]">
                      {proj.code} · <span className="text-[#075BFF]">{product?.name || 'General'}</span>
                    </div>
                    <h3 className="text-xl font-semibold text-white mt-0.5">{proj.name}</h3>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-white/[0.06] text-[#B5B1C0] border border-white/[0.08]">
                    {proj.phase}
                  </span>
                </div>
                <p className="text-xs text-[#827D8E] line-clamp-2 font-light">{proj.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
