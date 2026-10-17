/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * PrdViewerModal: Comprehensive Product Requirements Document & Architectural Specification Viewer.
 * Features full interactive review, PDF print/download, and ADR decision linkage.
 */

import React, { useState } from 'react';
import {
  FileText,
  Printer,
  Download,
  Copy,
  Check,
  X,
  Shield,
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Milestone,
  UserCheck,
  ExternalLink,
  Code2,
} from 'lucide-react';
import { PrdDocumentData, openPrdPrintPreview, downloadPrdHtml } from '../../lib/prdPdfExport';

interface PrdViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  prd: PrdDocumentData | null;
}

export const PrdViewerModal: React.FC<PrdViewerModalProps> = ({ isOpen, onClose, prd }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'specs' | 'architecture' | 'risks' | 'approvals'>('overview');
  const [copied, setCopied] = useState(false);

  if (!isOpen || !prd) return null;

  const handleCopyMarkdown = () => {
    const md = `# ${prd.title} — Product Requirements Document (PRD)
**Doc ID:** ${prd.id} | **Version:** ${prd.version} | **Status:** ${prd.status}
**Product:** ${prd.productName} (${prd.productCode}) | **Domain:** ${prd.domain}
**Author:** ${prd.author} | **Date:** ${prd.date}

## 1. Executive Summary
${prd.executiveSummary}

## 2. Problem Statement & Value Proposition
- **Problem Statement:** ${prd.problemStatement}
- **Target User:** ${prd.targetUser}
- **Expected ROI & Value:** ${prd.expectedValue}

## 3. Functional Requirements
${prd.functionalRequirements.map((fr) => `- **[${fr.priority}] ${fr.id} ${fr.title}:** ${fr.description}`).join('\n')}

## 4. Architecture & ADRs
- **Tech Stack:** ${prd.techStack.join(', ')}
${prd.architectureHighlights.map((a) => `- ${a}`).join('\n')}

## 5. Non-Functional Requirements
${prd.nonFunctionalRequirements.map((nfr) => `- **${nfr.category}:** ${nfr.specification}`).join('\n')}

## 6. Risk Matrix
${prd.riskMatrix.map((rm) => `- **[${rm.severity} Risk] ${rm.risk}:** ${rm.mitigation}`).join('\n')}

## 7. Delivery Milestones
${prd.milestones.map((m) => `- **${m.phase} (${m.eta}):** ${m.deliverable}`).join('\n')}

## 8. Multi-Signature Approvals
${prd.approvals.map((ap) => `- **${ap.role} (${ap.reviewer}):** ${ap.status} on ${ap.date}`).join('\n')}
`;

    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-fade-in">
      <div className="bg-[#0C0D14] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08] flex items-start justify-between gap-4 bg-[#10121C]">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold uppercase tracking-wider bg-[#075BFF]/15 text-[#5B8FFF] border border-[#075BFF]/30">
                {prd.id}
              </span>
              <span className="text-xs text-[#827D8E] font-mono">v{prd.version}</span>
              <span className="text-xs text-[#827D8E]">·</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                prd.status === 'Approved' || prd.status === 'Promoted'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : prd.status === 'In Review'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
              }`}>
                {prd.status}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">{prd.title}</h2>
            <p className="text-xs text-[#827D8E]">
              {prd.productName} ({prd.productCode}) · Authored by <span className="text-[#B5B1C0] font-medium">{prd.author}</span> on {prd.date}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openPrdPrintPreview(prd)}
              className="k-btn-primary px-3.5 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-[#075BFF]/20"
              title="Print or Save as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
            <button
              onClick={() => downloadPrdHtml(prd)}
              className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-[#B5B1C0] hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-white/[0.08]"
              title="Download HTML Spec"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCopyMarkdown}
              className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-[#B5B1C0] hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-white/[0.08]"
              title="Copy Markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#827D8E] hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 border-b border-white/[0.08] bg-[#0E1018] overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Value', icon: FileText },
            { id: 'specs', label: 'Functional Specs', icon: Layers },
            { id: 'architecture', label: 'Architecture & ADRs', icon: Code2 },
            { id: 'risks', label: 'Risks & Roadmap', icon: AlertTriangle },
            { id: 'approvals', label: 'Sign-Off & Approvals', icon: UserCheck },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'border-[#075BFF] text-white font-semibold'
                    : 'border-transparent text-[#827D8E] hover:text-white'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#075BFF]' : ''}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-sm text-[#B5B1C0]">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Executive Summary
                </h3>
                <p className="text-white text-sm leading-relaxed">{prd.executiveSummary}</p>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {prd.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded bg-white/[0.06] text-[#827D8E] text-[11px] font-mono">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2">
                  <h4 className="text-xs uppercase font-mono tracking-wider text-rose-400 font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Problem Statement
                  </h4>
                  <p className="text-white text-xs leading-relaxed">{prd.problemStatement}</p>
                </div>
                <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2">
                  <h4 className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Expected ROI & Value
                  </h4>
                  <p className="text-white text-xs leading-relaxed">{prd.expectedValue}</p>
                </div>
              </div>

              <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2">
                <h4 className="text-xs uppercase font-mono tracking-wider text-[#5B8FFF] font-semibold">
                  Target Personas & User Segments
                </h4>
                <p className="text-white text-xs leading-relaxed">{prd.targetUser}</p>
              </div>
            </div>
          )}

          {activeTab === 'specs' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Functional Specifications ({prd.functionalRequirements.length})
                </h3>
                <div className="space-y-2.5">
                  {prd.functionalRequirements.map((fr) => (
                    <div key={fr.id} className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-start gap-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${
                        fr.priority === 'P0' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                        fr.priority === 'P1' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}>
                        {fr.priority}
                      </span>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-white flex items-center gap-2">
                          <span className="font-mono text-[#827D8E]">{fr.id}</span>
                          <span>{fr.title}</span>
                        </div>
                        <p className="text-xs text-[#827D8E] leading-relaxed">{fr.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Non-Functional Standards
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {prd.nonFunctionalRequirements.map((nfr) => (
                    <div key={nfr.category} className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-1">
                      <div className="text-[11px] font-semibold text-[#5B8FFF] uppercase font-mono">{nfr.category}</div>
                      <p className="text-xs text-[#B5B1C0] leading-relaxed">{nfr.specification}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="space-y-6">
              <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Technology Stack
                </h3>
                <div className="flex flex-wrap gap-2">
                  {prd.techStack.map((tech) => (
                    <span key={tech} className="px-3 py-1 rounded-lg bg-[#075BFF]/10 text-[#5B8FFF] border border-[#075BFF]/25 font-mono text-xs font-medium">
                      {tech}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Architecture & Implementation Highlights
                </h3>
                <ul className="space-y-2 text-xs text-[#B5B1C0]">
                  {prd.architectureHighlights.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[#075BFF] font-bold">›</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {prd.adrs && prd.adrs.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                    Linked Architecture Decision Records (ADRs)
                  </h3>
                  <div className="space-y-2">
                    {prd.adrs.map((adr) => (
                      <div key={adr.code} className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white font-mono">{adr.code} · {adr.title}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            {adr.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#827D8E]">{adr.decision}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'risks' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Risk Matrix & Mitigation
                </h3>
                <div className="space-y-2.5">
                  {prd.riskMatrix.map((rm, i) => (
                    <div key={i} className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">{rm.risk}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          rm.severity === 'High' ? 'bg-rose-500/20 text-rose-400' :
                          rm.severity === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {rm.severity} Risk
                        </span>
                      </div>
                      <p className="text-xs text-[#827D8E]">
                        <strong className="text-[#B5B1C0]">Mitigation:</strong> {rm.mitigation}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                  Delivery Roadmap Milestones
                </h3>
                <div className="space-y-2.5">
                  {prd.milestones.map((m, i) => (
                    <div key={i} className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-white">{m.phase}</div>
                        <p className="text-xs text-[#827D8E]">{m.deliverable}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded bg-[#075BFF]/10 text-[#5B8FFF] border border-[#075BFF]/25 font-mono text-xs shrink-0">
                        {m.eta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'approvals' && (
            <div className="space-y-4">
              <h3 className="text-xs uppercase font-mono tracking-wider text-[#827D8E] font-semibold">
                Multi-Signature Sign-Off & Evidence Ledger
              </h3>
              <div className="space-y-2.5">
                {prd.approvals.map((ap, i) => (
                  <div key={i} className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-white">{ap.role}</div>
                      <div className="text-xs text-[#827D8E]">{ap.reviewer}</div>
                    </div>
                    <div className="text-right space-y-1">
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider ${
                        ap.status === 'Approved'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : ap.status === 'Rejected'
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}>
                        {ap.status}
                      </span>
                      <div className="text-[10px] text-[#827D8E]">{ap.date}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-6 border-t border-white/[0.08] bg-[#10121C] flex items-center justify-between">
          <div className="text-xs text-[#827D8E] font-mono">
            Generated via IdeaQ Engineering Engine
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => openPrdPrintPreview(prd)}
              className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-[#075BFF]/20"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save as PDF</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
