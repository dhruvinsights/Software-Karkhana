import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Plus,
  RefreshCw,
  ArrowRight,
  Shield,
  FileCode,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  MessageSquare,
  Bookmark,
  X,
  Play,
  Eye,
  LayoutGrid,
  FileText,
} from 'lucide-react';
import { FactoryState, factoryStore } from '../../store/factoryStore';
import { AIProviderInfo, Idea, IdeaChat, IdeaChatMessage, IdeaScan } from '../../types/factory';
import { SoftAurora } from '../reactbits/SoftAurora';
import { ThoughtLine } from '../reactbits/ThoughtLine';
import { BorderGlow } from '../reactbits/BorderGlow';
import { IdeaApprovalPanel } from './IdeaApprovalPanel';
import { fetchGitHubStatus, startGitHubDeviceFlow, pollGitHubDeviceFlow, saveGitHubTokenDirect, GitHubStatus } from '../../lib/githubApi';
import { chatSocket, useChatFrames } from '../../lib/chatSocket';
import { reportLabel, startIdeaReport } from '../../lib/ideaReports';
import { IdeaReportModal } from '../workspace/IdeaReportModal';
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
  const [scanChatId, setScanChatId] = useState<string | null>(null);

  // Right panel tab
  const [rightTab, setRightTab] = useState<'overview' | 'ideas' | 'projects' | 'reports'>('ideas');
  // Reviewer assignment per idea
  const [ideaReviewers, setIdeaReviewers] = useState<Record<string, string>>({});

  // Modals & Panels
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({ connected: false });
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [deviceFlow, setDeviceFlow] = useState<{ user_code: string; verification_uri: string; device_code: string; interval: number } | null>(null);
  const [reviewModalIdea, setReviewModalIdea] = useState<Idea | null>(null);
  const [reportIdea, setReportIdea] = useState<Idea | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const repoUrl = activeProduct?.settings?.repositoryUrl || '';

  // 1. Initial Data Fetch
  useEffect(() => {
    if (!token || !activeProduct) return;

    // Fetch Providers — prefer qwen2.5:0.5b on Ollama for fastest responses
    fetch('/api/ai/providers', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: AIProviderInfo[]) => {
        if (!Array.isArray(data)) return;
        setProviders(data);
        const avail = data.find((p) => p.available) || data[0];
        if (avail) {
          setSelectedProvider(avail.id);
          // Pick smallest/fastest Qwen model when on Ollama
          if (avail.id === 'ollama' && avail.models?.length) {
            const fastQwen = avail.models.find((m: string) => /qwen.*0\.5b/i.test(m) || /qwen2\.5.*0\.5/i.test(m));
            const smallQwen = avail.models.find((m: string) => /qwen/i.test(m));
            setSelectedModel(fastQwen || smallQwen || avail.defaultModel);
          } else {
            setSelectedModel(avail.defaultModel);
          }
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
      .then((data) => setScans(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch Chats
    fetch(`/api/products/${activeProduct.id}/idea-chats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: IdeaChat[]) => {
        if (!Array.isArray(data)) return;
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

  // 3. Realtime Scan & Activity Listeners — mirror scan progress into active chat
  useEffect(() => {
    return chatSocket.subscribe((frame) => {
      if (frame.type === 'scan_progress' && activeProduct) {
        const isRunning = frame.percent < 100;
        setScanning(isRunning);
        setScanStep(`${frame.step} (${frame.percent}%)`);

        // Inject a system message into the active chat so progress is visible
        const chatId = scanChatId;
        if (chatId) {
          const stepMsg: IdeaChatMessage = {
            id: `scan-${Date.now()}-${frame.percent}`,
            role: 'assistant',
            content: `**Scan update** — ${frame.step} (${frame.percent}%)`,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => {
            // Replace a previous scan-step message at the same percent or append
            const withoutDupe = prev.filter((m) => !m.id.startsWith(`scan-${frame.percent}`));
            return [...withoutDupe, stepMsg];
          });
        }

        if (frame.percent >= 100) {
          // Final "done" message
          if (chatId) {
            const doneMsg: IdeaChatMessage = {
              id: `scan-done-${Date.now()}`,
              role: 'assistant',
              content: `✅ **Codebase scan complete!** New feature ideas have been added to the Idea Backlog on the right. Click any idea to explore it in chat.`,
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, doneMsg]);
          }
          // Refresh ideas and scans
          fetch(`/api/ideas?product_id=${activeProduct.id}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then(setIdeas)
            .catch(() => {});
          fetch(`/api/products/${activeProduct.id}/idea-scans`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then(setScans)
            .catch(() => {});
          setScanChatId(null);
        }
      }
    });
  }, [activeProduct?.id, token, scanChatId]);

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

  // Actions: Trigger Codebase Scan — opens a dedicated scan chat + wires progress into it
  const handleTriggerScan = async () => {
    if (!activeProduct || !token) return;
    if (!repoUrl) {
      alert('Please add a GitHub Repository URL in Product Setup first.');
      return;
    }
    setScanning(true);
    setScanStep('Connecting multi-agent scanner to repository...');

    // Create a chat session to receive live scan progress
    let chatIdForScan = activeChatId;
    try {
      const chatRes = await fetch(`/api/products/${activeProduct.id}/idea-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: '🔍 Codebase Scan', provider: selectedProvider, model: selectedModel }),
      });
      const newChat: IdeaChat = await chatRes.json();
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setScanChatId(newChat.id);
      chatIdForScan = newChat.id;

      // Seed the chat with a kick-off message
      const kickoff: IdeaChatMessage = {
        id: `scan-kickoff-${Date.now()}`,
        role: 'assistant',
        content: `🚀 **Initiating autonomous codebase scan** on \`${repoUrl}\`\n\nThe multi-agent scanner will analyze your repository and surface feature ideas, architectural gaps, and opportunities. Progress will appear here in real-time.`,
        createdAt: new Date().toISOString(),
      };
      setMessages([kickoff]);
    } catch {
      // If chat creation fails, fall back to current chat
      if (activeChatId) setScanChatId(activeChatId);
    }

    try {
      const res = await fetch(`/api/products/${activeProduct.id}/idea-scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Scan failed to start');
      }
    } catch (e: any) {
      alert(e.message);
      setScanning(false);
      setScanChatId(null);
    }
  };

  const reloadIdeas = () => {
    if (!token || !activeProduct) return;
    fetch(`/api/ideas?product_id=${activeProduct.id}&workspace_id=${state.activeWorkspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setIdeas(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  // The server writes the report in the background and announces it with
  // workspace_sync "ideas"; until then the card shows that it is being written.
  useChatFrames('workspace_sync', (frame) => {
    if (frame.scope === 'ideas') reloadIdeas();
  }, [token, activeProduct?.id]);

  const handleReport = async (idea: Idea) => {
    if (!token) return;
    if (idea.reviewReport?.status === 'ready') {
      setReportIdea(idea);
      return;
    }
    if (idea.reviewReport?.status === 'running') return;
    try {
      await startIdeaReport(idea.id, token);
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, reviewReport: { status: 'running' } } : i)));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Reviews run through the approval panel (request, decide, create project); when it
  // closes, pull the ideas again so the cards show where each one now stands.
  const closeReviewModal = () => {
    setReviewModalIdea(null);
    reloadIdeas();
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
  const reportedIdeas = ideas.filter((i) => i.reviewReport);

  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden bg-[#0A0A0F] text-[#F6F5FA]">
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
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#075BFF] to-[#5B8FFF] flex items-center justify-center shadow-lg shadow-[#075BFF]/25">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">IdeaQ</h1>
            <p className="text-xs text-[#827D8E] font-light">
              Repository analysis and AI architecture{activeProduct?.name ? <> for <span className="text-[#B5B1C0]">{activeProduct.name}</span></> : null}
            </p>
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
            className="k-btn-primary px-4 py-2 bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-lg shadow-[#075BFF]/25 flex items-center gap-2 cursor-pointer transition-all"
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
          <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-6 animate-fade-in py-16">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#075BFF]/30 via-[#5B8FFF]/20 to-transparent border border-white/10 flex items-center justify-center shadow-2xl">
                  <Sparkles className="w-8 h-8 text-[#075BFF]" />
                </div>

                <div className="space-y-3">
                  <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-white font-sans">
                    What are we building in <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-[#075BFF] to-[#075BFF]">{activeProduct?.name}</span>?
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
              <div className="w-full space-y-8 pb-4">
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
                      color="#F6F5FA"
                    />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Bottom Floating Pill Composer (Gemini Design System) */}
          <div className="px-8 pb-6 pt-2">
            <div className="w-full relative bg-[#12121A] border border-white/[0.12] focus-within:border-[#075BFF]/60 focus-within:ring-2 focus-within:ring-[#075BFF]/20 rounded-full p-2.5 pl-5 shadow-2xl flex items-center gap-3 transition-all">
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
                className="k-btn-primary w-10 h-10 rounded-full bg-[#075BFF] hover:bg-[#075BFF]/90 disabled:opacity-40 text-white flex items-center justify-center shrink-0 cursor-pointer shadow-md transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="text-center text-[11px] text-[#777D8B] font-light mt-2">
              Model answers are grounded in product context and repository code.
            </div>
          </div>
        </main>

        {/* Right Panel: Tabbed — Overview | Ideas | Projects | Reports */}
        <aside className="w-96 border-l border-white/[0.08] bg-[#0B0B11]/80 flex flex-col shrink-0 overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-3 pt-3 pb-0 border-b border-white/[0.06] shrink-0">
            {(['ideas', 'overview', 'projects', 'reports'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`px-3 py-2 text-[11px] font-medium capitalize rounded-t-lg transition-colors cursor-pointer ${
                  rightTab === tab
                    ? 'text-white border-b-2 border-[#075BFF] bg-white/[0.04]'
                    : 'text-[#827D8E] hover:text-white'
                }`}
              >
                {tab === 'ideas' ? `Ideas (${ideas.length})` : tab === 'reports' ? `Reports (${reportedIdeas.length})` : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content — scrollable */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* ── IDEAS TAB ── */}
            {rightTab === 'ideas' && (
              <>
                {/* Active Scan Progress banner */}
                {scanning && (
                  <div className="p-3.5 rounded-2xl bg-[#075BFF]/10 border border-[#075BFF]/30 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-white">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Running Specialist Scan</span>
                    </div>
                    <ThoughtLine label={scanStep} working={true} fontSize={13} color="#F6F5FA" />
                  </div>
                )}

                {ideas.length === 0 ? (
                  <div className="text-center py-12 px-4 border border-dashed border-white/10 rounded-2xl space-y-3">
                    <FileCode className="w-8 h-8 text-[#827D8E] mx-auto" />
                    <p className="text-xs text-[#827D8E] font-light">
                      No ideas yet. Run a codebase scan to populate feature and architecture opportunities.
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
                    const reviewer = ideaReviewers[idea.id];
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
                          <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-medium ${
                            idea.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : idea.status === 'pending_approval' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : idea.status === 'rejected' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            : idea.status === 'promoted' ? 'bg-[#075BFF]/10 text-[#5B8FFF] border border-[#075BFF]/25'
                            : 'bg-white/[0.04] text-[#827D8E]'
                          }`}>
                            {STATUS_LABEL[idea.status] ?? idea.status}
                          </span>
                        </div>

                        <h4 className="text-sm font-semibold text-white leading-snug">{idea.title}</h4>
                        <p className="text-xs text-[#B5B1C0] line-clamp-2 font-light leading-relaxed">
                          {idea.problemStatement}
                        </p>

                        {/* Reviewer badge */}
                        {reviewer && (
                          <div className="flex items-center gap-1.5 text-[11px] text-[#827D8E]">
                            <div className="w-4 h-4 rounded-full bg-[#075BFF]/40 flex items-center justify-center text-[9px] text-white font-bold uppercase">
                              {reviewer[0]}
                            </div>
                            <span>{reviewer}</span>
                          </div>
                        )}

                        {/* Evidence files */}
                        {idea.evidence && idea.evidence.length > 0 && (
                          <div className="text-[11px] text-[#827D8E] font-mono flex items-center gap-1 truncate bg-black/30 p-1.5 rounded-lg">
                            <FileCode className="w-3 h-3 text-[#075BFF] shrink-0" />
                            <span className="truncate">{idea.evidence.join(', ')}</span>
                          </div>
                        )}

                        {/* Actions */}
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
                              onClick={() => handleReport(idea)}
                              disabled={idea.reviewReport?.status === 'running'}
                              title={idea.reviewReport?.status === 'failed' ? idea.reviewReport.error : 'Evaluation report grounded in the code'}
                              className="p-1.5 hover:bg-white/[0.08] text-[#A7ACB8] hover:text-white rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60"
                            >
                              {idea.reviewReport?.status === 'running'
                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#5B8FFF]" />
                                : <FileText className="w-3.5 h-3.5 text-[#5B8FFF]" />}
                              <span>{reportLabel(idea.reviewReport)}</span>
                            </button>
                          </div>
                          <button
                            onClick={() => setReviewModalIdea(idea)}
                            className={isApproved
                              ? 'px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-md flex items-center gap-1 transition-all'
                              : 'px-2.5 py-1 bg-[#075BFF]/20 hover:bg-[#075BFF]/30 text-[#5B8FFF] rounded-lg text-xs font-medium cursor-pointer transition-all'
                            }
                          >
                            {isApproved ? (
                              <><span>Create project</span><ArrowRight className="w-3 h-3" /></>
                            ) : idea.status === 'draft' ? 'Send for review' : 'Review status'}
                          </button>
                        </div>
                      </BorderGlow>
                    );
                  })
                )}
              </>
            )}

            {/* ── OVERVIEW TAB ── */}
            {rightTab === 'overview' && (
              <div className="space-y-5">
                {/* Product info */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase font-mono text-[#4e5668] tracking-widest">Product</p>
                  <p className="text-sm font-semibold text-white">{activeProduct?.name}</p>
                  {activeProduct?.description && (
                    <p className="text-xs text-[#8b93a5] leading-relaxed line-clamp-4">{activeProduct.description}</p>
                  )}
                </div>

                {/* Tech stack chips */}
                {activeProduct?.settings?.techStack && activeProduct.settings.techStack.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase font-mono text-[#4e5668] tracking-widest">Tech Stack</p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeProduct.settings.techStack.map((t: string) => (
                        <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-[#A7ACB8] border border-white/[0.06]">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Team members */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase font-mono text-[#4e5668] tracking-widest">Team Members</p>
                  {workspaceMembers.length === 0 ? (
                    <p className="text-xs text-[#4e5668]">No members yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {workspaceMembers.map((m: { id: string; name?: string; email?: string; role?: string }) => (
                        <div key={m.id} className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#075BFF]/30 border border-[#075BFF]/40 flex items-center justify-center text-[10px] font-bold text-white uppercase shrink-0">
                            {(m.name || m.email || '?')[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-white truncate">{m.name || m.email}</p>
                            {m.role && <p className="text-[10px] text-[#4e5668] capitalize">{m.role}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reviewer assignment per idea */}
                {ideas.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase font-mono text-[#4e5668] tracking-widest">Assign Reviewers</p>
                    <div className="space-y-2">
                      {ideas.map((idea) => (
                        <div key={idea.id} className="space-y-1">
                          <p className="text-[11px] text-[#A7ACB8] truncate">{idea.title}</p>
                          <select
                            value={ideaReviewers[idea.id] || ''}
                            onChange={(e) => setIdeaReviewers(prev => ({ ...prev, [idea.id]: e.target.value }))}
                            className="w-full text-[11px] bg-[#131720] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[#A7ACB8] cursor-pointer focus:outline-none focus:border-[#075BFF]/50"
                          >
                            <option value="">— Unassigned —</option>
                            {workspaceMembers.map((m: { id: string; name?: string; email?: string }) => (
                              <option key={m.id} value={m.name || m.email}>{m.name || m.email}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── PROJECTS TAB ── */}
            {rightTab === 'projects' && (
              <div className="space-y-3">
                {state.projects.filter((p) => p.productId === activeProduct?.id).length === 0 ? (
                  <div className="text-center py-12 px-4 border border-dashed border-white/10 rounded-2xl space-y-2">
                    <LayoutGrid className="w-7 h-7 text-[#4e5668] mx-auto" />
                    <p className="text-xs text-[#4e5668]">No projects yet. Approve an idea to create one.</p>
                  </div>
                ) : (
                  state.projects
                    .filter((p) => p.productId === activeProduct?.id)
                    .map((proj) => (
                      <div key={proj.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2 hover:bg-white/[0.05] transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-white leading-snug">{proj.name}</p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#075BFF]/15 text-[#5B8FFF] border border-[#075BFF]/20 shrink-0">
                            {proj.phase || 'Discovery'}
                          </span>
                        </div>
                        {proj.status && (
                          <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded ${
                            proj.status === 'live' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : proj.status === 'staging' ? 'bg-[#075BFF]/10 text-[#5B8FFF] border border-[#075BFF]/25'
                            : proj.status === 'blocked' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            : 'bg-white/[0.04] text-[#827D8E]'
                          }`}>
                            {proj.status}
                          </span>
                        )}
                      </div>
                    ))
                )}
              </div>
            )}

            {/* ── REPORTS TAB ── */}
            {rightTab === 'reports' && (
              <div className="space-y-3">
                {reportedIdeas.length === 0 ? (
                  <div className="text-center py-12 px-4 border border-dashed border-white/10 rounded-2xl space-y-2">
                    <FileText className="w-7 h-7 text-[#4e5668] mx-auto" />
                    <p className="text-xs text-[#4e5668]">No reports yet. Click "Evaluate" on any idea.</p>
                  </div>
                ) : (
                  reportedIdeas.map((idea) => {
                    const r = idea.reviewReport!;
                    return (
                      <div key={idea.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2">
                        <p className="text-xs font-semibold text-white leading-snug">{idea.title}</p>
                        {r.status === 'ready' && r.report && r.meta ? (
                          <p className="text-[11px] text-[#A7ACB8]">
                            <span className="text-white font-medium">{r.report.verdict}</span> · {r.meta.overallScore.toFixed(1)}/10 · size {r.report.size} · {new Date(r.meta.generatedAt).toLocaleDateString()}
                          </p>
                        ) : (
                          <p className={`text-[11px] ${r.status === 'failed' ? 'text-rose-400' : 'text-[#827D8E]'}`}>
                            {r.status === 'failed' ? `Failed: ${r.error}` : 'Writing report…'}
                          </p>
                        )}
                        <button
                          onClick={() => handleReport(idea)}
                          disabled={r.status === 'running'}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#075BFF]/15 hover:bg-[#075BFF]/25 text-[#5B8FFF] rounded-lg text-[11px] cursor-pointer disabled:opacity-60"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{reportLabel(r)}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
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
                    className="k-btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold shadow-md transition-all"
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
                  className="k-btn-primary w-full py-2.5 bg-[#075BFF] hover:bg-[#075BFF]/90 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-[#075BFF]/20"
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

      {reportIdea && (
        <IdeaReportModal ideaId={reportIdea.id} title={reportIdea.title} token={token} onClose={() => setReportIdea(null)} />
      )}
    </div>
  );
};
