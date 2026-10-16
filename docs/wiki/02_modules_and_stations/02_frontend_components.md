# 02. Frontend Components & UI Architecture Audit

## 📦 Directory Structure (`web/src/`)

```
web/src/
├── components/
│   ├── auth/
│   │   └── AuthScreen.tsx                 ← Enterprise Login/Signup, OTP, Google & GitHub SSO
│   ├── onboarding/
│   │   ├── OnboardingWizard.tsx           ← 4-step interactive progressive onboarding
│   │   ├── WorkspaceChooser.tsx           ← Switch or join enrolled workspaces
│   │   ├── CreateWorkspaceModal.tsx       ← 3-step organization workspace creator
│   │   ├── WorkspaceInviteModal.tsx       ← Role picker, link copy, member list & email invite
│   │   ├── CreateProductModal.tsx         ← PM product initializer modal
│   │   ├── CreateProjectModal.tsx         ← Project scaffolding with team member assignment
│   │   └── GuidedTutorialOverlay.tsx      ← Interactive walkthrough overlay
│   ├── reactbits/
│   │   ├── BlackHole.tsx                  ← Interactive physics-based black hole visual
│   │   ├── DashboardCursor.tsx            ← Smooth custom tech cursor
│   │   └── LiquidEther.css                ← Ambient animated gradient canvas
│   ├── shell/
│   │   ├── AppShell.tsx                   ← Main layout, dynamic breadcrumb, station navigation
│   │   ├── AICompanion.tsx                ← Expandable (420/680px) RAG chat & knowledge base tab
│   │   ├── ChatPanel.tsx                  ← Team collaboration chat panel & channels
│   │   └── ActivityFeedPanel.tsx          ← Live ledger events, agent run logs, station alerts
│   └── views/
│       ├── DashboardView.tsx              ← Workspace analytics, delivery metrics, active runs
│       ├── ProjectHubView.tsx             ← Station map, dependency DAG, task status, run logs
│       ├── PRReviewPanel.tsx              ← CodeRabbit / Dexter style diff reviewer & AI triage
│       ├── ProductsView.tsx               ← Product catalogue & AI idea generator
│       ├── OperationsStationView.tsx      ← Cluster health, Cloud Run container telemetry
│       └── SecurityStationView.tsx        ← SAST/DAST scanner, SBOM compliance, key verification
├── store/
│   └── factoryStore.ts                    ← Centralized reactive state manager (Zustand)
├── types/
│   ├── factory.ts                         ← TypeScript interfaces for workspaces, products, PRs, runs
│   └── speech.d.ts                        ← Web Speech API type definitions for voice input
├── App.tsx                                ← Root view switcher & authentication gate
└── main.tsx                               ← Vite React entry point
```

---

## 🎨 UI & Design System Patterns

### 1. Visual Hierarchy & Dark Tech Design
- **Theme**: Dark charcoal / obsidian background (`#07070B`, `#0A0A0F`, `#101016`) with cobalt blue accents (`#075BFF`) and glassmorphic translucent borders (`border-white/[0.08]`).
- **Typography**: Clean monospace tags for roles, screens, and hashes, paired with geometric sans-serif for content.
- **Micro-Interactions**: Smooth spring animations with `motion/react`, active station glow indicators, and live typing streams.

### 2. State Management (`web/src/store/factoryStore.ts`)
- Manages complete client session state, including active workspace, selected product, active project, selected PR, token authentication, and side-panel visibility (`companionOpen`, `chatOpen`, `activityFeedOpen`).
- Persists session tokens and current workspace to `localStorage` for uninterrupted workflows.

### 3. Integrated AI Companion (`web/src/components/shell/AICompanion.tsx`)
- Supports split tabs: **Chat** (with vector RAG context, session memory, quick actions, source citations) and **Knowledge Base** (document upload, chunk count inspection, and document deletion).
- Resizable layout: 420px compact panel or 680px wide studio view.
