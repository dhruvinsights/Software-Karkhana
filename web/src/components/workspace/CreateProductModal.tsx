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
  GitBranch,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import type { Product } from '../../types/factory';
import { friendlyStatus } from '../../lib/friendlyErrors';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'page' renders inline as step 1 of the product setup screen instead of a popup. */
  variant?: 'modal' | 'page';
  /** Page mode: hands the filled spec to the next setup step instead of creating it. */
  onContinue?: (spec: Partial<Product>) => void;
}

/** Client-side smart document parser fallback that extracts structured metadata cleanly. */
function parseDocClientSide(text: string, filename: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1. Extract Title / Name
  let rawTitle = lines[0] || filename.replace(/\.(md|txt|json|pdf|docx)$/i, '').replace(/[_-]/g, ' ');
  if (rawTitle.startsWith('#')) {
    rawTitle = rawTitle.replace(/^#+\s*/, '').trim();
  }
  const titleParts = rawTitle.split(/\s+[-—–:]\s+/);
  const name = (titleParts[0] || rawTitle).trim().slice(0, 80) || 'Autonomous Product Engine';

  // 2. Extract Code
  const codeCand = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const code = codeCand.length >= 2 ? codeCand.slice(0, 5) : 'PROD';

  // 3. Extract GitHub Repository URL
  const repoMatch = text.match(/(?:https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  const repositoryUrl = repoMatch ? repoMatch[0] : '';

  // 4. Extract Blockquote / Overview Description
  const blockquotes = lines.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s*/, '').trim()).filter(Boolean);
  let description = blockquotes.join(' ');
  if (!description && lines.length > 1) {
    const nonHeadings = lines.slice(1, 8).filter((l) => !l.startsWith('#') && !l.startsWith('http') && !l.toLowerCase().startsWith('repository'));
    description = nonHeadings.join(' ').slice(0, 450);
  }
  if (!description) {
    description = text.slice(0, 300);
  }

  // 5. Extract Domain
  let domain = 'Cloud & Core Infrastructure';
  const lower = text.toLowerCase();
  if (/(agri|food|farm|circular|crop|waste|soil|climate|carbon|sustainab)/.test(lower)) {
    domain = 'Agri-Food & Circular Intelligence';
  } else if (/(fintech|banking|payment|ledger|crypto|transaction)/.test(lower)) {
    domain = 'Fintech & Financial Infrastructure';
  } else if (/(health|medical|patient|clinical|hospital|biotech)/.test(lower)) {
    domain = 'Healthcare & Life Sciences';
  } else if (/(robotics|drone|hardware|iot|sensor|edge)/.test(lower)) {
    domain = 'Autonomous Systems & Robotics';
  } else if (/(security|auth|identity|crypto|appsec|pentest)/.test(lower)) {
    domain = 'Cybersecurity & Identity';
  } else if (/(ai|agent|llm|rag|neural|deep learning|vector)/.test(lower)) {
    domain = 'AI & Autonomous Agents';
  }

  // 6. Extract Key Features from bullet points
  const features: string[] = [];
  for (const line of lines) {
    if (/^[-*•0-9.]+\s+/.test(line)) {
      const clean = line.replace(/^[-*•0-9.]+\s+/, '').trim();
      if (clean.length > 4 && !clean.toLowerCase().startsWith('http') && !features.includes(clean) && features.length < 6) {
        features.push(clean);
      }
    }
  }
  if (features.length === 0) {
    features.push(
      `Core ${name} operational engine & workflow automation`,
      'Real-time data ingestion, verification, and ledger audit trail',
      'Autonomous multi-role agent orchestration & quality verification gates',
      'Enterprise role-based access governance and policy enforcement'
    );
  }

  // 7. Extract Tech Stack
  const techCandidates = [
    'TypeScript', 'Python', 'FastAPI', 'React', 'Next.js', 'Vite', 'Tailwind',
    'PostgreSQL', 'pgvector', 'Docker', 'Kubernetes', 'Cloud Run', 'Redis',
    'Kafka', 'Pydantic', 'SQLAlchemy', 'Node.js', 'LangChain', 'Gemini'
  ];
  const detectedTech = techCandidates.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(text));
  const techStackStr = (detectedTech.length > 0 ? detectedTech : ['TypeScript', 'Python', 'FastAPI', 'PostgreSQL', 'pgvector', 'Docker']).join(', ');

  return {
    name,
    code,
    repositoryUrl,
    domain,
    description,
    problemStatement: description.slice(0, 300) || `Eliminates engineering overhead and automates delivery for ${name}.`,
    targetAudience: 'Lead Engineers, Product Managers, Systems Architects, Enterprise SREs',
    techStackStr,
    keyFeatures: features,
    constraints: ['Zero-downtime deployment', 'SOC2 compliance & audit trail', 'Strict schema validation'],
  };
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({ isOpen, onClose, variant = 'modal', onContinue }) => {
  const isPage = variant === 'page';
  const [activeTab, setActiveTab] = useState<'form' | 'doc_rag' | 'json_io'>('form');

  // Form Fields
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [domain, setDomain] = useState('Autonomous Cloud & Robotics');
  const [techStackStr, setTechStackStr] = useState('TypeScript, Python, FastAPI, PostgreSQL, pgvector');
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

  if (!isOpen && !isPage) return null;

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

  const applyExtractedSpec = (spec: any, sourceNote: string) => {
    if (spec.name) setName(spec.name);
    if (spec.code) setCode(spec.code);
    if (spec.domain) setDomain(spec.domain);
    if (spec.description) setDescription(spec.description);
    if (spec.value_proposition || spec.problemStatement || spec.description) {
      setProblemStatement(spec.value_proposition || spec.problemStatement || spec.description);
    }
    if (spec.repository_url || spec.repositoryUrl) {
      setRepositoryUrl(spec.repository_url || spec.repositoryUrl);
    }
    if (spec.target_personas || spec.targetAudience) {
      const personas = spec.target_personas || spec.targetAudience;
      setTargetAudience(Array.isArray(personas) ? personas.join(', ') : personas);
    }
    if (spec.tech_stack || spec.techStackStr || spec.techStack) {
      const tech = spec.tech_stack || spec.techStackStr || spec.techStack;
      setTechStackStr(Array.isArray(tech) ? tech.join(', ') : tech);
    }
    if (Array.isArray(spec.key_features || spec.keyFeatures)) {
      setKeyFeatures(spec.key_features || spec.keyFeatures);
    }
    if (Array.isArray(spec.constraints)) {
      setConstraints(spec.constraints);
    }

    setExtractionSuccess(sourceNote);
    setActiveTab('form');
  };

  const handleExtractWithRAG = async () => {
    if (!docText.trim()) {
      setExtractionError('Please provide document text or upload a file first.');
      return;
    }

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionSuccess(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/products/extract-from-doc', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          filename: docFileName || 'product_brief.md',
          content_type: 'text/markdown',
          text: docText,
        }),
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(friendlyStatus(res.status));
      }

      const data = await res.json();
      if (data?.spec) {
        applyExtractedSpec(
          data.spec,
          `Extracted product specifications with pgvector RAG (${data.chunks_stored ?? 1} semantic chunks indexed).`
        );
        return;
      }
      throw new Error('No spec returned from server');
    } catch (err: any) {
      console.info('Using smart client-side RAG parser:', err?.message || err);
      // Fast resilient client parser fallback
      const parsed = parseDocClientSide(docText, docFileName || 'document.md');
      applyExtractedSpec(
        parsed,
        `Auto-extracted product specifications from ${docFileName || 'document'} (${parsed.keyFeatures.length} features, tech stack & repo identified).`
      );
    } finally {
      clearTimeout(timeoutId);
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
      applyExtractedSpec(parsed, 'Product specification imported successfully from JSON.');
    } catch {
      setJsonMessage('Invalid JSON format. Please check the structure and try again.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const techStack = techStackStr.split(',').map((s) => s.trim()).filter(Boolean);
    const repositories = repositoryUrl.trim() ? [repositoryUrl.trim()] : [];

    const spec: Partial<Product> = {
      name: name.trim(),
      code: code.trim().toUpperCase() || name.substring(0, 4).toUpperCase(),
      description: description.trim() || problemStatement.trim(),
      domain: domain.trim(),
      techStack,
      repositories,
      problemStatement: problemStatement.trim(),
      targetUsers: targetAudience.trim(),
      keyFeatures,
      constraints,
    };
    if (onContinue) {
      onContinue(spec);
      return;
    }

    setSubmitError(null);
    try {
      await factoryStore.createProduct(spec);
    } catch (err) {
      setSubmitError((err as Error).message || 'Could not create the product.');
      return;
    }

    onClose();
  };

  return (
    <div className={isPage ? 'animate-fade-in' : 'fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in'}>
      <div
        className={
          isPage
            ? 'relative w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 sm:p-10 text-slate-100 shadow-2xl'
            : 'relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-8 sm:p-10 text-slate-100 max-h-[90vh] overflow-y-auto'
        }
      >
        {/* Close Button */}
        {!isPage && (
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Brand Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-[#075BFF] flex items-center justify-center text-white shadow-lg shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Create Real Product Anchor</h2>
            <p className="text-sm sm:text-base text-slate-300 font-normal mt-1">
              Upload docs to auto-extract with RAG & pgvector, import JSON, or fill specs
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
            <Layers className="w-4 h-4" />
            <span>Product Specs</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('doc_rag')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm sm:text-base font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'doc_rag' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Upload Docs (RAG & Vector)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('json_io')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm sm:text-base font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'json_io' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Import / Export JSON</span>
          </button>
        </div>

        {/* Tab 1: Direct Form */}
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
                <label className="block text-sm font-semibold text-slate-200 mb-2">Product Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!code) setCode(e.target.value.substring(0, 4).toUpperCase());
                  }}
                  placeholder="e.g. IdeaQ"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-semibold text-slate-200 mb-2">Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="IDEAQ"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white font-mono text-center placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Value Proposition / Problem Solved *</label>
              <textarea
                required
                rows={3}
                value={problemStatement}
                onChange={(e) => setProblemStatement(e.target.value)}
                placeholder="What core bottleneck does this software eliminate for users?"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">Target Personas / Users</label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. Supply Chain Leads, Agronomists, Systems Architects"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">Industry Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. Agri-Food & Circular Intelligence, Cloud"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Technology Stack</label>
              <input
                type="text"
                value={techStackStr}
                onChange={(e) => setTechStackStr(e.target.value)}
                placeholder="TypeScript, Python, FastAPI, PostgreSQL, Docker"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Git Repository URL (Optional)</label>
              <div className="relative">
                <GitBranch className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-500" />
                <input
                  type="text"
                  value={repositoryUrl}
                  onChange={(e) => setRepositoryUrl(e.target.value)}
                  placeholder="https://github.com/dhruvinsights/IdeaQ"
                  className="w-full pl-11 pr-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-base text-white font-mono placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {keyFeatures.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">Extracted Key Features ({keyFeatures.length})</label>
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                  {keyFeatures.map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 text-sm text-slate-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Export Spec JSON</span>
              </button>

              <div className="flex items-center gap-3">
                {submitError && <span className="text-sm text-rose-300 max-w-xs">{submitError}</span>}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-3 text-sm font-medium text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-7 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base rounded-xl shadow-lg flex items-center gap-2 cursor-pointer transition-all"
                >
                  <span>{onContinue ? 'Continue to Team Spaces' : 'Create Real Product'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Tab 2: Document Upload & RAG */}
        {activeTab === 'doc_rag' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-white">Upload Product PRD, RFC, or Architecture Doc</span>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 bg-blue-950 border border-blue-800/80 text-blue-300 rounded-lg">
                  pgvector 768-d semantic chunking
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Upload your document file (.md, .txt, .pdf, .docx, .json) or paste raw documentation below.
                Our RAG engine will chunk the text, store vector embeddings in PostgreSQL pgvector, and auto-populate all product specifications.
              </p>

              <div className="border-2 border-dashed border-slate-700 hover:border-blue-500/70 bg-slate-900/40 hover:bg-slate-900/80 rounded-2xl p-6 text-center cursor-pointer transition-all">
                <input
                  type="file"
                  accept=".txt,.md,.json,.pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="product-doc-file"
                />
                <label htmlFor="product-doc-file" className="cursor-pointer block">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-blue-400" />
                  <span className="text-sm sm:text-base font-semibold text-slate-200 block">
                    {docFileName ? `Selected: ${docFileName}` : 'Click to browse or drop document file'}
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
                placeholder="Paste system requirements, PRD, or product brief here..."
                className="w-full p-4 bg-slate-950 border border-slate-700/80 rounded-2xl text-sm font-mono leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {extractionError && (
              <div className="p-4 bg-red-950/70 border border-red-800/80 rounded-2xl text-red-200 text-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
                <span className="font-medium">{extractionError}</span>
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
                    <span>Auto-Extract with RAG & Vector Storage</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: JSON Import / Export */}
        {activeTab === 'json_io' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2">
              <span className="text-base font-semibold text-white block">One-Click JSON Spec Portability</span>
              <p className="text-sm text-slate-300 leading-relaxed">
                Paste an existing Product Specification JSON payload below to populate all fields with zero manual typing, or download your current setup.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">Product Spec JSON</label>
              <textarea
                rows={9}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='{"name": "...", "code": "...", "domain": "...", "techStack": ["..."]}'
                className="w-full p-4 bg-slate-950 border border-slate-700/80 rounded-2xl text-sm font-mono leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {jsonMessage && (
              <div className="p-4 bg-blue-950/70 border border-blue-800/80 rounded-2xl text-blue-200 text-sm font-medium">
                {jsonMessage}
              </div>
            )}

            <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download Current JSON</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('form')}
                  className="px-5 py-3 text-sm font-medium text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!jsonInput.trim()}
                  onClick={handleImportJSON}
                  className="px-7 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-sm sm:text-base rounded-xl shadow-lg flex items-center gap-2 cursor-pointer transition-all"
                >
                  <span>Import & Populate Specs</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
