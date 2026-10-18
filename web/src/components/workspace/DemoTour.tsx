import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock, PlayCircle, X } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import {
  TOUR_MINUTES,
  TOUR_STEPS,
  loadTour,
  saveTour,
  type TourProgress,
} from '../../lib/demoTour';

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 6;
const CARD_W = 340;

/** Finds the highlighted element, waiting briefly for a screen that is still loading. */
function useTargetRect(target: string | undefined, depKey: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const frame = useRef(0);
  const measure = useCallback(() => {
    const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { setRect(null); return; }
    // The shell uses CSS zoom; getBoundingClientRect is already in viewport pixels on all engines we support.
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [target]);

  useLayoutEffect(() => {
    document.querySelector<HTMLElement>(`[data-tour="${target}"]`)?.scrollIntoView({ block: 'nearest' });
    measure();
    let tries = 0;
    const retry = window.setInterval(() => { measure(); if (++tries > 10) window.clearInterval(retry); }, 150);
    const onMove = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measure); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [target, depKey, measure]);
  return rect;
}

export const DemoTour: React.FC<{ screen: string; onSignUp: () => void }> = ({ screen, onSignUp }) => {
  const [t, setT] = useState<TourProgress>(() => loadTour());
  const step = TOUR_STEPS[t.index];
  const rect = useTargetRect(t.status === 'running' ? step.target : undefined, `${t.index}:${screen}`);
  const nextRef = useRef<HTMLButtonElement>(null);

  const update = (patch: Partial<TourProgress>) => {
    setT((cur) => {
      const next = { ...cur, ...patch };
      saveTour(next);
      return next;
    });
  };

  const go = (index: number) => {
    const s = TOUR_STEPS[index];
    factoryStore.setScreen(s.screen);
    update({ status: 'running', index });
  };

  // Resume on the right screen after a refresh.
  useEffect(() => {
    if (t.status === 'running' && factoryStore.getState().currentScreen !== step.screen) {
      factoryStore.setScreen(step.screen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (t.status === 'running') nextRef.current?.focus(); }, [t.status, t.index]);

  useEffect(() => {
    if (t.status !== 'running') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') update({ status: 'paused' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t.status]);

  const finish = (skipped: boolean) => update({ status: 'done', skipped, completed: skipped ? t.completed : TOUR_STEPS.map((s) => s.id) });
  const next = () => {
    const completed = Array.from(new Set([...t.completed, step.id]));
    if (t.index >= TOUR_STEPS.length - 1) { update({ completed }); finish(false); return; }
    update({ completed });
    go(t.index + 1);
  };

  if (t.status === 'paused' || (t.status === 'done' && t.skipped)) {
    return (
      <button
        type="button"
        onClick={() => go(t.status === 'done' ? 0 : t.index)}
        className="fixed bottom-4 right-4 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#075bff] text-white text-xs font-semibold shadow-lg shadow-[#075bff]/30 cursor-pointer"
      >
        <PlayCircle className="w-4 h-4" />
        {t.status === 'done' ? 'Restart tour' : `Resume tour · step ${t.index + 1} of ${TOUR_STEPS.length}`}
      </button>
    );
  }

  if (t.status === 'welcome') {
    return (
      <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Guided tour">
        <div className="w-full max-w-md bg-[#0a0d16] border border-white/10 rounded-3xl p-7 space-y-4 shadow-2xl">
          <h2 className="text-xl font-bold text-white">Welcome to the Software Karkhana demo</h2>
          <p className="text-sm text-slate-300">
            This is a real, working workspace for a health-tech team, filled with sample work. A guided tour walks you
            through every screen, one at a time.
          </p>
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Clock className="w-4 h-4" /> About {TOUR_MINUTES} minutes · {TOUR_STEPS.length} steps · 5 groups: Plan, Build, Verify, Ship, Learn
          </p>
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={() => finish(true)} className="text-xs text-slate-400 hover:text-white cursor-pointer">
              Skip tour, explore myself
            </button>
            <button type="button" autoFocus onClick={() => go(0)} className="px-5 py-2.5 bg-[#075bff] text-white text-xs font-semibold rounded-xl flex items-center gap-2 cursor-pointer">
              Start the tour <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (t.status === 'done') {
    return (
      <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Tour finished">
        <div className="w-full max-w-md bg-[#0a0d16] border border-white/10 rounded-3xl p-7 space-y-4 shadow-2xl">
          <h2 className="text-xl font-bold text-white">That was the whole factory</h2>
          <p className="text-sm text-slate-300">
            Keep exploring this demo, or sign up free to create your own workspace on the Free plan. The demo stays separate from it.
          </p>
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={() => update({ skipped: true })} className="text-xs text-slate-400 hover:text-white cursor-pointer">
              Keep exploring
            </button>
            <button type="button" autoFocus onClick={onSignUp} className="px-5 py-2.5 bg-[#075bff] text-white text-xs font-semibold rounded-xl cursor-pointer">
              Sign up free
            </button>
          </div>
        </div>
      </div>
    );
  }

  // running
  const vw = window.innerWidth, vh = window.innerHeight;
  const small = vw < 768;
  let cardStyle: React.CSSProperties;
  if (small || !rect) {
    cardStyle = small ? { left: 12, right: 12, bottom: 12 } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W };
  } else {
    const left = Math.min(Math.max(12, rect.left + rect.width + 16), vw - CARD_W - 12);
    const top = Math.min(Math.max(12, rect.top), vh - 300);
    cardStyle = { left, top, width: CARD_W };
  }
  const pct = ((t.index + 1) / TOUR_STEPS.length) * 100;
  const groupSteps = TOUR_STEPS.filter((s) => s.group === step.group);

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="false" aria-label={`Tour step ${t.index + 1} of ${TOUR_STEPS.length}`}>
      {rect ? (
        <div
          className="fixed rounded-xl border-2 border-[#3b82f6] pointer-events-none transition-all duration-200"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: '0 0 0 9999px rgba(3,5,12,0.72), 0 0 24px 4px rgba(59,130,246,0.55)' }}
        />
      ) : (
        <div className="fixed inset-0 bg-[#03050c]/70 pointer-events-none" />
      )}
      <div className="fixed bg-[#0a0d16] border border-[#075bff]/60 rounded-2xl p-5 space-y-3 shadow-2xl shadow-[#075bff]/20" style={cardStyle}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-mono text-slate-400">
            Step {t.index + 1} of {TOUR_STEPS.length} · {step.group} {groupSteps.indexOf(step) + 1}/{groupSteps.length}
          </span>
          <button type="button" aria-label="Pause tour" onClick={() => update({ status: 'paused' })} className="p-1 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="h-1 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={TOUR_STEPS.length} aria-valuenow={t.index + 1}>
          <div className="h-full bg-[#075bff] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <h3 className="text-base font-semibold text-white">{step.title}</h3>
        <p className="text-sm text-slate-300">{step.body}</p>
        <p className="text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">Try it: {step.tryIt}</p>
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => finish(true)} className="text-xs text-slate-400 hover:text-white cursor-pointer">Skip tour</button>
          <div className="flex items-center gap-2">
            <button type="button" disabled={t.index === 0} onClick={() => go(t.index - 1)} className="px-3 py-2 text-xs text-slate-300 bg-white/5 hover:bg-white/10 disabled:opacity-40 rounded-lg flex items-center gap-1 cursor-pointer">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button ref={nextRef} type="button" onClick={next} className="px-4 py-2 text-xs font-semibold text-white bg-[#075bff] rounded-lg flex items-center gap-1 cursor-pointer">
              {t.index === TOUR_STEPS.length - 1 ? 'Finish tour' : 'Next'} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
