/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Invitation client: create/preview/accept, plus remembering an invite across
 * the sign-in redirect so a link opened while logged out still works afterwards.
 */
import { friendlyStatus } from './friendlyErrors';

const PENDING_KEY = 'karkhana_pending_invite';

export interface InviteCreated {
  id: string;
  token: string;
  inviteLink: string;
  role: string;
  email: string | null;
  projectId: string | null;
  expiresAt: string;
  emailSent: boolean;
}

export interface InvitePreview {
  token: string;
  role: string;
  email: string | null;
  workspace: { id: string; name: string; slug: string } | null;
  project: { id: string; name: string } | null;
  inviter: { name: string };
  expiresAt: string | null;
}

export interface InviteAccepted {
  status: 'ok';
  projectId: string | null;
  workspace: { id: string; name: string; slug: string; domain: string; role: string };
}

async function detail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* fall through */
  }
  return friendlyStatus(res.status);
}

export function stashPendingInvite(token: string): void {
  try {
    localStorage.setItem(PENDING_KEY, token);
  } catch {
    /* storage unavailable: the link still works while the tab stays open */
  }
}

export function readPendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    // Older builds stored a JSON object; only a plain token is valid now.
    return raw && raw.startsWith('inv_') ? raw : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Pulls ?invite=TOKEN out of the address bar and removes it from the URL. */
export function takeInviteFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (!token) return null;
  params.delete('invite');
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  return token;
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(await detail(res));
  return res.json();
}

export async function acceptInvite(jwt: string, token: string): Promise<InviteAccepted> {
  const res = await fetch('/api/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await detail(res));
  return res.json();
}

export async function createInvite(
  jwt: string,
  workspaceId: string,
  body: { email?: string; role: string; project_id?: string; stations?: string[]; is_lead?: boolean },
): Promise<InviteCreated> {
  const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await detail(res));
  return res.json();
}
