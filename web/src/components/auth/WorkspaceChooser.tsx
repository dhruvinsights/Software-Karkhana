import React, { useEffect, useState } from 'react';
import {
  Building,
  Plus,
  ArrowRight,
  Users,
  Clock,
  Sparkles,
  Layers,
  ChevronRight,
  LogOut,
  Shield,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { ChromaWaves } from '../reactbits/ChromaWaves';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';

export interface WorkspaceChooserProps {
  state: FactoryState;
  onOpenWorkspace: (workspaceId: string, workspaceName: string) => void;
  onCreateNewWorkspace: () => void;
  onSignOut: () => void;
}

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  role: string;
  member_count: number;
  last_active: string;
  is_owner?: boolean;
}

export const WorkspaceChooser: React.FC<WorkspaceChooserProps> = ({
  state,
  onOpenWorkspace,
  onCreateNewWorkspace,
  onSignOut,
}) => {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const userEmail = state.currentUser?.email || 'user@enterprise.internal';
  const userName = state.currentUser?.display_name || 'Engineer';

  useEffect(() => {
    async function fetchWorkspaces() {
      setIsLoading(true);
      try {
        const token = state.token;
        if (token) {
          const res = await fetch('/api/workspaces/list', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            setWorkspaces(Array.isArray(data) ? data : []);
            setIsLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to load workspaces from backend', e);
      }

      setWorkspaces([]);
      setIsLoading(false);
    }

    fetchWorkspaces();
  }, [state.token, state.currentUser]);

  return (
    <div className="min-h-screen bg-[#06080e] text-[#f7f8fc] flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-12 selection:bg-[#075bff] selection:text-white relative overflow-hidden select-none">
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <ChromaWaves />
      </div>

      {/* Header bar */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-white/[0.08] relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#075bff] to-cyan-500 flex items-center justify-center font-bold text-white text-sm shadow-md">
            SK
          </div>
          <div>
            <span className="text-sm font-semibold text-white tracking-tight">Software Karkhana</span>
            <span className="text-[11px] text-slate-500 block">Workspace Central</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <span className="text-xs text-white font-medium block">{userName}</span>
            <span className="text-[11px] text-slate-400 block font-mono">{userEmail}</span>
          </div>
          <button
            onClick={onSignOut}
            className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Hub */}
      <div className="max-w-2xl mx-auto w-full my-auto py-8 relative z-10 space-y-8 animate-fade-in">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Welcome back, <ShinyText text={userName.split(' ')[0]} speed={4} />
          </h1>
          <p className="text-sm text-slate-400 font-light">
            Select a workspace for <span className="text-white font-medium">{userEmail}</span> to continue
          </p>
        </div>

        {/* Workspaces List Card */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500">
              Workspaces for {userEmail}
            </span>
            <span className="text-xs text-slate-500">{workspaces.length} enrolled</span>
          </div>

          <div className="space-y-2.5">
            {isLoading ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                Loading your workspaces from PostgreSQL database...
              </div>
            ) : workspaces.length === 0 ? (
              <div className="p-8 text-center bg-[#0a0d16]/80 border border-white/10 rounded-2xl space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#075bff]/10 border border-[#075bff]/30 text-[#075bff] flex items-center justify-center mx-auto">
                  <Building className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-white">No workspaces found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  You are not enrolled in any workspace under <span className="text-white font-medium">{userEmail}</span> yet. Create your first workspace to start building software.
                </p>
                <button
                  onClick={onCreateNewWorkspace}
                  className="mt-2 px-5 py-2.5 bg-[#075bff] hover:bg-[#075bff]/90 text-white font-semibold text-xs rounded-xl inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-[#075bff]/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Workspace</span>
                </button>
              </div>
            ) : (
              workspaces.map((ws) => (
                <SpotlightCard
                  key={ws.id}
                  onClick={() => onOpenWorkspace(ws.id, ws.name)}
                  className="p-4 sm:p-5 bg-[#0a0d16]/90 border border-white/10 hover:border-[#075bff]/50 rounded-2xl flex items-center justify-between cursor-pointer transition-all hover:scale-[1.01] group shadow-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#10172e] to-[#141e3d] border border-white/10 flex items-center justify-center text-lg font-bold text-cyan-400 group-hover:border-[#075bff]/50 transition-colors shadow-inner">
                      {ws.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm sm:text-base font-semibold text-white group-hover:text-cyan-300 transition-colors">
                          {ws.name}
                        </h3>
                        {ws.is_owner && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#075bff]/20 text-[#075bff] border border-[#075bff]/30 font-medium">
                            Owner
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1 text-[11px]">
                          <Users className="w-3.5 h-3.5 text-slate-500" />
                          {ws.member_count} member{ws.member_count !== 1 ? 's' : ''}
                        </span>
                        <span>·</span>
                        <span className="text-[11px] font-mono text-slate-500">{ws.domain}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button className="px-4 py-2 bg-[#075bff] group-hover:bg-[#075bff]/90 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-md group-hover:shadow-[#075bff]/30 cursor-pointer">
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </SpotlightCard>
              ))
            )}
          </div>

          {/* Create new workspace action tile */}
          <div
            onClick={onCreateNewWorkspace}
            className="p-4 sm:p-5 bg-white/[0.02] hover:bg-white/[0.05] border border-dashed border-white/15 hover:border-cyan-500/40 rounded-2xl flex items-center justify-between cursor-pointer transition-all group mt-4"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors">
                  Create a new workspace
                </h4>
                <p className="text-[11px] text-slate-400">
                  Set up a fresh autonomous software factory organization
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
          </div>
        </div>

        {/* Security & cloud badge footer */}
        <div className="p-4 bg-[#0a0d16]/60 border border-white/5 rounded-2xl flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Enterprise Security Posture · Zero-trust role boundaries active</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">Google Cloud Run</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full pt-6 border-t border-white/[0.08] text-center text-[10px] text-slate-600 relative z-10">
        Enterprise Cloud Infrastructure · Built on Google Cloud Run & Gemini
      </div>
    </div>
  );
};
