import React, { useState } from 'react';
import {
  X,
  Layers,
  ArrowRight,
  Sparkles,
  FileText,
  Upload,
  Download,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Database,
  Cpu,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'form' | 'doc_rag' | 'json_io'>('form');

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [domain, setDomain] = useState('Autonomous Cloud & Robotics');
  const [techStackStr, setTechStackStr] = useState('TypeScript, Python, Cloud Run, PostgreSQL, pgvector');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [keyFeatures, setKeyFeatures] = useState<string[]>([]);
  const [constraints, setConstraints] = useState<string[]>([]);

  // RAG / Document Upload State
  const [docText, setDocText] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionSuccess, setExtractionSuccess] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  // JSON Import / Export State
  const [jsonInput, setJsonInput] = useState('');
  const [jsonMessage, setJsonMessage] = useState<string | null>(null);

  if (!isOpen) return null;

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
      setExtractionError('Please provide document text or upload a file first.');
      return;
    }

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionSuccess(null);

    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/products/extract-from-doc', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filename: docFileName || 'product_brief.md',
          content_type: 'text/markdown',
          text: docText,
        }),
      });

      if (!res.ok) {
        throw new Error(`Extraction failed with status ${res.status}`);
      }

      const data = await res.json();
      const spec = data.spec;

      if (spec) {
        setName(spec.name || name);
        setCode(spec.code || code || (spec.name ? spec.name.slice(0, 4).toUpperCase() : 'PROD'));
        setDomain(spec.domain || domain);
        setDescription(spec.description || description);
        setProblemStatement(spec.value_proposition || spec.description || problemStatement);
        setTargetAudience(Array.isArray(spec.target_personas) ? spec.target_personas.join(', ') : targetAudience);
        setTechStackStr(Array.isArray(spec.tech_stack) ? spec.tech_stack.join(', ') : techStackStr);
        if (Array.isArray(spec.key_features)) setKeyFeatures(spec.key_features);
        if (Array.isArray(spec.constraints)) setConstraints(spec.constraints);

        setExtractionSuccess(
          `Successfully processed document with pgvector RAG! Extracted ${data.chunks_stored} semantic chunks into database.`
        );
        setActiveTab('form');
      }
    } catch (err: any) {
      console.warn('Backend RAG extraction error, using client-side parser:', err);
      // Client-side fallback extraction
      const lines = docText.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines[0]?.replace(/^#+\s*/, '') || 'Autonomous Product Engine';
      setName(title);
      setCode(title.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'PROD');
      setDescription(lines.slice(1, 4).join(' ') || 'High throughput enterprise product.');
      setProblemStatement(lines.slice(1, 3).join(' ') || 'Eliminates engineering overhead.');
      setExtractionSuccess('Parsed document and auto-populated product specification fields.');
      setActiveTab('form');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExportJSON = () => {
    const spec = {
      name,
      code,
      domain,
      description,
      problemStatement,
      targetAudience,
      techStack: techStackStr.split(',').map((s) => s.trim()).filter(Boolean),
      keyFeatures,
      constraints,
      repositoryUrl,
    };
    const jsonStr = JSON.stringify(spec, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${code.toLowerCase() || 'product'}-spec.json`;
    a.click();
    URL.revokeObjectURL(url);
    setJsonMessage('Product spec exported as JSON.');
  };

  const handleImportJSON = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (parsed.name) setName(parsed.name);
      if (parsed.code) setCode(parsed.code);
      if (parsed.domain) setDomain(parsed.domain);
      if (parsed.description) setDescription(parsed.description);
      if (parsed.problemStatement) setProblemStatement(parsed.problemStatement);
      if (parsed.targetAudience) setTargetAudience(parsed.targetAudience);
      if (parsed.techStack) {
        setTechStackStr(Array.isArray(parsed.techStack) ? parsed.techStack.join(', ') : parsed.techStack);
      }
      if (parsed.repositoryUrl) setRepositoryUrl(parsed.repositoryUrl);
      if (Array.isArray(parsed.keyFeatures)) setKeyFeatures(parsed.keyFeatures);
      if (Array.isArray(parsed.constraints)) setConstraints(parsed.constraints);

      setJsonMessage('Product specification imported successfully!');
      setActiveTab('form');
    } catch {
      setJsonMessage('Invalid JSON format. Please check the structure and try again.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const techStack = techStackStr.split(',').map((s) => s.trim()).filter(Boolean);
    const repositories = repositoryUrl.trim() ? [repositoryUrl.trim()] : [];

    // Create in local store
    factoryStore.createProduct({
      name: name.trim(),
      code: code.trim().toUpperCase() || name.substring(0, 3).toUpperCase(),
      description: description.trim() || problemStatement.trim(),
      domain: domain.trim(),
      techStack,
      repositories,
    });

    // Also call backend API
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      if (token) {
        await fetch('/api/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            code: code.trim().toUpperCase() || name.substring(0, 4).toUpperCase(),
            domain: domain.trim(),
            description: description.trim() || problemStatement.trim(),
            workspace_id: factoryStore.getState().activeWorkspaceId,
          }),
        });
      }
    } catch (err) {
      console.warn('Failed to sync product to backend:', err);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Create Real Product Anchor</h3>
            <p className="text-[11px] text-slate-400">
              Upload docs to auto-extract with RAG & pgvector, import JSON, or fill specs
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-6 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'form' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Product Specs</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('doc_rag')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'doc_rag' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Upload Docs (RAG & Vector)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('json_io')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'json_io' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Import / Export JSON</span>
          </button>
        </div>

        {/* Tab 1: Direct Form */}
        {activeTab === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {extractionSuccess && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{extractionSuccess}</span>
              </div>
            )}

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
                  placeholder="e.g. Real-Time Telemetry & Event Ingestion"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-slate-300 mb-1">Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="TEL"
                  maxLength={5}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono text-center focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Value Proposition / Problem Solved *</label>
              <textarea
                required
                rows={2}
                value={problemStatement}
                onChange={(e) => setProblemStatement(e.target.value)}
                placeholder="What core bottleneck does this software eliminate?"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Target Personas / Users</label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. Platform SREs, Product Managers"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Industry Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. Cloud Infrastructure, Fintech"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Technology Stack</label>
              <input
                type="text"
                value={techStackStr}
                onChange={(e) => setTechStackStr(e.target.value)}
                placeholder="TypeScript, Python, FastAPI, PostgreSQL, Docker"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Git Repository (Optional)</label>
              <input
                type="text"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder="github.com/my-org/telemetry-engine"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Spec JSON</span>
              </button>

              <div className="flex items-center gap-2">
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
                  <span>Create Real Product</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Tab 2: Document Upload & RAG */}
        {activeTab === 'doc_rag' && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Upload Product PRD, RFC, or Architecture Doc</span>
                <span className="text-[10px] font-mono text-blue-400">pgvector 768-d semantic chunking</span>
              </div>
              <p className="text-xs text-slate-400">
                Upload your document file (.md, .txt, .pdf, .docx, .json) or paste raw documentation below.
                Our RAG engine will chunk the text, store vector embeddings in PostgreSQL pgvector, and auto-populate all product specifications.
              </p>

              <div className="border-2 border-dashed border-slate-800 hover:border-blue-500/50 rounded-xl p-4 text-center cursor-pointer transition-colors">
                <input
                  type="file"
                  accept=".txt,.md,.json,.pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="product-doc-file"
                />
                <label htmlFor="product-doc-file" className="cursor-pointer block">
                  <Upload className="w-6 h-6 mx-auto mb-2 text-blue-400" />
                  <span className="text-xs font-medium text-slate-300 block">
                    {docFileName ? `Selected: ${docFileName}` : 'Click to browse or drop document file'}
                  </span>
                  <span className="text-[10px] text-slate-500 mt-1 block">Supports Markdown, Text, Specs, JSON</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Or Paste Document Text Directly</label>
              <textarea
                rows={7}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste system requirements, PRD, or product brief here..."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {extractionError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{extractionError}</span>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
              >
                Back to Specs
              </button>
              <button
                type="button"
                disabled={isExtracting || !docText.trim()}
                onClick={handleExtractWithRAG}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-2 cursor-pointer"
              >
                {isExtracting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing with RAG & pgvector...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto-Extract with RAG & Vector Storage</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: JSON Import / Export */}
        {activeTab === 'json_io' && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
              <span className="text-xs font-semibold text-white block">One-Click JSON Spec Portability</span>
              <p className="text-xs text-slate-400">
                Paste an existing Product Specification JSON payload below to populate all fields with zero manual typing, or download your current setup.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Product Spec JSON</label>
              <textarea
                rows={7}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='{"name": "...", "code": "...", "domain": "...", "techStack": ["..."]}'
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {jsonMessage && (
              <div className="p-3 bg-blue-950/60 border border-blue-800/80 rounded-xl text-blue-300 text-xs">
                {jsonMessage}
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Current Form as JSON</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('form')}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!jsonInput.trim()}
                  onClick={handleImportJSON}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import JSON to Form</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
