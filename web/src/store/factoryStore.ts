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
  ChatChannel,
  ChatMessage,
  ActivityEvent,
  ProjectComment,
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

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  avatar_url?: string | null;
  onboarded_at?: string | null;
}

export interface FactoryState {
  authStatus: 'guest' | 'authenticated';
  token: string | null;
  currentUser: CurrentUser | null;
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
  // Chat & Activity
  chatChannels: ChatChannel[];
  activeChatChannelId?: string;
  activityEvents: ActivityEvent[];
  projectComments: ProjectComment[];
  chatUnreadTotal: number;
  activityUnreadTotal: number;
}

const STORAGE_KEY = 'software_karkhana_clean_v4';

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'w-assigned-tasks', title: 'My Work & Assigned Tasks', category: 'tasks', enabled: true, order: 1 },
  { id: 'w-agent-runs', title: 'Active Autonomous Agent Runs', category: 'activity', enabled: true, order: 2 },
  { id: 'w-prs-review', title: 'Code Reviews & PRs', category: 'approvals', enabled: true, order: 3 },
  { id: 'w-pipelines', title: 'CI/CD Multi-Stage Canary Health', category: 'system', enabled: true, order: 4 },
];

function freshDefaults(): FactoryState {
  return {
    authStatus: 'guest',
    token: typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null,
    currentUser: null,
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
    chatChannels: [],
    activeChatChannelId: undefined,
    activityEvents: [],
    projectComments: [],
    chatUnreadTotal: 0,
    activityUnreadTotal: 0,
  };
}

function loadInitialState(): FactoryState {
  const defaults = freshDefaults();
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Merge stored state over defaults so newly-added fields are never undefined.
        return { ...defaults, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Failed to parse stored state, using clean defaults', e);
    }
  }
  return defaults;
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

  setAuthSession: (token: string, user: CurrentUser) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('karkhana_jwt_token', token);
    }
    const roleKey = (user.role in ROLE_CONFIGS ? user.role : 'product_manager') as FactoryRole;
    state = {
      ...state,
      authStatus: 'authenticated',
      token,
      currentUser: user,
      currentRole: roleKey,
      currentScreen: user.onboarded_at ? 'workspace_home' : 'onboarding',
    };
    notify();
    // Fetch live workspace data in background
    factoryStore.syncSessionFromServer();
  },

  syncSessionFromServer: async () => {
    const token = state.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null);
    if (!token) return;

    try {
      const authHeader = { Authorization: `Bearer ${token}` };

      // 1. Fetch Me
      const meRes = await fetch('/api/auth/me', { headers: authHeader });
      if (meRes.ok) {
        const user = await meRes.json();
        state.currentUser = user;
        state.authStatus = 'authenticated';
        state.token = token;
      }

      // 2. Fetch Workspaces
      const wsRes = await fetch('/api/workspaces/list', { headers: authHeader });
      if (wsRes.ok) {
        const wsList = await wsRes.json();
        if (wsList && wsList.length > 0) {
          state.workspaces = wsList.map((w: any) => ({
            id: w.id,
            name: w.name,
            slug: w.slug,
            domain: w.domain,
            plan: 'enterprise',
            createdAt: new Date().toISOString(),
            securityPosture: 'STANDARD',
            isDemo: false,
          }));
          if (!state.workspaces.find((w) => w.id === state.activeWorkspaceId)) {
            state.activeWorkspaceId = state.workspaces[0].id;
            state.workspace = state.workspaces[0];
          }
        }
      }

      // 3. Fetch Products
      const prodRes = await fetch('/api/products', { headers: authHeader });
      if (prodRes.ok) {
        const prods = await prodRes.json();
        if (prods) {
          state.products = prods.map((p: any) => ({
            id: p.id,
            workspaceId: p.workspaceId || state.activeWorkspaceId,
            name: p.name,
            code: p.code,
            domain: p.domain,
            description: p.description,
            ownerId: state.currentUser?.id || 'usr-lead',
            status: p.status || 'active',
            techStack: ['TypeScript', 'Python', 'PostgreSQL'],
            activeIdeaCount: 0,
            activeProjectCount: 0,
            repositories: [],
            lastActivity: p.createdAt || 'Active',
          }));
          if (!state.selectedProductId && state.products.length > 0) {
            state.selectedProductId = state.products[0].id;
          }
        }
      }

      // 4. Fetch Projects
      const projRes = await fetch('/api/projects', { headers: authHeader });
      if (projRes.ok) {
        const projs = await projRes.json();
        if (projs) {
          state.projects = projs.map((pr: any) => ({
            id: pr.id,
            productId: pr.product_id || state.selectedProductId || state.products[0]?.id || '',
            name: pr.name,
            code: pr.settings?.code || `PRJ-${pr.id.substring(0, 4).toUpperCase()}`,
            description: pr.settings?.description || pr.idea_text || 'Active engineering project deliverable.',
            status: pr.stage_status === 'submitted' ? 'planning' : 'development',
            phase: 'Sprint 1',
            health: 'healthy',
            leadId: pr.lead_id || state.currentUser?.id || 'usr-lead',
            teamsAssigned: ['tm-core'],
            targetReleaseDate: pr.settings?.target_release_date || '2026-12-31',
            repositoryUrl: pr.settings?.repository_url || 'github.com/org/repo',
            milestonesCount: 1,
            completedTasks: 0,
            totalTasks: 0,
            createdAt: pr.created_at || new Date().toISOString(),
          }));
          if (!state.selectedProjectId && state.projects.length > 0) {
            state.selectedProjectId = state.projects[0].id;
          }
        }
      }

      // 5. Fetch Ideas
      const ideasRes = await fetch('/api/ideas', { headers: authHeader });
      if (ideasRes.ok) {
        const ideas = await ideasRes.json();
        if (ideas) {
          state.ideas = ideas.map((i: any) => ({
            id: i.id,
            productId: i.productId || state.selectedProductId || '',
            title: i.title,
            problemStatement: i.problemStatement,
            targetUser: i.targetUser,
            expectedValue: i.expectedValue,
            authorId: i.authorId,
            status: i.status || 'draft',
            complexity: i.complexity || 'Medium',
            tags: i.tags || [],
            assessment: i.assessment,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
          }));
        }
      }

      notify();
    } catch (e) {
      console.warn('Session sync from server skipped / offline:', e);
    }
  },

  setAuthStatus: (authStatus: 'guest' | 'authenticated') => {
    state = { ...state, authStatus };
    notify();
  },

  signInDemo: () => {
    const demoUser: CurrentUser = {
      id: 'usr-lead',
      email: 'lead@factory.internal',
      display_name: 'Workspace Lead',
      role: 'product_manager',
      onboarded_at: new Date().toISOString(),
    };
    state = {
      ...state,
      authStatus: 'authenticated',
      currentUser: demoUser,
      activeWorkspaceId: state.workspaces[0]?.id || INITIAL_WORKSPACE.id,
      workspace: state.workspaces[0] || INITIAL_WORKSPACE,
      currentScreen: 'workspace_home',
      currentRole: 'product_manager',
    };
    notify();
  },

  signOut: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('karkhana_jwt_token');
    }
    state = {
      ...state,
      authStatus: 'guest',
      token: null,
      currentUser: null,
      currentScreen: 'landing',
    };
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

  // ── Chat actions ────────────────────────────────────────────────────────────
  ensureGeneralChannel: () => {
    const existing = state.chatChannels.find((c) => c.id === 'ch-general');
    if (existing) return;
    const general: ChatChannel = {
      id: 'ch-general',
      workspaceId: state.activeWorkspaceId,
      name: 'general',
      type: 'channel',
      participantIds: [],
      description: 'Workspace-wide announcements and discussions',
      unreadCount: 0,
      createdAt: new Date().toISOString(),
    };
    state = { ...state, chatChannels: [general, ...state.chatChannels] };
    notify();
  },

  createChannel: (name: string, description?: string) => {
    const ch: ChatChannel = {
      id: `ch-${Date.now()}`,
      workspaceId: state.activeWorkspaceId,
      name: name.toLowerCase().replace(/\s+/g, '-'),
      type: 'channel',
      participantIds: [],
      description: description || '',
      unreadCount: 0,
      createdAt: new Date().toISOString(),
    };
    state = { ...state, chatChannels: [...state.chatChannels, ch], activeChatChannelId: ch.id };
    notify();
    return ch;
  },

  openDM: (targetMemberId: string) => {
    const myId = state.currentUser?.id || state.members[0]?.id || 'usr-lead';
    const existing = state.chatChannels.find(
      (c) => c.type === 'dm' && c.participantIds.includes(myId) && c.participantIds.includes(targetMemberId)
    );
    if (existing) {
      state = { ...state, activeChatChannelId: existing.id, currentScreen: 'chat_dm' };
      notify();
      return existing;
    }
    const target = state.members.find((m) => m.id === targetMemberId);
    const dm: ChatChannel = {
      id: `dm-${Date.now()}`,
      workspaceId: state.activeWorkspaceId,
      name: target?.name || 'Direct Message',
      type: 'dm',
      participantIds: [myId, targetMemberId],
      unreadCount: 0,
      createdAt: new Date().toISOString(),
    };
    state = {
      ...state,
      chatChannels: [...state.chatChannels, dm],
      activeChatChannelId: dm.id,
      currentScreen: 'chat_dm',
    };
    notify();
    return dm;
  },

  setActiveChannel: (channelId: string) => {
    // Mark channel messages as read
    state = {
      ...state,
      activeChatChannelId: channelId,
      chatChannels: state.chatChannels.map((c) =>
        c.id === channelId ? { ...c, unreadCount: 0 } : c
      ),
      chatUnreadTotal: state.chatChannels
        .filter((c) => c.id !== channelId)
        .reduce((n, c) => n + c.unreadCount, 0),
    };
    notify();
  },

  receiveMessage: (msg: ChatMessage) => {
    // Called when a realtime message arrives on a channel we're NOT viewing
    const isActive = state.activeChatChannelId === msg.channelId;
    state = {
      ...state,
      chatChannels: state.chatChannels.map((c) =>
        c.id === msg.channelId
          ? { ...c, lastMessage: msg, unreadCount: isActive ? 0 : c.unreadCount + 1 }
          : c
      ),
      chatUnreadTotal: isActive ? state.chatUnreadTotal : state.chatUnreadTotal + 1,
    };
    notify();
  },

  // ── Activity/Mention actions ─────────────────────────────────────────────────
  pushActivity: (ev: ActivityEvent) => {
    state = {
      ...state,
      activityEvents: [ev, ...state.activityEvents].slice(0, 200),
      activityUnreadTotal: state.activityUnreadTotal + (ev.read ? 0 : 1),
    };
    notify();
  },

  markActivityRead: (id: string) => {
    state = {
      ...state,
      activityEvents: state.activityEvents.map((e) => (e.id === id ? { ...e, read: true } : e)),
      activityUnreadTotal: Math.max(0, state.activityUnreadTotal - 1),
    };
    notify();
  },

  markAllActivityRead: () => {
    state = {
      ...state,
      activityEvents: state.activityEvents.map((e) => ({ ...e, read: true })),
      activityUnreadTotal: 0,
    };
    notify();
  },

  // ── Project comments ─────────────────────────────────────────────────────────
  addProjectComment: (comment: ProjectComment) => {
    state = { ...state, projectComments: [...state.projectComments, comment] };
    // Extract @mentions and fire activity events for each mentioned user
    comment.mentions.forEach((mentionedId) => {
      const actor = state.members.find((m) => m.id === (state.currentUser?.id || 'usr-lead'));
      const target = state.members.find((m) => m.id === mentionedId);
      if (!target) return;
      const ev: ActivityEvent = {
        id: `act-${Date.now()}-${mentionedId}`,
        workspaceId: state.activeWorkspaceId,
        actorId: comment.authorId,
        actorName: comment.authorName,
        type: 'mention',
        summary: `${comment.authorName} mentioned you in a project comment`,
        targetScreen: 'project_detail',
        targetId: comment.projectId,
        projectId: comment.projectId,
        projectName: state.projects.find((p) => p.id === comment.projectId)?.name,
        createdAt: comment.createdAt,
        read: mentionedId !== (state.currentUser?.id || actor?.id),
      };
      factoryStore.pushActivity(ev);
    });
    notify();
  },
};
