import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePost, useGet, type Project } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Loading, PageHead, STATUS_HINT } from '../components/common';

export default function Ideas() {
  const { me } = useAuth();
  const { data, error } = useGet<Project[]>(['projects'], '/api/projects', 5000);
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const create = usePost<void, Project>(() => '/api/projects', [['projects']], () => ({ name, idea_text: idea }));
  const isPm = me?.role === 'pm';
  return (
    <div className="stack">
      <PageHead eyebrow="Ideas" title={isPm ? 'Write the idea once' : 'All ideas'}>
        {isPm ? 'The model scores it, lists gaps, drafts epics traceable to your words and writes the director report.' : 'Every submitted idea and where it stands.'}
      </PageHead>
      {isPm && (
        <div className="card stack">
          <h3>New idea</h3>
          <label className="f"><span className="lbl">Project name</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice discount codes" /></label>
          <label className="f"><span className="lbl">The idea, in plain words</span><textarea className="in" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="What problem, for whom, what must be true…" /></label>
          <div className="row between">
            <span className="muted sm">{idea.length} characters (minimum 40)</span>
            <button className="btn pri" disabled={create.isPending || name.length < 3 || idea.length < 40}
              onClick={() => create.mutate(undefined, { onSuccess: (p) => nav(`/projects/${p.id}`) })}>
              {create.isPending ? 'Submitting…' : 'Submit for evaluation'}
            </button>
          </div>
          <ErrorBox error={create.error} />
        </div>
      )}
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <Empty>No ideas yet.</Empty> : (
        <div className="g3">
          {data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card">
              <div className="row between"><span className="lbl">{p.stage}</span><span className="pill outline">{STATUS_HINT[p.stage_status] ?? p.stage_status}</span></div>
              <h4 style={{ marginTop: 10 }}>{p.name}</h4>
              <p className="muted sm" style={{ marginTop: 4 }}>{p.idea_text.slice(0, 140)}{p.idea_text.length > 140 ? '…' : ''}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
