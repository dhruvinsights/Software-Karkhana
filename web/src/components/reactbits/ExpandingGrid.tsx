import React, { useState } from 'react';
import { Layers, GitBranch, Cpu, ShieldCheck, Database, Boxes, Sparkles, Network } from 'lucide-react';

interface GridItem {
  id: string;
  title: string;
  category: 'Team' | 'Project' | 'Service' | 'Invariant';
  tag: string;
  metrics: string;
  icon: React.ReactNode;
}

interface ExpandingGridProps {
  className?: string;
}

export const ExpandingGrid: React.FC<ExpandingGridProps> = ({ className = '' }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const ITEMS: GridItem[] = [
    {
      id: 'core-infra',
      title: 'Infrastructure & Edge',
      category: 'Team',
      tag: 'Platform SRE',
      metrics: '99.999% SLA',
      icon: <Network className="w-5 h-5 text-blue-400" />,
    },
    {
      id: 'agent-swarm',
      title: 'Autonomous Workers',
      category: 'Service',
      tag: 'AST Execution',
      metrics: '14 Workers Live',
      icon: <Cpu className="w-5 h-5 text-purple-400" />,
    },
    {
      id: 'sec-guard',
      title: 'AppSec & Compliance',
      category: 'Invariant',
      tag: 'Zero CVE Gate',
      metrics: 'SOC 2 Enforced',
      icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 'ledger-sync',
      title: 'Cryptographic Ledger',
      category: 'Service',
      tag: 'Audit Logs',
      metrics: '100% Attested',
      icon: <Database className="w-5 h-5 text-cyan-400" />,
    },
    {
      id: 'product-hub',
      title: 'Product Discovery',
      category: 'Team',
      tag: 'Gemini Radar',
      metrics: '94/100 Fit',
      icon: <Sparkles className="w-5 h-5 text-amber-400" />,
    },
    {
      id: 'release-stream',
      title: 'Canary Gatekeepers',
      category: 'Project',
      tag: 'Multi-Sig Quorum',
      metrics: '<1s Rollback',
      icon: <GitBranch className="w-5 h-5 text-rose-400" />,
    },
  ];

  return (
    <div className={`w-full space-y-4 ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
            Unified Factory Graph · Teams & Projects
          </span>
        </div>
        <span className="text-[11px] font-mono text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20">
          Connected Ecosystem
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ITEMS.map((item) => {
          const isHovered = hoveredId === item.id;
          return (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer relative overflow-hidden ${
                isHovered
                  ? 'bg-[#14161f] border-white/25'
                  : 'bg-[#090b12]/80 border-white/10'
              }`}
            >

              <div className="flex items-start justify-between gap-3">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                  {item.icon}
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 uppercase">
                  {item.category}
                </span>
              </div>

              <div className="mt-4 space-y-1">
                <h4 className="text-sm font-bold text-white transition-colors">
                  {item.title}
                </h4>
                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>{item.tag}</span>
                  <span className="font-mono text-[11px] text-blue-400 font-semibold">
                    {item.metrics}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
