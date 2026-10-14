import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePost, useGet, type Project } from '../api';
import { useAuth } from '../auth';
import { ErrorBox } from '../components/common';

const STATUS_HINT: Record<string, string> = {
  submitted: 'Evaluating', evaluated: 'Awaiting director', rejected: 'Rejected', ready: 'Approved, board ready',
  running: 'Agent running', failed: 'Run failed', open: 'PR open', triage: 'Review triage', pending: 'Merged, QA pending',
};

export default function Projects() {
  const { me } = useAuth();
  const { data, error } = useGet<Project[]>(['projects'], '/api/projects', 5000);
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const create = usePost<void, Project>(() => '/api/projects', [['projects']], () => ({ name, idea_text: idea }));
  const awaiting = (data ?? []).filter((p) => p.stage_status === 'evaluated');

  return (
    <div className="stack">
      <div className="vh">
        <span className="eyebrow">{me?.role === 'pm' ? 'Initiate and evaluate' : 'Projects'}</span>
        <h2>{me?.role === 'pm' ? 'Write the idea once' : me?.role === 'director' ? 'Decisions waiting for you' : 'Projects'}</h2>
        <p className="muted">
          {me?.role === 'pm' && 'Gemini scores it, lists gaps, drafts epics traceable to your words, and writes the director report.'}
          {me?.role === 'director' && 'Each report is validated against the idea text before it reaches you. Your decision is recorded in the ledger.'}
          {(me?.role === 'developer' || me?.role === 'lead') && 'Open an approved project to see its board and hand a Ready story to the Coder agent.'}
        </p>
      </div>

      {me?.role === 'pm' && (
        <div className="card stack">
          <h3>New idea</h3>
          <label className="f"><span className="lbl">Project name</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice discount codes" /></label>
          <label className="f"><span className="lbl">The idea, in plain words</span><textarea className="in" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="What problem, for whom, what must be true..." /></label>
          <div className="row between">
            <span className="muted sm">{idea.length} characters (minimum 40)</span>
            <button className="btn pri" disabled={create.isPending || name.length < 3 || idea.length < 40}
              onClick={() => create.mutate(undefined, { onSuccess: (p) => nav(`/projects/${p.id}`) })}>
              {create.isPending ? 'Submitting' : 'Submit for evaluation'}
            </button>
          </div>
          <ErrorBox error={create.error} />
        </div>
      )}

      {me?.role === 'director' && awaiting.length > 0 && (
        <div className="card"><h3>Awaiting your approval ({awaiting.length})</h3>
          <ul className="t">{awaiting.map((p) => <li key={p.id}><Link to={`/projects/${p.id}`}>{p.name}</Link></li>)}</ul>
        </div>
      )}

      <ErrorBox error={error} />
      <div className="g3">
        {(data ?? []).map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ textDecoration: 'none' }}>
            <div className="row between"><span className="lbl">{p.stage}</span><span className="pill outline">{STATUS_HINT[p.stage_status] ?? p.stage_status}</span></div>
            <h4 style={{ marginTop: 8 }}>{p.name}</h4>
            <p className="muted sm" style={{ marginTop: 4 }}>{p.idea_text.slice(0, 140)}…</p>
          </Link>
        ))}
        {data && data.length === 0 && <p className="muted">No projects yet.</p>}
      </div>
    </div>
  );
}
