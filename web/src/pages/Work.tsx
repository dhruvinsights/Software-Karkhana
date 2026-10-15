import { Link } from 'react-router-dom';
import { useGet, type WorkItem } from '../api';
import { Empty, ErrorBox, Loading, PageHead } from '../components/common';

export default function Work() {
  const { data, error } = useGet<WorkItem[]>(['work'], '/api/work', 5000);
  const groups = new Map<string, WorkItem[]>();
  (data ?? []).forEach((t) => groups.set(t.project_id, [...(groups.get(t.project_id) ?? []), t]));
  return (
    <div className="stack">
      <PageHead eyebrow="My work" title="Stories ready for the agent">
        Approved stories only. Open one to hand it to the Coder agent and follow the run.
      </PageHead>
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <Empty>No approved stories yet. A director has to approve an idea first.</Empty> : (
        [...groups.entries()].map(([pid, items]) => (
          <section key={pid} className="stack" style={{ gap: 10 }}>
            <Link to={`/projects/${pid}`}><h3 style={{ fontSize: 18 }}>{items[0].project_name}</h3></Link>
            <div className="g3">
              {items.map((t) => (
                <Link key={t.id} to={`/projects/${pid}?task=${t.id}`} className="card">
                  <div className="row between"><span className="mono sm muted">{t.key}</span><span className="pill outline">{t.status.replace('_', ' ')}</span></div>
                  <h4 style={{ marginTop: 8 }}>{t.title}</h4>
                  <span className="muted sm">{t.criteria} acceptance criteria</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
