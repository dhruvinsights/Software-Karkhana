import React, { useState } from 'react';
import { X, Layers, ArrowRight, Sparkles, Code2, Users, Compass, GitBranch } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [domain, setDomain] = useState('Autonomous Cloud & Robotics');
  const [techStackStr, setTechStackStr] = useState('TypeScript, Rust, Cloud Run, PostgreSQL');
  const [repositoryUrl, setRepositoryUrl] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const techStack = techStackStr.split(',').map((s) => s.trim()).filter(Boolean);
    const repositories = repositoryUrl.trim() ? [repositoryUrl.trim()] : [];

    factoryStore.createProduct({
      name: name.trim(),
      code: code.trim().toUpperCase() || name.substring(0, 3).toUpperCase(),
      description: description.trim() || problemStatement.trim(),
      domain: domain.trim(),
      techStack,
      repositories,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-slate-100 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Create New Product</h3>
            <p className="text-[11px] text-slate-400">Define the core intent, audience, and boundary constraints</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-300 mb-1">Product Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!code) setCode(e.target.value.substring(0, 3).toUpperCase());
                }}
                placeholder="e.g. Cloud Telemetry Ingestion Service"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-300 mb-1">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CIS"
                maxLength={5}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono text-center focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Problem Being Solved *</label>
            <textarea
              required
              rows={2}
              value={problemStatement}
              onChange={(e) => setProblemStatement(e.target.value)}
              placeholder="What core pain point or bottleneck does this software eliminate?"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Audience / Users</label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g. Fleet SREs, Embedded Engineers"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Industry Domain</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Technology Stack (Comma-separated)</label>
            <input
              type="text"
              value={techStackStr}
              onChange={(e) => setTechStackStr(e.target.value)}
              placeholder="Rust, TypeScript, Cloud Run, gRPC"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Git Repository (Optional)</label>
            <input
              type="text"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              placeholder="github.com/my-org/my-engine"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5"
            >
              <span>Create Product & Launch</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
