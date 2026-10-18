// Google Stitch on the designer dashboard. The server decides who may use it
// (designers on the project only) and holds the Stitch key; the browser never
// talks to Stitch directly.
import { factoryStore } from '../store/factoryStore';

export type StitchDevice = 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC';
export type StitchModel = 'GEMINI_3_FLASH' | 'GEMINI_3_1_PRO';
export type CreativeRange = 'REFINE' | 'EXPLORE' | 'REIMAGINE';
export type VariantAspect = 'LAYOUT' | 'COLOR_SCHEME' | 'IMAGES' | 'TEXT_FONT' | 'TEXT_CONTENT';

export interface StitchScreen {
  id: string;
  stitchScreenId: string;
  title: string;
  prompt: string;
  deviceType: StitchDevice | null;
  width: number | null;
  height: number | null;
  pinned: boolean;
  parentId: string | null;
  hasScreenshot: boolean;
  createdAt: string | null;
}

export interface StitchJob {
  id: string;
  kind: 'generate' | 'edit' | 'variants' | 'sync';
  status: 'running' | 'succeeded' | 'failed';
  prompt: string;
  error: string | null;
  result: { screen_ids?: string[]; warnings?: string[]; messages?: string[]; suggestions?: string[] };
  createdAt: string | null;
  finishedAt: string | null;
}

export interface StitchHome {
  enabled: boolean;
  configured: boolean;
  isDesigner: boolean;
  canUse: boolean;
  reason: string;
  quota?: { used: number; limit: number };
  defaultModel?: StitchModel;
  stitchProjectId?: string | null;
  job?: StitchJob | null;
  screens?: StitchScreen[];
}

function headers(json = true): Record<string, string> {
  const token = factoryStore.getState().token;
  const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...headers(init.body !== undefined), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const base = (projectId: string) => `/api/projects/${projectId}/stitch`;

export const stitchApi = {
  home: (projectId: string) => call<StitchHome>(base(projectId)),
  job: (projectId: string, jobId: string) => call<StitchJob>(`${base(projectId)}/jobs/${jobId}`),
  generate: (
    projectId: string,
    body: { prompt: string; device_type: StitchDevice; model_id?: StitchModel; story_keys?: string[] },
  ) => call<StitchJob>(`${base(projectId)}/generate`, { method: 'POST', body: JSON.stringify(body) }),
  edit: (projectId: string, screenId: string, body: { prompt: string; model_id?: StitchModel }) =>
    call<StitchJob>(`${base(projectId)}/screens/${screenId}/edit`, { method: 'POST', body: JSON.stringify(body) }),
  variants: (
    projectId: string,
    screenId: string,
    body: { prompt: string; count: number; creative_range: CreativeRange; aspects: VariantAspect[]; model_id?: StitchModel },
  ) => call<StitchJob>(`${base(projectId)}/screens/${screenId}/variants`, { method: 'POST', body: JSON.stringify(body) }),
  sync: (projectId: string) => call<StitchJob>(`${base(projectId)}/sync`, { method: 'POST' }),
  pin: (projectId: string, screenId: string, pinned: boolean) =>
    call<StitchScreen>(`${base(projectId)}/screens/${screenId}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
  archive: (projectId: string, screenId: string) =>
    call<void>(`${base(projectId)}/screens/${screenId}`, { method: 'DELETE' }),
  preview: (projectId: string, screenId: string) =>
    call<{ id: string; title: string; srcdoc: string }>(`${base(projectId)}/screens/${screenId}/preview`),

  /** The screenshot as an object URL (the endpoint needs the bearer header, so <img src> cannot fetch it). */
  async screenshotUrl(projectId: string, screenId: string): Promise<string> {
    const res = await fetch(`${base(projectId)}/screens/${screenId}/screenshot`, { headers: headers(false) });
    if (!res.ok) throw new Error(`Screenshot unavailable (HTTP ${res.status})`);
    return URL.createObjectURL(await res.blob());
  },

  /** Saves the screen's HTML to the user's computer. */
  async downloadHtml(projectId: string, screen: StitchScreen): Promise<void> {
    const res = await fetch(`${base(projectId)}/screens/${screen.id}/html`, { headers: headers(false) });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const blob = new Blob([await res.text()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${screen.title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'screen'}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
