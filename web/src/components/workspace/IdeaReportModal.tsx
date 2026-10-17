import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { downloadIdeaReportPdf, fetchIdeaReportHtml } from '../../lib/ideaReports';

interface IdeaReportModalProps {
  ideaId: string;
  title: string;
  token: string;
  onClose: () => void;
}

/** The server-rendered evaluation report, exactly as it prints, with a PDF download. */
export const IdeaReportModal: React.FC<IdeaReportModalProps> = ({ ideaId, title, token, onClose }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchIdeaReportHtml(ideaId, token).then(setHtml).catch((e: Error) => setError(e.message));
  }, [ideaId, token]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadIdeaReportPdf(ideaId, title, token);
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
          <p className="text-sm font-semibold text-gray-800 truncate pr-4">{title} · Evaluation report</p>
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
          <p className="p-6 text-sm text-gray-500">Loading report…</p>
        ) : (
          // sandbox="" runs no scripts and gives the page no access to this app.
          <iframe title={`${title} report`} sandbox="" srcDoc={html} className="flex-1 w-full bg-white" />
        )}
      </div>
    </div>
  );
};
