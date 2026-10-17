/**
 * Idea evaluation reports. The server writes the report in the background
 * (POST /evaluate) and announces it with workspace_sync "ideas"; the finished
 * report is served as printable HTML and as a PDF.
 */

import { IdeaReportState } from '../types/factory';

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.detail || fallback);
}

export async function startIdeaReport(ideaId: string, token: string): Promise<void> {
  const res = await fetch(`/api/ideas/${ideaId}/evaluate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await failure(res, 'Could not start the report.');
}

export async function fetchIdeaReportHtml(ideaId: string, token: string): Promise<string> {
  const res = await fetch(`/api/ideas/${ideaId}/report.html`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await failure(res, 'Could not load the report.');
  return res.text();
}

export async function downloadIdeaReportPdf(ideaId: string, title: string, token: string): Promise<void> {
  const res = await fetch(`/api/ideas/${ideaId}/report.pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await failure(res, 'Could not create the PDF.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'idea'}-evaluation.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Short label for a report state, for buttons and lists. */
export function reportLabel(report: IdeaReportState | null | undefined): string {
  if (!report) return 'Evaluate';
  if (report.status === 'running') return 'Writing report…';
  if (report.status === 'failed') return 'Retry report';
  return 'View report';
}
