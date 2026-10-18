// Features vs projects: product sizing, grouping related features into a
// project, and adding an approved feature to a project that already exists.
import { factoryStore } from '../store/factoryStore';
import { Idea, ProductProfile } from '../types/factory';
import { friendlyStatus } from './friendlyErrors';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = factoryStore.getState().token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : friendlyStatus(res.status));
  return body as T;
}

export interface ProductSpec {
  name: string;
  description?: string;
  problem_statement?: string;
  target_users?: string;
  tech_stack?: string[];
  key_features?: string[];
  constraints?: string[];
}

export const ideaGroupsApi = {
  analyse: (spec: ProductSpec) => call<ProductProfile>('/api/products/analyse', { method: 'POST', body: JSON.stringify(spec) }),
  refreshProfile: (productId: string) => call<ProductProfile>(`/api/products/${productId}/profile`, { method: 'POST' }),
  autoGroup: (productId: string) => call<{ groups: Idea[] }>(`/api/products/${productId}/idea-groups/auto`, { method: 'POST' }),
  group: (productId: string, body: { idea_ids: string[]; title: string; problem_statement: string; expected_value?: string }) =>
    call<Idea>(`/api/products/${productId}/idea-groups`, { method: 'POST', body: JSON.stringify(body) }),
  ungroup: (groupId: string) => call<void>(`/api/idea-groups/${groupId}`, { method: 'DELETE' }),
  addToProject: (ideaId: string, projectId: string) =>
    call<{ status: string }>(`/api/ideas/${ideaId}/add-to-project`, { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
};

export const SIZE_COPY: Record<ProductProfile['size'], { label: string; rule: string }> = {
  small: {
    label: 'Small product',
    rule: 'Built as one project. Ideas are features that are added to it.',
  },
  medium: {
    label: 'Medium product',
    rule: 'Related features are grouped into projects. A single feature joins an existing project.',
  },
  large: {
    label: 'Large product',
    rule: 'Projects group many related features across areas. A single feature joins an existing project.',
  },
};

/** Ideas shown at the top level: features inside a group appear under their project. */
export const topLevel = (ideas: Idea[]) => ideas.filter((i) => !i.parentId);
