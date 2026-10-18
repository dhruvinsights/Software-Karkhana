// Building stories on a developer's own machine (karkhana-agent): machines,
// runs and their live logs. The server owns the state; the hooks re-read it on
// workspace_sync "runs" and append `run_log` lines as they stream in.
import { factoryStore } from '../store/factoryStore';

export interface Machine {
  id: string;
  name: string;
  platform: string;
  harness: string;
  online: boolean;
  lastSeenAt: string | null;
  /** The folder the developer chose for each project on this machine (project id -> path). */
  workPaths?: Record<string, string>;
}

export interface Pairing {
  code: string;
  expiresAt: string;
  command: string;
  install: string;
}

export interface RunInfo {
  id: string;
  task_id: string;
  status: string;
  phase: string | null;
  backend: string;
  branch: string | null;
  test_command: string | null;
  test_exit_code: number | null;
  validation_status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface LogLine {
  level: string;
  message: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${factoryStore.getState().token}` },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
  return body as T;
}

export const buildApi = {
  machines: () => call<Machine[]>('/api/devices'),
  pair: () => call<Pairing>('/api/devices/pairing', { method: 'POST' }),
  revoke: (id: string) => call<void>(`/api/devices/${id}`, { method: 'DELETE' }),
  setWorkPath: (deviceId: string, projectId: string, path: string) =>
    call<Machine>(`/api/devices/${deviceId}/paths`, { method: 'PUT', body: JSON.stringify({ project_id: projectId, path }) }),
  stop: (runId: string) => call<{ status: string }>(`/api/runs/${runId}/cancel`, { method: 'POST' }),
  takeStory: (issueId: string, userId: string) =>
    call(`/api/issues/${issueId}`, { method: 'PATCH', body: JSON.stringify({ assignee_id: userId, status: 'ready' }) }),
  build: (taskId: string, extra: object = {}) =>
    call<RunInfo>(`/api/tasks/${taskId}/runs`, { method: 'POST', body: JSON.stringify({ backend: 'device', ...extra }) }),
  runs: (taskId: string) => call<RunInfo[]>(`/api/tasks/${taskId}/runs`),
  logs: (runId: string) => call<LogLine[]>(`/api/runs/${runId}/logs`),
};
