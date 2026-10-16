/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * PRDiffViewer: "Files changed" for a pull request, with the AI review's
 * comments shown as inline threads under the exact line they refer to.
 *
 * The diff comes from GET /api/prs/{id}/diff, parsed on the server from the
 * same patch that was pushed to the branch, so what is shown is what will
 * merge. Comment threads are rendered by the parent (`renderComment`) so the
 * triage controls stay in one place.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Loader2, AlertTriangle } from 'lucide-react';

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
  prId: string;
  token: string;
  /** Changes whenever comments are triaged or re-generated, to refetch. */
  reloadKey: string;
  renderComment: (comment: DiffComment) => React.ReactNode;
}

const MAX_LINES_PER_FILE = 500;

const ROW_BG: Record<DiffLineRow['kind'], string> = {
  add: 'rgba(46, 160, 67, 0.14)',
  del: 'rgba(248, 81, 73, 0.14)',
  ctx: 'transparent',
};

const STATUS_LABEL: Record<DiffFile['status'], string> = {
  added: 'new',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
};

export const PRDiffViewer: React.FC<Props> = ({ prId, token, reloadKey, renderComment }) => {
  const [data, setData] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/prs/${prId}/diff`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        return res.json() as Promise<DiffPayload>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        // Open the first few files; keep the rest collapsed so big PRs stay usable.
        setCollapsed((prev) => {
          if (Object.keys(prev).length) return prev;
          const next: Record<string, boolean> = {};
          d.files.forEach((f, i) => {
            next[f.path] = i >= 3;
          });
          return next;
        });
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [prId, token, reloadKey]);

  // path -> line -> comments, plus file-level comments per path.
  const index = useMemo(() => {
    const byLine = new Map<string, DiffComment[]>();
    const fileLevel = new Map<string, DiffComment[]>();
    const unplaced: DiffComment[] = [];
    if (!data) return { byLine, fileLevel, unplaced };
    const known = new Set(data.files.map((f) => f.path));
    for (const c of data.comments) {
      if (!known.has(c.path)) {
        unplaced.push(c);
      } else if (c.line == null) {
        fileLevel.set(c.path, [...(fileLevel.get(c.path) ?? []), c]);
      } else {
        const key = `${c.path}:${c.line}`;
        byLine.set(key, [...(byLine.get(key) ?? []), c]);
      }
    }
    return { byLine, fileLevel, unplaced };
  }, [data]);

  if (loading && !data) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading diff…
      </div>
    );
  }
  if (error) {
    return <div style={{ color: 'var(--warn)', fontSize: 12 }}>Could not load the diff: {error}</div>;
  }
  if (!data || data.files.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        No diff is recorded for this pull request yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>{data.files.length} file{data.files.length === 1 ? '' : 's'} changed</span>
        <span style={{ color: '#2ea043' }}>+{data.additions}</span>
        <span style={{ color: '#f85149' }}>−{data.deletions}</span>
        <span>{data.comments.length} AI comment{data.comments.length === 1 ? '' : 's'}</span>
      </div>

      {data.truncated && (
        <div style={{ color: 'var(--warn)', fontSize: 12, marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={13} /> The stored patch was truncated; open the PR on GitHub for the full diff.
        </div>
      )}

      {index.unplaced.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Comments on files outside this diff
          </div>
          {index.unplaced.map((c) => (
            <div key={c.id}>{renderComment(c)}</div>
          ))}
        </div>
      )}

      {data.files.map((file) => {
        const isCollapsed = collapsed[file.path];
        const fileComments = index.fileLevel.get(file.path) ?? [];
        const total = file.hunks.reduce((n, h) => n + h.lines.length, 0);
        const limit = showAll[file.path] ? Infinity : MAX_LINES_PER_FILE;
        let rendered = 0;
        const commentCount =
          fileComments.length +
          file.hunks.reduce(
            (n, h) =>
              n + h.lines.reduce((m, ln) => m + (ln.new != null ? (index.byLine.get(`${file.path}:${ln.new}`)?.length ?? 0) : 0), 0),
            0,
          );
        return (
          <div
            key={file.path}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 12, overflow: 'hidden' }}
          >
            <button
              onClick={() => setCollapsed((s) => ({ ...s, [file.path]: !s[file.path] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                background: 'var(--bg-elevated)', border: 'none', color: 'var(--text-primary)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FileCode2 size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

            {!isCollapsed && (
              <div>
                {fileComments.length > 0 && (
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    {fileComments.map((c) => (
                      <div key={c.id}>{renderComment(c)}</div>
                    ))}
                  </div>
                )}

                {file.binary && (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Binary file not shown.</div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    <tbody>
                      {file.hunks.map((h, hi) => (
                        <React.Fragment key={hi}>
                          <tr>
                            <td colSpan={4} style={{ padding: '4px 12px', background: 'rgba(56,139,253,.1)', color: 'var(--text-muted)' }}>
                              {h.header}
                            </td>
                          </tr>
                          {h.lines.map((ln, li) => {
                            if (rendered >= limit) return null;
                            rendered += 1;
                            const threads = ln.new != null && ln.kind !== 'del' ? index.byLine.get(`${file.path}:${ln.new}`) : undefined;
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
                                {threads && threads.length > 0 && (
                                  <tr>
                                    <td colSpan={4} style={{ padding: '8px 12px 2px 60px', background: 'var(--bg-surface, rgba(255,255,255,.03))', fontFamily: 'inherit' }}>
                                      {threads.map((c) => (
                                        <div key={c.id}>{renderComment(c)}</div>
                                      ))}
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

                {total > MAX_LINES_PER_FILE && !showAll[file.path] && (
                  <button
                    onClick={() => setShowAll((s) => ({ ...s, [file.path]: true }))}
                    className="btn btn-ghost"
                    style={{ margin: 10, fontSize: 11 }}
                  >
                    Show all {total} lines
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
