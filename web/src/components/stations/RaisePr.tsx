/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Raise the pull request for a finished build. The developer decides where it
 * goes (the branch it is raised against), what the head branch is called and
 * what the pull request says. They can read the whole change first.
 */

import React, { useEffect, useState } from 'react';
import { GitPullRequest, Loader2 } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { devQaApi } from '../../lib/devQaApi';
import { PRDiffViewer } from '../views/PRDiffViewer';
import { ErrorText, field, Modal } from './StationKit';

export const RaisePrModal: React.FC<{
  projectId: string;
  runId: string;
  storyKey: string;
  storyTitle: string;
  onClose: () => void;
  onDone: (r: { number: number; url: string }) => void;
}> = ({ projectId, runId, storyKey, storyTitle, onClose, onDone }) => {
  const token = factoryStore.getState().token ?? '';
  const [repo, setRepo] = useState<{ repo: string | null; default: string; branches: string[]; reachable: boolean } | null>(null);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [title, setTitle] = useState(`${storyKey}: ${storyTitle}`.slice(0, 200));
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    devQaApi
      .branches(projectId)
      .then((r) => {
        setRepo(r);
        setBase(r.default);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await devQaApi.publish(runId, { base_branch: base || undefined, branch: head.trim() || undefined, title: title.trim() || undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Raise pull request" subtitle={`${storyKey} · nothing has been pushed yet`} onClose={onClose} wide>
      {!repo && !error && <p className="text-xs text-[#827D8E] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Reading the repository's branches…</p>}
      {repo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#B5B1C0] mb-1.5">Raise it against (base branch)</label>
            {repo.reachable && repo.branches.length > 0 ? (
              <select value={base} onChange={(e) => setBase(e.target.value)} className={field} aria-label="Base branch">
                {repo.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}{b === repo.default ? '  (default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input value={base} onChange={(e) => setBase(e.target.value)} className={`${field} font-mono`} aria-label="Base branch" />
            )}
            <p className="text-[10px] text-[#5f5b6b] mt-1">{repo.repo ?? 'No repository'}{repo.reachable ? '' : ' · branches could not be read, type the name'}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#B5B1C0] mb-1.5">Branch for this change (optional)</label>
            <input
              value={head}
              onChange={(e) => setHead(e.target.value)}
              placeholder={`karkhana/${storyKey.toLowerCase()}-…`}
              className={`${field} font-mono`}
              aria-label="Head branch"
            />
            <p className="text-[10px] text-[#5f5b6b] mt-1">Created on GitHub. Leave empty for the default name.</p>
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-[#B5B1C0] mb-1.5">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} aria-label="Pull request title" />
      </div>
      <button onClick={() => setReviewing((r) => !r)} className="text-xs text-[#7aa7ff] hover:text-white cursor-pointer">
        {reviewing ? 'Hide the change' : 'Read the change first'}
      </button>
      {reviewing && (
        <div className="max-h-[50vh] overflow-y-auto pr-1">
          <PRDiffViewer src={`/api/runs/${runId}/diff`} token={token} />
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-xs text-[#827D8E] hover:text-white cursor-pointer">
          Not yet
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !base || title.trim().length < 3}
          className="px-4 py-2 rounded-xl bg-[#075BFF] hover:bg-[#1a6bff] text-white text-xs font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitPullRequest className="w-3.5 h-3.5" />} Raise pull request
        </button>
      </div>
    </Modal>
  );
};
