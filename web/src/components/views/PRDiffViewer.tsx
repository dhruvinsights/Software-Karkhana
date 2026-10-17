/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * PRDiffViewer: "Files changed", built for big changes.
 *
 * The diff comes from the server (a pull request, or a build before any pull
 * request exists) parsed into hunks. What is rendered is what matters:
 *   - a compact file list with search and filters; files with open comments first;
 *   - only files with comments start open (at most 5); everything else is one row;
 *   - a file's lines are rendered only when it is open, 200 at a time;
 *   - lock files, minified bundles and build output are folded away by default;
 *   - the list itself is paged, so a 500-file change is 50 rows until asked for more.
 * Comment threads are rendered by the parent (`renderComment`) so triage stays in one place.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileCode2, Loader2, Search } from 'lucide-react';

interface DiffLineRow {
  kind: 'add' | 'del' | 'ctx';
  old: number | null;
  new: number | null;
  text: string;
}

interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLineRow[];
}

interface DiffFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffComment {
  id: string;
  path: string;
  line: number | null;
  severity: 'high' | 'medium' | 'low';
  body: string;
  triage: 'open' | 'valid' | 'dismissed';
  triage_reason: string | null;
}

interface DiffPayload {
  prId: string;
  number: number;
  truncated: boolean;
  additions: number;
  deletions: number;
  files: DiffFile[];
  comments: DiffComment[];
  unplaced: string[];
}

interface Props {
  /** A pull request (GET /api/prs/{id}/diff) ... */
  prId?: string;
  /** ... or any endpoint returning the same shape, e.g. a build's change (GET /api/runs/{id}/diff). */
  src?: string;
  token: string;
  /** Changes whenever comments are triaged or re-generated, to refetch. */
  reloadKey?: string;
  renderComment?: (comment: DiffComment) => React.ReactNode;
}

const LINES_STEP = 200;
const LIST_STEP = 50;
const AUTO_OPEN = 5;
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.map$|(^|\/)(dist|build|node_modules|\.next|coverage|__pycache__)\//;
const TESTS = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/;

const ROW_BG: Record<DiffLineRow['kind'], string> = {
  add: 'rgba(46, 160, 67, 0.14)',
  del: 'rgba(248, 81, 73, 0.14)',
  ctx: 'transparent',
};

const STATUS_LABEL: Record<DiffFile['status'], string> = { added: 'new', deleted: 'deleted', modified: 'modified', renamed: 'renamed' };

const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
  border: `1px solid ${on ? 'rgba(7,91,255,.6)' : 'var(--border)'}`,
  background: on ? 'rgba(7,91,255,.15)' : 'transparent', color: on ? '#fff' : 'var(--text-muted)',
});

const lineCount = (f: DiffFile) => f.hunks.reduce((n, h) => n + h.lines.length, 0);

const FileBody: React.FC<{
  file: DiffFile;
  byLine: Map<string, DiffComment[]>;
  fileLevel: DiffComment[];
  renderComment?: (c: DiffComment) => React.ReactNode;
}> = ({ file, byLine, fileLevel, renderComment }) => {
  const [limit, setLimit] = useState(LINES_STEP);
  const total = lineCount(file);
  let rendered = 0;
  return (
    <div>
      {fileLevel.length > 0 && renderComment && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          {fileLevel.map((c) => <div key={c.id}>{renderComment(c)}</div>)}
        </div>
      )}
      {file.binary && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Binary file not shown.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <tbody>
            {file.hunks.map((h, hi) => (
              <React.Fragment key={hi}>
                {rendered < limit && (
                  <tr>
                    <td colSpan={4} style={{ padding: '4px 12px', background: 'rgba(56,139,253,.1)', color: 'var(--text-muted)' }}>{h.header}</td>
                  </tr>
                )}
                {h.lines.map((ln, li) => {
                  if (rendered >= limit) return null;
                  rendered += 1;
                  const threads = ln.new != null && ln.kind !== 'del' ? byLine.get(`${file.path}:${ln.new}`) : undefined;
                  return (
                    <React.Fragment key={li}>
                      <tr style={{ background: ROW_BG[ln.kind] }}>
                        <td style={{ width: 44, textAlign: 'right', padding: '0 8px', color: 'var(--text-muted)', userSelect: 'none' }}>{ln.old ?? ''}</td>
                        <td style={{ width: 44, textAlign: 'right', padding: '0 8px', color: 'var(--text-muted)', userSelect: 'none' }}>{ln.new ?? ''}</td>
                        <td style={{ width: 16, textAlign: 'center', color: ln.kind === 'add' ? '#2ea043' : ln.kind === 'del' ? '#f85149' : 'var(--text-muted)', userSelect: 'none' }}>
                          {ln.kind === 'add' ? '+' : ln.kind === 'del' ? '−' : ''}
                        </td>
                        <td style={{ padding: '0 8px', whiteSpace: 'pre', color: 'var(--text-secondary)' }}>{ln.text}</td>
                      </tr>
                      {threads && threads.length > 0 && renderComment && (
                        <tr>
                          <td colSpan={4} style={{ padding: '8px 12px 2px 60px', background: 'var(--bg-surface, rgba(255,255,255,.03))', fontFamily: 'inherit' }}>
                            {threads.map((c) => <div key={c.id}>{renderComment(c)}</div>)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {total > limit && (
        <div style={{ display: 'flex', gap: 8, margin: 10 }}>
          <button onClick={() => setLimit((l) => l + LINES_STEP)} className="btn btn-ghost" style={{ fontSize: 11 }}>
            Show {Math.min(LINES_STEP, total - limit)} more lines ({total - limit} left)
          </button>
          <button onClick={() => setLimit(Infinity)} className="btn btn-ghost" style={{ fontSize: 11 }}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
};

export const PRDiffViewer: React.FC<Props> = ({ prId, src, token, reloadKey = '', renderComment }) => {
  const url = src ?? `/api/prs/${prId}/diff`;
  const [data, setData] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyComments, setOnlyComments] = useState(false);
  const [onlyTests, setOnlyTests] = useState(false);
  const [showGenerated, setShowGenerated] = useState(false);
  const [shown, setShown] = useState(LIST_STEP);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        return res.json() as Promise<DiffPayload>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        // Open only what needs a reviewer's eyes: files with comments, a handful at most.
        setOpen((prev) => {
          if (Object.keys(prev).length) return prev;
          const withComments = new Set(d.comments.map((c) => c.path));
          const next: Record<string, boolean> = {};
          d.files.filter((f) => withComments.has(f.path)).slice(0, AUTO_OPEN).forEach((f) => (next[f.path] = true));
          return next;
        });
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, token, reloadKey]);

  const index = useMemo(() => {
    const byLine = new Map<string, DiffComment[]>();
    const fileLevel = new Map<string, DiffComment[]>();
    const perFile = new Map<string, number>();
    const unplaced: DiffComment[] = [];
    if (!data) return { byLine, fileLevel, perFile, unplaced };
    const known = new Set(data.files.map((f) => f.path));
    for (const c of data.comments) {
      if (!known.has(c.path)) unplaced.push(c);
      else {
        perFile.set(c.path, (perFile.get(c.path) ?? 0) + 1);
        if (c.line == null) fileLevel.set(c.path, [...(fileLevel.get(c.path) ?? []), c]);
        else byLine.set(`${c.path}:${c.line}`, [...(byLine.get(`${c.path}:${c.line}`) ?? []), c]);
      }
    }
    return { byLine, fileLevel, perFile, unplaced };
  }, [data]);

  const view = useMemo(() => {
    if (!data) return { files: [] as DiffFile[], hidden: 0 };
    const q = query.trim().toLowerCase();
    let hidden = 0;
    const files = data.files.filter((f) => {
      if (!showGenerated && GENERATED.test(f.path)) {
        hidden += 1;
        return false;
      }
      if (q && !f.path.toLowerCase().includes(q)) return false;
      if (onlyComments && !index.perFile.get(f.path)) return false;
      if (onlyTests && !TESTS.test(f.path)) return false;
      return true;
    });
    // Files a reviewer must look at first: with comments, then the biggest changes.
    files.sort((a, b) => (index.perFile.get(b.path) ?? 0) - (index.perFile.get(a.path) ?? 0) || b.additions + b.deletions - (a.additions + a.deletions));
    return { files, hidden };
  }, [data, query, onlyComments, onlyTests, showGenerated, index]);

  if (loading && !data) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading diff…
      </div>
    );
  }
  if (error) return <div style={{ color: 'var(--warn)', fontSize: 12 }}>Could not load the diff: {error}</div>;
  if (!data || data.files.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No diff is recorded yet.</div>;

  const visible = view.files.slice(0, shown);
  const openCount = Object.values(open).filter(Boolean).length;

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>{data.files.length} file{data.files.length === 1 ? '' : 's'} changed</span>
        <span style={{ color: '#2ea043' }}>+{data.additions}</span>
        <span style={{ color: '#f85149' }}>−{data.deletions}</span>
        {data.comments.length > 0 && <span>{data.comments.length} AI comment{data.comments.length === 1 ? '' : 's'}</span>}
      </div>

      {data.truncated && (
        <div style={{ color: 'var(--warn)', fontSize: 12, marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={13} /> The stored patch was truncated; open the PR on GitHub for the full diff.
        </div>
      )}

      {/* Find what matters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
          <Search size={12} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-muted)' }} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(LIST_STEP);
            }}
            placeholder="Filter files…"
            aria-label="Filter files"
            style={{ width: '100%', padding: '5px 10px 5px 26px', fontSize: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
          />
        </div>
        {index.perFile.size > 0 && (
          <button style={chip(onlyComments)} onClick={() => setOnlyComments((v) => !v)}>With comments ({index.perFile.size})</button>
        )}
        <button style={chip(onlyTests)} onClick={() => setOnlyTests((v) => !v)}>Tests</button>
        {(view.hidden > 0 || showGenerated) && (
          <button style={chip(showGenerated)} onClick={() => setShowGenerated((v) => !v)}>
            {showGenerated ? 'Hide' : `Show ${view.hidden}`} lock / generated files
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          style={chip(false)}
          onClick={() => setOpen(openCount ? {} : Object.fromEntries(view.files.slice(0, 20).map((f) => [f.path, true])))}
        >
          {openCount ? 'Collapse all' : 'Expand first 20'}
        </button>
      </div>

      {index.unplaced.length > 0 && renderComment && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Comments on files outside this diff
          </div>
          {index.unplaced.map((c) => <div key={c.id}>{renderComment(c)}</div>)}
        </div>
      )}

      {view.files.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No file matches.</div>}

      {visible.map((file) => {
        const isOpen = !!open[file.path];
        const commentCount = index.perFile.get(file.path) ?? 0;
        return (
          <div key={file.path} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setOpen((s) => ({ ...s, [file.path]: !s[file.path] }))}
              aria-expanded={isOpen}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                background: 'var(--bg-elevated)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
              }}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <FileCode2 size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{STATUS_LABEL[file.status]}</span>
              <span style={{ fontSize: 11, color: '#2ea043' }}>+{file.additions}</span>
              <span style={{ fontSize: 11, color: '#f85149' }}>−{file.deletions}</span>
              {commentCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(240,165,0,.15)', color: 'var(--warn)' }}>
                  {commentCount} comment{commentCount === 1 ? '' : 's'}
                </span>
              )}
            </button>
            {isOpen && <FileBody file={file} byLine={index.byLine} fileLevel={index.fileLevel.get(file.path) ?? []} renderComment={renderComment} />}
          </div>
        );
      })}

      {view.files.length > shown && (
        <button onClick={() => setShown((n) => n + LIST_STEP)} className="btn btn-ghost" style={{ fontSize: 12, marginTop: 4 }}>
          Show {Math.min(LIST_STEP, view.files.length - shown)} more files ({view.files.length - shown} left)
        </button>
      )}
    </div>
  );
};
