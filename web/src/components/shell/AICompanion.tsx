import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  X,
  Send,
  FileCode2,
  Layers,
  RefreshCw,
  ChevronRight,
  Upload,
  Trash2,
  Plus,
  BookOpen,
  MessageSquare,
  Database,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';

interface AICompanionProps {
  state: FactoryState;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp?: string;
}

interface RagDocument {
  id: string;
  title: string;
  tags: string[];
  created_at: string;
  chunk_count: number;
}

const SESSION_STORAGE_KEY = 'karkhana_rag_session_id';

function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sid) {
    sid = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
  }
  return sid;
}

const QUICK_ACTIONS = [
  { label: 'Security scan diff', prompt: 'Perform a CodeRabbit diff security review on current branch', icon: FileCode2 },
  { label: 'Draft ADR', prompt: 'Draft an Architecture Decision Record (ADR) for this component', icon: Layers },
  { label: 'Explain RAG pipeline', prompt: 'How does the RAG pipeline work in this project?', icon: Database },
  { label: 'Deployment guide', prompt: 'How do I deploy this to Cloud Run?', icon: BookOpen },
];

export const AICompanion: React.FC<AICompanionProps> = ({ state }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId] = useState<string>(getOrCreateSessionId);
  const [activeTab, setActiveTab] = useState<'chat' | 'docs'>('chat');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestContent, setIngestContent] = useState('');
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeProject = state.projects.find((p) => p.id === state.selectedProjectId);
  const activePr = state.pullRequests.find((p) => p.id === state.selectedPrId);

  // The RAG API is tenant-scoped: every call needs a server workspace id (a UUID).
  // The offline placeholder workspace ('ws-main') has no server records, so the
  // companion stays disabled until a real workspace is loaded.
  const workspaceId = /^[0-9a-f-]{36}$/i.test(state.activeWorkspaceId || '') ? state.activeWorkspaceId : null;
  const wsQuery = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';

  const token = state.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('karkhana_jwt_token') : null);
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Load chat history on mount
  useEffect(() => {
    if (!state.companionOpen) return;
    if (!workspaceId) {
      setMessages([]);
      return;
    }
    const loadHistory = async () => {
      try {
        const res = await fetch(`/api/rag/history/${encodeURIComponent(sessionId)}${wsQuery}`, { headers: authHeaders });
        if (res.ok) {
          const data: ChatMessage[] = await res.json();
          if (data.length > 0) {
            setMessages(data);
            return;
          }
        }
      } catch {
        // Offline — start fresh
      }
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm your Factory AI Companion powered by **RAG + ${state.companionOpen ? 'Ollama/Gemini' : 'Ollama'}**.\n\nI'm grounded in *${state.workspace.name}*'s knowledge base. I can answer questions about the codebase, architecture decisions, and any documents you ingest.\n\nCurrent context: **${state.currentScreen}**`,
        timestamp: new Date().toISOString(),
      }]);
    };
    loadHistory();
  }, [state.companionOpen, sessionId, workspaceId]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load documents on docs tab
  useEffect(() => {
    if (activeTab !== 'docs' || !state.companionOpen) return;
    if (!workspaceId) {
      setDocuments([]);
      return;
    }
    loadDocuments();
  }, [activeTab, state.companionOpen, workspaceId]);

  const loadDocuments = async () => {
    if (!workspaceId) return;
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/rag/documents${wsQuery}`, { headers: authHeaders });
      if (res.ok) {
        const data: RagDocument[] = await res.json();
        setDocuments(data);
      }
    } catch {
      // offline
    } finally {
      setDocsLoading(false);
    }
  };

  const handleSend = useCallback(async (customPrompt?: string) => {
    const text = (customPrompt ?? input).trim();
    if (!text || loading || !workspaceId) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          workspace_id: workspaceId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.reply,
          sources: data.sources,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error('Non-OK response');
      }
    } catch {
      // Fallback using old gemini companion endpoint
      try {
        const fallbackRes = await fetch('/api/gemini/companion', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
            context: {
              role: state.currentRole,
              screen: state.currentScreen,
              entityTitle: activePr?.title || activeProject?.name || state.workspace.name,
            },
          }),
        });
        const fallbackData = await fallbackRes.json();
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: fallbackData.reply || 'I completed the analysis. No additional context was retrieved from the knowledge base.',
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `⚠️ AI model is offline. Make sure Ollama is running (\`ollama serve\`) or that \`GEMINI_API_KEY\` is set.\n\nIn the meantime: for **${state.currentScreen}** questions, check the docs tab to ingest reference material.`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, sessionId, state, authHeaders, activeProject, activePr, workspaceId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = async () => {
    if (!workspaceId) return;
    try {
      await fetch(`/api/rag/history/${encodeURIComponent(sessionId)}${wsQuery}`, { method: 'DELETE', headers: authHeaders });
    } catch { /* offline */ }
    setMessages([{
      role: 'assistant',
      content: 'Chat history cleared. How can I help you?',
      timestamp: new Date().toISOString(),
    }]);
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !ingestTitle.trim() || !ingestContent.trim()) return;
    setIngestLoading(true);
    try {
      const res = await fetch('/api/rag/ingest', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: ingestTitle.trim(),
          content: ingestContent.trim(),
          workspace_id: workspaceId,
          tags: ['manual'],
        }),
      });
      if (res.ok) {
        setIngestTitle('');
        setIngestContent('');
        setIngestOpen(false);
        await loadDocuments();
      }
    } catch { /* offline */ }
    finally { setIngestLoading(false); }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/rag/documents/${encodeURIComponent(docId)}${wsQuery}`, { method: 'DELETE', headers: authHeaders });
      if (res.ok) setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch { /* offline */ }
  };

  if (!state.companionOpen) return null;

  const panelWidth = expanded ? 'w-[680px]' : 'w-[420px]';

  return (
    <aside
      className={`${panelWidth} bg-[#0A0A0F] border-l border-white/[0.08] flex flex-col h-full shadow-2xl z-20 shrink-0 relative overflow-hidden transition-all duration-200`}
      style={{ minWidth: expanded ? 680 : 420, maxWidth: expanded ? 680 : 420 }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between bg-[#101016] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#075BFF] flex items-center justify-center text-white shadow-xs shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#F6F5FA] leading-none">AI Factory Companion</div>
            <div className="text-[10px] text-[#827D8E] mt-0.5 font-mono">RAG · LangChain · Ollama/Gemini</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Shrink panel' : 'Expand panel'}
            className="p-1.5 rounded-md text-[#827D8E] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleClearHistory}
            disabled={!workspaceId}
            title="Clear chat history"
            className="p-1.5 rounded-md text-[#827D8E] hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => factoryStore.toggleCompanion()}
            className="p-1.5 rounded-md text-[#827D8E] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Context Bar */}
      <div className="px-4 py-2 bg-[#07070B] border-b border-white/[0.08] flex flex-wrap gap-1.5 items-center shrink-0">
        <span className="text-[10px] font-mono text-[#827D8E] uppercase tracking-wider">Context:</span>
        <span className="bg-[#101016] border border-white/[0.08] px-2 py-0.5 rounded text-[10px] text-[#F6F5FA] font-mono">
          {state.currentRole}
        </span>
        <span className="bg-[#101016] border border-white/[0.08] px-2 py-0.5 rounded text-[10px] text-[#B5B1C0] font-mono truncate max-w-[130px]">
          {state.currentScreen}
        </span>
        {activePr && (
          <span className="bg-[#075BFF]/10 border border-[#075BFF]/30 px-2 py-0.5 rounded text-[10px] text-[#075BFF] font-mono">
            PR #{activePr.number}
          </span>
        )}
        {activeProject && (
          <span className="bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded text-[10px] text-[#B5B1C0] font-mono truncate max-w-[130px]">
            {activeProject.name}
          </span>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b border-white/[0.08] bg-[#0A0A0F] shrink-0">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'chat'
              ? 'border-[#075BFF] text-white'
              : 'border-transparent text-[#827D8E] hover:text-white'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'docs'
              ? 'border-[#075BFF] text-white'
              : 'border-transparent text-[#827D8E] hover:text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          Knowledge Base {documents.length > 0 && <span className="text-[10px] font-mono text-[#075BFF]">({documents.length})</span>}
        </button>
      </div>

      {!workspaceId && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2 bg-[#07070B]">
          <Database className="w-8 h-8 text-[#4e5668]" />
          <p className="text-xs text-[#B5B1C0]">Sign in and select a workspace to use the AI Companion.</p>
          <p className="text-[11px] text-[#4e5668]">The knowledge base is private to each workspace.</p>
        </div>
      )}

      {/* --- CHAT TAB --- */}
      {workspaceId && activeTab === 'chat' && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#07070B]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-xs ${
                    msg.role === 'user'
                      ? 'bg-[#075BFF] text-white rounded-br-sm'
                      : 'bg-[#101016] text-[#F6F5FA] rounded-bl-sm border border-white/[0.08]'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-1">
                      <span className="text-[10px] text-[#827D8E] font-mono">Sources:</span>
                      {msg.sources.map((s, si) => (
                        <span key={si} className="text-[10px] bg-[#075BFF]/10 text-[#075BFF] px-1.5 py-0.5 rounded font-mono">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-[#4e5668] mt-1 px-1 font-mono">
                  {msg.role === 'user' ? 'You' : 'Companion'}
                  {msg.timestamp && ` · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-[#075BFF] py-2 font-mono">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Retrieving context & generating response…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 border-t border-white/[0.08] bg-[#0A0A0F] space-y-1.5 shrink-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#4e5668]">Quick Actions</div>
            <div className="grid grid-cols-2 gap-1">
              {QUICK_ACTIONS.map((action, i) => {
                const Icon = action.icon;
                return (
                  <button
                    key={i}
                    onClick={() => handleSend(action.prompt)}
                    disabled={loading}
                    className="text-left px-2.5 py-1.5 rounded-lg bg-[#101016] border border-white/[0.08] text-[#B5B1C0] hover:border-[#075BFF]/50 hover:text-white text-[11px] flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Icon className="w-3.5 h-3.5 text-[#075BFF] shrink-0" />
                    <span className="truncate">{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input */}
          <div className="p-3 border-t border-white/[0.08] bg-[#101016] shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={2}
                placeholder="Ask about the codebase, architecture, RAG pipeline… (Shift+Enter for newline)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                className="flex-1 text-xs px-3 py-2 bg-[#07070B] border border-white/[0.1] rounded-xl outline-none focus:border-[#075BFF] focus:bg-[#0A0A0F] transition-all text-[#F6F5FA] placeholder-[#827D8E] resize-none"
                style={{ minHeight: 56, maxHeight: 120 }}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                className="k-btn-primary p-2.5 bg-[#075BFF] text-white rounded-xl hover:bg-[#075BFF]/90 disabled:opacity-40 transition-colors shadow-xs self-end shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* --- DOCS / KNOWLEDGE BASE TAB --- */}
      {workspaceId && activeTab === 'docs' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#07070B]">
          {/* Ingest form toggle */}
          <div className="p-4 border-b border-white/[0.08] shrink-0">
            <button
              onClick={() => setIngestOpen((v) => !v)}
              className="k-btn-secondary w-full py-2 px-4 bg-[#101016] hover:bg-[#17151D] border border-white/[0.08] rounded-xl text-xs font-medium text-[#B5B1C0] hover:text-white flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-[#075BFF]" />
              <span>Ingest New Document</span>
            </button>

            {ingestOpen && (
              <form onSubmit={handleIngest} className="mt-3 space-y-2.5">
                <input
                  type="text"
                  placeholder="Document title (e.g. Auth Architecture Overview)"
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E]"
                />
                <textarea
                  rows={5}
                  placeholder="Paste markdown, code, or any text content to add to the knowledge base…"
                  value={ingestContent}
                  onChange={(e) => setIngestContent(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-[#07070B] border border-white/[0.08] rounded-xl outline-none focus:border-[#075BFF] text-white placeholder-[#827D8E] resize-none font-mono"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIngestOpen(false)}
                    className="flex-1 py-2 bg-[#101016] rounded-xl text-xs text-[#827D8E] hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={ingestLoading || !ingestTitle.trim() || !ingestContent.trim()}
                    className="k-btn-primary flex-1 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {ingestLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>{ingestLoading ? 'Ingesting…' : 'Ingest'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {docsLoading && (
              <div className="flex items-center gap-2 text-xs text-[#075BFF] font-mono py-4 justify-center">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Loading documents…</span>
              </div>
            )}
            {!docsLoading && documents.length === 0 && (
              <div className="text-center py-10 space-y-2">
                <Database className="w-8 h-8 text-[#4e5668] mx-auto" />
                <p className="text-xs text-[#827D8E]">No documents ingested yet.</p>
                <p className="text-[11px] text-[#4e5668]">
                  Ingest architecture docs, README files, or meeting notes to ground the AI in your team's knowledge.
                </p>
              </div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-3.5 bg-[#101016] border border-white/[0.08] rounded-xl space-y-1.5 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-3.5 h-3.5 text-[#075BFF] shrink-0" />
                    <span className="text-xs font-medium text-white truncate">{doc.title}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteDocument(doc.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#827D8E] hover:text-rose-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-[#827D8E]">
                  <span>{doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                  {doc.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-[#075BFF]/10 text-[#075BFF] rounded text-[10px]">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};
