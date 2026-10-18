/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Launch Demo client: opens a sandbox workspace without an account, and later
 * saves the visitor's tour progress to their real account (claim).
 */
import type { CurrentUser } from '../store/factoryStore';

export const DEMO_TOKEN_KEY = 'karkhana_demo_token';
export const DEMO_ANCHORS_KEY = 'karkhana_demo_anchors';

export interface DemoStarted {
  token: string;
  user: CurrentUser;
  workspace: { id: string; name: string; slug: string };
  anchors: Record<string, string>;
  session: { id: string; expiresAt: string; tourMinutes: number };
}

async function detail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j.detail === 'string' ? j.detail : `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** Creates a demo workspace. Rejects with a readable message (429 when rate limited). */
export async function startDemoSession(): Promise<DemoStarted> {
  const res = await fetch('/api/demo/sessions', { method: 'POST' });
  if (!res.ok) throw new Error(await detail(res));
  return res.json();
}

export function readDemoToken(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(DEMO_TOKEN_KEY);
}

export function clearDemo(): void {
  localStorage.removeItem(DEMO_TOKEN_KEY);
  localStorage.removeItem(DEMO_ANCHORS_KEY);
}

/** After sign-in: attach the demo's tour progress and drafts to the account. Quietly a no-op without a demo. */
export async function claimDemo(jwt: string): Promise<void> {
  const demoToken = readDemoToken();
  if (!demoToken) return;
  const res = await fetch('/api/demo/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ demo_token: demoToken }),
  });
  // 400/409/410: this demo can no longer be claimed; drop it so we stop retrying.
  if (res.ok || [400, 409, 410].includes(res.status)) clearDemo();
}
