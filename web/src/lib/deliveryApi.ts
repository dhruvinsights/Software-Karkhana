// DevOps and Release stations: the GitHub Actions pipeline and release records.
import { factoryStore } from '../store/factoryStore';

export interface PipelineSetup {
  number: number;
  url: string;
  status: 'open' | 'merged';
  stack: string;
  ci?: string[];
}

export interface WorkflowRun {
  id: number;
  name: string;
  branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
  sha: string;
  createdAt: string;
}

export interface ReleaseRecord {
  id: string;
  version: string;
  status: 'draft' | 'published';
  manifest: {
    pullRequests: { number: number; url: string; title: string }[];
    stories: { key: string; title: string; status: string; qaPassed: number; qaTotal: number }[];
    security: { title: string; severity: string; status: string }[];
    commit: string;
    ci: string[];
  };
  blockers: string[];
  notes: string;
  commit: string;
  releaseUrl: string | null;
  approvedAt: string | null;
  createdAt: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${factoryStore.getState().token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  return body as T;
}

export const deliveryApi = {
  pipeline: (projectId: string) => call<{ setup: PipelineSetup | null; runs: WorkflowRun[] }>(`/api/projects/${projectId}/pipeline`),
  proposePipeline: (projectId: string) => call<PipelineSetup>(`/api/projects/${projectId}/pipeline`, { method: 'POST' }),
  mergePipeline: (projectId: string) => call<PipelineSetup>(`/api/projects/${projectId}/pipeline/merge`, { method: 'POST' }),
  releases: (projectId: string) => call<ReleaseRecord[]>(`/api/projects/${projectId}/releases`),
  prepare: (projectId: string, version: string) =>
    call<ReleaseRecord>(`/api/projects/${projectId}/releases`, { method: 'POST', body: JSON.stringify({ version }) }),
  refresh: (releaseId: string) => call<ReleaseRecord>(`/api/releases/${releaseId}/refresh`, { method: 'POST' }),
  approve: (releaseId: string) => call<ReleaseRecord>(`/api/releases/${releaseId}/approve`, { method: 'POST' }),
};
