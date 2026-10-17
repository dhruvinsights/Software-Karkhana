// Server-backed stations: architecture ADRs, QA test scenarios, security findings.
// Same pattern as the issue calls in factoryStore: Bearer token from the store,
// JSON in and out, the server's `detail` surfaced as the error message. The
// server enforces project and station access and writes every change to the
// ledger; nothing here touches localStorage.
import { useCallback, useEffect, useState } from 'react';
import { factoryStore } from '../store/factoryStore';
import type { ADR, SecurityFinding, TestScenario } from '../types/factory';

export interface ApiAdr extends ADR {
  key: string;
  workspaceId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTestScenario extends Omit<TestScenario, 'issueId' | 'actualResult' | 'evidenceUri' | 'automationScript'> {
  issueId: string | null;
  actualResult: string | null;
  evidenceUri: string | null;
  automationScript: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSecurityFinding extends Omit<SecurityFinding, 'cveId' | 'slaDeadline' | 'slaDaysRemaining'> {
  cveId: string | null;
  slaDeadline: string | null;
  slaDaysRemaining: number | null;
  statusReason: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/** A story developers finished that QA still has to cover. */
export interface QaQueueItem {
  id: string;
  key: string;
  title: string;
  status: string;
  acceptanceCriteria: string[];
  scenarios: number;
}

export class StationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Server project ids are UUIDs; demo/offline projects are not and have no server records. */
export const isServerProject = (projectId: string | undefined | null): projectId is string =>
  !!projectId && /^[0-9a-f-]{36}$/i.test(projectId);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = factoryStore.getState().token;
  if (!token) throw new StationError(401, 'Sign in to load this station.');
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join('; ') : `HTTP ${res.status}`;
    throw new StationError(res.status, detail);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const stationsApi = {
  listAdrs: (projectId: string) => call<ApiAdr[]>(`/api/projects/${projectId}/adrs`),
  createAdr: (
    projectId: string,
    body: { title: string; decision?: string; context?: string; rationale?: string; status?: ADR['status']; consequences?: string[]; affected_components?: string[] },
  ) => post<ApiAdr>(`/api/projects/${projectId}/adrs`, body),
  updateAdr: (id: string, body: Partial<{ title: string; status: ADR['status']; context: string; decision: string; rationale: string }>) =>
    patch<ApiAdr>(`/api/adrs/${id}`, body),

  listScenarios: (projectId: string) => call<ApiTestScenario[]>(`/api/projects/${projectId}/test-scenarios`),
  createScenario: (
    projectId: string,
    body: { title: string; type?: TestScenario['type']; priority?: TestScenario['priority']; steps?: string[]; expected_result?: string; automation_script?: string | null },
  ) => post<ApiTestScenario>(`/api/projects/${projectId}/test-scenarios`, body),
  updateScenario: (id: string, body: Partial<{ status: TestScenario['status']; actual_result: string | null; evidence_uri: string | null; title: string }>) =>
    patch<ApiTestScenario>(`/api/test-scenarios/${id}`, body),
  qaQueue: (projectId: string) => call<QaQueueItem[]>(`/api/projects/${projectId}/qa-queue`),
  /** AI drafts manual scenarios and an automation script for one finished story. */
  synthesizeScenarios: (issueId: string) => post<ApiTestScenario[]>(`/api/issues/${issueId}/test-scenarios`, {}),
  qaSignoff: (issueId: string) => post<{ id: string; status: string }>(`/api/issues/${issueId}/qa-signoff`, {}),

  listFindings: (projectId: string) => call<ApiSecurityFinding[]>(`/api/projects/${projectId}/security-findings`),
  createFinding: (
    projectId: string,
    body: { title: string; severity?: SecurityFinding['severity']; cvss_score?: number; cve_id?: string | null; cwe_category?: string; affected_component?: string; remediation_advice?: string; sla_deadline?: string | null },
  ) => post<ApiSecurityFinding>(`/api/projects/${projectId}/security-findings`, body),
  updateFinding: (id: string, body: Partial<{ status: SecurityFinding['status']; reason: string; severity: SecurityFinding['severity'] }>) =>
    patch<ApiSecurityFinding>(`/api/security-findings/${id}`, body),
};

export interface StationList<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  /** The project has no server record (offline demo): nothing to load. */
  offline: boolean;
  reload: () => Promise<void>;
  /** Replaces or prepends one item after a successful write. */
  upsert: (item: T & { id: string }) => void;
}

/** Loads one station's records for a project, with loading and error state. */
export function useStationList<T extends { id: string }>(
  projectId: string | undefined,
  load: (projectId: string) => Promise<T[]>,
): StationList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = !isServerProject(projectId);

  const reload = useCallback(async () => {
    if (!isServerProject(projectId)) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await load(projectId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // `load` is a stable module function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback((item: T) => {
    setItems((prev) => (prev.some((p) => p.id === item.id) ? prev.map((p) => (p.id === item.id ? item : p)) : [item, ...prev]));
  }, []);

  return { items, loading, error, offline, reload, upsert };
}
