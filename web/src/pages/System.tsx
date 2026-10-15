import { useGet, type ProviderHealth, type RunnerStatus } from '../api';
import { ErrorBox, Loading, PageHead } from '../components/common';
import { HealthPanel } from '../components/Health';

export default function System() {
  const h = useGet<ProviderHealth>(['health'], '/api/providers/health', 10000);
  const r = useGet<RunnerStatus>(['runner'], '/api/runner/status', 10000);
  return (
    <div className="stack">
      <PageHead eyebrow="System" title="What is actually connected">Live checks, not configuration claims.</PageHead>
      <ErrorBox error={h.error ?? r.error} />
      {h.data && r.data ? <HealthPanel health={h.data} runner={r.data} /> : <Loading />}
    </div>
  );
}
