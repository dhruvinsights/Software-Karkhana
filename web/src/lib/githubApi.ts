export interface GitHubStatus {
  connected: boolean;
  login?: string | null;
  scopes?: string | null;
}

export interface DeviceFlowStart {
  user_code: string;
  verification_uri: string;
  device_code: string;
  expires_in: number;
  interval: number;
}

export async function fetchGitHubStatus(token: string): Promise<GitHubStatus> {
  const res = await fetch('/api/github/auth/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { connected: false };
  return res.json();
}

export async function startGitHubDeviceFlow(token: string): Promise<DeviceFlowStart> {
  const res = await fetch('/api/github/auth/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to start GitHub device flow');
  return res.json();
}

export async function pollGitHubDeviceFlow(deviceCode: string, token: string): Promise<{ status: string; connected?: boolean; login?: string; error?: string }> {
  const res = await fetch(`/api/github/auth/poll?device_code=${encodeURIComponent(deviceCode)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Polling error');
  }
  return res.json();
}

export async function saveGitHubTokenDirect(patToken: string, token: string): Promise<{ connected: boolean }> {
  const res = await fetch('/api/github/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token: patToken }),
  });
  if (!res.ok) throw new Error('Failed to save GitHub token');
  return res.json();
}
