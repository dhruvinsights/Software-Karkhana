import { Link } from 'react-router-dom';
import { useGet } from '../api';

interface Row {
  id: string; name: string; stage: string; stage_status: string; merged_prs: number; runs: number;
  tasks: Record<string, number>; production_ready: boolean;
  gates: { stage: string; name: string; gate: string; wired: boolean; state: string }[];
}

const STATE: Record<string, string> = { passed: 'pill outline ok', current: 'pill solid', pending: 'pill dash warn', rejected: 'pill solid bad', planned: 'pill mut' };

export default function Portfolio() {
  const { data } = useGet<Row[]>(['portfolio'], '/api/portfolio', 5000);
  return (
    <div className="stack">
      <div className="vh">
        <span className="eyebrow">Gates and portfolio</span>
        <h2>Where every project stands</h2>
        <p className="muted">Computed from the records, not typed by anyone. Nothing here claims production readiness: QA, security and release gates stay pending until their teams sign off.</p>
      </div>
      {(data ?? []).map((p) => (
        <div key={p.id} className="card stack" style={{ gap: 10 }}>
          <div className="row between">
            <Link to={`/projects/${p.id}`}><h3 style={{ margin: 0 }}>{p.name}</h3></Link>
            <span className="row"><span className="pill outline">{p.stage} / {p.stage_status}</span><span className="pill dash">Not production-ready</span></span>
          </div>
          <span className="muted sm">{Object.entries(p.tasks).map(([k, v]) => `${v} ${k}`).join(' · ') || 'no tasks'} · {p.runs} agent runs · {p.merged_prs} merged PRs</span>
          <div className="row" style={{ gap: 6 }}>
            {p.gates.filter((g) => g.wired || ['qa', 'security', 'cicd', 'release'].includes(g.stage)).map((g) => (
              <span key={g.stage} className={STATE[g.state]} title={g.gate}>{g.name.split(' ')[0]}: {g.state}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
