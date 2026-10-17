// Project plan: the epics and stories drafted from the approved idea.
// The server owns the data; a lead builds the draft plan and approves it.
import { useCallback, useEffect, useState } from 'react';
import { factoryStore } from '../store/factoryStore';
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
};

/** Loads the plan and exposes the two lead actions. */
export function usePlan(projectId: string | undefined) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = !isServerProject(projectId);

  const reload = useCallback(async () => {
    if (!isServerProject(projectId)) return;
    setLoading(true);
    try {
      setPlan(await planApi.get(projectId));
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
    build: () => run(planApi.build),
    approve: () => run(planApi.approve),
  };
}
