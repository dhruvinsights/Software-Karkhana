import React, { useState, useEffect } from 'react';
import {
  X,
  FolderGit2,
  ArrowRight,
  Users,
  Check,
  Upload,
  Sparkles,
  FileText,
  CheckCircle2,
  AlertCircle,
  Database,
  GitBranch,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { friendlyStatus } from '../../lib/friendlyErrors';

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
}

const TEAM_SPACE_LABEL: Record<string, string> = {
  design: 'Design',
  architecture: 'Architecture',
  developer: 'Development',
  qa: 'QA / QC',
  security: 'Security & Pentest',
  devops: 'CI/CD',
  release: 'Release',
};

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

/** Client-side smart document parser fallback for projects. */
function parseProjectDocClientSide(text: string, filename: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let rawTitle = lines[0] || filename.replace(/\.(md|txt|json|pdf|docx)$/i, '').replace(/[_-]/g, ' ');
  if (rawTitle.startsWith('#')) {
    rawTitle = rawTitle.replace(/^#+\s*/, '').trim();
  }
  const titleParts = rawTitle.split(/\s+[-—–:]\s+/);
  const name = (titleParts[0] || rawTitle).trim().slice(0, 80) || 'Engineering Project';

  const codeCand = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const code = codeCand.length >= 2 ? codeCand.slice(0, 6) : 'PRJ';

  const repoMatch = text.match(/(?:https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  const repositoryUrl = repoMatch ? repoMatch[0] : '';

  const blockquotes = lines.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s*/, '').trim()).filter(Boolean);
  let description = blockquotes.join(' ');
  if (!description && lines.length > 1) {
    const nonHeadings = lines.slice(1, 8).filter((l) => !l.startsWith('#') && !l.startsWith('http') && !l.toLowerCase().startsWith('repository'));
    description = nonHeadings.join(' ').slice(0, 450);
  }
  if (!description) {
    description = text.slice(0, 300);
  }

  return { name, code, description, repositoryUrl };
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ isOpen, onClose, state }) => {
  const [activeTab, setActiveTab] = useState<'form' | 'doc'>('form');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [productId, setProductId] = useState(state.selectedProductId || state.products[0]?.id || '');
  const [targetDate, setTargetDate] = useState('2026-12-31');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [teamPicks, setTeamPicks] = useState<Record<string, string[]>>({});
  const [wsMembers, setWsMembers] = useState<WorkspaceMember[]>([]);
  const [docText, setDocText] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionSuccess, setExtractionSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = state.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null);
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  useEffect(() => {
    if (!isOpen) return;
    const wsId = state.activeWorkspaceId;
    const isRealId = wsId.includes('-') && wsId.length === 36;
    if (isRealId) {
      fetch(`/api/workspaces/${wsId}/members`, { headers: authHeaders })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: WorkspaceMember[]) => setWsMembers(data))
        .catch(() =>
          setWsMembers(state.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.roles[0] || 'developer' })))
        );
    } else {
      setWsMembers(state.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.roles[0] || 'developer' })));
    }
  }, [isOpen, state.activeWorkspaceId]);

  const selectedProduct = state.products.find((p) => p.id === (productId || state.selectedProductId));
  const teamSpaces = selectedProduct?.teamSpaces?.length ? selectedProduct.teamSpaces : Object.keys(TEAM_SPACE_LABEL);
  const togglePick = (space: string, userId: string) => {
    setTeamPicks((prev) => {
      const cur = prev[space] ?? [];
      return { ...prev, [space]: cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId] };
    });
  };

  const teamAssignments = () => {
    const byUser = new Map<string, string[]>();
    for (const space of teamSpaces) {
      for (const userId of teamPicks[space] ?? []) byUser.set(userId, [...(byUser.get(userId) ?? []), space]);
    }
    return [...byUser].map(([userId, stations]) => ({ userId, stations }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDocFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setDocText(content || '');
    };
    reader.readAsText(file);
  };

  const handleExtractWithRAG = async () => {
    if (!docText.trim()) {
      setError('Please provide document text or upload a file first.');
      return;
    }

    setIsExtracting(true);
    setError(null);
    setExtractionSuccess(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch('/api/projects/extract-from-doc', {
        method: 'POST',
        headers: authHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          filename: docFileName || 'project_brief.md',
          content_type: 'text/markdown',
          text: docText,
          workspace_id: state.activeWorkspaceId,
          product_id: productId || state.selectedProductId || undefined,
        }),
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(friendlyStatus(res.status));
      }

      const data = await res.json();
      const spec = data?.spec;

      if (spec) {
        if (spec.name) setName(spec.name);
        if (spec.code) setCode(spec.code);
        if (spec.description || spec.value_proposition) {
          setDescription(spec.description || spec.value_proposition);
        }
        if (spec.repository_url || spec.repositoryUrl) {
          setRepositoryUrl(spec.repository_url || spec.repositoryUrl);
        }
        setExtractionSuccess(
          `Extracted project specifications with pgvector RAG (${data.chunks_stored ?? 1} semantic chunks indexed).`
        );
        setActiveTab('form');
        return;
      }
      throw new Error('No spec returned from server');
    } catch (err: any) {
      console.info('Using smart client-side RAG parser for project:', err?.message || err);
      const parsed = parseProjectDocClientSide(docText, docFileName || 'project_brief.md');
      setName(parsed.name);
      setCode(parsed.code);
      setDescription(parsed.description);
      if (parsed.repositoryUrl) setRepositoryUrl(parsed.repositoryUrl);
      setExtractionSuccess(`Auto-extracted project specifications from ${docFileName || 'document'}.`);
      setActiveTab('form');
    } finally {
      clearTimeout(timeoutId);
      setIsExtracting(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const projCode = code.trim().toUpperCase() || `P-${state.projects.length + 1}`;
    const targetProdId = productId || state.selectedProductId || state.products[0]?.id || '';

    setSubmitting(true);
    setError(null);
    try {
      await factoryStore.createProject({
        name: name.trim(),
        code: projCode,
        description: description.trim() || `Engineering workspace for ${name.trim()}`,
        productId: targetProdId,
        targetReleaseDate: targetDate,
        repositoryUrl: repositoryUrl.trim() || undefined,
        members: teamAssignments(),
      });
    } catch (err) {
      setError((err as Error).message || 'Could not create the project.');
      if ((err as Error & { projectCreated?: boolean }).projectCreated) {
        // It exists already; clear the form so resubmitting can't create a duplicate.
        setName('');
        setTeamPicks({});
      }
      return;
    } finally {
      setSubmitting(false);
    }

    setName('');
    setCode('');
    setDescription('');
    setSelectedMemberIds([]);
    setTeamPicks({});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-8 sm:p-10 text-slate-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-[#075BFF] flex items-center justify-center text-white shadow-lg shrink-0">
            <FolderGit2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Create Engineering Project</h2>
            <p className="text-sm sm:text-base text-slate-300 font-normal mt-1">
              Open to all workspace team members (Developers, PMs, Architects, Leads)
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded-2xl mb-8">
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm sm:text-base font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'form' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FolderGit2 className="w-4 h-4" />
            <span>Project Specs</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('doc')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm sm:text-base font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'doc' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Upload Docs (RAG & Auto-Fill)</span>
          </button>
        </div>

        {activeTab === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {extractionSuccess && (
              <div className="p-4 bg-emerald-950/70 border border-emerald-700/80 rounded-2xl text-emerald-200 text-sm sm:text-base flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                <span className="font-medium">{extractionSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-3">
                <label className="block text-sm font-semibold text-slate-200 mb-2">Project Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!code) setCode(`P-${state.projects.length + 1}`);
                  }}
                  placeholder="e.g. Telemetry Stream Processor"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-semibold text-slate-200 mb-2">Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="PRJ-1"
                  maxLength={8}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white font-mono text-center placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Parent Product Anchor</label>
              {state.products.length > 0 ? (
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  {state.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-sm text-amber-300">
                  No products created yet. This project will be anchored to the workspace.
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Engineering Scope & Objectives</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What core deliverables, services, or features does this project build?"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">Target Release Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">Git Repository URL</label>
                <div className="relative">
                  <GitBranch className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={repositoryUrl}
                    onChange={(e) => setRepositoryUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                    className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </div>

            {/* Team spaces */}
            {wsMembers.filter((m) => m.id !== state.currentUser?.id).length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-1.5">
                  <Users className="w-4 h-4 inline mr-1.5" />
                  Team spaces · pick people for each
                </label>
                <p className="text-xs text-slate-400 mb-3">
                  Each person only sees the team spaces they're picked for. You get the PM view of everything.
                </p>
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {teamSpaces.map((space) => (
                    <div key={space} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-white">{TEAM_SPACE_LABEL[space] ?? space}</span>
                        <span className="text-xs font-mono text-slate-400">{(teamPicks[space] ?? []).length} picked</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {wsMembers
                          .filter((m) => m.id !== state.currentUser?.id)
                          .map((m) => {
                            const selected = (teamPicks[space] ?? []).includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => togglePick(space, m.id)}
                                title={`${m.name} · ${m.role}`}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                style={{
                                  background: selected ? 'rgba(7,91,255,0.15)' : 'rgba(0,0,0,0.3)',
                                  border: selected ? '1px solid rgba(7,91,255,0.6)' : '1px solid rgba(255,255,255,0.1)',
                                  color: selected ? 'white' : 'rgb(156,163,175)',
                                }}
                              >
                                <span className="w-4 h-4 rounded bg-[#075BFF]/20 flex items-center justify-center text-[10px] font-bold text-[#5B8FFF]">
                                  {m.name.charAt(0).toUpperCase()}
                                </span>
                                <span className="truncate max-w-[130px]">{m.name}</span>
                                {selected && <Check className="w-3.5 h-3.5 text-blue-400" />}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <div className="pt-6 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 text-sm font-medium text-slate-400 hover:text-white cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-7 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base rounded-xl shadow-lg flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                <span>{submitting ? 'Creating…' : 'Create Project'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Document Upload & RAG */}
        {activeTab === 'doc' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-white">Upload Project PRD or Spec Doc</span>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 bg-blue-950 border border-blue-800/80 text-blue-300 rounded-lg">
                  pgvector RAG
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Upload your project documentation or paste requirements text below. Our RAG system will extract scope, architecture, and objectives.
              </p>

              <div className="border-2 border-dashed border-slate-700 hover:border-blue-500/70 bg-slate-900/40 hover:bg-slate-900/80 rounded-2xl p-6 text-center cursor-pointer transition-all">
                <input
                  type="file"
                  accept=".txt,.md,.json,.pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="project-doc-file"
                />
                <label htmlFor="project-doc-file" className="cursor-pointer block">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-blue-400" />
                  <span className="text-sm sm:text-base font-semibold text-slate-200 block">
                    {docFileName ? `Selected: ${docFileName}` : 'Click to browse or drop project document'}
                  </span>
                  <span className="text-xs sm:text-sm text-slate-400 mt-1 block">Supports Markdown, Text, Specs, JSON</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Or Paste Document Text Directly</label>
              <textarea
                rows={9}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste project PRD, architecture notes, or technical brief..."
                className="w-full p-4 bg-slate-950 border border-slate-700/80 rounded-2xl text-sm font-mono leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-950/70 border border-red-800/80 rounded-2xl text-red-200 text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            <div className="pt-6 border-t border-slate-800 flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className="px-5 py-3 text-sm font-medium text-slate-400 hover:text-white cursor-pointer transition-colors"
              >
                Back to Specs
              </button>
              <button
                type="button"
                disabled={isExtracting || !docText.trim()}
                onClick={handleExtractWithRAG}
                className="px-7 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-sm sm:text-base rounded-2xl shadow-xl flex items-center gap-2.5 cursor-pointer transition-all"
              >
                {isExtracting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing with RAG & pgvector...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Auto-Extract & Populate Project</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
