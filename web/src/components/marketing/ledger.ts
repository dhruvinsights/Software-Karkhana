/**
 * Tiny SHA-256 hash chain for the landing-page demos.
 * Every interaction (approve a gate, file a bug, sign an ADR) appends a block whose hash
 * covers the previous block, so "Verify chain" on the page genuinely re-computes the links.
 */

export interface LedgerEntry {
  seq: number;
  stage: string;
  actor: string;
  status: string;
  prev: string;
  hash: string;
}

export type RecordFn = (stage: string, actor: string, status: string) => void;

export const GENESIS: LedgerEntry = {
  seq: 841,
  stage: 'GENESIS',
  actor: 'ledger',
  status: 'ANCHORED',
  prev: '',
  hash: '0'.repeat(64),
};

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
};

export async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    /* fall through to the non-crypto fallback */
  }
  return fnv(input);
}

const payload = (prev: string, seq: number, stage: string, actor: string, status: string) =>
  `${prev}|${seq}|${stage}|${actor}|${status}`;

export async function makeEntry(
  prev: LedgerEntry,
  stage: string,
  actor: string,
  status: string,
): Promise<LedgerEntry> {
  const seq = prev.seq + 1;
  const hash = await sha256Hex(payload(prev.hash, seq, stage, actor, status));
  return { seq, stage, actor, status, prev: prev.hash, hash };
}

/** Re-computes every link. Returns the index of the first broken block, or -1 when intact. */
export async function verifyChain(entries: LedgerEntry[]): Promise<number> {
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.prev !== entries[i - 1].hash) return i;
    const expected = await sha256Hex(payload(e.prev, e.seq, e.stage, e.actor, e.status));
    if (expected !== e.hash) return i;
  }
  return -1;
}

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
