import { Link } from 'react-router-dom';
import { useGet, type PrRow } from '../api';
import { Empty, ErrorBox, Loading, PageHead } from '../components/common';

export default function Reviews() {
  const { data, error } = useGet<PrRow[]>(['prs'], '/api/prs', 5000);
  return (
    <div className="stack">
      <PageHead eyebrow="PR reviews" title="Pull requests from the agent">
        Every comment from the automated review needs your verdict before merge. Clean reviews are recorded too.
      </PageHead>
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <Empty>No pull requests yet. Start a run from My work.</Empty> : (
        <div className="tw">
          <table>
            <thead><tr><th>PR</th><th>Project</th><th>Story</th><th>Status</th><th>Tests</th><th>Review</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">#{p.number}</td>
                  <td>{p.project_name}</td>
                  <td><span className="mono sm muted">{p.task_key}</span> {p.task_title}</td>
                  <td><span className="pill outline">{p.status}</span></td>
                  <td><span className={`pill ${p.tests_passed ? 'ok' : 'bad'}`}>{p.tests_passed ? 'passed' : 'failed'}</span></td>
                  <td>
                    {!p.reviewed ? <span className="pill warn">not reviewed</span>
                      : p.open_comments > 0 ? <span className="pill warn">{p.open_comments} of {p.total_comments} to triage</span>
                        : <span className="pill ok">{p.total_comments === 0 ? 'clean' : 'triaged'}</span>}
                    {p.review_engine && <span className="muted sm mono"> {p.review_engine}</span>}
                  </td>
                  <td><Link className="btn sm" to={`/projects/${p.project_id}?task=${p.task_id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
