/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Where the API lives. Empty (the default) means the same origin as the page:
 * the Vite proxy in development, or a Firebase Hosting rewrite in production.
 * Set VITE_API_BASE=https://api.example.com at build time when the backend is
 * deployed on another origin; the backend must then list this site's origin in
 * ALLOW_ORIGINS.
 */
export const API_BASE = (((import.meta as any).env?.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');

const API_PATH = /^\/(api|internal|healthz)(\/|\?|$)/;

/** Prefixes an API path with the backend origin; other URLs pass through unchanged. */
export function apiUrl(path: string): string {
  return API_BASE && API_PATH.test(path) ? API_BASE + path : path;
}

/** The chat WebSocket URL for an API path, on the backend's host. */
export function apiWsUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/, 'ws') + path;
}

/**
 * Routes every relative `/api/...` fetch to API_BASE, so the many call sites
 * keep using plain paths. A no-op when API_BASE is empty.
 */
export function installApiBase(): void {
  if (!API_BASE) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return original(apiUrl(input), init);
    if (input instanceof Request) {
      const u = new URL(input.url);
      if (u.origin === window.location.origin && API_PATH.test(u.pathname)) {
        return original(new Request(API_BASE + u.pathname + u.search, input), init);
      }
    }
    return original(input, init);
  };
}
