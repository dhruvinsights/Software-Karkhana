import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Bot,
  Send,
  Plus,
  RefreshCw,
  FolderGit2,
  CheckCircle2,
  Clock,
  ArrowRight,
  Shield,
  FileCode,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  AlertCircle,
  MessageSquare,
  Cpu,
  Bookmark,
  Layers,
  ChevronDown,
  X,
  Play
} from 'lucide-react';
import { FactoryState, factoryStore } from '../../store/factoryStore';
import { AIProviderInfo, Idea, IdeaChat, IdeaChatMessage, IdeaScan } from '../../types/factory';
import { SoftAurora } from '../reactbits/SoftAurora';
import { ThoughtLine } from '../reactbits/ThoughtLine';
import { BorderGlow } from '../reactbits/BorderGlow';
import { IdeaApprovalPanel } from './IdeaApprovalPanel';
import { fetchGitHubStatus, startGitHubDeviceFlow, pollGitHubDeviceFlow, saveGitHubTokenDirect, GitHubStatus } from '../../lib/githubApi';
import { chatSocket } from '../../lib/chatSocket';
import { MarkdownMessage } from '../MarkdownMessage';

const GithubIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

interface ProductIdeaLabProps {
  state: FactoryState;
  productId?: string;
  onOpenProjectCreate?: (fromIdea?: Idea) => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  promoted: 'Project created',
};

export const ProductIdeaLab: React.FC<ProductIdeaLabProps> = ({ state, productId, onOpenProjectCreate }) => {
  const token = state.token ?? '';
  const activeProduct = state.products.find((p) => p.id === (productId || state.selectedProductId)) || state.products[0];

  // Provider and models
  const [providers, setProviders] = useState<AIProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('ollama');
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  // Chats & Messages
  const [chats, setChats] = useState<IdeaChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IdeaChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);

  // Ideas & Scans
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [scans, setScans] = useState<IdeaScan[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState('Initiating scan...');

  // Modals & Panels
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({ connected: false });
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [deviceFlow, setDeviceFlow] = useState<{ user_code: string; verification_uri: string; device_code: string; interval: number } | null>(null);
  const [reviewModalIdea, setReviewModalIdea] = useState<Idea | null>(null);
  const [evalModalIdea, setEvalModalIdea] = useState<Idea | null>(null);
  const [evaluatingIdeaId, setEvaluatingIdeaId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const repoUrl = activeProduct?.settings?.repositoryUrl || '';

  // 1. Initial Data Fetch
  useEffect(() => {
    if (!token || !activeProduct) return;

    // Fetch Providers
    fetch('/api/ai/providers', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: AIProviderInfo[]) => {
        setProviders(data);
        const avail = data.find((p) => p.available) || data[0];
        if (avail) {
          setSelectedProvider(avail.id);
          setSelectedModel(avail.defaultModel);
        }
      })
      .catch(() => {});

    // Fetch GitHub status
    fetchGitHubStatus(token).then(setGithubStatus).catch(() => {});

    // Fetch Ideas
    fetch(`/api/ideas?product_id=${activeProduct.id}&workspace_id=${state.activeWorkspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setIdeas(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch Scans
    fetch(`/api/products/${activeProduct.id}/idea-scans`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setScans(data))
      .catch(() => {});

    // Fetch Chats
    fetch(`/api/products/${activeProduct.id}/idea-chats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: IdeaChat[]) => {
        setChats(data);
        if (data.length > 0) {
          setActiveChatId(data[0].id);
        }
      })
      .catch(() => {});
  }, [token, activeProduct?.id]);

  // 2. Fetch Active Chat Messages
  useEffect(() => {
    if (!token || !activeChatId) {
      setMessages([]);
      return;
    }
    fetch(`/api/idea-chats/${activeChatId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
      })
      .catch(() => {});
  }, [token, activeChatId]);

  // 3. Realtime Scan & Activity Listeners
  useEffect(() => {
    return chatSocket.subscribe((frame) => {
      if (frame.type === 'scan_progress' && activeProduct) {
        setScanning(frame.percent < 100);
        setScanStep(`${frame.step} (${frame.percent}%)`);
        if (frame.percent >= 100) {
          // Refresh ideas and scans
          fetch(`/api/ideas?product_id=${activeProduct.id}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then(setIdeas)
            .catch(() => {});
          fetch(`/api/products/${activeProduct.id}/idea-scans`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then(setScans)
            .catch(() => {});
        }
      }
    });
  }, [activeProduct?.id, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Actions: New Chat Session
  const handleCreateNewChat = async (seedIdea?: Idea) => {
    if (!activeProduct || !token) return;
    try {
      const res = await fetch(`/api/products/${activeProduct.id}/idea-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: seedIdea ? `Brainstorm: ${seedIdea.title}` : 'New Brainstorm',
          provider: selectedProvider,
          model: selectedModel,
          idea_id: seedIdea?.id,
        }),
      });
      const newChat: IdeaChat = await res.json();
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);

      if (seedIdea) {
        // Send initial seed prompt
        const prompt = `Let's brainstorm this feature idea: "${seedIdea.title}".\nProblem: ${seedIdea.problemStatement}\nExpected Value: ${seedIdea.expectedValue}\nTechnical files: ${seedIdea.evidence?.join(', ') || 'N/A'}.\n\nHow should we architect and implement this in ${activeProduct.name}?`;
        handleSendMessage(prompt, newChat.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Actions: Send Chat Message
  const handleSendMessage = async (customText?: string, targetChatId?: string) => {
    const textToSend = (customText || inputText).trim();
    const chatId = targetChatId || activeChatId;
    if (!textToSend || !token) return;

    if (!chatId) {
      await handleCreateNewChat();
      return;
    }

    if (!customText) setInputText('');

    // Append optimistic user message
    const tempUserMsg: IdeaChatMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: textToSend,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsThinking(true);
    setThinkingSteps(['Synthesizing product context', 'Analyzing architectural dependencies', 'Generating response']);

    try {
      const res = await fetch(`/api/idea-chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content: textToSend,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const assistantMsg: IdeaChatMessage = await res.json();
      setMessages((prev) => [...prev, assistantMsg]);
      // Update chat title in sidebar if updated
      // @ts-expect-error property exists on API response
      if (assistantMsg.chatTitle) {
        // @ts-expect-error property exists on API response
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: assistantMsg.chatTitle } : c)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsThinking(false);
      setThinkingSteps([]);
    }
  };

  // Actions: Trigger Codebase Scan
  const handleTriggerScan = async () => {
    if (!activeProduct || !token) return;
    if (!repoUrl) {
      alert('Please add a GitHub Repository URL in Product Setup first.');
      return;
    }
    setScanning(true);
    setScanStep('Connecting multi-agent scanner to repository...');
    try {
      const res = await fetch(`/api/products/${activeProduct.id}/idea-scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          repo_url: repoUrl,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Scan failed to start');
      }
    } catch (e: any) {
      alert(e.message);
      setScanning(false);
    }
  };

  // Actions: Evaluate Idea
  const handleEvaluateIdea = async (idea: Idea) => {
    if (!token) return;
    setEvaluatingIdeaId(idea.id);
    try {
      const res = await fetch(`/api/ideas/${idea.id}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, reviewReport: data.report } : i)));
      setEvalModalIdea({ ...idea, reviewReport: data.report });
    } catch (e) {
      console.error(e);
    } finally {
      setEvaluatingIdeaId(null);
    }
  };

  // Reviews run through the approval panel (request, decide, create project); when it
  // closes, pull the ideas again so the cards show where each one now stands.
  const closeReviewModal = () => {
    setReviewModalIdea(null);
    if (!token || !activeProduct) return;
    fetch(`/api/ideas?product_id=${activeProduct.id}&workspace_id=${state.activeWorkspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setIdeas(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  // Actions: Start GitHub Device Flow
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);

  const checkDeviceAuthNow = async (devCode?: string) => {
    const code = devCode || deviceFlow?.device_code;
    if (!code || !token) return;
    setIsCheckingAuth(true);
    try {
      const res = await pollGitHubDeviceFlow(code, token);
      if (res.status === 'granted' || res.connected) {
        setGithubStatus({ connected: true, login: res.login });
        setDeviceFlow(null);
        setGithubModalOpen(false);
      } else {
        const stat = await fetchGitHubStatus(token);
        if (stat.connected) {
          setGithubStatus(stat);
          setDeviceFlow(null);
          setGithubModalOpen(false);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleStartDeviceFlow = async () => {
    try {
      const flow = await startGitHubDeviceFlow(token);
      setDeviceFlow(flow);
      // Poll
      const pollInterval = setInterval(async () => {
        try {
          const res = await pollGitHubDeviceFlow(flow.device_code, token);
          if (res.status === 'granted' || res.connected) {
            clearInterval(pollInterval);
            setGithubStatus({ connected: true, login: res.login });
            setDeviceFlow(null);
            setGithubModalOpen(false);
          } else if (res.status === 'expired' || res.status === 'error') {
            clearInterval(pollInterval);
            setDeviceFlow(null);
          }
        } catch {
          // Check if token exists anyway
          const stat = await fetchGitHubStatus(token);
          if (stat.connected) {
            clearInterval(pollInterval);
            setGithubStatus(stat);
            setDeviceFlow(null);
            setGithubModalOpen(false);
          }
        }
      }, (flow.interval || 4) * 1000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSavePat = async () => {
    if (!patInput.trim()) return;
    try {
      await saveGitHubTokenDirect(patInput.trim(), token);
      setGithubStatus({ connected: true });
      setPatInput('');
      setGithubModalOpen(false);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const workspaceMembers = state.members || [];

  return (
    <div className="relative flex flex-col h-[calc(100vh-5rem)] max-w-[1700px] mx-auto overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0A0A0F]/90 text-[#F6F5FA]">
      {/* Background SoftAurora effect */}
      <div className="absolute inset-0 pointer-events-none opacity-30 z-0 overflow-hidden">
        <SoftAurora
          speed={0.4}
          scale={1.3}
          brightness={0.8}
          color1="#075BFF"
          color2="#7C3AED"
          noiseFrequency={2.2}
          noiseAmplitude={0.9}
          bandHeight={0.6}
          bandSpread={1.2}
          lightMode={false}
        />
      </div>

      {/* Top Header Bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#0E0E15]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#075BFF] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#075BFF]/25">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-white">{activeProduct?.name}</h1>
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#075BFF] bg-[#075BFF]/10 px-2 py-0.5 rounded border border-[#075BFF]/20">
                Idea Lab
              </span>
            </div>
            <p className="text-xs text-[#827D8E] font-light">Autonomous repository analysis & strategic AI architecture</p>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-3">
          {/* GitHub Connection Badge */}
          <button
            onClick={() => {
              setGithubModalOpen(true);
              fetchGitHubStatus(token).then(setGithubStatus).catch(() => {});
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 border transition-all cursor-pointer ${
              githubStatus.connected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            <GithubIcon className="w-3.5 h-3.5" />
            <span>{githubStatus.connected ? `GitHub: ${githubStatus.login || 'Connected'}` : 'Connect GitHub'}</span>
          </button>

          {/* Provider / Model Picker */}
          <div className="flex items-center bg-[#15151E] border border-white/[0.1] rounded-xl p-1 gap-1 text-xs">
            <select
              value={selectedProvider}
              onChange={(e) => {
                const p = e.target.value;
                setSelectedProvider(p);
                const info = providers.find((prov) => prov.id === p);
                if (info) setSelectedModel(info.defaultModel);
              }}
              className="bg-transparent text-[#F6F5FA] px-2 py-1 rounded outline-none font-medium cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#15151E] text-white">
                  {p.label} {!p.available && '(Needs Key)'}
                </option>
              ))}
            </select>

            {/* Model list for selected provider */}
            {providers.find((p) => p.id === selectedProvider)?.models && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-[#A7ACB8] px-2 py-1 rounded outline-none font-mono text-[11px] cursor-pointer"
              >
                {providers.find((p) => p.id === selectedProvider)?.models.map((m) => (
                  <option key={m} value={m} className="bg-[#15151E] text-white">
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Trigger Scan Button */}
          <button
            onClick={handleTriggerScan}
            disabled={scanning}
            className="px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-lg shadow-[#075BFF]/25 flex items-center gap-2 cursor-pointer transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{scanning ? 'Scanning Codebase...' : 'Scan Codebase for Ideas'}</span>
          </button>
        </div>
      </header>

      {/* Main Content: 3-column Layout */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Left: Chat Sessions History Sidebar */}
        <aside className="w-72 border-r border-white/[0.08] bg-[#0B0B11]/70 flex flex-col shrink-0 p-4 space-y-4">
          <button
            onClick={() => handleCreateNewChat()}
            className="w-full py-2.5 px-3 bg-[#15151F] hover:bg-[#1D1D2B] border border-white/[0.1] hover:border-white/20 text-[#F6F5FA] text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#075BFF]" />
            <span>New Brainstorm Chat</span>
          </button>

          <div className="text-[11px] uppercase font-mono tracking-wider text-[#827D8E] font-medium px-2">
            Recent Sessions
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {chats.length === 0 ? (
              <div className="text-center py-10 px-2 text-xs text-[#827D8E] font-light">
                No brainstorms yet. Start chatting or run an agent scan!
              </div>
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start gap-2.5 cursor-pointer ${
                    activeChatId === chat.id
                      ? 'bg-[#075BFF]/15 border border-[#075BFF]/30 text-white font-medium'
                      : 'text-[#B5B1C0] hover:bg-white/[0.04] hover:text-white border border-transparent'
                  }`}
                >
                  <MessageSquare className="w-4 h-4 mt-0.5 text-[#827D8E] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{chat.title}</div>
                    <div className="text-[10px] text-[#827D8E] font-mono mt-0.5">{chat.provider}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Center: Gemini-Style Chat Interface */}
        <main className="flex-1 flex flex-col justify-between overflow-hidden bg-transparent">
          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto px-8 sm:px-16 py-8 space-y-8">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-6 animate-fade-in py-16">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#075BFF]/30 via-[#7C3AED]/20 to-transparent border border-white/10 flex items-center justify-center shadow-2xl">
                  <Sparkles className="w-8 h-8 text-[#075BFF]" />
                </div>

                <div className="space-y-3">
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-white font-sans">
                    What are we building in <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400">{activeProduct?.name}</span>?
                  </h2>
                  <p className="text-base text-[#A7ACB8] font-light leading-relaxed">
                    Brainstorm features, explore codebase architecture, audit vulnerabilities, or convert ideas into executable engineering projects.
                  </p>
                </div>

                {/* Prompt Starter Chips */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full pt-4">
                  {[
                    'Audit architectural bottlenecks in our codebase',
                    'Propose 3 high-impact features with expected ROI',
                    'Draft a technical specification from our repository',
                    'Evaluate security and scalability risks',
                  ].map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(prompt)}
                      className="p-3.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 rounded-2xl text-left text-xs text-[#D1D5DB] transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span className="font-light">{prompt}</span>
                      <ChevronRight className="w-4 h-4 text-[#827D8E] group-hover:text-white transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-[840px] mx-auto space-y-8 pb-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="space-y-3">
                    {msg.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="bg-[#1C1C26] border border-white/[0.1] text-white px-5 py-3 rounded-2xl rounded-tr-sm text-[16px] leading-relaxed max-w-[85%] font-normal shadow-md">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Thinking accordion if model output thinking text */}
                        {msg.thinking && (
                          <ThoughtLine
                            label="Thought process"
                            doneLabel="Thought process"
                            steps={[msg.thinking.slice(0, 150) + '...']}
                            working={false}
                            fontSize={13}
                            color="#827D8E"
                          />
                        )}

                        {/* Markdown / Response Text */}
                        <MarkdownMessage content={msg.content} />

                        {/* Action buttons on answer */}
                        <div className="flex items-center gap-3 pt-2 text-xs text-[#827D8E]">
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                            className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </button>
                          <button
                            onClick={async () => {
                              // Save turn as an idea
                              const title = msg.content.slice(0, 60).replace(/^[#*\s]+/, '');
                              await fetch('/api/ideas', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({
                                  title,
                                  problem_statement: msg.content.slice(0, 300),
                                  expected_value: 'Generated via AI Brainstorm turn.',
                                  product_id: activeProduct.id,
                                }),
                              });
                              alert('Idea saved to product list!');
                            }}
                            className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                          >
                            <Bookmark className="w-3.5 h-3.5" />
                            <span>Save as Idea</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Thinking indicator while stream/call is running */}
                {isThinking && (
                  <div className="py-2">
                    <ThoughtLine
                      label="Thinking & analyzing architecture…"
                      steps={thinkingSteps}
                      working={true}
                      fontSize={15}
                      color="#075BFF"
                    />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Bottom Floating Pill Composer (Gemini Design System) */}
          <div className="px-8 sm:px-16 pb-6 pt-2">
            <div className="max-w-[840px] mx-auto relative bg-[#12121A] border border-white/[0.12] focus-within:border-[#075BFF]/60 focus-within:ring-2 focus-within:ring-[#075BFF]/20 rounded-full p-2.5 pl-5 shadow-2xl flex items-center gap-3 transition-all">
              <Sparkles className="w-5 h-5 text-[#075BFF] shrink-0" />
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                rows={1}
                placeholder={`Ask ${selectedProvider.toUpperCase()} about ${activeProduct?.name || 'this product'}...`}
                className="flex-1 bg-transparent text-[#F6F5FA] placeholder-[#777D8B] text-[15px] outline-none resize-none overflow-hidden max-h-32"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isThinking}
                className="w-10 h-10 rounded-full bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white flex items-center justify-center shrink-0 cursor-pointer shadow-md transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="text-center text-[11px] text-[#777D8B] font-light mt-2">
              Model answers are grounded in product context and repository code.
            </div>
          </div>
        </main>

        {/* Right Drawer: Discovered Ideas & Autonomous Pipeline */}
        <aside className="w-96 border-l border-white/[0.08] bg-[#0B0B11]/80 flex flex-col shrink-0 p-5 space-y-5 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#075BFF]" />
              <h3 className="text-sm font-semibold text-white">Idea Backlog</h3>
            </div>
            <span className="text-xs font-mono text-[#827D8E] bg-white/[0.05] px-2 py-0.5 rounded-full">
              {ideas.length}
            </span>
          </div>

          {/* Active Scan Progress banner */}
          {scanning && (
            <div className="p-3.5 rounded-2xl bg-[#075BFF]/10 border border-[#075BFF]/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running Specialist Scan</span>
              </div>
              <ThoughtLine
                label={scanStep}
                working={true}
                fontSize={13}
                color="#60A5FA"
              />
            </div>
          )}

          {/* Idea Cards List with BorderGlow */}
          <div className="space-y-4">
            {ideas.length === 0 ? (
              <div className="text-center py-12 px-4 border border-dashed border-white/10 rounded-2xl space-y-3">
                <FileCode className="w-8 h-8 text-[#827D8E] mx-auto" />
                <p className="text-xs text-[#827D8E] font-light">
                  No ideas found yet. Run an autonomous codebase scan to populate feature and architecture opportunities.
                </p>
                <button
                  onClick={handleTriggerScan}
                  className="px-3.5 py-1.5 bg-[#075BFF]/20 hover:bg-[#075BFF]/30 text-[#5B8FFF] rounded-xl text-xs font-medium cursor-pointer"
                >
                  Run Agent Scan
                </button>
              </div>
            ) : (
              ideas.map((idea) => {
                const isApproved = idea.status === 'approved';
                return (
                  <BorderGlow
                    key={idea.id}
                    borderRadius={18}
                    glowColor="220 80 80"
                    backgroundColor="#12121A"
                    glowIntensity={0.8}
                    className="p-4 space-y-3 border border-white/[0.08]"
                  >
                    {/* Header Chips */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/[0.06] text-[#A7ACB8] font-medium">
                        {idea.source === 'agent' ? 'Agent scan' : 'Manual'}
                      </span>
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-medium ${
                          idea.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : idea.status === 'pending_approval'
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : idea.status === 'rejected'
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            : idea.status === 'promoted'
                            ? 'bg-violet-500/10 text-violet-300 border border-violet-500/20'
                            : 'bg-white/[0.04] text-[#827D8E]'
                        }`}
                      >
                        {STATUS_LABEL[idea.status] ?? idea.status}
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-white leading-snug">{idea.title}</h4>
                    <p className="text-xs text-[#B5B1C0] line-clamp-2 font-light leading-relaxed">
                      {idea.problemStatement}
                    </p>

                    {/* Evidence files preview if present */}
                    {idea.evidence && idea.evidence.length > 0 && (
                      <div className="text-[11px] text-[#827D8E] font-mono flex items-center gap-1 truncate bg-black/30 p-1.5 rounded-lg">
                        <FileCode className="w-3 h-3 text-[#075BFF] shrink-0" />
                        <span className="truncate">{idea.evidence.join(', ')}</span>
                      </div>
                    )}

                    {/* Actions on Idea */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleCreateNewChat(idea)}
                          title="Open in AI Chat"
                          className="p-1.5 hover:bg-white/[0.08] text-[#A7ACB8] hover:text-white rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Chat</span>
                        </button>
                        <button
                          onClick={() => handleEvaluateIdea(idea)}
                          disabled={evaluatingIdeaId === idea.id}
                          title="Evaluate Metrics & ROI"
                          className="p-1.5 hover:bg-white/[0.08] text-[#A7ACB8] hover:text-white rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{evaluatingIdeaId === idea.id ? 'Scoring...' : 'Report'}</span>
                        </button>
                      </div>

                      <button
                        onClick={() => setReviewModalIdea(idea)}
                        className={
                          isApproved
                            ? 'px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-md flex items-center gap-1 transition-all'
                            : 'px-2.5 py-1 bg-[#075BFF]/20 hover:bg-[#075BFF]/30 text-[#5B8FFF] rounded-lg text-xs font-medium cursor-pointer transition-all'
                        }
                      >
                        {isApproved ? (
                          <>
                            <span>Create project</span>
                            <ArrowRight className="w-3 h-3" />
                          </>
                        ) : idea.status === 'draft' ? (
                          'Send for review'
                        ) : (
                          'Review status'
                        )}
                      </button>
                    </div>
                  </BorderGlow>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* MODAL: GitHub Connection */}
      {githubModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-[#13131C] border border-white/[0.12] rounded-2xl p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <GithubIcon className="w-5 h-5 text-white" />
                <h3 className="text-base font-semibold text-white">GitHub Connection</h3>
              </div>
              <button onClick={() => setGithubModalOpen(false)} className="text-[#827D8E] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#A7ACB8] font-light leading-relaxed">
              Connect GitHub so the codebase scanning agents can shallow-clone and analyze private or organization repositories.
            </p>

            {deviceFlow ? (
              <div className="p-4 bg-white/[0.04] rounded-xl border border-white/[0.08] text-center space-y-4">
                <div className="text-xs text-[#827D8E]">Your one-time GitHub device code:</div>
                <div className="text-2xl font-mono font-bold tracking-widest text-[#5B8FFF]">{deviceFlow.user_code}</div>
                <div className="flex flex-col gap-2">
                  <a
                    href={deviceFlow.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold shadow-md transition-all"
                  >
                    <span>Open GitHub Verification Page</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => checkDeviceAuthNow()}
                    disabled={isCheckingAuth}
                    className="w-full py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAuth ? 'animate-spin' : ''}`} />
                    <span>{isCheckingAuth ? 'Checking...' : "I've Authorized — Confirm Connection"}</span>
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 text-[11px] text-[#827D8E]">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Waiting for GitHub approval...</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={handleStartDeviceFlow}
                  className="w-full py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-[#075BFF]/20"
                >
                  Start GitHub OAuth Device Flow
                </button>

                <div className="flex items-center gap-2 text-xs text-[#827D8E]">
                  <div className="h-px bg-white/10 flex-1" />
                  <span>OR ENTER PAT</span>
                  <div className="h-px bg-white/10 flex-1" />
                </div>

                <div className="space-y-2">
                  <input
                    type="password"
                    value={patInput}
                    onChange={(e) => setPatInput(e.target.value)}
                    placeholder="ghp_... Personal Access Token"
                    className="w-full px-3 py-2 bg-[#1A1A26] border border-white/10 rounded-xl text-xs text-white outline-none"
                  />
                  <button
                    onClick={handleSavePat}
                    className="w-full py-2 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded-xl text-xs font-medium cursor-pointer"
                  >
                    Save Token
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Review & approval (the shared approval flow) */}
      {reviewModalIdea && token && state.currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#13131C] border border-white/[0.12] rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#075BFF]" />
                <h3 className="text-base font-semibold text-white">Review and approval</h3>
              </div>
              <button onClick={closeReviewModal} className="text-[#827D8E] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <div className="text-sm font-medium text-white">{reviewModalIdea.title}</div>
              <div className="text-xs text-[#827D8E] font-light mt-1">{reviewModalIdea.problemStatement}</div>
            </div>
            <IdeaApprovalPanel
              idea={reviewModalIdea}
              token={token}
              workspaceId={state.activeWorkspaceId}
              currentUserId={state.currentUser.id}
            />
          </div>
        </div>
      )}

      {/* MODAL: Evaluation Report Display */}
      {evalModalIdea && evalModalIdea.reviewReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 animate-fade-in overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#111118] border border-white/[0.15] rounded-2xl p-7 space-y-6 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div>
                <span className="text-[11px] font-mono text-[#075BFF] uppercase tracking-wider">Executive Feasibility Audit</span>
                <h3 className="text-xl font-semibold text-white mt-0.5">{evalModalIdea.title}</h3>
              </div>
              <button onClick={() => setEvalModalIdea(null)} className="text-[#827D8E] hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-[#D1D5DB]">
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
                <div className="font-semibold text-blue-400 font-mono uppercase text-[10px]">Business Value & ROI</div>
                <p>{evalModalIdea.reviewReport.business_value}</p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
                <div className="font-semibold text-indigo-400 font-mono uppercase text-[10px]">Market & Competitor Moat</div>
                <p>{evalModalIdea.reviewReport.market_differentiation}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
                  <div className="font-semibold text-amber-400 font-mono uppercase text-[10px]">Effort & Budget</div>
                  <p>{evalModalIdea.reviewReport.effort_budget}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
                  <div className="font-semibold text-rose-400 font-mono uppercase text-[10px]">Risk Assessment</div>
                  <p>{evalModalIdea.reviewReport.risk_assessment}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#075BFF]/10 border border-[#075BFF]/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white font-mono uppercase text-[10px]">Recommendation</span>
                  <span className="font-bold text-emerald-400">{evalModalIdea.reviewReport.recommendation}</span>
                </div>
                <p className="text-white/90">{evalModalIdea.reviewReport.recommendation_rationale}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setEvalModalIdea(null)}
                className="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded-xl text-xs font-medium cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
