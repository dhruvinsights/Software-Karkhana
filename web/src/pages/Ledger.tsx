import { LedgerTable, PageHead } from '../components/common';

export default function Ledger() {
  return (
    <div className="stack">
      <PageHead eyebrow="Ledger" title="Evidence ledger">Every decision, run and merge, hash-chained so tampering is detectable.</PageHead>
      <LedgerTable />
    </div>
  );
}
