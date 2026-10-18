import { useCallback, useEffect, useRef, useState } from 'react';
import { GENESIS, LedgerEntry, RecordFn, makeEntry, verifyChain } from './ledger';

const SEEDS: [string, string, string][] = [
  ['PRD_APPROVED', 'Priya N. · Product', 'SIGNED'],
  ['ADR-042', 'Arjun K. · Architect', 'SIGNED'],
  ['PR #118 merged', 'ADK Worker #4 → Meera S.', 'REVIEWED'],
];

/** Page-level hash-chained ledger shared by every landing demo. */
export function useLedger() {
  const [entries, setEntries] = useState<LedgerEntry[]>([GENESIS]);
  const [broken, setBroken] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const last = useRef<LedgerEntry>(GENESIS);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const seeded = useRef(false);

  const record: RecordFn = useCallback((stage, actor, status) => {
    queue.current = queue.current.then(async () => {
      const e = await makeEntry(last.current, stage, actor, status);
      last.current = e;
      setEntries((p) => [...p, e]);
    });
  }, []);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    SEEDS.forEach(([s, a, st]) => record(s, a, st));
  }, [record]);

  const verify = useCallback(async () => {
    setVerifying(true);
    await new Promise((r) => setTimeout(r, 450));
    const idx = await verifyChain(entries);
    setBroken(idx === -1 ? null : idx);
    setVerifying(false);
    return idx;
  }, [entries]);

  /** Edit a past block without re-hashing it; verification then fails on that block. */
  const tamper = useCallback(() => {
    setEntries((p) => {
      if (p.length < 3) return p;
      const i = Math.max(1, p.length - 3);
      return p.map((e, k) => (k === i ? { ...e, status: 'REJECTED' } : e));
    });
    setBroken(null);
  }, []);

  const reset = useCallback(() => {
    last.current = GENESIS;
    queue.current = Promise.resolve();
    setEntries([GENESIS]);
    setBroken(null);
    SEEDS.forEach(([s, a, st]) => record(s, a, st));
  }, [record]);

  return { entries, record, verify, tamper, reset, broken, verifying };
}
