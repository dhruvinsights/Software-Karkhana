import React, { useState } from 'react';
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
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { CreateProjectModal } from '../workspace/CreateProjectModal';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { GlassCard } from '../reactbits/GlassCard';
import { ShinyText } from '../reactbits/ShinyText';
import { ProductIdeaLab } from './ProductIdeaLab';

interface ProductWorkspaceViewProps {
  state: FactoryState;
}

export const ProductWorkspaceView: React.FC<ProductWorkspaceViewProps> = ({ state }) => {
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'projects' | 'ideas' | 'docs'>('ideas');

  const activeProduct = state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  if (!activeProduct) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-4 animate-fade-in">
        <h2 className="text-2xl font-semibold text-white">No Product Selected</h2>
        <p className="text-sm text-[#827D8E] font-light">Create a product first to view its engineering workspace.</p>
        <button
          onClick={() => factoryStore.setScreen('workspace_home')}
          className="px-5 py-2.5 bg-[#075BFF] text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-[#075BFF]/20"
        >
          Return to Overview
        </button>
      </div>
    );
  }

  const enrolledProjects = state.projects.filter((p) => p.productId === activeProduct.id);
  const enrolledIdeas = state.ideas.filter((i) => i.productId === activeProduct.id);
  const productDocs = state.knowledge.filter((k) => k.productId === activeProduct.id);

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      <CreateProjectModal
        isOpen={createProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
        state={state}
      />

      {/* Product Header */}
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

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('ideas')}
              className={`px-4 py-2.5 border text-[#F6F5FA] font-medium text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'ideas'
                  ? 'bg-[#075BFF] text-white border-[#075BFF] shadow-lg shadow-[#075BFF]/25'
                  : 'bg-[#101016] border-white/[0.1] hover:border-white/20'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-300" />
              <span>Idea Lab</span>
            </button>
            <button
              onClick={() => setCreateProjectModalOpen(true)}
              className="px-5 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#075BFF]/20 transition-colors flex items-center gap-2 cursor-pointer"
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
              Ideas
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
              ADRs & Specs
            </div>
            <div className="text-3xl sm:text-4xl font-light tracking-tight text-white font-sans">
              {productDocs.length}
            </div>
          </div>
        </div>
      </SpotlightCard>

      {/* Segmented Filter Bar */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'projects'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          Projects ({enrolledProjects.length})
        </button>
        <button
          onClick={() => setActiveTab('ideas')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'ideas'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          Ideas ({enrolledIdeas.length})
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'docs'
              ? 'bg-[#075BFF] text-white shadow-xs'
              : 'text-[#827D8E] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          Specifications & Knowledge ({productDocs.length})
        </button>
      </div>

      {/* TAB 1: PROJECTS */}
      {activeTab === 'projects' && (
        <div>
          {enrolledProjects.length === 0 ? (
            <GlassCard className="p-10 text-center space-y-4">
              <FolderGit2 className="w-8 h-8 text-[#075BFF] mx-auto" />
              <h3 className="text-base font-semibold text-white">No projects enrolled in this product</h3>
              <p className="text-xs text-[#827D8E] font-light max-w-sm mx-auto">
                Enroll microservices, backend APIs, or web applications to this product anchor.
              </p>
              <button
                onClick={() => setCreateProjectModalOpen(true)}
                className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Enroll First Project
              </button>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {enrolledProjects.map((proj) => (
                <SpotlightCard
                  key={proj.id}
                  className="p-6 space-y-3 cursor-pointer hover:border-[#075BFF]/40 transition-all"
                  onClick={() => {
                    factoryStore.selectProject(proj.id);
                    factoryStore.setScreen('projects');
                  }}
                  spotlightColor="rgba(7, 91, 255, 0.15)"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-[#075BFF]">{proj.code}</span>
                      <h3 className="text-lg font-semibold text-white mt-0.5">{proj.name}</h3>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-[#B5B1C0] border border-white/[0.08]">
                      {proj.phase}
                    </span>
                  </div>
                  <p className="text-xs text-[#827D8E] line-clamp-2 font-light">{proj.description}</p>
                </SpotlightCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IDEAS (Autonomous Idea Lab inside Product) */}
      {activeTab === 'ideas' && (
        <div className="pt-2">
          <ProductIdeaLab
            state={state}
            productId={activeProduct.id}
            onOpenProjectCreate={() => setCreateProjectModalOpen(true)}
          />
        </div>
      )}

      {/* TAB 3: DOCS */}
      {activeTab === 'docs' && (
        <GlassCard className="p-6 space-y-3">
          <h3 className="text-sm font-semibold text-white">Architectural Specifications</h3>
          <p className="text-xs text-[#827D8E] font-light">
            ADRs and design documents tied to this product domain.
          </p>
        </GlassCard>
      )}
    </div>
  );
};
