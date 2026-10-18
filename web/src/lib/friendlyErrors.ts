/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * People see plain sentences, never stack traces, status codes or JSON.
 *
 * installFriendlyErrors() wraps window.fetch once, so every one of the many
 * `/api` call sites gets it for free: an error response whose `detail` is
 * technical (validation lists, exception text, config hints, HTML from a
 * misrouted request) is rewritten to a friendly `detail` with the same status,
 * and a network failure rejects with a friendly Error. Details that already
 * read as a sentence ("This session has ended") pass through untouched, so
 * code that branches on them keeps working. The original goes to the console.
 */

const API_PATH = /^\/(api|internal)(\/|\?|$)/;

export const NETWORK_MESSAGE = "We couldn't reach Software Karkhana. Check your connection and try again.";
const UNAVAILABLE_MESSAGE = 'Software Karkhana is not available right now. Please try again in a few minutes.';

/** A plain sentence for an HTTP status, used when the server gave nothing better. */
export function friendlyStatus(status: number): string {
  if (status === 400) return "That request didn't look right. Please check what you entered and try again.";
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return "You don't have access to this. Ask a workspace admin if you need it.";
  if (status === 404) return "We couldn't find that. It may have been moved or deleted.";
  if (status === 408 || status === 504) return 'That took too long. Please try again.';
  if (status === 409) return 'Someone else changed this at the same time. Refresh and try again.';
  if (status === 413) return 'That file is too large. Files can be up to 10 MB.';
  if (status === 415) return "That file type isn't supported.";
  if (status === 422) return "Some fields are missing or invalid. Please check the form and try again.";
  if (status === 429) return "You're going a bit fast. Wait a moment and try again.";
  if (status === 502 || status === 503) return UNAVAILABLE_MESSAGE;
  if (status >= 500) return 'Something went wrong on our side. Please try again; if it keeps happening, let us know.';
  return 'Something went wrong. Please try again.';
}

// Text that is for developers, not for the person using the app.
const TECHNICAL = [
  /traceback|exception|error\(|errno|stack|\bat \w+ \(/i,
  /sqlalchemy|asyncpg|psycopg|pydantic|httpx|uvicorn|fastapi|node_modules/i,
  /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/, // ENV_VAR names: "Set GITHUB_CLIENT_ID"
  /\.env\b|\benv(ironment)? var/i,
  /[{}[\]]|=>|::|\bNone\b|\bnull\b|\bundefined\b|NaN/,
  /\b(HTTP|status) ?\d{3}\b|^\d{3}\b/i,
  /<!doctype|<html/i,
  /^(Not Found|Internal Server Error|Bad Request|Method Not Allowed|Unprocessable Entity|Forbidden|Unauthorized|Bad Gateway|Service Unavailable)$/i,
  /^(Missing authentication|Invalid or expired token|Could not determine identity|Not authenticated)$/i,
  /failed to fetch|networkerror|load failed|unexpected token|json/i,
];

/** True when a message can be shown to a person as it is. */
export function isFriendly(message: unknown): message is string {
  if (typeof message !== 'string') return false;
  const m = message.trim();
  return m.length > 0 && m.length <= 240 && !TECHNICAL.some((re) => re.test(m));
}

/** The message to show for any caught error or server detail. */
export function friendlyMessage(error: unknown, status?: number): string {
  const raw = error instanceof Error ? error.message : error;
  if (isFriendly(raw)) return raw;
  if (typeof raw === 'string' && /failed to fetch|networkerror|load failed/i.test(raw)) return NETWORK_MESSAGE;
  return friendlyStatus(status ?? 0);
}

function isApiRequest(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.href, window.location.href);
    return API_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function jsonResponse(status: number, detail: string, statusText = ''): Response {
  return new Response(JSON.stringify({ detail }), { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

async function rewrite(res: Response, url: string): Promise<Response> {
  const type = res.headers.get('content-type') ?? '';
  // An /api path answered with a web page means the request never reached the backend.
  if (type.includes('text/html')) {
    console.warn(`[api] ${url} returned HTML (${res.status}); the backend is not reachable from this site.`);
    return jsonResponse(503, UNAVAILABLE_MESSAGE, 'Service Unavailable');
  }
  if (res.ok) return res;
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    /* not JSON */
  }
  const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : body;
  if (isFriendly(detail)) return res;
  console.warn(`[api] ${url} → ${res.status}`, detail ?? res.statusText);
  return jsonResponse(res.status, friendlyStatus(res.status), res.statusText);
}

/** Wraps window.fetch so API errors reach the UI as plain sentences. Call once, before rendering. */
export function installFriendlyErrors(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
    let res: Response;
    try {
      res = await original(input, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn(`[api] ${url} failed`, err);
      throw new Error(NETWORK_MESSAGE);
    }
    return rewrite(res, url);
  };
}

/** An API failure that keeps its status, so callers can branch on 409 and friends. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Builds an HttpError from a failed response, with the server's (already friendly) detail. */
export async function httpError(res: Response): Promise<HttpError> {
  let detail: unknown;
  try {
    detail = ((await res.clone().json()) as { detail?: unknown }).detail;
  } catch {
    /* not JSON */
  }
  return new HttpError(res.status, isFriendly(detail) ? detail : friendlyStatus(res.status));
}
