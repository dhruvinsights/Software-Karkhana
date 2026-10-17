/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * The Developer station of a project.
 *
 *   My work            each story as a pipeline: code → unit → integration → AI review & PR
 *                      → human review → merged → manual check → QA, with live test progress
 *   Bugs from QA       new / reopened bugs to fix, fixes waiting for QA, verified
 *   Frontend & design  UI stories with the designer's screens and contracts
 *   Channels           this station's conversations
 *   Machines           connected developer machines
 *
 * Agents code, review and suggest. The developer confirms: every story gets a
 * manual check before QA, every fix a manual check before QA verifies it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bug as BugIcon,
  ClipboardCheck,
  ExternalLink,
  GitPullRequest,
  Hammer,
  Laptop,
  Loader2,
  MessagesSquare,
  Palette,
  Play,
  RotateCcw,
  Terminal,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { buildApi, Machine } from '../../lib/buildApi';
import { useChatFrames } from '../../lib/chatSocket';
import { Bug, DevBoard, devQaApi, DevStory, FrontendWorkspace } from '../../lib/devQaApi';
import { Machines, PHASE_LABEL, RunLog } from '../views/ProjectBuildPanel';
import { StationChannels } from './StationChannels';
import {
  BugStatePill,
  card,
  CheckSummary,
  ErrorText,
  ManualCheckModal,
  Pill,
  Pipeline,
  PriorityPill,
  StepState,
  SubTabs,
  SuiteBars,
} from './StationKit';

type Tab = 'mine' | 'all' | 'bugs' | 'frontend' | 'channels' | 'machines';

const FIX_CHECKLIST = [
  'I reproduced the bug before my change',
  'Following the steps no longer reproduces it',
  'The related unit and integration tests pass',
];

const ACTIVE_RUN = new Set(['queued', 'running']);

function steps(s: DevStory): { label: string; state: StepState; hint?: string }[] {
  const run = s.run;
  const suites = run?.testSuites ?? [];
  const unit = suites.find((x) => x.suite === 'unit' || x.suite === 'tests');
  const integ = suites.find((x) => x.suite === 'integration');
  const suiteState = (x: typeof unit): StepState =>
    !x ? 'waiting' : x.status === 'running' ? 'current' : x.status === 'passed' ? 'done' : 'blocked';
  const codeState: StepState = !run
    ? 'waiting'
    : ACTIVE_RUN.has(run.status) && (run.phase === 'coding' || run.phase === 'cloning' || run.phase === 'queued' || !run.phase)
      ? 'current'
      : run.status === 'failed'
        ? 'blocked'
        : 'done';
  const pr = s.pr;
  const merged = pr?.status === 'merged';
  const checkable = ['in_progress', 'in_review', 'ready_for_qa', 'in_qa'].includes(s.status);
  return [
    { label: 'Code', state: codeState, hint: run?.phase ? PHASE_LABEL[run.phase] ?? run.phase : undefined },
    { label: 'Unit', state: suiteState(unit) },
    { label: 'Integration', state: integ ? suiteState(integ) : unit && unit.status !== 'running' ? 'done' : 'waiting', hint: integ ? undefined : 'No separate integration suite' },
    {
      label: 'AI review',
      state: !pr ? (run?.phase === 'publishing' ? 'current' : 'waiting') : pr.openComments > 0 ? 'current' : 'done',
      hint: pr ? `${pr.openComments} AI comments to triage` : undefined,
    },
    {
      label: 'Human review',
      state: !pr ? 'waiting' : pr.approvals.length ? 'done' : pr.requestedReviewers.length ? 'current' : 'waiting',
      hint: pr?.approvals.length ? `Approved by ${pr.approvals.join(', ')}` : undefined,
    },
    { label: 'Merged', state: merged ? 'done' : pr && pr.approvals.length ? 'current' : 'waiting' },
    { label: 'Manual check', state: s.devCheck ? 'done' : checkable && (merged || s.status !== 'in_progress') ? 'current' : 'waiting' },
    { label: 'QA', state: s.status === 'done' ? 'done' : s.status === 'ready_for_qa' || s.status === 'in_qa' ? 'current' : 'waiting' },
  ];
}

const ReviewerPicker: React.FC<{ prId: string; members: { userId: string; name: string }[]; already: string[]; onDone: () => void }> = ({
  prId,
  members,
  already,
  onDone,
}) => {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const choices = members.filter((m) => !already.includes(m.userId));
  if (choices.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="bg-[#07070B] border border-white/[0.1] rounded-lg text-xs text-white px-2 py-1.5"
        aria-label="Reviewer"
      >
        <option value="">Ask a reviewer…</option>
        {choices.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      <button
        disabled={!pick || busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await devQaApi.requestReviewers(prId, [pick]);
            setMsg(r.onGitHub ? 'Requested here and on GitHub' : 'Requested');
            setPick('');
            onDone();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1"
      >
        <UserPlus className="w-3.5 h-3.5" /> Ask
      </button>
      {msg && <span className="text-[11px] text-[#827D8E]">{msg}</span>}
    </span>
  );
};

const StoryCard: React.FC<{
  story: DevStory;
  myId: string;
  members: { userId: string; name: string }[];
  onChange: () => void;
}> = ({ story, myId, members, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reworking, setReworking] = useState(false);
  const [reason, setReason] = useState('');
  const run = story.run;
  const pr = story.pr;
  const mine = story.assigneeId === myId;
  const running = !!run && ACTIVE_RUN.has(run.status);
  const canBuild = mine && !!story.taskId && (story.status === 'ready' || story.status === 'in_progress') && !running;
  const canCheck = mine && !story.devCheck && ['in_progress', 'in_review', 'ready_for_qa', 'in_qa'].includes(story.status) && !!pr;
  const openBugs = story.bugs.filter((b) => b.state !== 'verified' && b.state !== 'wont_fix');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`${card} p-4 space-y-3`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-white">
            <span className="font-mono text-[11px] text-[#827D8E] mr-2">{story.key}</span>
            {story.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#827D8E]">
            {story.layer && (
              <Pill className={story.layer === 'frontend' ? 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' : 'bg-white/5 text-[#B5B1C0] border-white/10'}>
                {story.layer}
              </Pill>
            )}
            <Pill className="bg-white/5 text-[#B5B1C0] border-white/10">{story.status.replace(/_/g, ' ')}</Pill>
            <span>{story.assigneeName ?? 'unassigned'}</span>
            {openBugs.length > 0 && (
              <Pill className="bg-rose-500/10 text-rose-300 border-rose-500/30">
                {openBugs.length} QA bug{openBugs.length > 1 ? 's' : ''}
              </Pill>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!story.assigneeId && (story.status === 'backlog' || story.status === 'ready') && (
            <button
              disabled={busy}
              onClick={() => act(() => buildApi.takeStory(story.id, myId))}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-lg text-xs cursor-pointer disabled:opacity-50"
            >
              Take it
            </button>
          )}
          {canBuild && (
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await buildApi.build(story.taskId!);
                  if (r.status === 'failed') throw new Error(r.error ?? 'The build could not start.');
                  setLog(true);
                })
              }
              className="px-3 py-1.5 bg-[#075BFF] hover:bg-[#1a6bff] text-white rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Play className="w-3 h-3" /> {run ? 'Build again' : 'Build on my machine'}
            </button>
          )}
          {canCheck && (
            <button
              onClick={() => setChecking(true)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> I tested it by hand
            </button>
          )}
          {run && (
            <button
              onClick={() => setLog((o) => !o)}
              aria-label="Run log"
              className="p-1.5 rounded-lg bg-white/[0.06] text-[#B5B1C0] hover:text-white cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      <Pipeline steps={steps(story)} />

      {run && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            {running && (
              <p className="text-[11px] text-[#7aa7ff] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> {PHASE_LABEL[run.phase ?? 'queued'] ?? run.phase}
              </p>
            )}
            {run.testSuites.length > 0 ? (
              <SuiteBars suites={run.testSuites} />
            ) : (
              !running && <p className="text-[11px] text-[#827D8E]">No test results reported for this run.</p>
            )}
            {run.status === 'failed' && run.error && <ErrorText>{run.error}</ErrorText>}
          </div>
          {pr && (
            <div className="space-y-2 text-xs">
              <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[#7aa7ff] hover:text-white">
                <GitPullRequest className="w-3.5 h-3.5" /> PR #{pr.number} · {pr.status}
                <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-[#827D8E]">
                {pr.reviewed ? `AI review done · ${pr.openComments} comment(s) to triage` : 'AI review pending'}
                {' · '}
                {pr.approvals.length ? `approved by ${pr.approvals.join(', ')}` : 'no human approval yet'}
              </p>
              {pr.requestedReviewers.length > 0 && (
                <p className="text-[#B5B1C0]">Asked: {pr.requestedReviewers.map((r) => r.name).join(', ')}</p>
              )}
              {pr.status === 'open' && mine && !reworking && (
                <button
                  onClick={() => {
                    setReworking(true);
                    setReason(pr.testsPassed ? '' : 'Tests failed in the build; fix them and build again.');
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 text-xs cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Send back for rework
                </button>
              )}
              {reworking && pr && (
                <div className="space-y-1.5">
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="What must change (goes on the PR when it closes)"
                    className="w-full px-3 py-2 bg-[#07070B] border border-white/[0.1] rounded-lg text-xs text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await devQaApi.rework(pr.id, reason);
                          setReworking(false);
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-xs cursor-pointer disabled:opacity-40"
                    >
                      Close PR and make it Ready
                    </button>
                    <button onClick={() => setReworking(false)} className="px-2.5 py-1.5 text-xs text-[#827D8E] cursor-pointer">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {pr.status === 'open' && (
                <ReviewerPicker
                  prId={pr.id}
                  members={members.filter((m) => m.userId !== story.assigneeId)}
                  already={pr.requestedReviewers.map((r) => r.userId)}
                  onDone={onChange}
                />
              )}
            </div>
          )}
        </div>
      )}

      {story.devCheck && <CheckSummary check={story.devCheck} />}

      {story.bugs.length > 0 && (
        <ul className="space-y-1">
          {story.bugs.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-xs text-[#B5B1C0]">
              <BugIcon className="w-3 h-3 text-rose-300" />
              <span className="font-mono text-[10px] text-[#827D8E]">{b.key}</span>
              <span className="truncate flex-1">{b.title}</span>
              <BugStatePill state={b.state} />
            </li>
          ))}
        </ul>
      )}

      {log && run && <RunLog runId={run.id} />}
      {error && <ErrorText>{error}</ErrorText>}

      {checking && (
        <ManualCheckModal
          title={`Manual check · ${story.key}`}
          intro="Run the change yourself. Tick each criterion only after you saw it work. QA cannot sign off until you do."
          criteria={story.acceptanceCriteria}
          submitLabel="Confirm manual check"
          onClose={() => setChecking(false)}
          onSubmit={async (criteria, notes) => {
            await devQaApi.devCheck(story.id, criteria, notes);
            onChange();
          }}
        />
      )}
    </article>
  );
};

const BugRow: React.FC<{ bug: Bug; myId: string; onChange: () => void }> = ({ bug, myId, onChange }) => {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionable = bug.assigneeId === myId || !bug.assigneeId;
  return (
    <li className={`${card} p-4 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button onClick={() => setOpen((o) => !o)} className="text-left min-w-0 cursor-pointer">
          <p className="text-sm text-white">
            <span className="font-mono text-[11px] text-[#827D8E] mr-2">{bug.key}</span>
            {bug.title}
          </p>
          <p className="text-[11px] text-[#827D8E] mt-0.5">
            on {bug.storyKey ?? '—'} · reported by {bug.reporterName ?? 'QA'} · {bug.assigneeName ?? 'unassigned'}
            {bug.reopenCount ? ` · reopened ${bug.reopenCount}×` : ''}
          </p>
        </button>
        <div className="flex items-center gap-2">
          <PriorityPill p={bug.priority} />
          <BugStatePill state={bug.state} />
          {actionable && (bug.state === 'new' || bug.state === 'reopened') && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await devQaApi.startFix(bug.id);
                  onChange();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Wrench className="w-3.5 h-3.5" /> Start fix
            </button>
          )}
          {actionable && (bug.state === 'fixing' || bug.state === 'new' || bug.state === 'reopened') && (
            <button
              onClick={() => setFixing(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> Mark fixed
            </button>
          )}
        </div>
      </div>
      {open && bug.description && (
        <pre className="text-[11px] text-[#B5B1C0] whitespace-pre-wrap bg-black/30 rounded-lg p-3 font-sans">{bug.description}</pre>
      )}
      {bug.devCheck && <CheckSummary check={bug.devCheck} />}
      {error && <ErrorText>{error}</ErrorText>}
      {fixing && (
        <ManualCheckModal
          title={`Mark ${bug.key} fixed`}
          intro="Confirm the fix by hand. QA verifies it next and can reopen it with a reason."
          criteria={FIX_CHECKLIST}
          submitLabel="Mark fixed"
          onClose={() => setFixing(false)}
          onSubmit={async (criteria, notes) => {
            await devQaApi.markFixed(bug.id, criteria, notes);
            onChange();
          }}
        />
      )}
    </li>
  );
};

const FrontendTab: React.FC<{ projectId: string; epoch: number }> = ({ projectId, epoch }) => {
  const [data, setData] = useState<FrontendWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    devQaApi.frontend(projectId).then(setData).catch((e) => setError((e as Error).message));
  }, [projectId, epoch]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="text-xs text-[#827D8E]">Loading…</p>;
  const d = data.design;
  return (
    <div className="space-y-4">
      <section className={`${card} p-5 space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-fuchsia-300" /> Design handoff
          </p>
          {d && (
            <Pill className={d.status === 'approved' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}>
              v{d.version} · {d.status === 'approved' ? 'approved' : 'draft'}
            </Pill>
          )}
        </div>
        {d ? (
          <>
            <p className="text-sm text-[#B5B1C0]">{d.overview}</p>
            {d.handoffNotes.length > 0 && (
              <ul className="text-xs text-[#a8a3b5] list-disc ml-4 space-y-1">
                {d.handoffNotes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            {d.tokens.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.tokens.map((t) => (
                  <span key={t.name} className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-[#B5B1C0] flex items-center gap-1.5">
                    {/^#|rgb|hsl/.test(t.value) && <span className="w-2.5 h-2.5 rounded-sm border border-white/20" style={{ background: t.value }} />}
                    {t.name}: {t.value}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-[#827D8E]">No design yet. When the designer drafts screens, frontend stories and their agents get them here automatically.</p>
        )}
        <p className="text-[11px] text-[#827D8E]">Coding runs for these stories receive their screens and API contracts as context.</p>
      </section>
      {data.stories.length === 0 ? (
        <p className="text-xs text-[#827D8E]">No frontend stories in this project.</p>
      ) : (
        data.stories.map((s) => (
          <article key={s.id} className={`${card} p-4 space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-mono text-[11px] text-[#827D8E] mr-2">{s.key}</span>
                {s.title}
              </p>
              <span className="text-[11px] text-[#827D8E]">
                {s.status.replace(/_/g, ' ')} · {s.assigneeName ?? 'unassigned'}
                {s.run ? ` · run ${s.run.status}` : ''}
              </span>
            </div>
            {s.run && s.run.testSuites.length > 0 && <SuiteBars suites={s.run.testSuites} compact />}
            {s.screens.length === 0 && s.contracts.length === 0 && (
              <p className="text-[11px] text-amber-300">The design does not cite this story yet; ask the designer.</p>
            )}
            {s.screens.map((sc) => (
              <div key={sc.name} className="space-y-1.5">
                <button
                  onClick={() => setPreview(preview === `${s.id}:${sc.name}` ? null : `${s.id}:${sc.name}`)}
                  className="text-xs text-fuchsia-300 hover:text-white cursor-pointer"
                >
                  Screen: {sc.name} · {sc.states.join(', ')} {preview === `${s.id}:${sc.name}` ? '▲' : '▼'}
                </button>
                {preview === `${s.id}:${sc.name}` && (
                  // sandbox="" runs no scripts; prototypes are static HTML by contract.
                  <iframe title={sc.name} sandbox="" srcDoc={sc.html} className="w-full h-72 rounded-lg bg-white" />
                )}
              </div>
            ))}
            {s.contracts.map((c) => (
              <p key={`${c.method} ${c.path}`} className="text-[11px] text-[#B5B1C0]">
                <span className="font-mono px-1.5 py-0.5 rounded bg-[#075BFF]/20 text-[#7aa7ff] mr-1.5">{c.method}</span>
                <code className="text-white">{c.path}</code> · {c.summary}
              </p>
            ))}
          </article>
        ))
      )}
    </div>
  );
};

export const DevWorkspace: React.FC<{ projectId: string; projectCode: string }> = ({ projectId, projectCode }) => {
  const myId = factoryStore.getState().currentUser?.id ?? '';
  const [tab, setTab] = useState<Tab>('mine');
  const [board, setBoard] = useState<DevBoard | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([devQaApi.devBoard(projectId), buildApi.machines().catch(() => [])]);
      setBoard(b);
      setMachines(m);
      setEpoch((n) => n + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
    devQaApi
      .projectMembers(projectId)
      .then((rows) => setMembers(rows.map((r) => ({ userId: r.userId ?? r.id ?? '', name: r.name ?? r.displayName ?? '' }))))
      .catch(() => {});
  }, [reload, projectId]);

  useChatFrames('workspace_sync', (f) => {
    if (f.scope === 'runs' || f.scope === 'projects') void reload();
  }, [reload]);

  const stories = board?.stories ?? [];
  const mine = useMemo(() => stories.filter((s) => s.assigneeId === myId), [stories, myId]);
  const myBugs = (board?.bugs ?? []).filter((b) => b.assigneeId === myId || !b.assigneeId);
  const toFix = myBugs.filter((b) => b.state === 'new' || b.state === 'reopened' || b.state === 'fixing');
  const suites = mine.flatMap((s) => s.run?.testSuites ?? []).filter((x) => x.status !== 'running');
  const passRate = suites.length ? Math.round((suites.filter((x) => x.status === 'passed').length / suites.length) * 100) : null;
  const waitingCheck = mine.filter((s) => !s.devCheck && s.pr && ['in_review', 'ready_for_qa', 'in_qa'].includes(s.status)).length;
  const online = machines.filter((m) => m.online).length;

  const stats = [
    { label: 'My stories', value: mine.length },
    { label: 'Building now', value: mine.filter((s) => s.run && ACTIVE_RUN.has(s.run.status)).length },
    { label: 'Test suites passing', value: passRate === null ? '—' : `${passRate}%` },
    { label: 'Manual checks due', value: waitingCheck, alert: waitingCheck > 0 },
    { label: 'Bugs to fix', value: toFix.length, alert: toFix.length > 0 },
  ];

  const groups: [string, Bug[]][] = [
    ['To fix', myBugs.filter((b) => b.state === 'new' || b.state === 'reopened')],
    ['Fixing', myBugs.filter((b) => b.state === 'fixing')],
    ['Fixed, waiting for QA', myBugs.filter((b) => b.state === 'fixed')],
    ['Verified', myBugs.filter((b) => b.state === 'verified')],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Hammer className="w-5 h-5 text-[#075BFF]" /> Developer workspace
          </h2>
          <p className="text-xs text-[#827D8E] mt-1">
            Agents code, test and review. You confirm: a manual check on every story and every fix.
          </p>
        </div>
        <span className="text-[11px] text-[#827D8E] flex items-center gap-1.5">
          <Laptop className="w-3.5 h-3.5" /> {online} machine{online === 1 ? '' : 's'} online
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`${card} p-3.5`}>
            <p className={`text-2xl font-semibold ${s.alert ? 'text-amber-300' : 'text-white'}`}>{s.value}</p>
            <p className="text-[10px] uppercase font-mono text-[#827D8E]">{s.label}</p>
          </div>
        ))}
      </div>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: 'My work', count: mine.length },
          { id: 'all', label: 'All stories', count: stories.length },
          { id: 'bugs', label: 'Bugs from QA', count: toFix.length, alert: true },
          { id: 'frontend', label: 'Frontend & design' },
          { id: 'channels', label: 'Channels' },
          { id: 'machines', label: 'Machines', count: machines.length },
        ]}
      />

      {error && <ErrorText>{error}</ErrorText>}
      {!board && !error && <p className="text-xs text-[#827D8E]">Loading…</p>}

      {(tab === 'mine' || tab === 'all') && board && (
        <div className="space-y-3">
          {(tab === 'mine' ? mine : stories).length === 0 ? (
            <div className={`${card} p-8 text-center text-sm text-[#827D8E]`}>
              {tab === 'mine'
                ? 'Nothing assigned to you. Take a story from All stories.'
                : 'No approved stories yet. They appear once the plan is approved.'}
            </div>
          ) : (
            (tab === 'mine' ? mine : stories).map((s) => (
              <StoryCard key={s.id} story={s} myId={myId} members={members} onChange={reload} />
            ))
          )}
        </div>
      )}

      {tab === 'bugs' && board && (
        <div className="space-y-5">
          {myBugs.length === 0 && <div className={`${card} p-8 text-center text-sm text-[#827D8E]`}>No QA bugs for you. </div>}
          {groups.map(([label, rows]) =>
            rows.length ? (
              <section key={label} className="space-y-2">
                <h3 className="text-xs uppercase font-mono text-[#827D8E]">
                  {label} · {rows.length}
                </h3>
                <ul className="space-y-2">
                  {rows.map((b) => (
                    <BugRow key={b.id} bug={b} myId={myId} onChange={reload} />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}

      {tab === 'frontend' && <FrontendTab projectId={projectId} epoch={epoch} />}

      {tab === 'channels' && (
        <StationChannels projectId={projectId} projectCode={projectCode} station="developer" stationLabel="Developer" />
      )}

      {tab === 'machines' && <Machines machines={machines} onChange={reload} />}

      <p className="text-[11px] text-[#5f5b6b] flex items-center gap-1.5">
        <MessagesSquare className="w-3 h-3" /> Bugs QA files land in "Bugs from QA" and in your activity feed.
      </p>
    </div>
  );
};
