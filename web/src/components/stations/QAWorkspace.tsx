/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * The QA station of a project.
 *
 *   Queue          finished stories by stage: waiting for the developer's manual
 *                  check, ready, in QA, signed off. Open one to run scenarios, ask
 *                  the QA agent for suggestions and sign it off.
 *   Suggestions    what the QA agent thinks may be wrong; QA accepts (a bug goes
 *                  to the developer) or dismisses with a reason. Agents only suggest.
 *   Verify fixes   bugs the developer marked fixed, with their manual check
 *   All bugs       every QA bug and where it stands
 *   Channels       this station's conversations
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, ClipboardList, FileCode2, Loader2, Plus, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useChatFrames } from '../../lib/chatSocket';
import { devQaApi, QaBoard, QaStage, QaStory, QaSuggestion, Scenario } from '../../lib/devQaApi';
import { stationsApi } from '../../lib/stationsApi';
import { StationChannels } from './StationChannels';
import { BugStatePill, card, CheckSummary, ErrorText, field, Modal, Pill, PriorityPill, SubTabs } from './StationKit';

type Tab = 'queue' | 'suggestions' | 'verify' | 'bugs' | 'channels';

const STAGES: { id: QaStage; label: string; hint: string }[] = [
  { id: 'waiting_dev_check', label: 'Waiting for developer', hint: 'Manual check not confirmed yet' },
  { id: 'ready', label: 'Ready for QA', hint: 'Developer checked it by hand' },
  { id: 'in_qa', label: 'In QA', hint: 'Scenarios running' },
  { id: 'signed_off', label: 'Signed off', hint: 'Done' },
];

const ScenarioRow: React.FC<{ s: Scenario; onChange: () => void }> = ({ s, onChange }) => {
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(s.actualResult ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = async (status: Scenario['status']) => {
    if (status === 'failed' && actual.trim().length < 3) {
      setOpen(true);
      setError('Write what actually happened; it goes into the bug for the developer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await devQaApi.recordResult(s.id, status, actual);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tone =
    s.status === 'passed'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      : s.status === 'failed'
        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
        : s.status === 'blocked'
          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
          : 'bg-white/5 text-[#827D8E] border-white/10';
  return (
    <li className="p-3 rounded-xl border border-white/[0.06] space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setOpen((o) => !o)} className="text-left text-sm text-white cursor-pointer min-w-0">
          {s.title} <span className="text-[11px] text-[#827D8E]">· {s.type} · {s.priority}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <Pill className={tone}>{s.status.replace('_', ' ')}</Pill>
          {(['passed', 'failed', 'blocked'] as const).map((st) => (
            <button
              key={st}
              disabled={busy}
              onClick={() => void record(st)}
              className={`px-2 py-1 rounded-lg text-[11px] cursor-pointer disabled:opacity-40 border ${
                st === 'passed' ? 'border-emerald-500/30 text-emerald-300' : st === 'failed' ? 'border-rose-500/30 text-rose-300' : 'border-amber-500/30 text-amber-300'
              } hover:bg-white/[0.05]`}
            >
              {st === 'passed' ? 'Pass' : st === 'failed' ? 'Fail' : 'Blocked'}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="space-y-2 text-xs text-[#B5B1C0]">
          <ol className="list-decimal ml-5 space-y-0.5">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
          <p>
            <span className="text-[#827D8E]">Expected:</span> {s.expectedResult}
          </p>
          <textarea
            rows={2}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="What actually happened (required to fail it)"
            className={field}
            aria-label="Actual result"
          />
          {s.automationScript && (
            <details>
              <summary className="cursor-pointer text-[#7aa7ff] flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5" /> Automation script
              </summary>
              <pre className="mt-1 text-[11px] bg-black/40 rounded-lg p-3 overflow-x-auto">{s.automationScript}</pre>
            </details>
          )}
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </li>
  );
};

const SuggestionCard: React.FC<{ s: QaSuggestion; onChange: () => void }> = ({ s, onChange }) => {
  const [mode, setMode] = useState<'accept' | 'dismiss' | null>(null);
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(s.severity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'accept') {
        const r = await devQaApi.accept(s.id, priority, notes);
        setDone(`Filed as ${r.bugKey} for the developer.`);
      } else {
        await devQaApi.dismiss(s.id, notes);
        setDone('Dismissed.');
      }
      setMode(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`${card} p-4 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-white">
          <Bot className="w-3.5 h-3.5 inline mr-1.5 text-fuchsia-300" />
          {s.title}
        </p>
        <div className="flex items-center gap-1.5">
          <Pill className="bg-white/5 text-[#B5B1C0] border-white/10">{s.category.replace('_', ' ')}</Pill>
          <PriorityPill p={s.severity} />
          {s.status !== 'open' && (
            <Pill className={s.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-[#827D8E] border-white/10'}>
              {s.status}
            </Pill>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[#827D8E]">on {s.storyKey}</p>
      <p className="text-xs text-[#B5B1C0]">{s.description}</p>
      <ol className="list-decimal ml-5 text-xs text-[#a8a3b5] space-y-0.5">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
      <p className="text-xs text-[#a8a3b5]">
        <span className="text-[#827D8E]">Expected:</span> {s.expected}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {s.evidence.map((e, i) => (
          <code key={i} className="text-[11px] px-2 py-0.5 rounded bg-black/40 text-[#7aa7ff]" title={e.note}>
            {e.path}
            {e.line ? `:${e.line}` : ''}
          </code>
        ))}
      </div>
      {s.status !== 'open' && s.reason && <p className="text-[11px] text-[#827D8E]">“{s.reason}” — {s.decidedBy}</p>}
      {s.status === 'open' && !mode && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setMode('accept')}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5"
          >
            <ThumbsUp className="w-3.5 h-3.5" /> I reproduced it · file bug
          </button>
          <button
            onClick={() => setMode('dismiss')}
            className="px-3 py-1.5 rounded-lg border border-white/[0.1] text-[#B5B1C0] hover:text-white text-xs cursor-pointer flex items-center gap-1.5"
          >
            <ThumbsDown className="w-3.5 h-3.5" /> Not a bug
          </button>
        </div>
      )}
      {mode && (
        <div className="space-y-2 pt-1">
          {mode === 'accept' && (
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={`${field} w-auto`} aria-label="Priority">
              {['P0', 'P1', 'P2', 'P3'].map((p) => <option key={p}>{p}</option>)}
            </select>
          )}
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={mode === 'accept' ? 'What you saw when you reproduced it (optional)' : 'Why this is not a bug (required)'}
            className={field}
          />
          <div className="flex gap-2">
            <button
              disabled={busy || (mode === 'dismiss' && notes.trim().length < 10)}
              onClick={() => void submit()}
              className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
            >
              {mode === 'accept' ? 'File bug to developer' : 'Dismiss'}
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-1.5 text-xs text-[#827D8E] hover:text-white cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-[11px] text-emerald-300">{done}</p>}
      {error && <ErrorText>{error}</ErrorText>}
    </article>
  );
};

const StoryPanel: React.FC<{
  story: QaStory;
  projectId: string;
  scenarios: Scenario[];
  suggestions: QaSuggestion[];
  onChange: () => void;
  onClose: () => void;
}> = ({ story, projectId, scenarios, suggestions, onChange, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const agent = story.qaAgent;
  const [secBlockers, setSecBlockers] = useState<string[]>([]);

  // The server refuses sign-off while the security gate is closed; say why up front.
  useEffect(() => {
    stationsApi
      .securitySummary(projectId)
      .then((s) => setSecBlockers(s.gate.open ? [] : s.gate.blockers))
      .catch(() => setSecBlockers([]));
  }, [projectId]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`${story.key} · ${story.title}`} subtitle={STAGES.find((s) => s.id === story.stage)?.hint} onClose={onClose} wide>
      {story.devCheck ? (
        <CheckSummary check={story.devCheck} />
      ) : (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          The developer has not confirmed a manual check yet. You can prepare scenarios, but sign-off waits for them.
        </p>
      )}

      <section className="space-y-1.5">
        <h4 className="text-xs uppercase font-mono text-[#827D8E]">Acceptance criteria</h4>
        <ul className="text-sm text-[#D1D5DB] list-disc ml-5 space-y-0.5">
          {story.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs uppercase font-mono text-[#827D8E]">Scenarios · {scenarios.length}</h4>
          <div className="flex gap-2">
            <button
              disabled={!!busy}
              onClick={() => act('gen', () => devQaApi.generateScenarios(story.id))}
              className="px-3 py-1.5 rounded-lg bg-[#075BFF]/15 text-[#7aa7ff] hover:bg-[#075BFF]/25 text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
            >
              {busy === 'gen' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Draft scenarios with AI
            </button>
            <button
              onClick={() => setAdding((a) => !a)}
              className="px-3 py-1.5 rounded-lg border border-white/[0.1] text-[#B5B1C0] hover:text-white text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" /> Add by hand
            </button>
          </div>
        </div>
        {adding && (
          <div className="space-y-2 p-3 rounded-xl border border-white/[0.08]">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scenario title" className={field} />
            <textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="One step per line" className={field} />
            <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Expected result" className={field} />
            <button
              disabled={title.trim().length < 3 || !!busy}
              onClick={() =>
                act('add', async () => {
                  await devQaApi.addScenario(projectId, {
                    title: title.trim(),
                    issue_id: story.id,
                    steps: steps.split('\n').map((x) => x.trim()).filter(Boolean),
                    expected_result: expected.trim(),
                  });
                  setTitle('');
                  setSteps('');
                  setExpected('');
                  setAdding(false);
                })
              }
              className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
            >
              Save scenario
            </button>
          </div>
        )}
        <ul className="space-y-2">
          {scenarios.map((s) => <ScenarioRow key={s.id} s={s} onChange={onChange} />)}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs uppercase font-mono text-[#827D8E]">QA agent</h4>
          <button
            disabled={agent?.state === 'running' || !!busy}
            onClick={() => act('agent', () => devQaApi.runQaAgent(story.id))}
            className="px-3 py-1.5 rounded-lg bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25 text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            {agent?.state === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
            {agent?.state === 'running' ? agent.step ?? 'Looking…' : 'Ask the QA agent for bugs'}
          </button>
        </div>
        <p className="text-[11px] text-[#827D8E]">
          The agent reads the change and the code and only suggests. Nothing reaches the developer until you file it.
          {agent?.state === 'ready' && ` Last run: ${agent.suggested ?? 0} suggestion(s), ${agent.dropped ?? 0} dropped for citing code that does not exist.`}
        </p>
        {agent?.state === 'failed' && <ErrorText>{agent.error}</ErrorText>}
        {suggestions.map((s) => <SuggestionCard key={s.id} s={s} onChange={onChange} />)}
      </section>

      {story.bugs.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs uppercase font-mono text-[#827D8E]">Bugs</h4>
          {story.bugs.map((b) => (
            <p key={b.id} className="flex items-center gap-2 text-xs text-[#B5B1C0]">
              <span className="font-mono text-[10px] text-[#827D8E]">{b.key}</span>
              <span className="flex-1 truncate">{b.title}</span>
              <PriorityPill p={b.priority} />
              <BugStatePill state={b.state} />
            </p>
          ))}
        </section>
      )}

      {secBlockers.length > 0 && story.stage !== 'signed_off' && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          Security gate closed, so sign-off will be refused: {secBlockers.join('; ')}. Fix and rescan in the Security station.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {story.stage !== 'signed_off' && (
        <div className="flex justify-end pt-2 border-t border-white/[0.06]">
          <button
            disabled={!!busy}
            onClick={() => act('signoff', () => devQaApi.signOff(story.id))}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" /> Sign off {story.key}
          </button>
        </div>
      )}
    </Modal>
  );
};

const VerifyRow: React.FC<{ bug: QaBoard['toVerify'][number]; onChange: () => void }> = ({ bug, onChange }) => {
  const [reopening, setReopening] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verify = async (result: 'pass' | 'fail') => {
    setBusy(true);
    setError(null);
    try {
      await devQaApi.verify(bug.id, result, notes);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`${card} p-4 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-white">
          <span className="font-mono text-[11px] text-[#827D8E] mr-2">{bug.key}</span>
          {bug.title}
          <span className="block text-[11px] text-[#827D8E]">
            on {bug.storyKey} · fixed by {bug.assigneeName ?? '—'}
            {bug.reopenCount ? ` · reopened ${bug.reopenCount}× before` : ''}
          </span>
        </p>
        <PriorityPill p={bug.priority} />
      </div>
      {bug.devCheck && <CheckSummary check={bug.devCheck} />}
      {!reopening ? (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => void verify('pass')}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Verified, it works
          </button>
          <button
            onClick={() => setReopening(true)}
            className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-300 text-xs cursor-pointer hover:bg-rose-500/10"
          >
            Still broken · reopen
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What still fails (required)" className={field} />
          <div className="flex gap-2">
            <button
              disabled={busy || notes.trim().length < 10}
              onClick={() => void verify('fail')}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
            >
              Reopen to developer
            </button>
            <button onClick={() => setReopening(false)} className="px-3 py-1.5 text-xs text-[#827D8E] hover:text-white cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </li>
  );
};

export const QAWorkspace: React.FC<{ projectId: string; projectCode: string }> = ({ projectId, projectCode }) => {
  const [tab, setTab] = useState<Tab>('queue');
  const [board, setBoard] = useState<QaBoard | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [suggestions, setSuggestions] = useState<QaSuggestion[]>([]);
  const [openStory, setOpenStory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [b, sc, sg] = await Promise.all([
        devQaApi.qaBoard(projectId),
        devQaApi.scenarios(projectId),
        devQaApi.suggestions(projectId),
      ]);
      setBoard(b);
      setScenarios(sc);
      setSuggestions(sg);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useChatFrames('workspace_sync', (f) => {
    if (f.scope === 'projects' || f.scope === 'runs') void reload();
  }, [reload]);

  // The QA agent works in the background; poll while it does, in case the socket is down.
  const agentRunning = board?.stories.some((s) => s.qaAgent?.state === 'running');
  useEffect(() => {
    if (!agentRunning) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [agentRunning, reload]);

  const stories = board?.stories ?? [];
  const open = suggestions.filter((s) => s.status === 'open');
  const current = stories.find((s) => s.id === openStory) ?? null;
  const byStage = useMemo(() => Object.fromEntries(STAGES.map((st) => [st.id, stories.filter((s) => s.stage === st.id)])), [stories]);
  const openBugs = (board?.bugs ?? []).filter((b) => b.state !== 'verified' && b.state !== 'wont_fix').length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-emerald-400" /> QA workspace
        </h2>
        <p className="text-xs text-[#827D8E] mt-1">
          Agents draft scenarios and suggest bugs. You decide what is a bug, verify fixes and sign stories off.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ...STAGES.map((st) => ({ label: st.label, value: byStage[st.id]?.length ?? 0 })),
          { label: 'Open bugs', value: openBugs },
        ].map((s) => (
          <div key={s.label} className={`${card} p-3.5`}>
            <p className="text-2xl font-semibold text-white">{s.value}</p>
            <p className="text-[10px] uppercase font-mono text-[#827D8E]">{s.label}</p>
          </div>
        ))}
      </div>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'queue', label: 'Queue', count: stories.length },
          { id: 'suggestions', label: 'Agent suggestions', count: open.length, alert: true },
          { id: 'verify', label: 'Verify fixes', count: board?.toVerify.length ?? 0, alert: true },
          { id: 'bugs', label: 'All bugs', count: board?.bugs.length ?? 0 },
          { id: 'channels', label: 'Channels' },
        ]}
      />

      {error && <ErrorText>{error}</ErrorText>}
      {!board && !error && <p className="text-xs text-[#827D8E]">Loading…</p>}

      {tab === 'queue' && board && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {STAGES.map((st) => (
            <section key={st.id} className="space-y-2">
              <h3 className="text-xs font-semibold text-white flex items-center justify-between">
                {st.label}
                <span className="text-[10px] font-mono text-[#827D8E]">{byStage[st.id]?.length ?? 0}</span>
              </h3>
              {(byStage[st.id] ?? []).length === 0 && <p className="text-[11px] text-[#5f5b6b]">Nothing here.</p>}
              {(byStage[st.id] ?? []).map((s) => {
                const sc = s.scenarios;
                return (
                  <button key={s.id} onClick={() => setOpenStory(s.id)} className={`${card} w-full text-left p-3 space-y-2 hover:border-[#075BFF]/40 cursor-pointer`}>
                    <p className="text-xs text-white">
                      <span className="font-mono text-[10px] text-[#827D8E] mr-1.5">{s.key}</span>
                      {s.title}
                    </p>
                    {sc.total > 0 && (
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex" title={`${sc.passed} passed, ${sc.failed} failed of ${sc.total}`}>
                        <span className="bg-emerald-400" style={{ width: `${(sc.passed / sc.total) * 100}%` }} />
                        <span className="bg-rose-400" style={{ width: `${(sc.failed / sc.total) * 100}%` }} />
                        <span className="bg-amber-400" style={{ width: `${(sc.blocked / sc.total) * 100}%` }} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="text-[#827D8E]">{sc.total ? `${sc.passed}/${sc.total} scenarios` : 'no scenarios'}</span>
                      {s.openSuggestions > 0 && <Pill className="bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30">{s.openSuggestions} to triage</Pill>}
                      {s.bugs.filter((b) => b.state !== 'verified').length > 0 && (
                        <Pill className="bg-rose-500/10 text-rose-300 border-rose-500/30">{s.bugs.filter((b) => b.state !== 'verified').length} bugs</Pill>
                      )}
                      {s.qaAgent?.state === 'running' && <Loader2 className="w-3 h-3 animate-spin text-fuchsia-300" />}
                    </div>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {tab === 'suggestions' && (
        <div className="space-y-3">
          {suggestions.length === 0 && (
            <div className={`${card} p-8 text-center text-sm text-[#827D8E]`}>
              No suggestions. Open a story in the queue and ask the QA agent to look for bugs.
            </div>
          )}
          {suggestions.map((s) => <SuggestionCard key={s.id} s={s} onChange={reload} />)}
        </div>
      )}

      {tab === 'verify' && board && (
        <ul className="space-y-2">
          {board.toVerify.length === 0 && <div className={`${card} p-8 text-center text-sm text-[#827D8E]`}>No fixes waiting for you.</div>}
          {board.toVerify.map((b) => <VerifyRow key={b.id} bug={b} onChange={reload} />)}
        </ul>
      )}

      {tab === 'bugs' && board && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#827D8E] border-b border-white/[0.06]">
                {['Bug', 'Story', 'Priority', 'State', 'Developer', 'Reported by', 'Source'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.bugs.map((b) => (
                <tr key={b.id} className="border-b border-white/[0.04] text-[#B5B1C0]">
                  <td className="px-3 py-2">
                    <span className="font-mono text-[10px] text-[#827D8E] mr-1.5">{b.key}</span>
                    {b.title}
                  </td>
                  <td className="px-3 py-2 font-mono">{b.storyKey ?? '—'}</td>
                  <td className="px-3 py-2"><PriorityPill p={b.priority} /></td>
                  <td className="px-3 py-2"><BugStatePill state={b.state} /></td>
                  <td className="px-3 py-2">{b.assigneeName ?? '—'}</td>
                  <td className="px-3 py-2">{b.reporterName ?? '—'}</td>
                  <td className="px-3 py-2">{b.source}</td>
                </tr>
              ))}
              {board.bugs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-[#827D8E]">No bugs filed.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'channels' && <StationChannels projectId={projectId} projectCode={projectCode} station="qa" stationLabel="QA" />}

      {current && (
        <StoryPanel
          story={current}
          projectId={projectId}
          scenarios={scenarios.filter((s) => s.issueId === current.id)}
          suggestions={suggestions.filter((s) => s.storyId === current.id)}
          onChange={reload}
          onClose={() => setOpenStory(null)}
        />
      )}
    </div>
  );
};
