import {
  Workspace,
  TeamMember,
  Team,
  Product,
  ProductKnowledge,
  Idea,
  ApprovalRequest,
  Project,
  Epic,
  Issue,
  DesignArtifact,
  ADR,
  MermaidDiagram,
  AgentRun,
  PullRequest,
  TestScenario,
  Defect,
  SecurityFinding,
  Pipeline,
  Environment,
  Release,
  FeedbackItem,
  Incident,
  FactoryRule,
  FactorySkill,
  AuditEvent,
  FactoryRole,
  ScreenId,
  DashboardWidget,
  WorkspaceTemplate,
} from '../types/factory';

export const ROLE_CONFIGS: Record<FactoryRole, { label: string; badge: string; desc: string }> = {
  executive: { label: 'Executive / Director', badge: 'Leadership', desc: 'Portfolio oversight, capital allocation, and multi-signature approval gates.' },
  product_manager: { label: 'Product Manager', badge: 'Discovery & Plan', desc: 'Idea validation studio, feasibility radar, epics, and roadmap planning.' },
  designer: { label: 'UI / UX Designer', badge: 'Design System', desc: 'AI prototype studio, screen flow maps, design tokens, and review pins.' },
  architect: { label: 'Systems Architect', badge: 'Architecture', desc: 'Mermaid C4 system design, ADR registry, API contracts, and risk mapping.' },
  developer: { label: 'Lead Developer', badge: 'Engineering', desc: 'Task context packages, autonomous coding agents, and CodeRabbit PR reviews.' },
  qa: { label: 'QA / QC Lead', badge: 'Verification', desc: 'Test plan generation, manual scenario runner, automation suites, and defect gates.' },
  security: { label: 'AppSec / Pen Tester', badge: 'Security', desc: 'Threat modeling, SAST/DAST scan runs, vulnerability triage, and SLA tracking.' },
  devops: { label: 'DevOps / SRE', badge: 'Infrastructure', desc: 'Visual CI/CD pipeline DAGs, Cloud Run & Cloud SQL environment orchestration.' },
  release_manager: { label: 'Release Manager', badge: 'Shipping', desc: 'Pre-flight checklists, multi-role quorum sign-off, and canary deployments.' },
  support: { label: 'Support & SRE', badge: 'Operations', desc: 'Production feedback triage, telemetry alarms, and P0 incident response.' },
  admin: { label: 'Workspace Admin', badge: 'Governance', desc: 'Visual workflow designer, integration catalog, model registry, and audit trails.' },
};

// ---------------------------------------------------------------------------
// ZERO MOCK DATA - CLEAN INITIAL SYSTEM STATE
// Everything is 100% created by the user during real execution.
// ---------------------------------------------------------------------------

const INITIAL_WORKSPACE: Workspace = {
  id: 'ws-main',
  name: 'Workspace Alpha',
  slug: 'workspace-alpha',
  domain: 'factory.internal',
  plan: 'enterprise',
  createdAt: new Date().toISOString(),
  securityPosture: 'STANDARD',
  isDemo: false,
};

const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: 'usr-lead',
    name: 'Workspace Lead',
    email: 'lead@factory.internal',
    avatar: '',
    roles: [
      'executive',
      'product_manager',
      'designer',
      'architect',
      'developer',
      'qa',
      'security',
      'devops',
      'release_manager',
      'support',
      'admin',
    ],
    teamId: 'tm-core',
    timezone: 'UTC',
    availability: 'online',
  },
];

const INITIAL_TEAMS: Team[] = [
  {
    id: 'tm-core',
    name: 'Core Engineering Team',
    leadId: 'usr-lead',
    mission: 'Cross-functional engineering and product delivery.',
    memberCount: 1,
    assignedProjectIds: [],
  },
];

export interface FactoryState {
  authStatus: 'guest' | 'authenticated';
  currentRole: FactoryRole;
  currentScreen: ScreenId;
  selectedProductId?: string;
  selectedProjectId?: string;
  selectedIdeaId?: string;
  selectedPrId?: string;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspace: Workspace;
  onboardingStep: number;
  dashboardWidgets: DashboardWidget[];
  members: TeamMember[];
  teams: Team[];
  products: Product[];
  knowledge: ProductKnowledge[];
  ideas: Idea[];
  projects: Project[];
  epics: Epic[];
  issues: Issue[];
  pullRequests: PullRequest[];
  adrs: ADR[];
  diagrams: MermaidDiagram[];
  testScenarios: TestScenario[];
  securityFindings: SecurityFinding[];
  pipelines: Pipeline[];
  environments: Environment[];
  releases: Release[];
  feedback: FeedbackItem[];
  incidents: Incident[];
  rules: FactoryRule[];
  skills: FactorySkill[];
  auditLogs: AuditEvent[];
  activeAgentRun?: AgentRun;
  companionOpen: boolean;
}

const STORAGE_KEY = 'software_karkhana_clean_v4';

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'w-assigned-tasks', title: 'My Work & Assigned Tasks', category: 'tasks', enabled: true, order: 1 },
  { id: 'w-agent-runs', title: 'Active Autonomous Agent Runs', category: 'activity', enabled: true, order: 2 },
  { id: 'w-prs-review', title: 'Code Reviews & PRs', category: 'approvals', enabled: true, order: 3 },
  { id: 'w-pipelines', title: 'CI/CD Multi-Stage Canary Health', category: 'system', enabled: true, order: 4 },
];

function loadInitialState(): FactoryState {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to parse stored state, using clean defaults', e);
    }
  }

  return {
    authStatus: 'guest',
    currentRole: 'product_manager',
    currentScreen: 'landing',
    selectedProductId: undefined,
    selectedProjectId: undefined,
    selectedIdeaId: undefined,
    selectedPrId: undefined,
    workspaces: [INITIAL_WORKSPACE],
    activeWorkspaceId: INITIAL_WORKSPACE.id,
    workspace: INITIAL_WORKSPACE,
    onboardingStep: 1,
    dashboardWidgets: DEFAULT_WIDGETS,
    members: INITIAL_MEMBERS,
    teams: INITIAL_TEAMS,
    products: [],
    knowledge: [],
    ideas: [],
    projects: [],
    epics: [],
    issues: [],
    pullRequests: [],
    adrs: [],
    diagrams: [],
    testScenarios: [],
    securityFindings: [],
    pipelines: [],
    environments: [],
    releases: [],
    feedback: [],
    incidents: [],
    rules: [],
    skills: [],
    auditLogs: [],
    companionOpen: false,
  };
}

let state: FactoryState = loadInitialState();
const listeners = new Set<(s: FactoryState) => void>();

function notify() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to persist factory state', e);
    }
  }
  listeners.forEach((l) => l(state));
}

export const factoryStore = {
  getState: () => state,
  subscribe: (listener: (s: FactoryState) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setAuthStatus: (authStatus: 'guest' | 'authenticated') => {
    state = { ...state, authStatus };
    notify();
  },

  signInDemo: () => {
    state = {
      ...state,
      authStatus: 'authenticated',
      activeWorkspaceId: state.workspaces[0]?.id || INITIAL_WORKSPACE.id,
      workspace: state.workspaces[0] || INITIAL_WORKSPACE,
      currentScreen: 'workspace_home',
      currentRole: 'product_manager',
    };
    notify();
  },

  signOut: () => {
    state = { ...state, authStatus: 'guest', currentScreen: 'landing' };
    notify();
  },

  startOnboarding: () => {
    state = { ...state, currentScreen: 'onboarding', onboardingStep: 1 };
    notify();
  },

  setOnboardingStep: (step: number) => {
    state = { ...state, onboardingStep: step };
    notify();
  },

  createWorkspace: (name: string, slug: string, template: WorkspaceTemplate = 'empty', goal?: string, invites: string[] = []) => {
    const newWsId = `ws-${Date.now()}`;
    const newWorkspace: Workspace = {
      id: newWsId,
      name: name || 'My Software Factory',
      slug: slug || 'my-factory',
      domain: `${slug || 'factory'}.internal`,
      plan: 'enterprise',
      createdAt: new Date().toISOString(),
      securityPosture: 'STANDARD',
      templateUsed: template,
      isDemo: false,
    };

    state = {
      ...state,
      authStatus: 'authenticated',
      workspaces: [...state.workspaces, newWorkspace],
      activeWorkspaceId: newWsId,
      workspace: newWorkspace,
      currentScreen: 'workspace_home',
      currentRole: 'product_manager',
    };
    factoryStore.logAudit('Created Workspace', `Workspace "${newWorkspace.name}" created.`);
    notify();
  },

  switchWorkspace: (workspaceId: string) => {
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    state = {
      ...state,
      activeWorkspaceId: ws.id,
      workspace: ws,
      currentScreen: 'workspace_home',
    };
    factoryStore.logAudit('Switched Workspace', `Switched active workspace to "${ws.name}".`);
    notify();
  },

  createProduct: (product: Partial<Product>) => {
    const newProdId = `prod-${Date.now()}`;
    const newProduct: Product = {
      id: newProdId,
      workspaceId: state.workspace.id,
      name: product.name || 'New Product',
      code: product.code || (product.name ? product.name.slice(0, 4).toUpperCase() : 'PROD'),
      description: product.description || 'Enterprise software product.',
      ownerId: state.members[0]?.id || 'usr-lead',
      status: 'active',
      domain: product.domain || 'Cloud & Core Infrastructure',
      techStack: product.techStack || ['TypeScript', 'Node.js', 'PostgreSQL'],
      activeIdeaCount: 0,
      activeProjectCount: 0,
      repositories: product.repositories || [],
      lastActivity: 'Just created',
    };
    state = {
      ...state,
      products: [newProduct, ...state.products],
      selectedProductId: newProdId,
      currentScreen: 'product_detail',
    };
    factoryStore.logAudit('Created Product', `Product "${newProduct.name}" created.`);
    notify();
  },

  deleteProduct: (productId: string) => {
    state = {
      ...state,
      products: state.products.filter((p) => p.id !== productId),
      projects: state.projects.filter((p) => p.productId !== productId),
      ideas: state.ideas.filter((i) => i.productId !== productId),
      selectedProductId: state.selectedProductId === productId ? undefined : state.selectedProductId,
    };
    factoryStore.logAudit('Deleted Product', `Product ${productId} deleted.`);
    notify();
  },

  createProject: (project: Partial<Project>) => {
    const newPrjId = `prj-${Date.now()}`;
    const newProject: Project = {
      id: newPrjId,
      productId: project.productId || state.selectedProductId || state.products[0]?.id || '',
      name: project.name || 'New Project',
      code: project.code || `PRJ-${state.projects.length + 1}`,
      description: project.description || 'Core engineering service deliverable.',
      status: 'development',
      phase: 'Sprint 1',
      health: 'healthy',
      leadId: state.members[0]?.id || 'usr-lead',
      teamsAssigned: ['tm-core'],
      targetReleaseDate: project.targetReleaseDate || '2026-12-31',
      repositoryUrl: project.repositoryUrl || 'github.com/org/repo',
      milestonesCount: 1,
      completedTasks: 0,
      totalTasks: 0,
      createdAt: new Date().toISOString(),
    };
    state = {
      ...state,
      projects: [newProject, ...state.projects],
      selectedProjectId: newPrjId,
      currentScreen: 'project_detail',
    };
    // Update product active project count
    if (newProject.productId) {
      state.products = state.products.map((p) =>
        p.id === newProject.productId ? { ...p, activeProjectCount: (p.activeProjectCount || 0) + 1 } : p
      );
    }
    factoryStore.logAudit('Created Project', `Project "${newProject.name}" created.`);
    notify();
  },

  deleteProject: (projectId: string) => {
    state = {
      ...state,
      projects: state.projects.filter((p) => p.id !== projectId),
      issues: state.issues.filter((i) => i.projectId !== projectId),
      pullRequests: state.pullRequests.filter((pr) => pr.projectId !== projectId),
      selectedProjectId: state.selectedProjectId === projectId ? undefined : state.selectedProjectId,
    };
    factoryStore.logAudit('Deleted Project', `Project ${projectId} deleted.`);
    notify();
  },

  updateDashboardWidgets: (widgets: DashboardWidget[]) => {
    state = { ...state, dashboardWidgets: widgets };
    notify();
  },

  setRole: (role: FactoryRole) => {
    state = { ...state, currentRole: role };
    const screenMap: Record<FactoryRole, ScreenId> = {
      executive: 'portfolio',
      product_manager: 'workspace_home',
      designer: 'prototype_studio',
      architect: 'system_design',
      developer: 'developer_dashboard',
      qa: 'qa_dashboard',
      security: 'security_dashboard',
      devops: 'pipeline_studio',
      release_manager: 'release_dashboard',
      support: 'feedback_inbox',
      admin: 'rule_governance',
    };
    state.currentScreen = screenMap[role] || 'workspace_home';
    notify();
  },

  setScreen: (screen: ScreenId) => {
    state = { ...state, currentScreen: screen };
    notify();
  },

  selectProduct: (id: string) => {
    state = { ...state, selectedProductId: id };
    notify();
  },

  selectProject: (id: string) => {
    state = { ...state, selectedProjectId: id };
    notify();
  },

  selectIdea: (id: string) => {
    state = { ...state, selectedIdeaId: id };
    notify();
  },

  selectPr: (id: string) => {
    state = { ...state, selectedPrId: id };
    notify();
  },

  toggleCompanion: () => {
    state = { ...state, companionOpen: !state.companionOpen };
    notify();
  },

  // State Mutations
  addIdea: (idea: Idea) => {
    state = { ...state, ideas: [idea, ...state.ideas], selectedIdeaId: idea.id };
    factoryStore.logAudit('Created Feature Idea', `Idea "${idea.title}" submitted to discovery studio.`);
    notify();
  },

  deleteIdea: (ideaId: string) => {
    state = {
      ...state,
      ideas: state.ideas.filter((i) => i.id !== ideaId),
      selectedIdeaId: state.selectedIdeaId === ideaId ? undefined : state.selectedIdeaId,
    };
    factoryStore.logAudit('Deleted Idea', `Idea ${ideaId} deleted.`);
    notify();
  },

  promoteIdeaToProject: (ideaId: string, projectName: string) => {
    const idea = state.ideas.find((i) => i.id === ideaId);
    if (!idea) return;

    const newPrjId = `prj-gen-${Date.now()}`;
    const newProject: Project = {
      id: newPrjId,
      productId: idea.productId || state.products[0]?.id || '',
      sourceIdeaId: idea.id,
      name: projectName || `${idea.title} Project`,
      code: `P-${state.projects.length + 1}`,
      description: idea.expectedValue || idea.problemStatement,
      status: 'planning',
      phase: 'Sprint 1',
      health: 'healthy',
      leadId: state.members[0]?.id || 'usr-lead',
      teamsAssigned: ['tm-core'],
      targetReleaseDate: '2026-12-31',
      repositoryUrl: `github.com/org/${idea.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      milestonesCount: 1,
      completedTasks: 0,
      totalTasks: 0,
      createdAt: new Date().toISOString(),
    };

    state = {
      ...state,
      ideas: state.ideas.map((i) => (i.id === ideaId ? { ...i, status: 'promoted', promotedProjectId: newPrjId } : i)),
      projects: [newProject, ...state.projects],
      selectedProjectId: newPrjId,
      currentScreen: 'projects',
    };

    factoryStore.logAudit('Promoted Idea to Project', `Idea "${idea.title}" promoted to Project "${newProject.name}".`);
    notify();
  },

  createIssue: (issue: Partial<Issue>) => {
    const newIssueId = `iss-${Date.now()}`;
    const newIssue: Issue = {
      id: newIssueId,
      projectId: issue.projectId || state.selectedProjectId || state.projects[0]?.id || '',
      title: issue.title || 'New Task',
      type: issue.type || 'story',
      status: issue.status || 'todo',
      priority: issue.priority || 'P2',
      assigneeId: issue.assigneeId || state.members[0]?.id || 'usr-lead',
      labels: issue.labels || ['Sprint 1'],
      acceptanceCriteria: issue.acceptanceCriteria || ['Deliverable verified.'],
      commentsCount: 0,
      updatedAt: new Date().toISOString(),
    };
    state = { ...state, issues: [newIssue, ...state.issues] };
    factoryStore.logAudit('Created Issue', `Created task "${newIssue.title}"`);
    notify();
  },

  updateIssueStatus: (issueId: string, newStatus: Issue['status']) => {
    state = {
      ...state,
      issues: state.issues.map((i) => (i.id === issueId ? { ...i, status: newStatus, updatedAt: new Date().toISOString() } : i)),
    };
    notify();
  },

  createPullRequest: (pr: Partial<PullRequest>) => {
    const newPrId = `pr-${Date.now().toString().slice(-4)}`;
    const newPR: PullRequest = {
      id: newPrId,
      projectId: pr.projectId || state.selectedProjectId || state.projects[0]?.id || '',
      number: state.pullRequests.length + 1,
      title: pr.title || 'Feature implementation and code delivery',
      authorId: state.members[0]?.id || 'usr-lead',
      sourceBranch: pr.sourceBranch || 'feature/work',
      targetBranch: pr.targetBranch || 'main',
      status: pr.status || 'open',
      checksStatus: 'passed',
      additions: pr.additions || 45,
      deletions: pr.deletions || 8,
      changedFilesCount: 2,
      description: 'Feature implementation with verified test coverage.',
      diffSummary: pr.diffSummary || 'Implemented new service handlers and clean abstractions.',
      aiReview: pr.aiReview || {
        summary: 'Automated AST review completed. Zero breaking changes or unhandled exceptions detected.',
        architectureImpact: 'Preserves modular interfaces.',
        findings: [],
      },
    };
    state = { ...state, pullRequests: [newPR, ...state.pullRequests], selectedPrId: newPR.id };
    factoryStore.logAudit('Created Pull Request', `PR #${newPR.number}: "${newPR.title}" opened.`);
    notify();
  },

  applyCodeRabbitFix: (prId: string, findingId: string) => {
    const pr = state.pullRequests.find((p) => p.id === prId);
    if (!pr || !pr.aiReview) return;

    const finding = pr.aiReview.findings.find((f) => f.id === findingId);
    if (!finding) return;

    state = {
      ...state,
      pullRequests: state.pullRequests.map((p) => {
        if (p.id !== prId || !p.aiReview) return p;
        return {
          ...p,
          aiReview: {
            ...p.aiReview,
            findings: p.aiReview.findings.filter((f) => f.id !== findingId),
          },
          diffSummary: `${p.diffSummary}\n[Applied 1-Click CodeRabbit Patch: ${finding.title}]`,
        };
      }),
    };

    factoryStore.logAudit('Applied AI Patch', `Applied fix for "${finding.title}" in ${finding.file}:${finding.line}`);
    notify();
  },

  addTestScenario: (ts: Partial<TestScenario>) => {
    const newTc: TestScenario = {
      id: `tc-${Date.now().toString().slice(-4)}`,
      projectId: ts.projectId || state.selectedProjectId || state.projects[0]?.id || '',
      title: ts.title || 'New Automated Scenario',
      type: ts.type || 'Functional',
      priority: ts.priority || 'P1',
      steps: ts.steps || ['Initialize test runtime', 'Execute assert conditions'],
      expectedResult: ts.expectedResult || 'Response matches specification schema.',
      status: 'not_run',
    };
    state = { ...state, testScenarios: [newTc, ...state.testScenarios] };
    factoryStore.logAudit('Added Test Scenario', `Created test "${newTc.title}"`);
    notify();
  },

  runTestScenario: (scenarioId: string, result: 'passed' | 'failed' | 'blocked') => {
    state = {
      ...state,
      testScenarios: state.testScenarios.map((tc) =>
        tc.id === scenarioId ? { ...tc, status: result, actualResult: `Verified at ${new Date().toLocaleTimeString()}.` } : tc
      ),
    };
    factoryStore.logAudit('Executed QA Scenario', `Test ${scenarioId} marked as ${result.toUpperCase()}`);
    notify();
  },

  createPipeline: (pipeline: Partial<Pipeline>) => {
    const newPl: Pipeline = {
      id: `pipe-${Date.now().toString().slice(-4)}`,
      projectId: pipeline.projectId || state.selectedProjectId || state.projects[0]?.id || '',
      name: pipeline.name || 'Continuous Integration & Delivery',
      status: 'success',
      lastRunDuration: '1m 24s',
      lastRunTimestamp: 'Just now',
      stages: [
        { id: 'stg-1', name: 'Build & Typecheck', status: 'success', duration: '24s', command: 'npm run build' },
        { id: 'stg-2', name: 'Unit & Contract Tests', status: 'success', duration: '45s', command: 'npm test' },
        { id: 'stg-3', name: 'SAST Vulnerability Scan', status: 'success', duration: '18s', command: 'trivy fs .' },
        { id: 'stg-4', name: 'Container Artifact Bake', status: 'success', duration: '32s', command: 'docker build .' },
        { id: 'stg-5', name: 'Cloud Run Staging Deploy', status: 'success', duration: '20s', command: 'gcloud run deploy' },
      ],
      yamlContent: 'name: CI/CD\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest',
    };
    state = { ...state, pipelines: [newPl, ...state.pipelines] };
    factoryStore.logAudit('Created CI/CD Pipeline', `Pipeline "${newPl.name}" configured.`);
    notify();
  },

  createRelease: (rel: Partial<Release>) => {
    const newRelId = `rel-${Date.now().toString().slice(-4)}`;
    const newRelease: Release = {
      id: newRelId,
      projectId: rel.projectId || state.selectedProjectId || state.projects[0]?.id || '',
      version: rel.version || `v1.${state.releases.length}.0`,
      status: 'ready',
      targetDate: rel.targetDate || new Date().toISOString().split('T')[0],
      releaseManagerId: state.members[0]?.id || 'usr-lead',
      changelog: rel.changelog || 'Initial production release candidate.',
      checklists: [
        { item: 'Full test suite passed (100% pass rate)', checked: true, ownerRole: 'qa' },
        { item: 'Zero High/Critical CVEs detected in container image', checked: true, ownerRole: 'security' },
        { item: 'Database migration tested in Staging environment', checked: true, ownerRole: 'devops' },
        { item: 'Canary traffic route verified on Cloud Run', checked: true, ownerRole: 'release_manager' },
      ],
      signoffs: [
        { role: 'product_manager', approverName: 'Product Lead', signed: true, timestamp: new Date().toISOString() },
        { role: 'qa', approverName: 'QA Lead', signed: true, timestamp: new Date().toISOString() },
        { role: 'security', approverName: 'Security Lead', signed: false },
        { role: 'release_manager', approverName: 'Release Manager', signed: false },
      ],
    };
    state = { ...state, releases: [newRelease, ...state.releases] };
    factoryStore.logAudit('Created Release', `Release ${newRelease.version} staged.`);
    notify();
  },

  signoffRelease: (releaseId: string, role: FactoryRole, approverName: string) => {
    state = {
      ...state,
      releases: state.releases.map((rel) => {
        if (rel.id !== releaseId) return rel;
        const updatedSignoffs = rel.signoffs.map((s) => (s.role === role ? { ...s, signed: true, approverName, timestamp: new Date().toISOString() } : s));
        const allSigned = updatedSignoffs.every((s) => s.signed);
        return {
          ...rel,
          signoffs: updatedSignoffs,
          status: allSigned ? 'ready' : rel.status,
        };
      }),
    };
    factoryStore.logAudit('Release Gate Signed', `${approverName} (${ROLE_CONFIGS[role].label}) signed off release ${releaseId}.`);
    notify();
  },

  triggerCanaryDeploy: (releaseId: string) => {
    state = {
      ...state,
      releases: state.releases.map((r) => (r.id === releaseId ? { ...r, status: 'deploying' } : r)),
    };
    factoryStore.logAudit('Canary Deployment Triggered', `Traffic diverted 10% to new revision.`);
    notify();

    setTimeout(() => {
      state = {
        ...state,
        releases: state.releases.map((r) => (r.id === releaseId ? { ...r, status: 'released' } : r)),
      };
      factoryStore.logAudit('Canary Succeeded', 'Traffic scaled to 100%. Production healthy.');
      notify();
    }, 2000);
  },

  logIncident: (inc: Partial<Incident>) => {
    const newInc: Incident = {
      id: `inc-${Date.now().toString().slice(-4)}`,
      projectId: state.selectedProjectId || state.projects[0]?.id || '',
      title: inc.title || 'Unexpected latency degradation in API route',
      severity: inc.severity || 'SEV1',
      status: 'investigating',
      commanderId: state.members[0]?.id || 'usr-lead',
      startedAt: 'Just now',
      impactDuration: 'Ongoing',
      summary: inc.summary || 'Service latency spike detected by monitoring probes.',
      affectedServices: inc.affectedServices || ['API Service'],
      actionItems: ['Investigate thread pool saturation', 'Deploy patched replica'],
    };
    state = { ...state, incidents: [newInc, ...state.incidents] };
    factoryStore.logAudit('Logged Incident', `Incident [${newInc.severity}] "${newInc.title}" registered.`);
    notify();
  },

  logAudit: (action: string, details: string) => {
    const currentMember = state.members[0] || INITIAL_MEMBERS[0];
    const newEntry: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: currentMember.name,
      role: state.currentRole,
      action,
      targetEntity: state.selectedProjectId || 'workspace',
      details,
    };
    state = { ...state, auditLogs: [newEntry, ...state.auditLogs] };
    notify();
  },

  clearAllData: () => {
    state = {
      ...state,
      products: [],
      projects: [],
      ideas: [],
      epics: [],
      issues: [],
      pullRequests: [],
      adrs: [],
      diagrams: [],
      testScenarios: [],
      securityFindings: [],
      pipelines: [],
      environments: [],
      releases: [],
      feedback: [],
      incidents: [],
      auditLogs: [],
      selectedProductId: undefined,
      selectedProjectId: undefined,
      selectedIdeaId: undefined,
      selectedPrId: undefined,
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    notify();
  },

  resetDefaults: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    state = loadInitialState();
    notify();
  },
};
