import React, { useState } from 'react';
import { X, FolderGit2, ArrowRight, Calendar, Users, Code2, Link, Check, Sparkles } from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FactoryState;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ isOpen, onClose, state }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [productId, setProductId] = useState(state.selectedProductId || state.products[0]?.id || '');
  const [targetDate, setTargetDate] = useState('2026-12-31');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [assignedRole, setAssignedRole] = useState(state.currentUser?.role || 'developer');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const projCode = code.trim().toUpperCase() || `P-${state.projects.length + 1}`;
    const targetProdId = productId || state.selectedProductId || state.products[0]?.id || '';

    // Update local store
    factoryStore.createProject({
      name: name.trim(),
      code: projCode,
      description: description.trim() || `Engineering workspace for ${name.trim()}`,
      productId: targetProdId,
      targetReleaseDate: targetDate,
      repositoryUrl: repositoryUrl.trim() || `github.com/org/${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    });

    // Sync to backend API
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      if (token) {
        await fetch('/api/projects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            idea_text: description.trim() || `Project ${name.trim()} initialized.`,
            product_id: targetProdId.includes('-') && targetProdId.length === 36 ? targetProdId : null,
            workspace_id: state.activeWorkspaceId.includes('-') && state.activeWorkspaceId.length === 36 ? state.activeWorkspaceId : null,
            code: projCode,
            description: description.trim(),
            repository_url: repositoryUrl.trim(),
            target_release_date: targetDate,
          }),
        });
      }
    } catch (err) {
      console.warn('Backend project creation sync skipped:', err);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <FolderGit2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Create Engineering Project</h3>
            <p className="text-[11px] text-slate-400">
              Open to all workspace team members (Developers, PMs, Architects, Leads)
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-300 mb-1">Project Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!code) setCode(`P-${state.projects.length + 1}`);
                }}
                placeholder="e.g. Telemetry Stream Processor"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-300 mb-1">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PRJ-1"
                maxLength={8}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono text-center focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Parent Product Anchor</label>
            {state.products.length > 0 ? (
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {state.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-amber-300">
                No products created yet. This project will be anchored to the workspace.
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Engineering Scope & Objectives</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What core deliverables, services, or features does this project build?"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Release Date</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Git Repository</label>
              <input
                type="text"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder="github.com/org/repo"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span>Create Project</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
