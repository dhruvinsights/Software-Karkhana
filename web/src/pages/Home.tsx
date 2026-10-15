import { Link } from 'react-router-dom';
import { useGet, type Dashboard } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Loading, PageHead, STATUS_HINT } from '../components/common';

const COPY: Record<string, string> = {
  pm: 'Your ideas, where each one stands, and the ones that need another pass.',
  director: 'What is waiting for your decision and how delivery is moving.',
  developer: 'Stories the agent can pick up and AI review comments that need your verdict.',
  lead: 'Delivery health, review load and learnings waiting for verification.',
};

export default function Home() {
  const { me } = useAuth();
  const { data, error } = useGet<Dashboard>(['dashboard', me?.id], '/api/dashboard', 5000);
  return (
    <div className="stack">
      <PageHead eyebrow="Overview" title={data ? `Hello, ${data.user.split(' ')[0]}` : 'Overview'}>{me && COPY[me.role]}</PageHead>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="g3">
            {data.stats.map((s) => (
              <div key={s.label} className="stat"><b>{s.value}</b><span>{s.label}</span>{s.hint && <span className="sm">{s.hint}</span>}</div>
            ))}
          </div>
          {Object.entries(data.queues).map(([title, items]) => (
            <section key={title} className="stack" style={{ gap: 12 }}>
              <h3 style={{ fontSize: 18 }}>{title}</h3>
              {items.length === 0 ? <Empty>Nothing here right now.</Empty> : (
                <div className="g3">
                  {items.map((it) => (
                    <Link key={it.id} to={`/projects/${it.project_id ?? it.id}`} className="card">
                      <div className="row between"><span className="lbl">{it.stage}</span><span className="pill outline">{STATUS_HINT[it.status] ?? it.status}</span></div>
                      <h4 style={{ marginTop: 10 }}>{it.name}</h4>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
