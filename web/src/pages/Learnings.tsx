import { useGet, usePost, type Learning, type Project } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox } from '../components/common';

export default function Learnings() {
  const { me } = useAuth();
  const { data } = useGet<Learning[]>(['learnings'], '/api/learnings', 5000);
  const projects = useGet<Project[]>(['projects'], '/api/projects');
  const names = Object.fromEntries((projects.data ?? []).map((p) => [p.id, p.name]));
  const verify = usePost<{ id: string; decision: string }>((b) => `/api/learnings/${b.id}/verify?decision=${b.decision}`, [['learnings']]);
  const canVerify = me?.role === 'lead' || me?.role === 'director';
  return (
    <div className="stack">
      <div className="vh">
        <span className="eyebrow">Feedback and learning</span>
        <h2>Learnings</h2>
        <p className="muted">Captured on every merge from the PR and its triaged review. Only verified learnings are offered to the evaluator on the next project.</p>
      </div>
      <ErrorBox error={verify.error} />
      {(data ?? []).map((l) => (
        <div key={l.id} className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <span className="row"><span className={`pill ${l.status === 'verified' ? 'outline ok' : l.status === 'rejected' ? 'solid bad' : 'dash'}`}>{l.status}</span>{l.status === 'verified' ? <Badge kind="human" /> : <Badge kind="ai" />}</span>
            <span className="muted sm">{names[l.project_id] ?? 'project'} · {new Date(l.created_at).toLocaleString()}</span>
          </div>
          <p>{l.text}</p>
          <span className="muted sm mono">
            {typeof l.source.pr_url === 'string' && <>PR {String(l.source.pr_number)} · </>}
            {Array.isArray(l.source.comment_ids) && <>{l.source.comment_ids.length} triaged comments linked</>}
            {l.verified_at && <> · verified {new Date(l.verified_at).toLocaleString()}</>}
          </span>
          {canVerify && l.status === 'unverified' && (
            <div className="row">
              <button className="btn pri sm" onClick={() => verify.mutate({ id: l.id, decision: 'verified' })}>Verify</button>
              <button className="btn sm" onClick={() => verify.mutate({ id: l.id, decision: 'rejected' })}>Reject</button>
            </div>
          )}
        </div>
      ))}
      {data && data.length === 0 && <p className="muted">No learnings yet. Merge a PR to capture the first one.</p>}
    </div>
  );
}
