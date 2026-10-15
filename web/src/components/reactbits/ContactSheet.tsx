import React, { useState } from 'react';
import { Terminal, Shield, GitCommit, CheckCircle2, Sparkles, Cpu, Layers } from 'lucide-react';

interface PrintItem {
  id: string;
  type: string;
  title: string;
  hash: string;
  status: string;
  snippet: string;
}

export const ContactSheet: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const PRINTS: PrintItem[] = [
    {
      id: 'p1',
      type: 'AST INVARIANT PATCH',
      title: 'Fix bounded buffer allocation in RPC handler',
      hash: 'sha256:7f9a2e...',
      status: 'VERIFIED',
      snippet: 'diff --git a/handler.go +buf.Grow(maxLen)',
    },
    {
      id: 'p2',
      type: 'GEMINI TEST MATRIX',
      title: 'Chaos fault-injection on network timeout',
      hash: 'sha256:1a84f3...',
      status: 'PASSED',
      snippet: 'assert_circuit_breaker_opened(p99_latency_ms < 50)',
    },
    {
      id: 'p3',
      type: 'ADR-004 CONTRACT',
      title: 'Adopt Protobuf v3 for Swarm RPC Bus',
      hash: 'sha256:bb019c...',
      status: 'ACCEPTED',
      snippet: 'syntax = "proto3"; message SwarmEvent {}',
    },
    {
      id: 'p4',
      type: 'CANARY SRE ATTESTATION',
      title: '10% live traffic shift with error rate < 0.001%',
      hash: 'sha256:99f7d1...',
      status: 'GREEN',
      snippet: 'cosign verify --key cosign.pub karkhana:v2.4',
    },
  ];

  return (
    <div className={`p-6 bg-[#080a10] rounded-2xl border border-white/10 space-y-4 ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
            Live Contact Sheet · Proofs & Artifacts
          </span>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
          Continuous Stream
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRINTS.map((print) => {
          const isSelected = selectedHash === print.hash;
          return (
            <div
              key={print.id}
              onClick={() => setSelectedHash(isSelected ? null : print.hash)}
              className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer font-mono text-xs space-y-2 relative overflow-hidden ${
                isSelected
                  ? 'bg-[#101422] border-blue-500/60 shadow-[0_0_20px_rgba(7,91,255,0.2)]'
                  : 'bg-[#0c0e16] border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-blue-400 font-bold">{print.type}</span>
                <span className="text-emerald-400 font-semibold">{print.status}</span>
              </div>
              <div className="text-white font-sans font-semibold text-xs leading-snug">
                {print.title}
              </div>
              <div className="p-2 bg-[#050608] rounded border border-white/5 text-[10px] text-slate-400 overflow-x-auto">
                <code>{print.snippet}</code>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                <span>{print.hash}</span>
                <span className="text-blue-400 hover:underline">Attested &rarr;</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
