// Project plan: the epics and stories drafted from the approved idea.
// The server owns the data; a lead builds the draft plan and approves it.
import { useCallback, useEffect, useState } from 'react';
import { factoryStore } from '../store/factoryStore';
import { useChatFrames } from './chatSocket';
import { isServerProject } from './stationsApi';

export interface PlanIssue {
  id: string;
  key: string;
  title: string;
  description: string;
  type: 'epic' | 'story';
  status: string;
  acceptanceCriteria: string[];
  sourceQuote: string;
  assigneeName: string | null;
}

export interface PlanEpic extends PlanIssue {
  stories: PlanIssue[];
}

export interface PlanData {
  epics: PlanEpic[];
  draft: number;
  total: number;
}

/** Progress of the job that drafts the PRD, ERD and backlog. */
export interface DocsStatus {
  state: 'running' | 'ready' | 'failed';
  step?: string;
  error?: string | null;
}

export interface ProjectDoc {
  id: string;
  kind: 'prd' | 'erd' | 'design';
  version: number;
  title: string;
  status: 'draft' | 'approved';
  model: string;
  content: any;
  createdAt: string;
  approvedAt: string | null;
  mermaid?: string;
}

export interface ProjectDocs {
  status: DocsStatus | null;
  documents: ProjectDoc[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = factoryStore.getState().token;
  if (!token) throw new Error('Sign in to load the plan.');
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  }
  return body as T;
}

export const planApi = {
  get: (projectId: string) => call<PlanData>(`/api/projects/${projectId}/plan`),
  build: (projectId: string) => call<{ created: number }>(`/api/projects/${projectId}/plan`, { method: 'POST' }),
  approve: (projectId: string) => call<{ approved: number }>(`/api/projects/${projectId}/plan/approve`, { method: 'POST' }),
  documents: (projectId: string) => call<ProjectDocs>(`/api/projects/${projectId}/documents`),
  redraft: (projectId: string) => call<{ status: string }>(`/api/projects/${projectId}/documents/redraft`, { method: 'POST' }),
};

/** Loads the plan and its documents, live, and exposes the lead actions. */
export function usePlan(projectId: string | undefined) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [docs, setDocs] = useState<ProjectDocs | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = !isServerProject(projectId);

  const reload = useCallback(async () => {
    if (!isServerProject(projectId)) return;
    setLoading(true);
    try {
      const [p, d] = await Promise.all([planApi.get(projectId), planApi.documents(projectId)]);
      setPlan(p);
      setDocs(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The drafting job and other people's approvals announce themselves here.
  useChatFrames('workspace_sync', (frame) => {
    if (frame.scope === 'projects') void reload();
  }, [reload]);

  const run = useCallback(
    async (action: (id: string) => Promise<unknown>) => {
      if (!isServerProject(projectId)) return;
      setBusy(true);
      setError(null);
      try {
        await action(projectId);
        await reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [projectId, reload],
  );

  return {
    plan,
    loading,
    busy,
    error,
    offline,
    reload,
    docs,
    build: () => run(planApi.build),
    approve: () => run(planApi.approve),
    redraft: () => run(planApi.redraft),
  };
}
