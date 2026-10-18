// Project launch: the calls behind the multi-step screen that turns an
// approved idea into a staffed project with its own repository and plan.
import { factoryStore } from '../store/factoryStore';
import { friendlyStatus } from './friendlyErrors';

export interface RepoCheck {
  ok: boolean;
  slug: string;
  url?: string;
  private?: boolean;
  defaultBranch?: string;
  empty?: boolean;
  permissions?: { admin: boolean; maintain: boolean; push: boolean; pull: boolean };
  login?: string | null;
  error?: string | null;
}

export type TeamId = 'design' | 'architecture' | 'developer' | 'qa' | 'devops' | 'security' | 'release';

export interface TeamNeed {
  team: TeamId;
  needed: boolean;
  reason: string;
}

export interface TeamPlan {
  summary: string;
  kind: string;
  teams: TeamNeed[];
  risks: string[];
  source: 'ai' | 'heuristic';
}

export interface PromoteBody {
  name: string;
  code?: string;
  description?: string;
  repository_url: string;
  target_release_date?: string;
  teams: string[];
  leads: { user_id: string; role: string; stations: string[]; is_lead: boolean }[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = factoryStore.getState().token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : friendlyStatus(res.status);
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export const launchApi = {
  checkRepo: (url: string) => call<RepoCheck>('/api/github/repo-check', { method: 'POST', body: JSON.stringify({ url }) }),
  createRepo: (body: { name: string; owner?: string; private: boolean; description?: string }) =>
    call<RepoCheck>('/api/github/repos', { method: 'POST', body: JSON.stringify(body) }),
  teamPlan: (ideaId: string) => call<TeamPlan>(`/api/ideas/${ideaId}/team-plan`, { method: 'POST' }),
  promote: (ideaId: string, body: PromoteBody) =>
    call<{ projectId: string; projectName: string }>(`/api/ideas/${ideaId}/promote`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
