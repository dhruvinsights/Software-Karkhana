import React, { useState, useEffect } from 'react';
import {
  Search,
  Layers,
  FolderGit2,
  GitPullRequest,
  CheckCircle2,
  ShieldAlert,
  Terminal,
  Cpu,
  FileText,
  UserCheck,
  X,
  ArrowRight,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ScreenId, FactoryRole } from '../../types/factory';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const state = factoryStore.getState();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Trigger open in parent
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const quickActions: { label: string; screen: ScreenId; icon: any; category: string; role?: FactoryRole }[] = [
    { label: 'Developer: CodeRabbit PR Review (#42)', screen: 'ai_code_review', icon: GitPullRequest, category: 'Engineering' },
    { label: 'Developer: Agent Run Workspace', screen: 'agent_run', icon: Terminal, category: 'Engineering' },
    { label: 'Product Manager: Idea Validation Studio', screen: 'idea_detail', icon: Layers, category: 'Discovery' },
    { label: 'Product Manager: HTML Report Builder', screen: 'idea_report', icon: FileText, category: 'Discovery' },
    { label: 'Executive: Portfolio & Approvals', screen: 'portfolio', icon: UserCheck, category: 'Leadership' },
    { label: 'UI/UX: AI Prototype Studio', screen: 'prototype_studio', icon: Cpu, category: 'Design' },
    { label: 'Architecture: System Design & C4 Diagrams', screen: 'system_design', icon: Layers, category: 'Architecture' },
    { label: 'Architecture: ADR Registry', screen: 'adrs', icon: FileText, category: 'Architecture' },
    { label: 'QA / QC: Test Plan Generator & Runner', screen: 'qa_dashboard', icon: CheckCircle2, category: 'Verification' },
    { label: 'Security: Threat Assessment & SLAs', screen: 'security_dashboard', icon: ShieldAlert, category: 'AppSec' },
    { label: 'DevOps: Visual CI/CD Pipelines', screen: 'pipeline_studio', icon: Terminal, category: 'DevOps' },
    { label: 'DevOps: Cloud Run Environments', screen: 'infra_manager', icon: Cpu, category: 'DevOps' },
    { label: 'Release: 4-Eye Sign-off & Canary Deploy', screen: 'release_signoff', icon: CheckCircle2, category: 'Releases' },
    { label: 'Incidents: P0/P1 Commander Console', screen: 'incidents', icon: ShieldAlert, category: 'Operations' },
    { label: 'Admin: Visual Workflow Designer', screen: 'workflow_designer', icon: Layers, category: 'Governance' },
    { label: 'Admin: Tamper-Evident Audit Explorer', screen: 'audit_explorer', icon: FileText, category: 'Governance' },
  ];

  const filtered = quickActions.filter(
    (a) => a.label.toLowerCase().includes(query.toLowerCase()) || a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-2xl bg-[#101016] rounded-2xl shadow-2xl border border-white/[0.12] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center px-4 py-3.5 border-b border-white/[0.08]">
          <Search className="w-5 h-5 text-[#827D8E] mr-3" />
          <input
            type="text"
            placeholder="Type a screen, command, or role to navigate... (e.g. CodeRabbit, PR, QA, Cloud Run)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full text-base bg-transparent border-none outline-none text-[#F6F5FA] placeholder-[#827D8E]"
          />
          <button onClick={onClose} className="p-1 text-[#827D8E] hover:text-white rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1 bg-[#0A0A0F]">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#827D8E]">
              No matching destinations found for "{query}".
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    factoryStore.setScreen(item.screen);
                    if (item.role) factoryStore.setRole(item.role);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-sm text-[#B5B1C0] hover:bg-white/[0.06] hover:text-[#F6F5FA] transition-colors group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-1.5 rounded-lg bg-[#17151D] border border-white/[0.08] text-[#827D8E] group-hover:bg-[#075BFF]/20 group-hover:text-[#075BFF] transition-colors">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-medium text-[#F6F5FA] group-hover:text-white">{item.label}</div>
                      <div className="text-xs text-[#827D8E] font-mono">{item.category}</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#827D8E] group-hover:text-[#075BFF] opacity-0 group-hover:opacity-100 transition-all transform translate-x-1" />
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2.5 bg-[#101016] border-t border-white/[0.08] flex items-center justify-between text-xs text-[#827D8E]">
          <div className="flex items-center space-x-2">
            <kbd className="px-1.5 py-0.5 bg-[#07070B] border border-white/[0.1] rounded text-[#B5B1C0] font-mono text-[10px]">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="px-1.5 py-0.5 bg-[#07070B] border border-white/[0.1] rounded text-[#B5B1C0] font-mono text-[10px]">Enter</kbd>
            <span>Select</span>
          </div>
          <div className="font-mono text-[11px] text-[#827D8E]">Software Karkhana Control Plane</div>
        </div>
      </div>
    </div>
  );
};
