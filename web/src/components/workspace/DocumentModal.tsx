import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { downloadIdeaReportPdf, fetchIdeaReportHtml } from '../../lib/ideaReports';

interface DocumentModalProps {
  title: string;
  loadHtml: () => Promise<string>;
  downloadPdf: () => Promise<void>;
  onClose: () => void;
}

/** A server-rendered document exactly as it prints, with a PDF download. */
export const DocumentModal: React.FC<DocumentModalProps> = ({ title, loadHtml, downloadPdf, onClose }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadHtml().then(setHtml).catch((e: Error) => setError(e.message));
    // Loaded once per open; the parent remounts the modal for another document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadPdf();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[88vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <p className="text-sm font-semibold text-gray-800 truncate pr-4">{title}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={download}
              disabled={downloading || !html}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-lg text-xs font-medium cursor-pointer disabled:opacity-60"
            >
              {downloading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>{downloading ? 'Preparing PDF…' : 'Download PDF'}</span>
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-gray-200 text-gray-500 hover:text-gray-800 rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : html === null ? (
          <p className="p-6 text-sm text-gray-500">Loading…</p>
        ) : (
          // sandbox="" runs no scripts and gives the page no access to this app.
          <iframe title={title} sandbox="" srcDoc={html} className="flex-1 w-full bg-white" />
        )}
      </div>
    </div>
  );
};

/** The evaluation report of one idea. */
export const IdeaReportModal: React.FC<{ ideaId: string; title: string; token: string; onClose: () => void }> = ({
  ideaId,
  title,
  token,
  onClose,
}) => (
  <DocumentModal
    title={`${title} · Evaluation report`}
    loadHtml={() => fetchIdeaReportHtml(ideaId, token)}
    downloadPdf={() => downloadIdeaReportPdf(ideaId, title, token)}
    onClose={onClose}
  />
);
