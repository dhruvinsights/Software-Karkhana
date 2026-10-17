// HTTP calls to the Karkhana server. Two credentials, two scopes:
//   Device <token>  claims this machine's jobs and posts their logs;
//   Run <token>     reports on one run (spec, progress, result), nothing else.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(url, { method = 'GET', auth, body, timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail);
  }
  return data;
}

export async function pair(server, { code, name, platform, harness }) {
  return request(`${server}/api/agent/pair`, { method: 'POST', body: { code, name, platform, harness } });
}

export function deviceClient(server, token) {
  const auth = `Device ${token}`;
  return {
    claim: () => request(`${server}/api/agent/jobs/claim`, { method: 'POST', auth, timeoutMs: 45_000 }),
    logs: (jobId, lines) => request(`${server}/api/agent/jobs/${jobId}/logs`, { method: 'POST', auth, body: { lines } }),
    finish: (jobId, body) => request(`${server}/api/agent/jobs/${jobId}/finish`, { method: 'POST', auth, body }),
  };
}

export function runClient(callbackUrl, runId, runToken) {
  const base = `${callbackUrl}/internal/runs/${runId}`;
  const auth = `Run ${runToken}`;
  return {
    spec: () => request(`${base}/spec`, { auth }),
    progress: (phase) => request(`${base}/progress`, { method: 'POST', auth, body: { phase } }),
    // Publishing and review happen inside this call on the server.
    complete: (result) => request(`${base}/complete`, { method: 'POST', auth, body: result, timeoutMs: 600_000 }),
  };
}
