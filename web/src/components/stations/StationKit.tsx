/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Small pieces the Developer and QA stations share.
 */

import React, { useState } from 'react';
import { CheckCircle2, Circle, Loader2, X, XCircle } from 'lucide-react';
import { BUG_STATE_STYLE, BugState, ManualCheck, TestSuite } from '../../lib/devQaApi';

export const card = 'rounded-2xl border border-white/[0.08] bg-[#0C0D14]/80';
export const field =
  'w-full px-3 py-2.5 bg-[#07070B] border border-white/[0.1] rounded-xl text-sm text-white placeholder-[#5f5b6b] focus:outline-none focus:border-[#075BFF] focus:ring-2 focus:ring-[#075BFF]/20';

export const Pill: React.FC<{ className?: string; children: React.ReactNode; title?: string }> = ({ className = '', children, title }) => (
  <span title={title} className={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase whitespace-nowrap ${className}`}>
    {children}
  </span>
);

export const BugStatePill: React.FC<{ state: BugState }> = ({ state }) => {
  const s = BUG_STATE_STYLE[state];
  return <Pill className={s.cls}>{s.label}</Pill>;
};

export const PriorityPill: React.FC<{ p: string }> = ({ p }) => (
  <Pill
    className={
      p === 'P0'
        ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
        : p === 'P1'
          ? 'bg-orange-500/10 text-orange-300 border-orange-500/30'
          : 'bg-white/5 text-[#B5B1C0] border-white/10'
    }
  >
    {p}
  </Pill>
);

export const ErrorText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="text-[11px] text-rose-300">
    {children}
  </p>
);

/** One bar per suite: passed (green) and failed (red) out of the total, or a running shimmer. */
export const SuiteBars: React.FC<{ suites: TestSuite[]; compact?: boolean }> = ({ suites, compact }) => {
  if (suites.length === 0) return null;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {suites.map((s) => {
        const total = s.total ?? 0;
        const pass = total ? ((s.passed ?? 0) / total) * 100 : s.status === 'passed' ? 100 : 0;
        const fail = total ? ((s.failed ?? 0) / total) * 100 : s.status === 'failed' ? 100 : 0;
        const label = s.suite === 'tests' ? 'Tests' : s.suite.charAt(0).toUpperCase() + s.suite.slice(1);
        return (
          <div key={s.suite} className="space-y-1" title={s.command}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-[#B5B1C0]">
                {s.status === 'running' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#7aa7ff]" />
                ) : s.status === 'passed' ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <XCircle className="w-3 h-3 text-rose-400" />
                )}
                {label} tests
              </span>
              <span className="font-mono text-[#827D8E]">
                {s.status === 'running'
                  ? 'running…'
                  : total
                    ? `${s.passed ?? 0}/${total} passed${s.failed ? ` · ${s.failed} failed` : ''}`
                    : s.status}
                {s.durationMs ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : ''}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
              {s.status === 'running' ? (
                <span className="w-1/3 bg-[#075BFF]/70 animate-pulse rounded-full" />
              ) : (
                <>
                  <span className="bg-emerald-400" style={{ width: `${pass}%` }} />
                  <span className="bg-rose-400" style={{ width: `${fail}%` }} />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** A step of a pipeline: done, current, blocked or waiting. */
export type StepState = 'done' | 'current' | 'blocked' | 'waiting';

export const Pipeline: React.FC<{ steps: { label: string; state: StepState; hint?: string }[] }> = ({ steps }) => (
  <ol className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Progress">
    {steps.map((s, i) => (
      <li key={s.label} className="flex items-center gap-1 shrink-0" title={s.hint}>
        <span
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium border ${
            s.state === 'done'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
              : s.state === 'current'
                ? 'bg-[#075BFF]/15 text-white border-[#075BFF]/50'
                : s.state === 'blocked'
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  : 'text-[#5f5b6b] border-white/[0.06]'
          }`}
        >
          {s.state === 'done' ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : s.state === 'current' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : s.state === 'blocked' ? (
            <XCircle className="w-3 h-3" />
          ) : (
            <Circle className="w-3 h-3" />
          )}
          {s.label}
        </span>
        {i < steps.length - 1 && <span className="w-3 h-px bg-white/10" />}
      </li>
    ))}
  </ol>
);

export const Modal: React.FC<{ title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({
  title,
  subtitle,
  onClose,
  children,
  wide,
}) => (
  <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-[#0C0D14] border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-[#827D8E] mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 text-[#827D8E] hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

/**
 * The developer's manual check: tick each acceptance criterion after trying it
 * by hand and say what was tried. Agents only suggest; this is the confirmation.
 */
export const ManualCheckModal: React.FC<{
  title: string;
  criteria: string[];
  intro: string;
  submitLabel: string;
  onSubmit: (criteria: { text: string; ok: boolean }[], notes: string) => Promise<void>;
  onClose: () => void;
}> = ({ title, criteria, intro, submitLabel, onSubmit, onClose }) => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = criteria.every((c) => ticked[c]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        criteria.map((c) => ({ text: c, ok: !!ticked[c] })),
        notes,
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} subtitle={intro} onClose={onClose}>
      {criteria.length > 0 && (
        <ul className="space-y-1.5">
          {criteria.map((c) => (
            <li key={c}>
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.03] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!ticked[c]}
                  onChange={(e) => setTicked((t) => ({ ...t, [c]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span className="text-sm text-[#D1D5DB]">{c}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className="block text-xs font-semibold text-[#B5B1C0] mb-1.5">What did you try by hand?</label>
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Called POST /discounts with -10 on my machine; got 400 with the right message."
          className={field}
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-xs text-[#827D8E] hover:text-white cursor-pointer">
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !all || notes.trim().length < 10}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} {submitLabel}
        </button>
      </div>
    </Modal>
  );
};

export const CheckSummary: React.FC<{ check: ManualCheck }> = ({ check }) => (
  <div className="text-[11px] text-emerald-300/90 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg px-3 py-2">
    <span className="font-semibold">Checked by hand</span> by {check.byName} · {new Date(check.at).toLocaleString()}
    <p className="text-[#B5B1C0] mt-0.5">{check.notes}</p>
  </div>
);

export const SubTabs = <T extends string,>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number; alert?: boolean }[];
  value: T;
  onChange: (t: T) => void;
}) => (
  <div className="flex gap-1 p-1 bg-[#07070B] rounded-xl border border-white/[0.08] overflow-x-auto" role="tablist">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={value === t.id}
        onClick={() => onChange(t.id)}
        className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
          value === t.id ? 'bg-[#075BFF] text-white' : 'text-[#827D8E] hover:text-white'
        }`}
      >
        {t.label}
        {t.count !== undefined && (
          <span
            className={`px-1.5 rounded-full text-[10px] ${
              t.alert && t.count > 0 ? 'bg-rose-500 text-white' : value === t.id ? 'bg-white/20' : 'bg-white/[0.08]'
            }`}
          >
            {t.count}
          </span>
        )}
      </button>
    ))}
  </div>
);
