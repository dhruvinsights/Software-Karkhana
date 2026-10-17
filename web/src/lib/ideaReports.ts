/**
 * Idea evaluation reports. The server writes the report in the background
 * (POST /evaluate) and announces it with workspace_sync "ideas"; the finished
 * report is served as printable HTML and as a PDF.
 */

import { IdeaReportState } from '../types/factory';
import { downloadPdf, fetchHtml, fileSafe } from './printable';

export async function startIdeaReport(ideaId: string, token: string): Promise<void> {
  const res = await fetch(`/api/ideas/${ideaId}/evaluate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Could not start the report.');
  }
}

export const fetchIdeaReportHtml = (ideaId: string, token: string) => fetchHtml(`/api/ideas/${ideaId}/report.html`, token);

export const downloadIdeaReportPdf = (ideaId: string, title: string, token: string) =>
  downloadPdf(`/api/ideas/${ideaId}/report.pdf`, `${fileSafe(title)}-evaluation.pdf`, token);

/** Short label for a report state, for buttons and lists. */
export function reportLabel(report: IdeaReportState | null | undefined): string {
  if (!report) return 'Evaluate';
  if (report.status === 'running') return 'Writing report…';
  if (report.status === 'failed') return 'Retry report';
  return 'View report';
}
