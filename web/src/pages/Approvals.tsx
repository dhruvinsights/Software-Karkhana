import { Link } from 'react-router-dom';
import { useGet, type Project } from '../api';
import { Empty, ErrorBox, Loading, PageHead } from '../components/common';

export default function Approvals() {
  const { data, error } = useGet<Project[]>(['projects'], '/api/projects', 5000);
  const waiting = (data ?? []).filter((p) => p.stage_status === 'evaluated');
  return (
    <div className="stack">
      <PageHead eyebrow="Approvals" title="Decisions waiting for you">
        Each report is validated against the idea text before it reaches you. Your decision is recorded in the ledger.
      </PageHead>
      <ErrorBox error={error} />
      {!data ? <Loading /> : waiting.length === 0 ? <Empty>No evaluated ideas are waiting for a decision.</Empty> : (
        <div className="g3">
          {waiting.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card">
              <span className="lbl">Awaiting your decision</span>
              <h4 style={{ marginTop: 10 }}>{p.name}</h4>
              <p className="muted sm" style={{ marginTop: 4 }}>{p.idea_text.slice(0, 140)}…</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
