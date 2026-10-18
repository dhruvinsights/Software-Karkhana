import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Download,
  Eye,
  Layers,
  Monitor,
  Pin,
  PinOff,
  RefreshCw,
  Smartphone,
  Sparkles,
  Tablet,
  Wand2,
  X,
} from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { useChatFrames } from '../../lib/chatSocket';
import { planApi, PlanIssue } from '../../lib/planApi';
import {
  CreativeRange,
  StitchDevice,
  StitchHome,
  StitchJob,
  StitchModel,
  StitchScreen,
  VariantAspect,
  stitchApi,
} from '../../lib/stitchApi';

const DEVICES: { id: StitchDevice; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: 'DESKTOP', label: 'Desktop', Icon: Monitor },
  { id: 'MOBILE', label: 'Mobile', Icon: Smartphone },
  { id: 'TABLET', label: 'Tablet', Icon: Tablet },
  { id: 'AGNOSTIC', label: 'Any', Icon: Layers },
];
const MODELS: { id: StitchModel; label: string }[] = [
  { id: 'GEMINI_3_FLASH', label: 'Gemini 3 Flash · fast' },
  { id: 'GEMINI_3_1_PRO', label: 'Gemini 3.1 Pro · best' },
];
const ASPECTS: { id: VariantAspect; label: string }[] = [
  { id: 'LAYOUT', label: 'Layout' },
  { id: 'COLOR_SCHEME', label: 'Colour' },
  { id: 'IMAGES', label: 'Images' },
  { id: 'TEXT_FONT', label: 'Type' },
  { id: 'TEXT_CONTENT', label: 'Copy' },
];
const KIND_LABEL: Record<StitchJob['kind'], string> = {
  generate: 'Generating a screen',
  edit: 'Applying your edit',
  variants: 'Generating variants',
  sync: 'Syncing from Stitch',
};
const FRAME_WIDTH: Record<string, number> = { MOBILE: 390, TABLET: 820, DESKTOP: 1280, AGNOSTIC: 1280 };

const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
    on ? 'bg-[#075BFF]/20 border-[#075BFF]/60 text-white' : 'bg-white/[0.03] border-white/[0.08] text-[#B5B1C0] hover:text-white'
  }`;

/** A screenshot loaded with the bearer token, released when the card unmounts. */
const Thumb: React.FC<{ projectId: string; screen: StitchScreen }> = ({ projectId, screen }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!screen.hasScreenshot) return;
    let alive = true;
    let made: string | null = null;
    stitchApi
      .screenshotUrl(projectId, screen.id)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [projectId, screen.id, screen.hasScreenshot]);
  return url ? (
    <img src={url} alt={`Screenshot of ${screen.title}`} className="w-full h-full object-cover object-top" />
  ) : (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-[#827D8E]">
      {screen.hasScreenshot ? 'Loading…' : 'No screenshot'}
    </div>
  );
};

type Action = { kind: 'edit' | 'variants'; screen: StitchScreen } | null;

/** Preview in a sandboxed frame (opaque origin, server-injected CSP), plus edit and variant actions. */
const ScreenModal: React.FC<{
  projectId: string;
  screen: StitchScreen;
  busy: boolean;
  onClose: () => void;
  onRun: (a: NonNullable<Action>, prompt: string, opts: { count: number; range: CreativeRange; aspects: VariantAspect[] }) => void;
}> = ({ projectId, screen, busy, onClose, onRun }) => {
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'variants'>('edit');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(3);
  const [range, setRange] = useState<CreativeRange>('EXPLORE');
  const [aspects, setAspects] = useState<VariantAspect[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stitchApi
      .preview(projectId, screen.id)
      .then((p) => setSrcdoc(p.srcdoc))
      .catch((e: Error) => setError(e.message));
  }, [projectId, screen.id]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const width = FRAME_WIDTH[screen.deviceType ?? 'DESKTOP'] ?? 1280;
  const ok = prompt.trim().length >= 3 && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${screen.title}`}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-7xl max-h-[92vh] bg-[#0B0B10] border border-white/[0.08] rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06]">
          <p className="text-sm text-white font-medium truncate">{screen.title}</p>
          <span className="text-[11px] font-mono text-[#827D8E]">{screen.deviceType ?? 'any device'}</span>
          <button ref={closeRef} onClick={onClose} aria-label="Close preview" className="ml-auto p-1.5 rounded-lg text-[#B5B1C0] hover:text-white hover:bg-white/[0.06] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_320px]">
          <div className="overflow-auto bg-[#15151c] p-4 flex justify-center">
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            {!error && !srcdoc && <p className="text-xs text-[#827D8E]">Loading preview…</p>}
            {srcdoc && (
              // No allow-same-origin: the design runs in an opaque origin with no access to the app.
              <iframe
                title={screen.title}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={srcdoc}
                style={{ width: Math.min(width, 1280), maxWidth: '100%' }}
                className="h-[70vh] rounded-lg bg-white shrink-0"
              />
            )}
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-white/[0.06] p-4 space-y-3 overflow-y-auto">
            <div className="flex gap-1.5">
              <button className={chip(mode === 'edit')} onClick={() => setMode('edit')}>Edit</button>
              <button className={chip(mode === 'variants')} onClick={() => setMode('variants')}>Variants</button>
            </div>
            <label className="block text-[11px] text-[#827D8E]" htmlFor="stitch-change">
              {mode === 'edit' ? 'What should change?' : 'What should the variants explore?'}
            </label>
            <textarea
              id="stitch-change"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder={mode === 'edit' ? 'Switch to a dark theme and make the primary button larger' : 'Different ways to lay out the order summary'}
              className="w-full text-xs bg-black/40 border border-white/[0.08] rounded-xl p-3 text-white placeholder:text-[#5f5b6b] focus:outline-none focus:border-[#075BFF]/60"
            />
            {mode === 'variants' && (
              <>
                <div className="flex items-center gap-2 text-[11px] text-[#B5B1C0]">
                  <span>How many</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className={chip(count === n)} onClick={() => setCount(n)}>{n}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['REFINE', 'EXPLORE', 'REIMAGINE'] as CreativeRange[]).map((r) => (
                    <button key={r} className={chip(range === r)} onClick={() => setRange(r)}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      className={chip(aspects.includes(a.id))}
                      onClick={() => setAspects((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#827D8E]">No aspect selected means Stitch may vary all of them.</p>
              </>
            )}
            <button
              disabled={!ok}
              onClick={() => onRun({ kind: mode, screen }, prompt.trim(), { count, range, aspects })}
              className="k-btn-primary w-full px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium hover:bg-[#1a6bff] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Wand2 className="w-3.5 h-3.5" /> {mode === 'edit' ? 'Apply edit' : `Generate ${count} variant${count > 1 ? 's' : ''}`}
            </button>
            {screen.prompt && (
              <details className="text-[11px] text-[#827D8E]">
                <summary className="cursor-pointer">Prompt used</summary>
                <p className="mt-1 whitespace-pre-wrap">{screen.prompt}</p>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Google Stitch studio. Rendered only on the designer dashboard, and only for people the
 * server confirms hold the project's design station; everyone else gets nothing.
 */
export const StitchStudioPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [home, setHome] = useState<StitchHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<StitchDevice>('DESKTOP');
  const [model, setModel] = useState<StitchModel>('GEMINI_3_FLASH');
  const [stories, setStories] = useState<PlanIssue[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<StitchScreen | null>(null);

  const reload = useCallback(async () => {
    try {
      const h = await stitchApi.home(projectId);
      setHome(h);
      if (h.defaultModel) setModel((m) => (m === 'GEMINI_3_FLASH' ? h.defaultModel! : m));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    setHome(null);
    setPicked([]);
    void reload();
  }, [reload]);

  // Approved stories a designer can cite in the brief.
  useEffect(() => {
    if (!home?.canUse) return;
    planApi
      .get(projectId)
      .then((p) => setStories(p.epics.flatMap((e) => e.stories).filter((s) => s.status !== 'draft')))
      .catch(() => setStories([]));
  }, [projectId, home?.canUse]);

  useChatFrames('workspace_sync', (f) => {
    if (f.scope === 'stitch') void reload();
  }, [reload]);

  const running = home?.job?.status === 'running';
  // Generation runs in the background; poll while it does (the socket frame usually wins).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [running, reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const screens = home?.screens ?? [];
  const pinnedCount = useMemo(() => screens.filter((s) => s.pinned).length, [screens]);

  if (!home) return error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null;
  // Not a designer on this project: the studio does not exist for them.
  if (!home.isDesigner) return null;

  if (!home.configured) {
    return (
      <GlassCard className="p-5 space-y-1">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#5B8FFF]" /> Google Stitch
        </h3>
        <p className="text-xs text-[#827D8E]">
          Google Stitch is not enabled on this server yet. Ask your administrator to turn it on (see docs/integrations/GOOGLE_STITCH.md).
        </p>
      </GlassCard>
    );
  }

  const quota = home.quota ?? { used: 0, limit: 0 };
  const quotaLeft = Math.max(0, quota.limit - quota.used);
  const job = home.job;
  const canGenerate = !busy && !running && prompt.trim().length >= 3 && quotaLeft > 0;

  return (
    <section aria-labelledby="stitch-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="stitch-title" className="text-xl font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#5B8FFF]" /> Google Stitch
          </h2>
          <p className="text-xs text-[#827D8E] mt-1">
            Generate screens from a brief, refine them, and pin the ones developers should build.
            {pinnedCount > 0 && ` ${pinnedCount} pinned for the handoff.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-mono px-2 py-1 rounded-lg ${quotaLeft === 0 ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.05] text-[#B5B1C0]'}`}
            title="Generations, edits and variants this workspace can still run in the next 24 hours"
          >
            {quotaLeft}/{quota.limit} left today
          </span>
          {home.stitchProjectId && (
            <button
              disabled={busy || running}
              onClick={() => run(() => stitchApi.sync(projectId))}
              className="k-btn-secondary px-3 py-1.5 bg-[#101016] border border-white/[0.08] text-white rounded-xl text-xs hover:border-white/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              title="Import screens from the linked Stitch project that are not here yet"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync
            </button>
          )}
        </div>
      </div>

      <GlassCard className="p-5 space-y-3">
        <label htmlFor="stitch-brief" className="block text-[11px] font-mono uppercase text-[#827D8E]">
          Design brief
        </label>
        <textarea
          id="stitch-brief"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="A checkout page for a B2B invoicing app: order summary on the right, saved cards, a coupon field, clear totals in INR."
          className="w-full text-sm bg-black/40 border border-white/[0.08] rounded-xl p-3 text-white placeholder:text-[#5f5b6b] focus:outline-none focus:border-[#075BFF]/60"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Device" className="flex gap-1.5">
            {DEVICES.map(({ id, label, Icon }) => (
              <button key={id} role="radio" aria-checked={device === id} className={`${chip(device === id)} flex items-center gap-1`} onClick={() => setDevice(id)}>
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value as StitchModel)}
            className="text-[11px] bg-black/40 border border-white/[0.08] rounded-lg px-2 py-1 text-[#D1D5DB] focus:outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <span className="text-[11px] text-[#827D8E] ml-auto">{prompt.length}/4000</span>
        </div>
        {stories.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-[#827D8E]">Cite stories (their acceptance criteria are added to the brief):</p>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {stories.map((s) => (
                <button
                  key={s.key}
                  className={chip(picked.includes(s.key))}
                  title={s.title}
                  onClick={() =>
                    setPicked((cur) => (cur.includes(s.key) ? cur.filter((k) => k !== s.key) : cur.length < 12 ? [...cur, s.key] : cur))
                  }
                >
                  {s.key} <span className="text-[#827D8E]">· {s.title.length > 32 ? `${s.title.slice(0, 32)}…` : s.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button
            disabled={!canGenerate}
            onClick={() =>
              run(async () => {
                await stitchApi.generate(projectId, { prompt: prompt.trim(), device_type: device, model_id: model, story_keys: picked });
                setPrompt('');
              })
            }
            className="k-btn-primary px-4 py-2 bg-[#075BFF] text-white rounded-xl text-xs font-medium hover:bg-[#1a6bff] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> Generate screen
          </button>
        </div>
      </GlassCard>

      {running && job && (
        <div role="status" className="text-xs text-white bg-[#075BFF]/10 border border-[#075BFF]/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#5B8FFF]" /> {KIND_LABEL[job.kind]}… Stitch can take a few minutes. You can leave this page.
        </div>
      )}
      {job?.status === 'failed' && job.error && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {job.error}
        </div>
      )}
      {job?.status === 'succeeded' && ((job.result.messages?.length ?? 0) > 0 || (job.result.suggestions?.length ?? 0) > 0 || (job.result.warnings?.length ?? 0) > 0) && (
        <GlassCard className="p-4 space-y-2 text-xs">
          {job.result.messages?.map((m) => <p key={m} className="text-[#D1D5DB]">{m}</p>)}
          {job.result.warnings?.map((w) => <p key={w} className="text-amber-300/90">{w}</p>)}
          {(job.result.suggestions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[#827D8E]">Stitch suggests:</span>
              {job.result.suggestions!.map((s) => (
                <button key={s} className={chip(false)} onClick={() => setPrompt(s)}>{s}</button>
              ))}
            </div>
          )}
        </GlassCard>
      )}
      {error && <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">{error}</div>}

      {screens.length === 0 ? (
        <p className="text-xs text-[#827D8E] py-6 text-center">No Stitch screens yet. Write a brief above to generate the first one.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {screens.map((s) => (
            <GlassCard key={s.id} className="p-0 overflow-hidden flex flex-col">
              <button onClick={() => setOpen(s)} className="relative h-48 bg-[#15151c] cursor-pointer group" aria-label={`Preview ${s.title}`}>
                <Thumb projectId={projectId} screen={s} />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />
                </span>
                {s.pinned && (
                  <span className="absolute top-2 left-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#075BFF] text-white flex items-center gap-1">
                    <Pin className="w-2.5 h-2.5" /> Handoff
                  </span>
                )}
              </button>
              <div className="p-3 space-y-2 flex-1 flex flex-col">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-white font-medium truncate">{s.title}</p>
                  <span className="text-[10px] font-mono text-[#827D8E] ml-auto shrink-0">{s.deviceType ?? 'ANY'}</span>
                </div>
                {s.parentId && <p className="text-[10px] text-[#827D8E]">Derived from another screen</p>}
                <div className="flex gap-1 mt-auto pt-1">
                  <button
                    disabled={busy}
                    onClick={() => run(() => stitchApi.pin(projectId, s.id, !s.pinned))}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[11px] bg-white/[0.04] text-[#D1D5DB] hover:bg-white/[0.08] cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    {s.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />} {s.pinned ? 'Unpin' : 'Pin for handoff'}
                  </button>
                  <button
                    onClick={() => run(() => stitchApi.downloadHtml(projectId, s))}
                    disabled={busy}
                    aria-label={`Download HTML of ${s.title}`}
                    title="Download HTML"
                    className="px-2 py-1.5 rounded-lg bg-white/[0.04] text-[#D1D5DB] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Archive "${s.title}"? It stays in the audit trail but leaves this list.`)) {
                        void run(() => stitchApi.archive(projectId, s.id));
                      }
                    }}
                    disabled={busy}
                    aria-label={`Archive ${s.title}`}
                    title="Archive"
                    className="px-2 py-1.5 rounded-lg bg-white/[0.04] text-[#D1D5DB] hover:bg-red-500/20 hover:text-red-200 cursor-pointer disabled:opacity-50"
                  >
                    <Archive className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {open && (
        <ScreenModal
          projectId={projectId}
          screen={open}
          busy={busy || running || quotaLeft === 0}
          onClose={() => setOpen(null)}
          onRun={(a, text, opts) => {
            setOpen(null);
            void run(() =>
              a.kind === 'edit'
                ? stitchApi.edit(projectId, a.screen.id, { prompt: text, model_id: model })
                : stitchApi.variants(projectId, a.screen.id, {
                    prompt: text,
                    count: opts.count,
                    creative_range: opts.range,
                    aspects: opts.aspects,
                    model_id: model,
                  }),
            );
          }}
        />
      )}
    </section>
  );
};
