import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Hammer, Laptop, Play, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { GlassCard } from '../reactbits/GlassCard';
import { buildApi, LogLine, Machine, Pairing, RunInfo } from '../../lib/buildApi';
import { planApi, PlanIssue } from '../../lib/planApi';
import { useChatFrames } from '../../lib/chatSocket';
import { factoryStore } from '../../store/factoryStore';

export const PHASE_LABEL: Record<string, string> = {
  queued: 'Waiting for your machine',
  cloning: 'Preparing the worktree',
  coding: 'Agent is coding',
  validating: 'Running tests',
  publishing: 'Reviewing and opening the PR',
  done: 'Pull request opened',
};

/** Connected machines and the one-time command to connect another. */
/** Where this project lives on a machine: the developer decides; empty means the agent's default folder. */
const FolderSetting: React.FC<{ machine: Machine; projectId: string; onChange: () => void }> = ({ machine, projectId, onChange }) => {
  const saved = machine.workPaths?.[projectId] ?? '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(saved), [saved]);
  const save = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await buildApi.setWorkPath(machine.id, projectId, path);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pl-4 space-y-1.5">
      <label className="text-[11px] text-[#827D8E] block">Folder for this project on {machine.name}</label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Default (the agent's work folder). Or e.g. ~/code/my-project"
          aria-label={`Folder for this project on ${machine.name}`}
          className="flex-1 px-3 py-1.5 bg-[#07070B] border border-white/[0.1] rounded-lg text-xs text-white font-mono placeholder-[#5f5b6b] focus:outline-none focus:border-[#075BFF]"
        />
        <button
          disabled={busy || value.trim() === saved}
          onClick={() => void save(value.trim())}
          className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-xs font-medium cursor-pointer disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <p className="text-[10px] text-[#5f5b6b]">
        An existing checkout of this repository is reused; a new or empty folder is cloned into. Anything else is refused, never overwritten.
      </p>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
};

export const Machines: React.FC<{ machines: Machine[]; onChange: () => void; projectId?: string }> = ({ machines, onChange, projectId }) => {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    try {
      setPairing(await buildApi.pair());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white flex items-center gap-2">
          <Laptop className="w-4 h-4 text-[#075BFF]" /> My machines
        </p>
        <button onClick={connect} className="px-3 py-1.5 bg-[#075BFF]/15 hover:bg-[#075BFF]/25 text-[#5B8FFF] rounded-lg text-xs font-medium cursor-pointer">
          Connect a machine
        </button>
      </div>
      {machines.length === 0 && !pairing && (
        <p className="text-xs text-[#827D8E]">No machine connected. Stories are built on your computer, in your own checkout, with your coding agent.</p>
      )}
      {machines.map((m) => (
        <div key={m.id} className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[#B5B1C0]">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${m.online ? 'bg-emerald-400' : 'bg-[#4e5668]'}`} />
              {m.name} <span className="text-[#827D8E]">· {m.harness} · {m.online ? 'online' : 'offline'}</span>
            </span>
            <button
              title="Disconnect"
              onClick={async () => {
                await buildApi.revoke(m.id);
                onChange();
              }}
              className="p-1 text-[#827D8E] hover:text-rose-300 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {projectId && <FolderSetting machine={m} projectId={projectId} onChange={onChange} />}
        </div>
      ))}
      {pairing && (
        <div className="space-y-2 pt-2 border-t border-white/[0.06]">
          <p className="text-xs text-[#B5B1C0]">
            Install the agent once (<code className="text-white">{pairing.install}</code>), then run this within 10 minutes,
            and after it <code className="text-white">karkhana-agent work</code>:
          </p>
          <div className="flex items-start gap-2">
            <code className="flex-1 text-[11px] text-white bg-black/40 rounded-lg p-2.5 break-all">{pairing.command}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(pairing.command);
                setCopied(true);
              }}
              className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white cursor-pointer"
              title="Copy"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </GlassCard>
  );
};

type LogKind = 'read' | 'write' | 'command' | 'thinking' | 'error' | 'status' | 'info';

const KIND_STYLE: Record<LogKind, { label: string; cls: string }> = {
  read: { label: 'Read', cls: 'text-[#7aa7ff]' },
  write: { label: 'Write', cls: 'text-emerald-300' },
  command: { label: 'Run', cls: 'text-amber-300' },
  thinking: { label: 'Thinking', cls: 'text-[#827D8E]' },
  error: { label: 'Error', cls: 'text-rose-300' },
  status: { label: 'Status', cls: 'text-fuchsia-300' },
  info: { label: 'Info', cls: 'text-[#B5B1C0]' },
};

const READS = /^(Read|read_file|Glob|Grep|list_files|list_dir|search_files|search|LS|codebase_search)\b/;
const WRITES = /^(Write|Edit|MultiEdit|NotebookEdit|write_file|replace_in_file|apply_diff|insert_content|write_to_file|edit_file)\b/;
const COMMANDS = /^(Bash|execute_command|run_command|shell)\b/;
const STATUS = /(finished:|Credits spent|Built and green|Tests (still )?failing|Sending only|continuing|The tests already pass|new worktree)/i;

function kindOf(l: LogLine): LogKind {
  if (l.level === 'error') return 'error';
  if (l.level === 'thinking') return 'thinking';
  if (WRITES.test(l.message)) return 'write';
  if (READS.test(l.message)) return 'read';
  if (COMMANDS.test(l.message)) return 'command';
  if (STATUS.test(l.message)) return 'status';
  return 'info';
}

const pathOf = (m: string) => /"(?:file_path|path|filePath)"\s*:\s*"([^"]+)"/.exec(m)?.[1] ?? null;

/** What the tool call is, in one readable line: Bash shows the command, file tools the path. */
function summarize(l: LogLine, kind: LogKind): string {
  if (kind === 'read' || kind === 'write') {
    const p = pathOf(l.message);
    if (p) return `${l.message.split(' ')[0]} ${p}`;
  }
  if (kind === 'command') {
    const c = /"command"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(l.message)?.[1];
    if (c) return `$ ${c.replace(/\\"/g, '"').replace(/\\n/g, '\n')}`;
  }
  return l.message;
}

/**
 * A run's live log, readable for a developer: tool calls are grouped (reads, writes,
 * commands), filterable and summarised ("files written", credits so far), and the
 * whole thing can be copied. Loaded once, then appended as lines stream in.
 */
export const RunLog: React.FC<{ runId: string }> = ({ runId }) => {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<LogKind | 'all'>('all');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    buildApi.logs(runId).then(setLines).catch(() => {});
  }, [runId]);
  useChatFrames('run_log', (f) => {
    if (f.runId === runId) setLines((prev) => [...prev, ...f.lines]);
  }, [runId]);

  const kinds = useMemo(() => lines.map(kindOf), [lines]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    kinds.forEach((k) => (c[k] = (c[k] ?? 0) + 1));
    return c;
  }, [kinds]);
  const written = useMemo(() => {
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (kinds[i] === 'write') {
        const p = pathOf(l.message);
        if (p) seen.add(p.replace(/^.*\.worktrees\/[^/]+\//, ''));
      }
    });
    return [...seen];
  }, [lines, kinds]);
  const spent = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      const m = /finished:.*\$([0-9.]+)/.exec(l.message);
      if (m) total += Number(m[1]);
    }
    return total;
  }, [lines]);
  // The agent logs "worktree <path> on <branch>" / "continuing in <path>": the folder on the
  // developer's machine where the files are being written. Open it to watch them appear.
  const worktree = lines.map((l) => /^(?:new worktree|continuing in|worktree) (\S+)/.exec(l.message)?.[1]).find(Boolean);

  useEffect(() => {
    if (follow) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length, filter, follow]);

  const shown = lines.map((l, i) => ({ l, k: kinds[i] })).filter(({ k }) => filter === 'all' || k === filter);
  const copy = async () => {
    await navigator.clipboard.writeText(lines.map((l) => `${l.level === 'error' ? '! ' : ''}${l.message}`).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {(['all', 'write', 'read', 'command', 'thinking', 'error', 'status'] as const).map((k) => {
          const n = k === 'all' ? lines.length : counts[k] ?? 0;
          if (k !== 'all' && n === 0) return null;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1 rounded-full border cursor-pointer ${filter === k ? 'bg-[#075BFF]/20 border-[#075BFF]/60 text-white' : 'border-white/[0.1] text-[#827D8E] hover:text-white'}`}
            >
              {k === 'all' ? 'All' : KIND_STYLE[k].label} {n}
            </button>
          );
        })}
        <span className="flex-1" />
        {spent > 0 && <span className="text-fuchsia-300 font-mono">credits so far ${spent.toFixed(2)}</span>}
        <label className="flex items-center gap-1 text-[#827D8E] cursor-pointer">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
        <button onClick={() => void copy()} className="px-2.5 py-1 rounded-lg border border-white/[0.1] text-[#B5B1C0] hover:text-white cursor-pointer">
          {copied ? 'Copied' : 'Copy log'}
        </button>
      </div>
      {written.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="text-[#827D8E] self-center">Files written ({written.length}):</span>
          {written.slice(0, 24).map((p) => (
            <code key={p} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{p}</code>
          ))}
          {written.length > 24 && <span className="text-[#827D8E]">+{written.length - 24} more</span>}
        </div>
      )}
      <div ref={box} className="max-h-96 min-h-24 resize-y overflow-y-auto bg-black/50 rounded-lg p-3 font-mono text-[11px] space-y-1 select-text">
        {worktree && (
          <p className="pb-1.5 mb-1.5 border-b border-white/[0.06] flex flex-wrap items-center gap-2 font-sans">
            <span className="text-[#827D8E]">Files are written in</span>
            <code className="text-[#B5B1C0]">{worktree}</code>
            <a href={`vscode://file${worktree}`} className="text-[#7aa7ff] hover:text-white">Open in VS Code</a>
            <button onClick={() => void navigator.clipboard.writeText(worktree)} className="text-[#7aa7ff] hover:text-white cursor-pointer">
              Copy path
            </button>
          </p>
        )}
        {lines.length === 0 && <p className="text-[#827D8E]">No output yet.</p>}
        {shown.map(({ l, k }, i) => (
          <p key={i} className={`flex gap-2 ${KIND_STYLE[k].cls} ${k === 'thinking' ? 'italic' : ''}`}>
            <span className="w-14 shrink-0 opacity-60 uppercase text-[9px] pt-0.5">{KIND_STYLE[k].label}</span>
            <span className="whitespace-pre-wrap break-words min-w-0">{summarize(l, k)}</span>
          </p>
        ))}
      </div>
    </div>
  );
};

/** One story: take it, build it on my machine, watch the run. */
const StoryRow: React.FC<{ story: PlanIssue; myId: string; onChange: () => void; epoch: number }> = ({ story, myId, onChange, epoch }) => {
  const [run, setRun] = useState<RunInfo | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const loadRun = useCallback(async () => {
    if (!story.taskId) return;
    const runs = await buildApi.runs(story.taskId).catch(() => []);
    setRun(runs[0] ?? null);
  }, [story.taskId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun, epoch]);

  useEffect(() => {
    if (open && run) buildApi.logs(run.id).then(setLines).catch(() => {});
  }, [open, run?.id]);

  useChatFrames('run_log', (f) => {
    if (run && f.runId === run.id) setLines((prev) => [...prev, ...f.lines]);
  }, [run?.id]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
      await loadRun();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mine = story.assigneeId === myId;
  const running = run && (run.status === 'queued' || run.status === 'running');
  const canBuild = mine && story.taskId && (story.status === 'ready' || story.status === 'in_progress') && !running;

  return (
    <li className="px-4 py-3 border-t border-white/[0.06] space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white">
            <span className="font-mono text-[11px] text-[#827D8E] mr-2">{story.key}</span>
            {story.title}
          </p>
          <p className="text-[11px] text-[#827D8E] mt-0.5">
            {story.status.replace(/_/g, ' ')}
            {story.assigneeName ? ` · ${story.assigneeName}` : ' · unassigned'}
            {run && ` · run ${run.status}${run.phase ? ` (${PHASE_LABEL[run.phase] ?? run.phase})` : ''}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!story.assigneeId && story.status === 'backlog' && (
            <button
              disabled={busy}
              onClick={() => act(() => buildApi.takeStory(story.id, myId))}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-lg text-xs cursor-pointer disabled:opacity-50"
            >
              Take it
            </button>
          )}
          {canBuild && (
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await buildApi.build(story.taskId!);
                  if (r.status === 'failed') throw new Error(r.error ?? 'The build could not start.');
                  setOpen(true);
                })
              }
              className="px-3 py-1.5 bg-[#075BFF] hover:bg-[#1a6bff] text-white rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Play className="w-3 h-3" /> Build on my machine
            </button>
          )}
          {run && (
            <button onClick={() => setOpen((o) => !o)} className="p-1.5 rounded-lg bg-white/[0.06] text-[#B5B1C0] hover:text-white cursor-pointer" title="Run log">
              <Terminal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {running && (
        <p className="text-[11px] text-[#7aa7ff] flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3 animate-spin" /> {PHASE_LABEL[run!.phase ?? 'queued'] ?? run!.phase}
        </p>
      )}
      {run?.status === 'failed' && run.error && <p className="text-[11px] text-rose-300">{run.error}</p>}
      {run?.status === 'succeeded' && (
        <p className="text-[11px] text-emerald-300">
          Tests {run.validation_status} ({run.test_command}) · branch {run.branch}. Review the pull request below.
        </p>
      )}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      {open && (
        <div className="max-h-64 overflow-y-auto bg-black/50 rounded-lg p-3 font-mono text-[11px] space-y-0.5">
          {lines.length === 0 && <p className="text-[#827D8E]">No output yet.</p>}
          {lines.map((l, i) => (
            <p key={i} className={l.level === 'error' ? 'text-rose-300' : l.level === 'thinking' ? 'text-[#827D8E]' : 'text-[#B5B1C0]'}>
              {l.message}
            </p>
          ))}
          <div ref={logEnd} />
        </div>
      )}
    </li>
  );
};

/** The developer station: connect a machine, take stories, build them locally, watch them run. */
export const ProjectBuildPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [stories, setStories] = useState<PlanIssue[]>([]);
  const [epoch, setEpoch] = useState(0);
  const myId = factoryStore.getState().currentUser?.id ?? '';

  const reload = useCallback(async () => {
    const [m, plan] = await Promise.all([buildApi.machines().catch(() => []), planApi.get(projectId).catch(() => null)]);
    setMachines(m);
    setStories(plan ? plan.epics.flatMap((e) => e.stories).filter((s) => s.status !== 'draft') : []);
    setEpoch((n) => n + 1);
  }, [projectId]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void buildApi.machines().then(setMachines).catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  useChatFrames('workspace_sync', (f) => {
    if (f.scope === 'runs' || f.scope === 'projects') void reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <Hammer className="w-5 h-5 text-[#075BFF]" /> Build
      </h2>
      <Machines machines={machines} onChange={reload} />
      <GlassCard className="p-0 overflow-hidden">
        <p className="px-4 py-3 text-sm font-semibold text-white">Stories</p>
        {stories.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-[#827D8E]">No approved stories yet. They appear here once the plan is approved.</p>
        ) : (
          <ul>
            {stories.map((s) => (
              <StoryRow key={s.id} story={s} myId={myId} onChange={reload} epoch={epoch} />
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
};
