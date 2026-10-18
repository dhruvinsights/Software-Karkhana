// Developer and QA stations: the boards they read and the accountable actions
// people take on them. The server owns every rule; these are thin calls.
import { factoryStore } from '../store/factoryStore';
import { chatSocket } from './chatSocket';
import { friendlyStatus } from './friendlyErrors';

export interface TestSuite {
  suite: string;
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped';
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  command?: string;
  durationMs?: number;
  output?: string;
}

export interface ManualCheck {
  kind: 'story' | 'fix';
  by: string;
  byName: string;
  at: string;
  criteria: { text: string; ok: boolean }[];
  notes: string;
}

export type BugState = 'new' | 'reopened' | 'fixing' | 'fixed' | 'verified' | 'wont_fix';

export interface Bug {
  id: string;
  key: string;
  title: string;
  description?: string;
  priority: string;
  status?: string;
  state: BugState;
  reopenCount?: number;
  source?: string;
  storyId?: string | null;
  storyKey?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  reporterName?: string | null;
  devCheck?: ManualCheck | null;
  /** The fix's buildable task and its latest run (an agent can fix the bug). */
  taskId?: string | null;
  run?: { id: string; status: string; phase: string | null; testSuites: TestSuite[]; error?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface GateOption {
  id: string;
  label: string;
  needs_note?: boolean;
}

/** A question the build is waiting on: the developer answers it on the story. */
export interface Gate {
  id: string;
  name: string;
  summary: string;
  options: GateOption[];
  openedAt: string;
  decision: { action: string; note: string; by: string; at: string } | null;
}

export interface BriefPreview {
  story: { key: string; title: string; description: string };
  criteria: { index: number; text: string; chars: number }[];
  notes: { id: string; kind: string; title: string; author: string; body: string; chars: number }[];
  rework: string | null;
  pauses: { id: 'after_code' | 'before_tests' | 'fix'; label: string }[];
  estimateTokens: number;
}

export interface RunSteering {
  control?: { mode: 'auto' | 'step' | 'custom'; pauses?: ('after_code' | 'before_tests' | 'fix')[] };
  brief?: { criteria?: number[] | null; notes?: string[] | null; focus?: string[]; instruction?: string };
}

export interface DevRun {
  id: string;
  status: string;
  phase: string | null;
  control?: { mode: string; pauses: string[] } | null;
  gate?: Gate | null;
  branch?: string | null;
  error?: string | null;
  testSuites: TestSuite[];
  testExitCode?: number | null;
  createdAt?: string;
  finishedAt?: string | null;
}

export interface DevPr {
  id: string;
  number: number;
  url: string;
  status: string;
  testsPassed: boolean;
  reviewed: boolean;
  openComments: number;
  approvals: string[];
  requestedReviewers: { userId: string; name: string; at: string }[];
}

export interface DevStory {
  id: string;
  key: string;
  title: string;
  status: string;
  layer: string | null;
  taskId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  acceptanceCriteria: string[];
  devCheck: ManualCheck | null;
  run: DevRun | null;
  pr: DevPr | null;
  bugs: Bug[];
}

export interface DevBoard {
  projectId: string;
  stories: DevStory[];
  bugs: Bug[];
}

export interface DesignScreen {
  name: string;
  purpose: string;
  story_keys: string[];
  states: string[];
  html: string;
}

export interface DesignContract {
  method: string;
  path: string;
  summary: string;
  story_keys: string[];
  request_example: string;
  response_example: string;
  errors: string[];
}

export interface FrontendWorkspace {
  design: {
    version: number;
    status: string;
    overview: string;
    principles: string[];
    tokens: { name: string; value: string }[];
    accessibility: string[];
    handoffNotes: string[];
  } | null;
  stories: {
    id: string;
    key: string;
    title: string;
    status: string;
    taskId: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    acceptanceCriteria: string[];
    screens: DesignScreen[];
    contracts: DesignContract[];
    run: { id: string; status: string; phase: string | null; testSuites: TestSuite[] } | null;
  }[];
}

export type QaStage = 'waiting_dev_check' | 'ready' | 'in_qa' | 'signed_off';

export interface QaStory {
  id: string;
  key: string;
  title: string;
  status: string;
  stage: QaStage;
  acceptanceCriteria: string[];
  devCheck: ManualCheck | null;
  qaAgent: { state?: 'running' | 'ready' | 'failed'; step?: string | null; suggested?: number; dropped?: number; error?: string | null; by?: string } | null;
  scenarios: { total: number; passed: number; failed: number; blocked: number; not_run: number };
  openSuggestions: number;
  bugs: { id: string; key: string; title: string; state: BugState; priority: string }[];
}

export interface QaBoard {
  stories: QaStory[];
  toVerify: (Bug & { devCheck: ManualCheck | null })[];
  bugs: Bug[];
}

export interface QaSuggestion {
  id: string;
  storyId: string;
  storyKey: string | null;
  title: string;
  description: string;
  category: string;
  severity: string;
  steps: string[];
  expected: string;
  evidence: { path: string; line?: number | null; note?: string }[];
  status: 'open' | 'accepted' | 'dismissed';
  reason: string | null;
  bugId: string | null;
  model: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface Scenario {
  id: string;
  issueId: string | null;
  title: string;
  type: string;
  priority: string;
  steps: string[];
  expectedResult: string;
  actualResult: string | null;
  automationScript: string | null;
  status: 'not_run' | 'passed' | 'failed' | 'blocked';
}

export interface StationChannel {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  projectId: string | null;
  station: string | null;
  description?: string | null;
  unreadCount: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = factoryStore.getState().token;
  if (!token) throw new Error('Sign in first.');
  const ws = chatSocket.currentWorkspaceId;
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(ws ? { 'X-Workspace-Id': ws } : {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : friendlyStatus(res.status));
  return body as T;
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const devQaApi = {
  devBoard: (projectId: string) => call<DevBoard>(`/api/projects/${projectId}/dev-board`),
  frontend: (projectId: string) => call<FrontendWorkspace>(`/api/projects/${projectId}/frontend`),
  devCheck: (issueId: string, criteria: { text: string; ok: boolean }[], notes: string) =>
    post<{ devCheck: ManualCheck }>(`/api/issues/${issueId}/dev-check`, { criteria, notes }),
  startFix: (bugId: string) => post(`/api/issues/${bugId}/start-fix`),
  markFixed: (bugId: string, criteria: { text: string; ok: boolean }[], notes: string) =>
    post(`/api/issues/${bugId}/mark-fixed`, { criteria, notes }),
  verify: (bugId: string, result: 'pass' | 'fail', notes: string) => post(`/api/issues/${bugId}/verify`, { result, notes }),
  briefPreview: (taskId: string) => call<BriefPreview>(`/api/tasks/${taskId}/brief-preview`),
  decide: (runId: string, gateId: string, action: string, note: string) =>
    post<{ status: string }>(`/api/runs/${runId}/gate`, { gate_id: gateId, action, note }),
  branches: (projectId: string) =>
    call<{ repo: string | null; default: string; branches: string[]; reachable: boolean }>(`/api/projects/${projectId}/branches`),
  publish: (runId: string, body: { base_branch?: string; branch?: string; title?: string }) =>
    post<{ number: number; url: string; branch: string; base: string }>(`/api/runs/${runId}/publish`, body),
  rework: (prId: string, reason: string) => post<{ closedOnGitHub: boolean }>(`/api/prs/${prId}/rework`, { reason }),
  requestReviewers: (prId: string, userIds: string[]) =>
    post<{ onGitHub: boolean }>(`/api/prs/${prId}/reviewers`, { user_ids: userIds }),

  qaBoard: (projectId: string) => call<QaBoard>(`/api/projects/${projectId}/qa-board`),
  runQaAgent: (storyId: string) => post(`/api/issues/${storyId}/qa-agent`),
  suggestions: (projectId: string) => call<QaSuggestion[]>(`/api/projects/${projectId}/qa-suggestions`),
  accept: (id: string, priority: string | undefined, notes: string) =>
    post<{ bugKey: string }>(`/api/qa-suggestions/${id}/accept`, { priority, notes }),
  dismiss: (id: string, reason: string) => post(`/api/qa-suggestions/${id}/dismiss`, { reason }),
  scenarios: (projectId: string) => call<Scenario[]>(`/api/projects/${projectId}/test-scenarios`),
  generateScenarios: (storyId: string) => post<Scenario[]>(`/api/issues/${storyId}/test-scenarios`),
  addScenario: (projectId: string, body: { title: string; issue_id: string; steps: string[]; expected_result: string }) =>
    post<Scenario>(`/api/projects/${projectId}/test-scenarios`, body),
  recordResult: (scenarioId: string, status: Scenario['status'], actual: string) =>
    call<Scenario>(`/api/test-scenarios/${scenarioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, actual_result: actual || null }),
    }),
  signOff: (storyId: string) => post(`/api/issues/${storyId}/qa-signoff`),

  projectMembers: (projectId: string) =>
    call<{ userId?: string; id?: string; name?: string; displayName?: string; role: string; stations: string[] }[]>(
      `/api/projects/${projectId}/members`,
    ),
  channels: () => call<StationChannel[]>('/api/chat/channels'),
  createChannel: (body: { name: string; project_id: string; station: string; audience: 'team' | 'project' | 'workspace'; description?: string }) =>
    post<StationChannel>('/api/chat/channels', body),
  linkChannel: (id: string) => post<StationChannel>(`/api/chat/channels/${id}/link`),
};

export const BUG_STATE_STYLE: Record<BugState, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  reopened: { label: 'Reopened', cls: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  fixing: { label: 'Fixing', cls: 'bg-[#075BFF]/10 text-[#7aa7ff] border-[#075BFF]/30' },
  fixed: { label: 'Fixed · verify', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  verified: { label: 'Verified', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  wont_fix: { label: "Won't fix", cls: 'bg-white/5 text-[#827D8E] border-white/10' },
};
