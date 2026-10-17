/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * PRD & ADR PDF Generator and Export Engine.
 * Generates executive-grade, print-ready Product Requirements Documents
 * with full architectural specifications, risk matrices, and multi-party sign-off tables.
 */

import { Idea, Product, ADR } from '../types/factory';

export interface PrdDocumentData {
  id: string;
  title: string;
  version: string;
  date: string;
  status: 'Draft' | 'In Review' | 'Approved' | 'Promoted';
  author: string;
  productName: string;
  productCode: string;
  domain: string;
  techStack: string[];
  problemStatement: string;
  expectedValue: string;
  targetUser: string;
  complexity: string;
  tags: string[];
  executiveSummary: string;
  functionalRequirements: {
    id: string;
    title: string;
    description: string;
    priority: 'P0' | 'P1' | 'P2';
  }[];
  nonFunctionalRequirements: {
    category: string;
    specification: string;
  }[];
  architectureHighlights: string[];
  adrs?: {
    code: string;
    title: string;
    status: string;
    decision: string;
  }[];
  riskMatrix: {
    risk: string;
    severity: 'High' | 'Medium' | 'Low';
    mitigation: string;
  }[];
  milestones: {
    phase: string;
    deliverable: string;
    eta: string;
  }[];
  approvals: {
    role: string;
    reviewer: string;
    status: 'Approved' | 'Pending' | 'Rejected';
    date: string;
  }[];
}

export function buildPrdFromIdea(
  idea: Idea,
  product: Product,
  authorName = 'Workspace Lead',
  approvers: { role: string; reviewer: string; status: 'Approved' | 'Pending' | 'Rejected'; date: string }[] = [],
  productAdrs: ADR[] = [],
): PrdDocumentData {
  const statusMap: Record<string, 'Draft' | 'In Review' | 'Approved' | 'Promoted'> = {
    draft: 'Draft',
    pending_approval: 'In Review',
    approved: 'Approved',
    rejected: 'In Review',
    promoted: 'Promoted',
  };

  const status = statusMap[idea.status] || 'Draft';
  const techStack = product.techStack && product.techStack.length > 0
    ? product.techStack
    : ['TypeScript', 'FastAPI', 'PostgreSQL', 'Docker', 'Redis'];

  // Default approvals if none provided
  const approvalList: { role: string; reviewer: string; status: 'Approved' | 'Pending' | 'Rejected'; date: string }[] =
    approvers.length > 0
      ? approvers
      : [
          {
            role: 'Lead Architect',
            reviewer: 'Systems Architect',
            status: (idea.status === 'approved' || idea.status === 'promoted' ? 'Approved' : 'Pending') as 'Approved' | 'Pending' | 'Rejected',
            date: new Date(idea.updatedAt || Date.now()).toLocaleDateString(),
          },
          {
            role: 'Product Manager',
            reviewer: authorName,
            status: (idea.status === 'approved' || idea.status === 'promoted' ? 'Approved' : 'Pending') as 'Approved' | 'Pending' | 'Rejected',
            date: new Date(idea.createdAt || Date.now()).toLocaleDateString(),
          },
          {
            role: 'AppSec / Security Lead',
            reviewer: 'AppSec Specialist',
            status: (idea.status === 'approved' || idea.status === 'promoted' ? 'Approved' : 'Pending') as 'Approved' | 'Pending' | 'Rejected',
            date: new Date(idea.updatedAt || Date.now()).toLocaleDateString(),
          },
        ];

  return {
    id: `PRD-${idea.id.substring(0, 8).toUpperCase()}`,
    title: idea.title,
    version: '1.0.0',
    date: new Date(idea.createdAt || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    status,
    author: authorName,
    productName: product.name,
    productCode: product.code,
    domain: product.domain || 'Enterprise Software',
    techStack,
    problemStatement: idea.problemStatement || 'Automate and streamline engineering workflow bottlenecks.',
    expectedValue: idea.expectedValue || 'Accelerate delivery cycle time and eliminate repetitive manual toil.',
    targetUser: idea.targetUser || 'Enterprise Developers, SREs, Product Managers',
    complexity: idea.complexity || 'Medium',
    tags: idea.tags && idea.tags.length > 0 ? idea.tags : ['Automation', 'Core-Platform', 'AI-Assisted'],
    executiveSummary: `This Product Requirements Document (PRD) defines the specification, architecture, and execution roadmap for "${idea.title}". Initiated under product umbrella ${product.name} (${product.code}), this initiative directly targets ${idea.targetUser} to deliver high-impact engineering automation and operational excellence.`,
    functionalRequirements: [
      {
        id: 'FR-01',
        title: 'Core Engine & Workflow Orchestration',
        description: `Implement the primary logic and service boundary required to execute ${idea.title}.`,
        priority: 'P0',
      },
      {
        id: 'FR-02',
        title: 'API Contracts & Service Integration',
        description: 'Provide secure REST / WebSocket interfaces for real-time telemetry, state synchronisation, and audit ledger emission.',
        priority: 'P0',
      },
      {
        id: 'FR-03',
        title: 'Role-Based Access Control & Approvals',
        description: 'Enforce multi-signature approval gates before promoting state across staging and production boundaries.',
        priority: 'P1',
      },
      {
        id: 'FR-04',
        title: 'Telemetry & Evidence Ledger Logging',
        description: 'Record all transaction events, execution traces, and gate transitions to the tamper-evident PostgreSQL ledger.',
        priority: 'P1',
      },
    ],
    nonFunctionalRequirements: [
      {
        category: 'Performance & Latency',
        specification: 'p99 API response time < 150ms under standard concurrency; streaming updates < 50ms latency.',
      },
      {
        category: 'Security & Posture',
        specification: 'Row-Level Security (RLS) enabled on all tables; TLS 1.3 in transit; AES-256 for persistent token stores.',
      },
      {
        category: 'Reliability & SLA',
        specification: '99.9% service availability with automated health checks, graceful fallback, and idempotent worker retries.',
      },
      {
        category: 'Scalability',
        specification: 'Stateless API workers horizontally scalable behind Cloud Run / Kubernetes load balancers.',
      },
    ],
    architectureHighlights: [
      `Modular service encapsulation aligned with ${product.name} architecture standards.`,
      `Database persistence backed by PostgreSQL schema with pgvector semantic indexes.`,
      `FastAPI asynchronous worker loops with strict typing and schema validation.`,
      `Real-time WebSocket notifications broadcasting progress to connected factory stations.`,
    ],
    adrs: productAdrs.length > 0
      ? productAdrs.map((a) => ({
          code: `ADR-${String(a.number).padStart(3, '0')}`,
          title: a.title,
          status: a.status.toUpperCase(),
          decision: a.decision,
        }))
      : [
          {
            code: 'ADR-001',
            title: 'Event-Driven Realtime Orchestration',
            status: 'ACCEPTED',
            decision: 'Adopt Redis Pub/Sub and WebSocket broker for real-time factory state synchronization.',
          },
          {
            code: 'ADR-002',
            title: 'Immutable Evidence Ledger',
            status: 'ACCEPTED',
            decision: 'Store all worker steps, gate validations, and approvals in an append-only audit ledger.',
          },
        ],
    riskMatrix: [
      {
        risk: 'Third-party API rate limits / upstream provider downtime',
        severity: 'Medium',
        mitigation: 'Implement exponential backoff retry policies with local fallback heuristics.',
      },
      {
        risk: 'Schema drift between service versions',
        severity: 'Low',
        mitigation: 'Strict Pydantic / TypeScript contract synchronization and automated migration gating.',
      },
      {
        risk: 'Unauthorized approval bypass',
        severity: 'High',
        mitigation: 'Server-side cryptographic token verification and multi-role quorum validation.',
      },
    ],
    milestones: [
      {
        phase: 'Phase 1: Architecture & API Foundation',
        deliverable: 'Data models, OpenAPI specs, database migrations, and mock test harness.',
        eta: 'Sprint 1',
      },
      {
        phase: 'Phase 2: Core Implementation & Integrations',
        deliverable: 'Autonomous worker pipelines, real-time channels, and station UI integration.',
        eta: 'Sprint 2',
      },
      {
        phase: 'Phase 3: QA Verification & Hardening',
        deliverable: 'E2E gate verification, SAST security scan pass, and load testing.',
        eta: 'Sprint 3',
      },
      {
        phase: 'Phase 4: Release & Canary Deployment',
        deliverable: 'Multi-signature sign-off, canary rollout, and monitoring dashboard activation.',
        eta: 'Sprint 4',
      },
    ],
    approvals: approvalList,
  };
}

export function generatePrdHtml(prd: PrdDocumentData): string {
  const statusColor = prd.status === 'Approved' || prd.status === 'Promoted' ? '#10B981' : prd.status === 'In Review' ? '#F59E0B' : '#3B82F6';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${prd.title} - PRD Specification</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.55;
      font-size: 13px;
      margin: 0;
      padding: 24px;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
      .page-break {
        page-break-before: always;
      }
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563EB;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 700;
      color: #2563EB;
      margin-bottom: 4px;
    }
    .doc-title {
      font-size: 24px;
      font-weight: 800;
      color: #0F172A;
      margin: 0 0 6px 0;
      line-height: 1.2;
    }
    .doc-subtitle {
      font-size: 12px;
      color: #64748B;
      margin: 0;
    }
    .meta-box {
      text-align: right;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      background: ${statusColor}15;
      color: ${statusColor};
      border: 1px solid ${statusColor}40;
      margin-bottom: 8px;
    }
    .meta-table {
      font-size: 11px;
      color: #475569;
      border-collapse: collapse;
      margin-top: 4px;
    }
    .meta-table td {
      padding: 2px 6px;
    }
    .meta-table td:first-child {
      font-weight: 600;
      color: #1E293B;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
    }
    .meta-item-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748B;
      letter-spacing: 0.5px;
    }
    .meta-item-value {
      font-size: 13px;
      font-weight: 600;
      color: #0F172A;
      margin-top: 2px;
    }
    .section {
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #1E293B;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 6px;
      margin: 0 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      background: #2563EB;
      color: #ffffff;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 800;
    }
    p {
      margin: 0 0 10px 0;
      color: #334155;
    }
    .table-custom {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 12px;
    }
    .table-custom th {
      background: #F1F5F9;
      color: #1E293B;
      text-align: left;
      padding: 8px 10px;
      font-weight: 700;
      border-bottom: 1px solid #CBD5E1;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .table-custom td {
      padding: 8px 10px;
      border-bottom: 1px solid #E2E8F0;
      vertical-align: top;
      color: #334155;
    }
    .table-custom tr:nth-child(even) td {
      background: #F8FAFC;
    }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      background: #E2E8F0;
      color: #334155;
      margin-right: 4px;
      margin-bottom: 4px;
    }
    .tag-pri-p0 {
      background: #FEE2E2;
      color: #991B1B;
      font-weight: 700;
    }
    .tag-pri-p1 {
      background: #FEF3C7;
      color: #92400E;
      font-weight: 700;
    }
    .tag-pri-p2 {
      background: #E0E7FF;
      color: #3730A3;
      font-weight: 700;
    }
    .risk-high {
      color: #DC2626;
      font-weight: 700;
    }
    .risk-med {
      color: #D97706;
      font-weight: 700;
    }
    .risk-low {
      color: #16A34A;
      font-weight: 700;
    }
    .bullet-list {
      margin: 0;
      padding-left: 20px;
      color: #334155;
    }
    .bullet-list li {
      margin-bottom: 6px;
    }
    .footer {
      border-top: 1px solid #E2E8F0;
      padding-top: 12px;
      margin-top: 32px;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #94A3B8;
    }
    .btn-action {
      background: #2563EB;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-action:hover {
      background: #1D4ED8;
    }
    .btn-bar {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      gap: 10px;
      background: rgba(15, 23, 42, 0.9);
      padding: 10px 16px;
      border-radius: 12px;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      z-index: 1000;
    }
  </style>
</head>
<body>
  <div class="btn-bar no-print">
    <button class="btn-action" onclick="window.print()">
      🖨️ Print / Save as PDF
    </button>
    <button class="btn-action" style="background: #475569;" onclick="window.close()">
      ✕ Close
    </button>
  </div>

  <!-- Header -->
  <div class="header-bar">
    <div>
      <div class="brand-title">Software Karkhana • IdeaQ Engineering Studio</div>
      <h1 class="doc-title">${prd.title}</h1>
      <p class="doc-subtitle">Product Requirements & Architectural Specification (PRD)</p>
    </div>
    <div class="meta-box">
      <div class="status-badge">${prd.status}</div>
      <table class="meta-table">
        <tr><td>Doc ID:</td><td>${prd.id}</td></tr>
        <tr><td>Version:</td><td>v${prd.version}</td></tr>
        <tr><td>Date:</td><td>${prd.date}</td></tr>
      </table>
    </div>
  </div>

  <!-- Meta Summary Strip -->
  <div class="meta-grid">
    <div>
      <div class="meta-item-label">Product Anchor</div>
      <div class="meta-item-value">${prd.productName} (${prd.productCode})</div>
    </div>
    <div>
      <div class="meta-item-label">Industry Domain</div>
      <div class="meta-item-value">${prd.domain}</div>
    </div>
    <div>
      <div class="meta-item-label">Complexity Level</div>
      <div class="meta-item-value">${prd.complexity} Complexity</div>
    </div>
    <div>
      <div class="meta-item-label">Lead Author</div>
      <div class="meta-item-value">${prd.author}</div>
    </div>
  </div>

  <!-- Section 1: Executive Summary -->
  <div class="section">
    <div class="section-title"><span class="section-num">1</span> Executive Summary</div>
    <p>${prd.executiveSummary}</p>
    <div style="margin-top: 8px;">
      ${prd.tags.map((t) => `<span class="tag">#${t}</span>`).join('')}
    </div>
  </div>

  <!-- Section 2: Problem Statement & Value Proposition -->
  <div class="section">
    <div class="section-title"><span class="section-num">2</span> Problem Statement & Expected ROI</div>
    <p><strong>Core Problem:</strong> ${prd.problemStatement}</p>
    <p><strong>Target Users:</strong> ${prd.targetUser}</p>
    <p><strong>Value Realization:</strong> ${prd.expectedValue}</p>
  </div>

  <!-- Section 3: Functional Requirements -->
  <div class="section">
    <div class="section-title"><span class="section-num">3</span> Functional Requirements & Specifications</div>
    <table class="table-custom">
      <thead>
        <tr>
          <th style="width: 80px;">ID</th>
          <th style="width: 200px;">Requirement</th>
          <th>Description & Scope</th>
          <th style="width: 70px;">Priority</th>
        </tr>
      </thead>
      <tbody>
        ${prd.functionalRequirements.map((fr) => `
          <tr>
            <td><strong>${fr.id}</strong></td>
            <td><strong>${fr.title}</strong></td>
            <td>${fr.description}</td>
            <td>
              <span class="tag ${fr.priority === 'P0' ? 'tag-pri-p0' : fr.priority === 'P1' ? 'tag-pri-p1' : 'tag-pri-p2'}">${fr.priority}</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Section 4: Non-Functional Requirements -->
  <div class="section">
    <div class="section-title"><span class="section-num">4</span> Non-Functional & Reliability Standards</div>
    <table class="table-custom">
      <thead>
        <tr>
          <th style="width: 200px;">Category</th>
          <th>Standard & Target Metric</th>
        </tr>
      </thead>
      <tbody>
        ${prd.nonFunctionalRequirements.map((nfr) => `
          <tr>
            <td><strong>${nfr.category}</strong></td>
            <td>${nfr.specification}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Section 5: Architecture & ADR Highlights -->
  <div class="section">
    <div class="section-title"><span class="section-num">5</span> Architecture Highlights & Decision Records (ADRs)</div>
    <p><strong>Core Tech Stack:</strong> ${prd.techStack.join(', ')}</p>
    <ul class="bullet-list">
      ${prd.architectureHighlights.map((a) => `<li>${a}</li>`).join('')}
    </ul>
    ${prd.adrs && prd.adrs.length > 0 ? `
      <table class="table-custom" style="margin-top: 12px;">
        <thead>
          <tr>
            <th style="width: 90px;">ADR ID</th>
            <th style="width: 220px;">Decision Title</th>
            <th style="width: 90px;">Status</th>
            <th>Summary Decision</th>
          </tr>
        </thead>
        <tbody>
          ${prd.adrs.map((adr) => `
            <tr>
              <td><strong>${adr.code}</strong></td>
              <td><strong>${adr.title}</strong></td>
              <td><span class="tag" style="background: #DBEAFE; color: #1E40AF; font-weight:700;">${adr.status}</span></td>
              <td>${adr.decision}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}
  </div>

  <!-- Section 6: Risk Analysis -->
  <div class="section">
    <div class="section-title"><span class="section-num">6</span> Risk Matrix & Mitigation Strategy</div>
    <table class="table-custom">
      <thead>
        <tr>
          <th>Identified Risk</th>
          <th style="width: 100px;">Severity</th>
          <th>Mitigation Action Plan</th>
        </tr>
      </thead>
      <tbody>
        ${prd.riskMatrix.map((rm) => `
          <tr>
            <td>${rm.risk}</td>
            <td class="${rm.severity === 'High' ? 'risk-high' : rm.severity === 'Medium' ? 'risk-med' : 'risk-low'}">${rm.severity}</td>
            <td>${rm.mitigation}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Section 7: Delivery Milestones -->
  <div class="section">
    <div class="section-title"><span class="section-num">7</span> Execution Roadmap & Delivery Milestones</div>
    <table class="table-custom">
      <thead>
        <tr>
          <th style="width: 220px;">Milestone Phase</th>
          <th>Target Deliverables</th>
          <th style="width: 100px;">Target Sprint</th>
        </tr>
      </thead>
      <tbody>
        ${prd.milestones.map((m) => `
          <tr>
            <td><strong>${m.phase}</strong></td>
            <td>${m.deliverable}</td>
            <td><strong>${m.eta}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Section 8: Approvals Sign-off -->
  <div class="section">
    <div class="section-title"><span class="section-num">8</span> Multi-Signature Sign-Off & Approvals Table</div>
    <table class="table-custom">
      <thead>
        <tr>
          <th style="width: 180px;">Station Role</th>
          <th style="width: 200px;">Designated Reviewer</th>
          <th style="width: 110px;">Verdict</th>
          <th>Date & Audit Trace</th>
        </tr>
      </thead>
      <tbody>
        ${prd.approvals.map((ap) => `
          <tr>
            <td><strong>${ap.role}</strong></td>
            <td>${ap.reviewer}</td>
            <td>
              <span class="tag" style="${ap.status === 'Approved' ? 'background:#DCFCE7;color:#166534;' : ap.status === 'Rejected' ? 'background:#FEE2E2;color:#991B1B;' : 'background:#FEF3C7;color:#92400E;'} font-weight:700;">
                ${ap.status.toUpperCase()}
              </span>
            </td>
            <td>${ap.date} (Recorded in Karkhana Evidence Ledger)</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>Generated by IdeaQ Studio • Software Karkhana Autonomous Factory</div>
    <div>Confidential • Internal Engineering Document • Page 1 of 1</div>
  </div>
</body>
</html>`;
}

export function openPrdPrintPreview(prd: PrdDocumentData): void {
  const html = generatePrdHtml(prd);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

export function downloadPrdHtml(prd: PrdDocumentData): void {
  const html = generatePrdHtml(prd);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prd.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-prd.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
