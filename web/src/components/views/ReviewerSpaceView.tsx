import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Sparkles,
  FileCode,
  Layers,
  ChevronRight,
  Filter,
  Check,
  X,
  MessageSquare,
  ArrowRight
} from 'lucide-react';
import { FactoryState, factoryStore } from '../../store/factoryStore';
import { IdeaReviewItem } from '../../types/factory';
import { useChatFrames } from '../../lib/chatSocket';
import { IdeaReportModal } from '../workspace/DocumentModal';
import { BorderGlow } from '../reactbits/BorderGlow';
import { SpotlightCard } from '../reactbits/SpotlightCard';

interface ReviewerSpaceViewProps {
  state: FactoryState;
}

export const ReviewerSpaceView: React.FC<ReviewerSpaceViewProps> = ({ state }) => {
  const token = state.token ?? '';
  const [reviews, setReviews] = useState<IdeaReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'decided'>('pending');
  const [selectedReview, setSelectedReview] = useState<IdeaReviewItem | null>(null);

  // Decision state (an approval needs no words; a rejection needs a reason)
  const [decisionAction, setDecisionAction] = useState<'approved' | 'rejected' | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportFor, setReportFor] = useState<IdeaReviewItem | null>(null);

  const fetchReviews = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/idea-approvals/inbox?scope=all', {
        headers: { Authorization: `Bearer ${token}`, ...(state.activeWorkspaceId.length === 36 ? { 'X-Workspace-Id': state.activeWorkspaceId } : {}) },
      });
      if (res.ok) {
        const rows = (await res.json()) as any[];
        setReviews(
          rows.map((r) => ({
            id: r.ideaId,
            ideaId: r.ideaId,
            ideaTitle: r.title,
            problemStatement: r.problemStatement,
            expectedValue: r.expectedValue || '',
            complexity: r.complexity || 'Medium',
            tags: r.tags || [],
            evidence: r.evidence || [],
            reviewReport: r.reviewReport || undefined,
            productName: r.productName || 'Product',
            productId: r.productId || undefined,
            decision: r.decision,
            comment: r.reason || r.note || undefined,
            requestedByName: r.requestedBy,
            requestedAt: r.requestedAt,
            decidedAt: r.decidedAt || undefined,
          })),
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [token, state.activeWorkspaceId]);

  // New requests and finished reports arrive live.
  useChatFrames('workspace_sync', (frame) => {
    if (frame.scope === 'ideas') fetchReviews();
  }, [token, state.activeWorkspaceId]);

  const handleDecide = async () => {
    if (!selectedReview || !decisionAction || !token) return;
    setSubmitting(true);
    try {
      setDecisionError(null);
      if (decisionAction === 'rejected' && !decisionComment.trim()) {
        setDecisionError('Say why: the author needs to know what to change.');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/ideas/${selectedReview.ideaId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          decision: decisionAction === 'approved' ? 'approve' : 'reject',
          reason: decisionComment.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDecisionError(typeof body.detail === 'string' ? body.detail : `Could not record the decision (HTTP ${res.status}).`);
      } else {
        setReviews((prev) =>
          prev.map((r) =>
            r.id === selectedReview.id
              ? { ...r, decision: decisionAction, comment: decisionComment, decidedAt: new Date().toISOString() }
              : r
          )
        );
        setSelectedReview(null);
        setDecisionAction(null);
        setDecisionComment('');
      }
    } catch (e) {
      console.error(e);
      setDecisionError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingList = reviews.filter((r) => r.decision === 'pending');
  const decidedList = reviews.filter((r) => r.decision !== 'pending');
  const activeList = tab === 'pending' ? pendingList : decidedList;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Reviewer Space Header */}
      <SpotlightCard className="p-8 sm:p-10 space-y-4" spotlightColor="rgba(7, 91, 255, 0.15)">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#075BFF]">
              <ShieldCheck className="w-4 h-4" />
              <span>Reviewer Council Space</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              Idea & Architecture Proposals
            </h1>
            <p className="text-sm text-[#A7ACB8] font-light max-w-2xl">
              Formal review queue for validating project proposals, budget readiness, and architecture feasibility prior to engineering kickoff.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setTab('pending')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                tab === 'pending'
                  ? 'bg-[#075BFF] text-white shadow-lg shadow-[#075BFF]/25'
                  : 'bg-[#15151F] text-[#827D8E] hover:text-white'
              }`}
            >
              Pending ({pendingList.length})
            </button>
            <button
              onClick={() => setTab('decided')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                tab === 'decided'
                  ? 'bg-[#075BFF] text-white shadow-lg shadow-[#075BFF]/25'
                  : 'bg-[#15151F] text-[#827D8E] hover:text-white'
              }`}
            >
              History ({decidedList.length})
            </button>
          </div>
        </div>
      </SpotlightCard>

      {/* Reviews Queue */}
      {loading ? (
        <div className="text-center py-20 text-xs text-[#827D8E] font-light">
          Loading reviewer queue...
        </div>
      ) : activeList.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
          <h3 className="text-lg font-medium text-white">All Caught Up!</h3>
          <p className="text-xs text-[#827D8E] font-light max-w-md mx-auto">
            {tab === 'pending'
              ? 'You have no pending proposal reviews in this workspace.'
              : 'No decided proposal history recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {activeList.map((item) => (
            <BorderGlow
              key={item.id}
              borderRadius={20}
              glowColor="220 80 80"
              backgroundColor="#111118"
              className="p-6 border border-white/[0.08] space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-[#075BFF]/10 text-[#5B8FFF] border border-[#075BFF]/20">
                      {item.productName}
                    </span>
                    <span className="text-xs text-[#827D8E]">
                      Requested by <strong className="text-white font-medium">{item.requestedByName}</strong>
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-white">{item.ideaTitle}</h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-xs font-mono uppercase px-2.5 py-1 rounded-lg font-medium ${
                      item.decision === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : item.decision === 'rejected'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                    }`}
                  >
                    {item.decision.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {/* Description & Evidence */}
              <div className="space-y-3 text-xs leading-relaxed text-[#B5B1C0]">
                <div>
                  <strong className="text-white">Problem & Opportunity:</strong>
                  <p className="mt-0.5">{item.problemStatement}</p>
                </div>
                {item.expectedValue && (
                  <div>
                    <strong className="text-white">Expected Strategic Value:</strong>
                    <p className="mt-0.5">{item.expectedValue}</p>
                  </div>
                )}
                {item.evidence && item.evidence.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-[#827D8E] font-mono bg-black/40 p-2 rounded-xl">
                    <FileCode className="w-3.5 h-3.5 text-[#075BFF] shrink-0" />
                    <span className="truncate">Cites: {item.evidence.join(', ')}</span>
                  </div>
                )}
              </div>

              {/* The evaluation report reviewers decide on */}
              {item.reviewReport?.status === 'ready' && item.reviewReport.report && item.reviewReport.meta && (
                <div className="flex items-center justify-between gap-3 p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl text-xs">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-blue-400 uppercase font-semibold">Evaluation report</div>
                    <p className="text-[#D1D5DB] mt-0.5">
                      <span className="text-white font-semibold">{item.reviewReport.report.verdict}</span>
                      {' · '}{item.reviewReport.meta.overallScore.toFixed(1)}/10 · size {item.reviewReport.report.size}
                    </p>
                    <p className="text-[#A7ACB8] mt-1 line-clamp-2">{item.reviewReport.report.executive_summary}</p>
                  </div>
                  <button
                    onClick={() => setReportFor(item)}
                    className="shrink-0 px-3 py-1.5 bg-[#075BFF]/20 hover:bg-[#075BFF]/30 text-[#5B8FFF] rounded-lg text-xs font-medium cursor-pointer"
                  >
                    Read report
                  </button>
                </div>
              )}

              {/* Reviewer Decision Actions */}
              {item.decision === 'pending' ? (
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
                  <button
                    onClick={() => {
                      setSelectedReview(item);
                      setDecisionAction('rejected');
                    }}
                    className="px-4 py-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 rounded-xl text-xs font-medium cursor-pointer transition-colors"
                  >
                    Reject with reason
                  </button>
                  <button
                    onClick={() => {
                      setSelectedReview(item);
                      setDecisionAction('approved');
                    }}
                    className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Approve Proposal</span>
                  </button>
                </div>
              ) : (
                item.comment && (
                  <div className="text-xs text-[#827D8E] italic bg-white/[0.02] p-3 rounded-lg border border-white/[0.04]">
                    " {item.comment} "
                  </div>
                )
              )}
            </BorderGlow>
          ))}
        </div>
      )}

      {/* Decision Modal */}
      {selectedReview && decisionAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-[#13131C] border border-white/[0.12] rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                {decisionAction === 'approved' ? 'Approve Proposal' : 'Reject Proposal'}
              </h3>
              <button
                onClick={() => {
                  setSelectedReview(null);
                  setDecisionAction(null);
                }}
                className="text-[#827D8E] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-[#A7ACB8] font-light">
              Proposal: <strong className="text-white">{selectedReview.ideaTitle}</strong>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-[#827D8E]">
                {decisionAction === 'rejected' ? 'Why are you rejecting it? (required)' : 'Comments (optional)'}
              </label>
              <textarea
                value={decisionComment}
                onChange={(e) => setDecisionComment(e.target.value)}
                rows={3}
                placeholder="Add reasoning, architectural guidance, or next steps..."
                className="w-full px-3 py-2 bg-[#1A1A26] border border-white/10 rounded-xl text-xs text-white outline-none"
              />
            </div>

            {decisionError && (
              <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{decisionError}</div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setSelectedReview(null);
                  setDecisionAction(null);
                  setDecisionError(null);
                }}
                className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-[#A7ACB8] rounded-xl text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDecide}
                disabled={submitting}
                className={`px-5 py-2 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg transition-all ${
                  decisionAction === 'approved'
                    ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25'
                    : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/25'
                }`}
              >
                {submitting ? 'Submitting...' : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}
      {reportFor && (
        <IdeaReportModal ideaId={reportFor.ideaId} title={reportFor.ideaTitle} token={token} onClose={() => setReportFor(null)} />
      )}
    </div>
  );
};
