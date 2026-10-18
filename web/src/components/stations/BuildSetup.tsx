/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Before a build starts, the developer decides two things:
 *   what the coding agent is given (which criteria and notes, where to start, their own
 *   instruction), and where the build stops to ask them (after the code, before each test
 *   suite, before a failing test is sent back).
 * Nothing is sent that is not shown here, with a rough size.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import { BriefPreview, devQaApi, RunSteering } from '../../lib/devQaApi';
import { ErrorText, field, Modal } from './StationKit';

type Mode = 'step' | 'custom' | 'auto';
type Pause = 'after_code' | 'before_tests' | 'fix';

const MODE_KEY = 'karkhana.build.mode';
const PAUSES_KEY = 'karkhana.build.pauses';

function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const MODES: { id: Mode; title: string; hint: string }[] = [
  { id: 'step', title: 'Ask me at every step', hint: 'It stops after the code, before each test suite and before a failing test is fixed. You decide each time.' },
  { id: 'custom', title: 'Only where I choose', hint: 'Pick the stops below.' },
  { id: 'auto', title: 'Run on its own', hint: 'Code, test, fix. Nothing is pushed: you still raise the pull request.' },
];

export const BuildSetupModal: React.FC<{
  taskId: string;
  storyKey: string;
  /** "Continue" when the next build picks up work already in the folder. */
  continuing: boolean;
  onClose: () => void;
  onStart: (steering: RunSteering) => Promise<void>;
}> = ({ taskId, storyKey, continuing, onClose, onStart }) => {
  const [data, setData] = useState<BriefPreview | null>(null);
  const [tab, setTab] = useState<'brief' | 'control'>('brief');
  const [criteria, setCriteria] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState('');
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<Mode>(remembered<Mode>(MODE_KEY, 'step'));
  const [pauses, setPauses] = useState<Set<Pause>>(new Set(remembered<Pause[]>(PAUSES_KEY, ['after_code', 'before_tests', 'fix'])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    devQaApi
      .briefPreview(taskId)
      .then((d) => {
        setData(d);
        setCriteria(new Set(d.criteria.map((c) => c.index)));
        setNotes(new Set(d.notes.map((n) => n.id)));
      })
      .catch((e) => setError((e as Error).message));
  }, [taskId]);

  const tokens = useMemo(() => {
    if (!data) return 0;
    const chars =
      data.story.title.length + data.story.description.length +
      data.criteria.filter((c) => criteria.has(c.index)).reduce((n, c) => n + c.chars, 0) +
      data.notes.filter((n) => notes.has(n.id)).reduce((n, x) => n + x.chars, 0) +
      focus.length + instruction.length + (data.rework?.length ?? 0);
    return Math.round(chars / 4) + 450; // the standing rules and instructions
  }, [data, criteria, notes, focus, instruction]);

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  const start = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(MODE_KEY, JSON.stringify(mode));
      localStorage.setItem(PAUSES_KEY, JSON.stringify([...pauses]));
    } catch {
      /* the choice just is not remembered */
    }
    const all = (n: number, total: number) => n === total;
    try {
      await onStart({
        control: { mode, ...(mode === 'custom' ? { pauses: [...pauses] } : {}) },
        brief: {
          criteria: all(criteria.size, data.criteria.length) ? null : [...criteria].sort((a, b) => a - b),
          notes: all(notes.size, data.notes.length) ? null : [...notes],
          focus: focus.split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
          instruction: instruction.trim(),
        },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${continuing ? 'Continue' : 'Build'} ${storyKey}`}
      subtitle="You decide what the agent is given and where it stops to ask you."
      onClose={onClose}
      wide
    >
      <div className="flex gap-1 p-1 bg-[#07070B] rounded-xl border border-white/[0.08] w-fit" role="tablist">
        {([['brief', 'What the AI gets'], ['control', 'When to ask me']] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${tab === id ? 'bg-[#075BFF] text-white' : 'text-[#827D8E] hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!data && !error && <p className="text-xs text-[#827D8E] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Gathering what the agent could be told…</p>}

      {data && tab === 'brief' && (
        <div className="space-y-4">
          {continuing && (
            <p className="text-[11px] text-[#7aa7ff] bg-[#075BFF]/10 border border-[#075BFF]/30 rounded-lg px-3 py-2">
              This continues the work already in your folder. The tests run first; the agent is only called if they fail or you give an instruction.
            </p>
          )}
          {data.rework && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-300">A reviewer asked for this on the previous pull request. It is always included.</p>
              <p className="text-xs text-[#D1D5DB] mt-1 whitespace-pre-wrap">{data.rework}</p>
            </div>
          )}
          <section className="space-y-1.5">
            <h4 className="text-xs uppercase font-mono text-[#827D8E]">Acceptance criteria · {criteria.size}/{data.criteria.length}</h4>
            {data.criteria.map((c) => (
              <label key={c.index} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-white/[0.03] cursor-pointer">
                <input type="checkbox" checked={criteria.has(c.index)} onChange={() => toggle(criteria, c.index, setCriteria)} className="mt-0.5" />
                <span className="text-xs text-[#D1D5DB]">{c.text}</span>
              </label>
            ))}
          </section>
          <section className="space-y-1.5">
            <h4 className="text-xs uppercase font-mono text-[#827D8E]">Shared notes · {notes.size}/{data.notes.length}</h4>
            {data.notes.length === 0 && <p className="text-[11px] text-[#5f5b6b]">No shared notes yet.</p>}
            {data.notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-white/[0.06]">
                <div className="flex items-center gap-2.5 p-2">
                  <input type="checkbox" checked={notes.has(n.id)} onChange={() => toggle(notes, n.id, setNotes)} aria-label={`Include ${n.title}`} />
                  <button onClick={() => setOpen(open === n.id ? null : n.id)} className="flex-1 flex items-center gap-1.5 text-left text-xs text-[#D1D5DB] cursor-pointer">
                    {open === n.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span className="font-mono text-[10px] uppercase px-1.5 rounded bg-white/[0.06] text-[#B5B1C0]">{n.kind}</span>
                    <span className="truncate">{n.title}</span>
                    <span className="ml-auto text-[10px] text-[#827D8E] shrink-0">{n.author} · {n.chars.toLocaleString()} chars</span>
                  </button>
                </div>
                {open === n.id && <pre className="px-3 pb-3 text-[11px] text-[#B5B1C0] whitespace-pre-wrap font-sans select-text">{n.body}{n.chars > n.body.length ? '\n…' : ''}</pre>}
              </div>
            ))}
          </section>
          <section className="space-y-1.5">
            <label className="text-xs uppercase font-mono text-[#827D8E] block" htmlFor="focus">Start from these files or folders (optional)</label>
            <textarea id="focus" rows={2} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={'backend/app/models/\nbackend/tests/test_domain.py'} className={`${field} font-mono`} />
          </section>
          <section className="space-y-1.5">
            <label className="text-xs uppercase font-mono text-[#827D8E] block" htmlFor="instr">Your instruction (optional)</label>
            <textarea id="instr" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Keep it in one module. Do not touch the seed data. Use pydantic v2 only." className={field} />
          </section>
          <p className="text-[11px] text-[#827D8E]">
            About <span className="text-white font-mono">{tokens.toLocaleString()}</span> tokens go to the agent. The exact prompt is written to the run log.
          </p>
        </div>
      )}

      {data && tab === 'control' && (
        <div className="space-y-2" role="radiogroup" aria-label="When to ask me">
          {MODES.map((m) => (
            <label key={m.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === m.id ? 'border-[#075BFF]/60 bg-[#075BFF]/10' : 'border-white/[0.08] hover:bg-white/[0.03]'}`}>
              <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1" />
              <span>
                <span className="block text-sm text-white">{m.title}</span>
                <span className="block text-[11px] text-[#827D8E]">{m.hint}</span>
              </span>
            </label>
          ))}
          {mode === 'custom' && (
            <div className="pl-3 space-y-1">
              {data.pauses.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 text-xs text-[#D1D5DB] cursor-pointer">
                  <input type="checkbox" checked={pauses.has(p.id)} onChange={() => toggle(pauses, p.id as Pause, setPauses)} /> {p.label}
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[#5f5b6b]">Whatever you choose, nothing is pushed or raised until you do it yourself.</p>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11px] text-[#827D8E]">
          {mode === 'auto' ? 'Runs on its own' : mode === 'step' ? 'Asks you at every step' : `Asks you at ${pauses.size} place${pauses.size === 1 ? '' : 's'}`}
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-[#827D8E] hover:text-white cursor-pointer">Cancel</button>
          <button
            onClick={() => void start()}
            disabled={busy || !data || criteria.size === 0}
            className="px-4 py-2 rounded-xl bg-[#075BFF] hover:bg-[#1a6bff] text-white text-xs font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {continuing ? 'Continue on my machine' : 'Start on my machine'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
