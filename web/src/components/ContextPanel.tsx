import { useState } from 'react';
import { useGet, usePost, type ContextEntry } from '../api';
import { Empty, ErrorBox } from './common';

const KINDS = ['note', 'decision', 'handoff'] as const;

// Shared context: what people decided and what each agent run handed over.
export function ContextPanel({ projectId }: { projectId: string }) {
  const { data, error } = useGet<ContextEntry[]>(['context', projectId], `/api/projects/${projectId}/context`, 5000);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const add = usePost<void, ContextEntry>(() => `/api/projects/${projectId}/context`, [['context', projectId]], () => ({ kind, title, body }));
  return (
    <div className="stack">
      <p className="muted sm">Read by every teammate and handed to the Coder agent with each task. Agent runs add a handoff when they finish.</p>
      <div className="card stack">
        <div className="row">{KINDS.map((k) => <button key={k} className={`btn sm ${kind === k ? 'pri' : ''}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <input className="in" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="in" style={{ minHeight: 90 }} placeholder="What should the next person or agent know?" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row between">
          <a className="btn sm" href={`/api/projects/${projectId}/context/export.md`} target="_blank" rel="noreferrer">Export Markdown</a>
          <button className="btn pri" disabled={add.isPending || title.trim().length < 3 || body.trim().length < 3}
            onClick={() => add.mutate(undefined, { onSuccess: () => { setTitle(''); setBody(''); } })}>{add.isPending ? 'Saving…' : 'Add to context'}</button>
        </div>
        <ErrorBox error={add.error} />
      </div>
      <ErrorBox error={error} />
      {data && data.length === 0 && <Empty>No shared context yet.</Empty>}
      {(data ?? []).map((e) => (
        <div key={e.id} className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <span className="row"><span className={`pill ${e.kind === 'decision' ? 'solid' : 'outline'}`}>{e.kind}</span>{e.author_kind === 'ai' && <span className="pill dash">AI-written</span>}</span>
            <span className="muted sm">{e.author_label} · {new Date(e.created_at).toLocaleString()}</span>
          </div>
          <h4>{e.title}</h4>
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.body}</p>
        </div>
      ))}
    </div>
  );
}
