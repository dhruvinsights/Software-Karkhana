export type FactoryRole =
  | 'executive'
  | 'product_manager'
  | 'designer'
  | 'architect'
  | 'developer'
  | 'qa'
  | 'security'
  | 'devops'
  | 'release_manager'
  | 'support'
  | 'admin';

export interface RoleConfig {
  id: FactoryRole;
  label: string;
  badge: string;
  description: string;
  primaryScreens: string[];
}

export type ScreenId =
  // Experience A: Public Website & Marketing Experience
  | 'landing'
  | 'how_it_works'
  | 'capabilities'
  | 'solutions'
  | 'research'
  // Experience B: Auth & Onboarding Flow
  | 'signin'
  | 'signup'
  | 'onboarding'
  | 'join_workspace'
  | 'workspace_chooser'
  | 'members'
  // Experience B: Authenticated Factory Workspace
  | 'workspace_home'
  | 'directory_teams'
  | 'team_detail'
  | 'products'
  | 'product_create'
  | 'product_detail'
  | 'knowledge'
  | 'product_settings'
  // Group C
  | 'ideas'
  | 'idea_detail'
  | 'idea_generate'
  | 'idea_compare'
  | 'research_evidence'
  | 'idea_report'
  // Group D
  | 'approvals'
  | 'approval_detail'
  | 'portfolio'
  | 'project_health'
  | 'approval_policy'
  // Group E
  | 'projects'
  | 'project_create'
  | 'project_detail'
  | 'project_onboarding'
  | 'project_team'
  | 'project_settings'
  // Group F
  | 'roadmap'
  | 'epics'
  | 'epic_detail'
  | 'issues'
  | 'issue_detail'
  | 'board'
  | 'milestones'
  | 'decisions'
  // Group G
  | 'designer_dashboard'
  | 'prototype_studio'
  | 'flow_map'
  | 'design_review'
  | 'design_tokens'
  // Group H
  | 'architecture_dashboard'
  | 'system_design'
  | 'adrs'
  | 'api_registry'
  | 'risk_map'
  // Group I
  | 'developer_dashboard'
  | 'task_detail'
  | 'repo_explorer'
  | 'agent_run'
  | 'pull_requests'
  | 'ai_code_review'
  | 'dependencies'
  | 'dev_handoff'
  // Group J
  | 'qa_dashboard'
  | 'feature_test'
  | 'test_plan_generator'
  | 'manual_execution'
  | 'automation_workspace'
  | 'defects'
  | 'qa_signoff'
  // Group K
  | 'security_dashboard'
  | 'assessment_builder'
  | 'security_execution'
  | 'finding_detail'
  | 'security_policies'
  // Group L
  | 'devops_dashboard'
  | 'pipeline_studio'
  | 'infra_manager'
  | 'deployment_readiness'
  | 'deployment_history'
  // Group M
  | 'release_dashboard'
  | 'release_detail'
  | 'release_notes'
  | 'release_signoff'
  | 'release_execution'
  // Group N
  | 'feedback_inbox'
  | 'feedback_detail'
  | 'public_portal'
  | 'incidents'
  // Group O
  | 'knowledge_hub'
  | 'learning_capture'
  | 'rule_governance'
  | 'skills_library'
  | 'memory_inspector'
  // Group P
  | 'workflow_templates'
  | 'workflow_designer'
  | 'integrations'
  | 'models'
  | 'admin_settings'
  | 'audit_explorer'
  // Group Q — Chat & Activity
  | 'chat_dm'
  | 'chat_channel'
  | 'activity_feed';

export type WorkspaceTemplate =
  | 'empty'
  | 'solo_builder'
  | 'product_team'
  | 'engineering_org'
  | 'custom_factory';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  domain: string;
  plan: 'free' | 'enterprise' | 'factory_scale';
  createdAt: string;
  securityPosture: 'SOC2_TYPE_II' | 'ISO_27001' | 'STANDARD';
  templateUsed?: WorkspaceTemplate;
  isDemo?: boolean;
}

export interface UserSession {
  id: string;
  name: string;
  email: string;
  avatar: string;
  isAuthenticated: boolean;
  activeWorkspaceId: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  category: 'metrics' | 'activity' | 'tasks' | 'approvals' | 'releases' | 'system';
  enabled: boolean;
  order: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  roles: FactoryRole[];
  teamId: string;
  timezone: string;
  availability: 'online' | 'busy' | 'offline';
}

export interface Team {
  id: string;
  name: string;
  leadId: string;
  mission: string;
  memberCount: number;
  assignedProjectIds: string[];
}

export interface Product {
  id: string;
  workspaceId: string;
  name: string;
  code: string;
  description: string;
  ownerId: string;
  status: 'active' | 'incubating' | 'archived';
  domain: string;
  techStack: string[];
  activeIdeaCount: number;
  activeProjectCount: number;
  repositories: string[];
  lastActivity: string;
}

export interface ProductKnowledge {
  id: string;
  productId: string;
  title: string;
  category: 'architecture' | 'adr' | 'glossary' | 'policy' | 'spec';
  author: string;
  summary: string;
  content: string;
  updatedAt: string;
  tags: string[];
}

export interface IdeaAssessment {
  overallScore: number;
  scores: {
    userValue: number;
    strategicFit: number;
    feasibility: number;
    technicalComplexity: number;
    costRoi: number;
    riskCompliance: number;
    deliverySpeed: number;
    evidenceQuality: number;
  };
  executiveSummary: string;
  keyRisks: string[];
  recommendedArchitecture: string;
  openQuestions: string[];
}

export interface Idea {
  id: string;
  productId: string;
  title: string;
  problemStatement: string;
  targetUser: string;
  expectedValue: string;
  authorId: string;
  status: 'draft' | 'evaluating' | 'needs_evidence' | 'approved' | 'rejected' | 'promoted';
  promotedProjectId?: string;
  complexity: 'Low' | 'Medium' | 'High';
  tags: string[];
  createdAt: string;
  updatedAt: string;
  assessment?: IdeaAssessment;
  reportHtml?: string;
}

export interface ApprovalRequest {
  id: string;
  type: 'idea_promotion' | 'architecture_change' | 'security_exception' | 'release_signoff' | 'budget_override';
  title: string;
  entityId: string;
  requesterId: string;
  approverIds: string[];
  requiredSignatures: number;
  approvedSignatures: string[];
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  impactSummary: string;
  createdAt: string;
  auditTrail: {
    actorId: string;
    action: string;
    comment?: string;
    timestamp: string;
  }[];
}

export interface Project {
  id: string;
  productId: string;
  sourceIdeaId?: string;
  name: string;
  code: string;
  description: string;
  status: 'planning' | 'design' | 'development' | 'qa' | 'staging' | 'live' | 'blocked';
  phase: string;
  health: 'healthy' | 'at_risk' | 'critical';
  leadId: string;
  teamsAssigned: string[];
  targetReleaseDate: string;
  repositoryUrl: string;
  milestonesCount: number;
  completedTasks: number;
  totalTasks: number;
  createdAt: string;
}

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: 'backlog' | 'in_progress' | 'review' | 'done';
  ownerId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  storyCount: number;
  progressPercent: number;
  tags: string[];
}

export interface Issue {
  id: string;
  epicId?: string;
  projectId: string;
  title: string;
  type: 'story' | 'bug' | 'task' | 'chore' | 'security';
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  assigneeId: string;
  labels: string[];
  acceptanceCriteria: string[];
  linkedPrId?: string;
  linkedBranch?: string;
  commentsCount: number;
  updatedAt: string;
}

export interface DesignArtifact {
  id: string;
  projectId: string;
  title: string;
  version: string;
  status: 'draft' | 'in_review' | 'approved';
  viewport: 'desktop' | 'tablet' | 'mobile';
  prompt: string;
  htmlMarkup: string;
  tokens: Record<string, string>;
  pins: {
    id: string;
    x: number;
    y: number;
    author: string;
    comment: string;
    status: 'open' | 'resolved';
  }[];
}

export interface ADR {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  context: string;
  decision: string;
  rationale: string;
  consequences: string[];
  author: string;
  date: string;
  affectedComponents: string[];
}

export interface MermaidDiagram {
  id: string;
  projectId: string;
  title: string;
  type: 'c4_container' | 'sequence' | 'er' | 'flowchart';
  code: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  issueId: string;
  agentModel: string;
  branch: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  startedAt: string;
  elapsedSeconds: number;
  steps: {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    command?: string;
    output?: string;
  }[];
  touchedFiles: string[];
}

export interface PullRequest {
  id: string;
  projectId: string;
  number: number;
  title: string;
  authorId: string;
  sourceBranch: string;
  targetBranch: string;
  status: 'open' | 'draft' | 'merged' | 'closed';
  checksStatus: 'passed' | 'running' | 'failed';
  additions: number;
  deletions: number;
  changedFilesCount: number;
  description: string;
  diffSummary: string;
  aiReview?: {
    summary: string;
    architectureImpact: string;
    findings: {
      id: string;
      severity: 'CRITICAL' | 'WARNING' | 'INFO';
      category: string;
      file: string;
      line: number;
      title: string;
      description: string;
      suggestedPatch: string;
    }[];
  };
}

export interface TestScenario {
  id: string;
  projectId: string;
  issueId?: string;
  title: string;
  type: 'Functional' | 'Boundary' | 'Security / Negative' | 'Performance / Load' | 'Accessibility';
  priority: 'P0' | 'P1' | 'P2';
  steps: string[];
  expectedResult: string;
  status: 'not_run' | 'passed' | 'failed' | 'blocked';
  actualResult?: string;
  evidenceUri?: string;
  automationScript?: string;
}

export interface Defect {
  id: string;
  projectId: string;
  title: string;
  severity: 'blocker' | 'critical' | 'major' | 'minor';
  status: 'open' | 'investigating' | 'fix_in_progress' | 'resolved' | 'closed';
  reporterId: string;
  assigneeId?: string;
  environment: string;
  stepsToReproduce: string[];
  linkedIssueId?: string;
  createdAt: string;
}

export interface SecurityFinding {
  id: string;
  projectId: string;
  title: string;
  cveId?: string;
  cweCategory: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  cvssScore: number;
  status: 'open' | 'in_remediation' | 'verified_fixed' | 'waived';
  affectedComponent: string;
  remediationAdvice: string;
  slaDeadline: string;
  slaDaysRemaining: number;
}

export interface Pipeline {
  id: string;
  projectId: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  lastRunDuration: string;
  lastRunTimestamp: string;
  stages: {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    duration: string;
    command: string;
  }[];
  yamlContent: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: 'Development' | 'Staging' | 'Production';
  status: 'healthy' | 'degraded' | 'syncing';
  url: string;
  activeRevision: string;
  trafficPercentage: number;
  cpuUtilization: number;
  memoryUsage: string;
  lastDeployedAt: string;
}

export interface Release {
  id: string;
  projectId: string;
  version: string;
  status: 'planning' | 'in_review' | 'ready' | 'deploying' | 'released' | 'rolled_back';
  targetDate: string;
  releaseManagerId: string;
  changelog: string;
  checklists: {
    item: string;
    checked: boolean;
    ownerRole: FactoryRole;
  }[];
  signoffs: {
    role: FactoryRole;
    approverName: string;
    signed: boolean;
    timestamp?: string;
  }[];
}

export interface FeedbackItem {
  id: string;
  productId: string;
  source: 'github_issues' | 'customer_support' | 'telemetry' | 'crash_report';
  title: string;
  reporter: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'critical';
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'new' | 'triaged' | 'converted_to_issue' | 'dismissed';
  content: string;
  suggestedAction: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  projectId: string;
  title: string;
  severity: 'SEV0' | 'SEV1' | 'SEV2';
  status: 'investigating' | 'identified' | 'mitigating' | 'resolved';
  commanderId: string;
  startedAt: string;
  impactDuration: string;
  summary: string;
  affectedServices: string[];
  actionItems: string[];
}

export interface FactoryRule {
  id: string;
  title: string;
  category: 'code_quality' | 'security' | 'architecture' | 'testing';
  pattern: string;
  enforcedBy: 'linter' | 'ai_code_review' | 'ci_pipeline';
  rationale: string;
  status: 'active' | 'draft' | 'deprecated';
  version: string;
}

export interface FactorySkill {
  id: string;
  name: string;
  description: string;
  version: string;
  category: 'coding' | 'testing' | 'devops' | 'architecture';
  toolsRequired: string[];
  usageCount: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  role: FactoryRole;
  action: string;
  targetEntity: string;
  details: string;
}

// ─── Chat & Activity Types ────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  body: string;
  /** @mention user ids extracted from body */
  mentions: string[];
  attachments?: string[];
  /** ISO timestamp */
  createdAt: string;
  editedAt?: string;
}

export interface ChatChannel {
  id: string;
  workspaceId: string;
  name: string;
  /** 'channel' = public #channel, 'dm' = direct message thread */
  type: 'channel' | 'dm';
  /** For DMs: the two participant user ids */
  participantIds: string[];
  description?: string;
  unreadCount: number;
  lastMessage?: ChatMessage;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  /** 'mention' | 'comment' | 'review' | 'approval' | 'run_complete' | 'pr_merged' */
  type: 'mention' | 'comment' | 'review' | 'approval' | 'run_complete' | 'pr_merged';
  /** human-readable summary */
  summary: string;
  /** deep-link target */
  targetScreen?: ScreenId;
  targetId?: string;
  projectId?: string;
  projectName?: string;
  /** ISO timestamp */
  createdAt: string;
  read: boolean;
}

export interface ProjectComment {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt?: string;
}
