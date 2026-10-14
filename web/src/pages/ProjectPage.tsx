import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGet, usePost, type Comment, type ProjectDetail, type PullRequest, type Run, type Task } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, StageTracker } from '../components/common';

const COLUMNS: [string, string][] = [['backlog', 'Backlog'], ['ready', 'Ready'], ['in_progress', 'In progress'], ['review', 'Review'], ['done', 'Done']];

export default function ProjectPage() {
  const { id } = useParams();
  const { data, error } = useGet<ProjectDetail>(['project', id], `/api/projects/${id}`, 3000);
  const [open, setOpen] = useState<Task | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Loading<span className="spin" /></p>;
  const { project, evaluation, tasks, approvals } = data;

  return (
    <div className="stack">
      <div className="vh">
        <span className="eyebrow">{project.stage} / {project.stage_status}</span>
        <h2>{project.name}</h2>
      </div>
      <StageTracker stage={project.stage} />
      {project.stage_status === 'submitted' && !evaluation && <div className="card"><p>Gemini is evaluating this idea<span className="spin" /></p><p className="muted sm">Output is checked against the schema and every epic quote is matched to your text before it appears.</p></div>}

      <div className="g2">
        <div className="card"><span className="lbl">Idea (the only source epics may quote)</span><p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{project.idea_text}</p></div>
        {evaluation && <Scorecard detail={data} />}
      </div>

      {evaluation && <EvaluationView detail={data} />}
      <DirectorGate detail={data} />
      {approvals.map((a) => (
        <div key={a.id} className="card row between">
          <span>Director <b>{a.decision}</b> the {a.gate} gate{a.reason ? `: "${a.reason}"` : ''}</span>
          <span className="row"><Badge kind="human" /><span className="muted sm">{new Date(a.decided_at).toLocaleString()}</span></span>
        </div>
      ))}

      {tasks.length > 0 && <Board tasks={tasks} onOpen={setOpen} />}
      {open && <TaskDrawer task={open} projectId={project.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Scorecard({ detail }: { detail: ProjectDetail }) {
  const ev = detail.evaluation!;
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <span className="lbl">Evaluation v{ev.version}</span>
        <span className="row">{ev.served_from_cache ? <Badge kind="cached" /> : <Badge kind="ai" />}<Badge kind="code" /></span>
      </div>
      <div className="row"><span className="score">{ev.result.score}</span><span className="muted">/ 10 potential</span></div>
      <p>{ev.result.score_rationale}</p>
      <p className="muted sm">Model <span className="mono">{ev.model}</span>. Schema valid, {ev.result.epics.length} epics, every source quote verified against the idea.</p>
    </div>
  );
}

function EvaluationView({ detail }: { detail: ProjectDetail }) {
  const r = detail.evaluation!.result;
  const cites = detail.evaluation!.citations;
  return (
    <>
      <div className="g2">
        <div className="card">
          <div className="row between"><h3>Gaps to answer</h3><Badge kind="assumption" /></div>
          <ul className="t">{r.gaps.map((g, i) => <li key={i}><b>{g.question}</b> <span className="muted">{g.why_it_matters}</span></li>)}</ul>
        </div>
        <div className="card">
          <div className="row between"><h3>Project memory</h3>{cites.length > 0 && <Badge kind="human" />}</div>
          {cites.length === 0 ? <p className="muted">{r.memory_note === 'no relevant memory' ? 'No relevant memory. Nothing verified from earlier projects applies.' : r.memory_note}</p> : cites.map((c) => (
            <div key={c.learning_id} className="cmt" style={{ marginTop: 6 }}>
              <span>{c.text}</span>
              <span className="sm"><b>Applied:</b> {c.how_it_applies}</span>
              <span className="muted sm">From <b>{c.source_project}</b>{c.source_pr_url && <> · <a href={c.source_pr_url.startsWith('local://') ? undefined : c.source_pr_url} target="_blank" rel="noreferrer">PR</a></>} · verified by {c.verified_by} {c.verified_at && `on ${new Date(c.verified_at).toLocaleDateString()}`}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row between"><h3>Epics, traceable to the idea</h3><Badge kind="ai" /></div>
        <div className="g3" style={{ marginTop: 8 }}>
          {r.epics.map((e, i) => (
            <div key={i} className="stack" style={{ gap: 6 }}>
              <h4>{i + 1}. {e.title}</h4>
              <p className="sm">{e.description}</p>
              <p className="quote" title="Verbatim quote from the idea, checked by the server">“{e.source_quote}”</p>
              <ul className="t sm">{e.stories.map((s, j) => <li key={j}>{s.title}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row between"><h3>Director report</h3><span className="pill outline">Recommendation: {r.director_report.recommendation}</span></div>
        <p>{r.director_report.summary}</p>
        <span className="lbl" style={{ display: 'block', marginTop: 10 }}>Key risks</span>
        <ul className="t">{r.director_report.key_risks.map((k, i) => <li key={i}>{k}</li>)}</ul>
        <p style={{ marginTop: 8 }}><b>Decision requested:</b> {r.director_report.decision_requested}</p>
      </div>
    </>
  );
}

function DirectorGate({ detail }: { detail: ProjectDetail }) {
  const { me } = useAuth();
  const [reason, setReason] = useState('');
  const pid = detail.project.id;
  const decide = usePost<'approved' | 'rejected'>(() => `/api/projects/${pid}/approve`, [['project', pid], ['projects']], (d) => ({ decision: d, reason: reason || null }));
  const reeval = usePost<void>(() => `/api/projects/${pid}/evaluate`, [['project', pid]]);
  if (detail.project.stage === 'evaluate' && detail.project.stage_status === 'rejected' && me?.role === 'pm') {
    return <div className="card row between"><span>The director rejected this. Edit nothing or refine scope, then re-evaluate.</span><button className="btn" onClick={() => reeval.mutate()}>Re-evaluate</button></div>;
  }
  if (detail.project.stage_status !== 'evaluated') return null;
  if (me?.role !== 'director') return <div className="card muted">Waiting for a director decision. Only a director can pass this gate; the API refuses anyone else.</div>;
  return (
    <div className="card stack" style={{ borderWidth: 2, borderColor: 'var(--fg)' }}>
      <h3>Approval gate</h3>
      <textarea className="in" style={{ minHeight: 70 }} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="row">
        <button className="btn pri" disabled={decide.isPending} onClick={() => decide.mutate('approved')}>Approve</button>
        <button className="btn" disabled={decide.isPending} onClick={() => decide.mutate('rejected')}>Reject</button>
        <span className="muted sm">Approval moves Draft stories to Ready and is written to the ledger.</span>
      </div>
      <ErrorBox error={decide.error} />
    </div>
  );
}

function Board({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const drafts = tasks.filter((t) => t.status === 'draft');
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}><h3>Task board</h3>{drafts.length > 0 && <span className="pill dash warn">{drafts.length} Draft stories, locked until approval</span>}</div>
      {drafts.length > 0 ? (
        <div className="g3">{drafts.map((t) => <div key={t.id} className="tcard draft"><span className="mono sm muted">{t.key} · Draft</span><b>{t.title}</b></div>)}</div>
      ) : (
        <div className="board">
          {COLUMNS.map(([k, label]) => {
            const items = tasks.filter((t) => t.status === k);
            return (
              <div key={k} className="col"><h4><span>{label}</span><span>{items.length}</span></h4>
                {items.map((t) => (
                  <button key={t.id} className="tcard" onClick={() => onOpen(t)}>
                    <span className="mono sm muted">{t.key}</span><b>{t.title}</b>
                    <span className="muted sm">{t.acceptance_criteria.length} acceptance criteria</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskDrawer({ task, projectId, onClose }: { task: Task; projectId: string; onClose: () => void }) {
  const { me } = useAuth();
  const isDev = me?.role === 'developer' || me?.role === 'lead';
  const runs = useGet<Run[]>(['runs', task.id], `/api/tasks/${task.id}/runs`, 2500);
  const pr = useGet<PullRequest | null>(['pr', task.id], `/api/tasks/${task.id}/pr`, 3000);
  const start = usePost<void, Run>(() => `/api/tasks/${task.id}/runs`, [['runs', task.id], ['project', projectId]]);
  const merge = usePost<string>((id) => `/api/prs/${id}/merge`, [['pr', task.id], ['project', projectId], ['learnings']]);
  const latest = runs.data?.[0];
  const running = latest && (latest.status === 'running' || latest.status === 'queued');
  const project = useGet<ProjectDetail>(['project', projectId], `/api/projects/${projectId}`);
  const current = project.data?.tasks.find((t) => t.id === task.id) ?? task;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Task">
        <div className="row between"><span className="mono muted">{current.key} · {current.status}</span><button className="btn sm" onClick={onClose}>Close</button></div>
        <h3 style={{ fontSize: 22 }}>{current.title}</h3>
        <div><span className="lbl">Acceptance criteria</span><ul className="t">{current.acceptance_criteria.map((c, i) => <li key={i}>{c}</li>)}</ul></div>

        {isDev && current.status === 'ready' && (
          <button className="btn pri" disabled={start.isPending} onClick={() => start.mutate()}>Assign to agent</button>
        )}
        <ErrorBox error={start.error} />

        {latest && (
          <div className="card stack" style={{ gap: 8 }}>
            <div className="row between"><h4>Agent run</h4><span className="row" style={{ gap: 6 }}>
              <span className="pill outline" title="Did the worker finish?">Worker: {latest.status}{running && latest.phase ? ` · ${latest.phase}` : ''}</span>
              {latest.validation_status !== 'not_run' && (
                <span className={`pill ${latest.validation_status === 'passed' ? 'outline ok' : 'solid bad'}`} title="Did the tests pass?">
                  Validation: {latest.validation_status}
                </span>
              )}
            </span></div>
            {latest.validation_status === 'failed' && (
              <div className="err">Tests failed. The worker finished, but this implementation is not accepted: the PR is a draft and merge is blocked.</div>
            )}
            {running && <p className="muted sm">Coder agent (Google ADK) is working on <span className="mono">{latest.backend}</span><span className="spin" /></p>}
            {latest.test_exit_code !== null && (
              <div className="row">
                <span className={`pill ${latest.test_exit_code === 0 ? 'outline ok' : 'solid bad'}`}>tests exit {latest.test_exit_code}</span>
                <Badge kind="code" /><span className="mono sm muted">{latest.test_command}</span>
              </div>
            )}
            {latest.test_output && <pre className="code">{latest.test_output.slice(-1200)}</pre>}
            {latest.error && <div className="err">{latest.error}</div>}
          </div>
        )}

        {pr.data && <PrPanel pr={pr.data} taskId={task.id} canAct={isDev} onMerge={() => merge.mutate(pr.data!.id)} merging={merge.isPending} />}
        <ErrorBox error={merge.error} />
        {merge.isSuccess && <div className="card"><b>Merged.</b> A learning was captured as unverified. A lead can verify it on the Learnings page.</div>}
      </aside>
    </>
  );
}

function PrPanel({ pr, taskId, canAct, onMerge, merging }: { pr: PullRequest; taskId: string; canAct: boolean; onMerge: () => void; merging: boolean }) {
  const real = !pr.url.startsWith('local://');
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <h4>Pull request #{pr.number}</h4>
        {real ? <a className="btn sm" href={pr.url} target="_blank" rel="noreferrer">Open on GitHub</a> : <span className="pill dash">local branch (no GitHub configured)</span>}
      </div>
      <div className="row"><span className="pill outline">{pr.status}</span><span className={`pill ${pr.tests_passed ? 'outline ok' : 'solid bad'}`}>tests {pr.tests_passed ? 'passed' : 'failed'}</span><span className="mono sm muted">{pr.branch}</span></div>
      <div className="row between"><span className="lbl">AI review comments</span><Badge kind="ai" /></div>
      {pr.comments.length === 0 && pr.status === 'open' && <RetryReview prId={pr.id} taskId={taskId} canAct={canAct} />}
      {pr.comments.map((c) => <TriageCard key={c.id} c={c} taskId={taskId} canAct={canAct && pr.status === 'open'} />)}
      {pr.status === 'open' && (
        <>
          {pr.merge_blockers.map((b) => <div key={b} className="chk"><span className="pill dash warn">blocked</span>{b}</div>)}
          <button className="btn pri" disabled={!canAct || !pr.can_merge || merging} onClick={onMerge}>
            {merging ? 'Merging' : 'Merge pull request'}
          </button>
        </>
      )}
    </div>
  );
}

function TriageCard({ c, taskId, canAct }: { c: Comment; taskId: string; canAct: boolean }) {
  const [reason, setReason] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const triage = usePost<{ triage: string; reason?: string }>(() => `/api/comments/${c.id}/triage`, [['pr', taskId]], (b) => b);
  return (
    <div className={`cmt ${c.triage}`}>
      <div className="row between"><span className="mono sm">{c.path}{c.line ? `:${c.line}` : ''}</span><span className={`pill ${c.severity === 'high' ? 'solid' : c.severity === 'medium' ? 'dash' : 'mut'}`}>{c.severity}</span></div>
      <span>{c.body}</span>
      {c.triage !== 'open' && <span className="muted sm">Triaged: <b>{c.triage}</b>{c.triage_reason ? ` (${c.triage_reason})` : ''}</span>}
      {canAct && (
        <div className="row">
          <button className="btn sm" disabled={triage.isPending} onClick={() => triage.mutate({ triage: 'valid' })}>Valid</button>
          {!dismissing ? <button className="btn sm" onClick={() => setDismissing(true)}>Dismiss</button> : (
            <>
              <input className="in" style={{ flex: 1, minWidth: 160, width: 'auto' }} placeholder="Why is it not valid?" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn sm" disabled={!reason.trim() || triage.isPending} onClick={() => triage.mutate({ triage: 'dismissed', reason })}>Dismiss</button>
            </>
          )}
        </div>
      )}
      <ErrorBox error={triage.error} />
    </div>
  );
}

function RetryReview({ prId, taskId, canAct }: { prId: string; taskId: string; canAct: boolean }) {
  const retry = usePost<void>(() => `/api/prs/${prId}/review`, [['pr', taskId]]);
  return (
    <div className="cmt">
      <span>The AI review did not complete, so merge is blocked.</span>
      {canAct && <button className="btn sm" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? 'Reviewing' : 'Retry AI review'}</button>}
      <ErrorBox error={retry.error} />
    </div>
  );
}
