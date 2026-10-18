// Typed API client. Every call carries the identity header; the server
// enforces roles, so the UI hiding a button is convenience, not security.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';

export interface Project { id: string; name: string; idea_text: string; stage: string; stage_status: string; created_at: string }
export interface Story { title: string; acceptance_criteria: string[] }
export interface EpicDraft { title: string; description: string; source_quote: string; stories: Story[] }
export interface Evaluation {
  id: string; version: number; model: string; created_at: string;
  result: {
    score: number; score_rationale: string; summary: string;
    gaps: { question: string; why_it_matters: string }[];
    epics: EpicDraft[];
    director_report: { summary: string; recommendation: string; key_risks: string[]; decision_requested: string };
    memory_note: string;
  };
  citations: { learning_id: string; text: string; source_project: string; source_pr_url: string | null; verified_by: string | null; verified_at: string | null; how_it_applies: string }[];
}
export interface Task { id: string; key: string; epic_id: string; title: string; description: string; acceptance_criteria: string[]; status: string }
export interface Approval { id: string; gate: string; decision: string; reason: string | null; decided_at: string }
export interface ProjectDetail { project: Project; evaluation: Evaluation | null; epics: { id: string; title: string; source_quote: string }[]; tasks: Task[]; approvals: Approval[] }
export interface Run { id: string; task_id: string; status: string; phase: string | null; backend: string; branch: string | null; test_command: string | null; test_exit_code: number | null; test_output: string | null; validation_status: 'not_run' | 'passed' | 'failed'; error: string | null; created_at: string; finished_at: string | null }
export interface Comment { id: string; path: string; line: number | null; severity: string; body: string; triage: string; triage_reason: string | null }
export interface PullRequest { id: string; task_id: string; number: number; url: string; branch: string; status: string; tests_passed: boolean; reviewed_at: string | null; review_engine: string | null; review_model: string | null; review_summary: string | null; comments: Comment[]; can_merge: boolean; merge_blockers: string[] }
export interface Learning { id: string; project_id: string; text: string; status: string; source: Record<string, unknown>; verified_at: string | null; created_at: string }
export interface LedgerEntry { seq: number; actor_label: string; actor_kind: string; action: string; subject_type: string; subject_id: string; payload: Record<string, unknown>; created_at: string; prev_hash: string; hash: string }
export interface Stage { id: string; name: string; phase: string; owner: string; gate: string; wired: boolean }

export interface NavPage { path: string; label: string; icon: string }
export interface Nav { role: string; pages: NavPage[] }
export interface DashItem { id: string; name: string; stage: string; status: string; project_id?: string }
export interface Dashboard { role: string; user: string; stats: { label: string; value: number; hint: string }[]; queues: Record<string, DashItem[]> }
export interface WorkItem { id: string; key: string; title: string; status: string; criteria: number; project_id: string; project_name: string }
export interface PrRow {
  id: string; number: number; url: string; branch: string; status: string; tests_passed: boolean; reviewed: boolean; review_engine: string | null;
  open_comments: number; total_comments: number; task_id: string; task_key: string; task_title: string; project_id: string; project_name: string;
}
export interface ProviderHealth {
  llm_provider: string; embed_provider: string; chat_model: string; embed_model: string;
  gemini: { configured: boolean; backend: 'vertex' | 'ai-studio'; project: string };
  ollama: { base_url: string; ok: boolean; models: string[]; error?: string };
  review: { engine: string; pr_agent_ready: boolean };
}
export interface RunnerStatus { backend: string; ready: boolean; detail: string }
export interface DevUser { email: string; name: string; role: string }
export interface PublicStats { projects: number; merged_prs: number; agent_runs: number; ledger_entries: number }

export interface ContextEntry { id: string; project_id: string; kind: 'decision' | 'note' | 'handoff'; title: string; body: string; author_label: string; author_kind: string; created_at: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function useApi() {
  const { token } = useAuth();
  return async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { 'Content-Type': 'application/json', ...(await token()), ...(init.headers as Record<string, string> | undefined) };
    const r = await fetch(path, { ...init, headers });
    if (!r.ok) {
      let detail = r.statusText;
      try { const body = await r.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail); } catch { /* not JSON */ }
      throw new ApiError(r.status, detail);
    }
    return r.json() as Promise<T>;
  };
}

export function useGet<T>(key: unknown[], path: string | null, refetchMs?: number | false) {
  const call = useApi();
  return useQuery<T>({ queryKey: key, queryFn: () => call<T>(path!), enabled: !!path, refetchInterval: refetchMs });
}

export function usePost<TBody, TOut = unknown>(path: (b: TBody) => string, invalidate: unknown[][], body?: (b: TBody) => unknown) {
  const call = useApi();
  const qc = useQueryClient();
  return useMutation<TOut, ApiError, TBody>({
    mutationFn: (b) => call<TOut>(path(b), { method: 'POST', body: body ? JSON.stringify(body(b)) : undefined }),
    onSettled: () => { invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k })); qc.invalidateQueries({ queryKey: ['ledger'] }); },
  });
}
