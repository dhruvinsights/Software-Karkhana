// A build that stops and asks the developer. The agent opens a question on the
// server (shown on the story with its options), polls for the answer, and carries on
// as told. Only the places the developer chose to pause at ask anything.
import { setTimeout as sleep } from 'node:timers/promises';

export class Stopped extends Error {
  constructor(where) {
    super(`Stopped by the developer at ${where}.`);
    this.name = 'Stopped';
  }
}

const TERMINAL = new Set(['failed', 'cancelled', 'timed_out', 'succeeded']);

/**
 * @param {object} p
 * @param {object} p.runApi      { gate(g), gateState() }
 * @param {object} [p.control]   { pauses: ['after_code', ...] } from the run
 * @param {AbortSignal} [p.signal]
 * @param {Function} p.log
 * @param {number} [p.pollMs]
 * @returns {(key: string, summary: string, options: object[], name?: string) => Promise<{action: string, note: string}>}
 */
export function makeGate({ runApi, control, signal, log, pollMs = 3000 }) {
  const pauses = new Set(control?.pauses ?? []);
  return async function pause(key, summary, options, name = key) {
    if (!pauses.has(key)) return { action: 'go', note: '' };
    await runApi.gate({ name, summary, options });
    log('info', `Waiting for your decision (${name}): ${summary}`);
    for (;;) {
      if (signal?.aborted) return { action: 'stop', note: '' };
      await sleep(pollMs);
      let state;
      try {
        state = await runApi.gateState();
      } catch {
        continue; // a lost poll is simply asked again
      }
      if (state?.status && TERMINAL.has(state.status)) return { action: 'stop', note: '' };
      const d = state?.gate?.decision;
      if (d) {
        await runApi.gate({ clear: true }).catch(() => {});
        log('info', `You chose: ${d.action}${d.note ? ` — ${d.note}` : ''}`);
        return { action: d.action, note: d.note ?? '' };
      }
    }
  };
}

export const GO = { id: 'go', label: 'Go on' };
