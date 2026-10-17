/**
 * Server-rendered documents (reports, PRDs): fetched with the session token,
 * shown as HTML and saved as PDF.
 */

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(typeof body?.detail === 'string' ? body.detail : fallback);
}

export async function fetchHtml(path: string, token: string): Promise<string> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await failure(res, 'Could not load the document.');
  return res.text();
}

export async function downloadPdf(path: string, filename: string, token: string): Promise<void> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await failure(res, 'Could not create the PDF.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function fileSafe(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'document';
}
