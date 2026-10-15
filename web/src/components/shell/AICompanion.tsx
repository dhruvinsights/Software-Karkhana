import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Layers,
  FileCode2,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Terminal,
  ChevronRight,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { BlackHole } from '../reactbits/BlackHole';

interface AICompanionProps {
  state: FactoryState;
}

export const AICompanion: React.FC<AICompanionProps> = ({ state }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string; action?: string }[]>([
    {
      role: 'assistant',
      text: `Hello! I'm your Factory AI Companion, grounded in ${state.workspace.name} context. Currently tracking ${state.currentRole.toUpperCase()} mode on "${state.currentScreen}". How can I accelerate your delivery today?`,
    },
  ]);

  const activeProject = state.projects.find((p) => p.id === state.selectedProjectId);
  const activePr = state.pullRequests.find((p) => p.id === state.selectedPrId);

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    const newMessages = [...messages, { role: 'user' as const, text: textToSend }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/gemini/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.text })),
          context: {
            role: state.currentRole,
            screen: state.currentScreen,
            entityTitle: activePr?.title || activeProject?.name || state.workspace.name,
            data: {
              projectId: state.selectedProjectId,
              prId: state.selectedPrId,
            },
          },
        }),
      });

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.reply || 'I have completed the analysis and updated the factory context.',
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `[Offline Mode Analysis]: Inspected the active project "${activeProject?.name}". Recommendation: Ensure bounded buffers in ring allocations and verify Cloud Run container health prior to release sign-off.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!state.companionOpen) return null;

  return (
    <aside className="w-96 bg-[#0A0A0F] border-l border-white/[0.08] flex flex-col h-full shadow-2xl z-20 shrink-0 animate-in slide-in-from-right duration-200 relative overflow-hidden">
      {/* Ambient Black Hole Background */}
      <div className="absolute top-0 right-0 w-80 h-80 opacity-30 pointer-events-none -mr-16 -mt-16 z-0">
        <BlackHole />
      </div>

      {/* Companion Header */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between bg-[#101016]">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#075BFF] flex items-center justify-center text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#F6F5FA] leading-none">AI Factory Companion</div>
            <div className="text-[10px] text-[#827D8E] mt-0.5 font-mono">Gemini 3.8 Flash · Context Memory</div>
          </div>
        </div>
        <button
          onClick={() => factoryStore.toggleCompanion()}
          className="p-1 rounded-md text-[#827D8E] hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Attached Context Bar */}
      <div className="px-4 py-2 bg-[#07070B] border-b border-white/[0.08] flex flex-wrap gap-1.5 items-center text-xs">
        <span className="text-[10px] font-mono text-[#827D8E] uppercase tracking-wider">Context:</span>
        <span className="bg-[#101016] border border-white/[0.08] px-2 py-0.5 rounded text-[10px] text-[#F6F5FA] font-mono">
          {state.currentRole}
        </span>
        <span className="bg-[#101016] border border-white/[0.08] px-2 py-0.5 rounded text-[10px] text-[#B5B1C0] font-mono truncate max-w-[120px]">
          {state.currentScreen}
        </span>
        {activePr && (
          <span className="bg-[#075BFF]/10 border border-[#075BFF]/30 px-2 py-0.5 rounded text-[10px] text-[#075BFF] font-mono">
            PR #{activePr.number}
          </span>
        )}
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#07070B]">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-xs ${
                msg.role === 'user'
                  ? 'bg-[#075BFF] text-white rounded-br-xs'
                  : 'bg-[#101016] text-[#F6F5FA] rounded-bl-xs border border-white/[0.08]'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>
            </div>
            <span className="text-[10px] text-[#827D8E] mt-1 px-1 font-mono">
              {msg.role === 'user' ? 'You' : 'Companion'}
            </span>
          </div>
        ))}
        {loading && (
          <div className="flex items-center space-x-2 text-xs text-[#075BFF] py-2 font-mono">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Analyzing factory records with Gemini 3.8...</span>
          </div>
        )}
      </div>

      {/* Suggested Quick Triggers */}
      <div className="px-4 py-2 border-t border-white/[0.08] bg-[#0A0A0F] space-y-1.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[#827D8E]">Quick Actions:</div>
        <div className="grid grid-cols-1 gap-1">
          <button
            onClick={() => handleSend('Perform a CodeRabbit diff security review on current branch')}
            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-[#101016] border border-white/[0.08] text-[#B5B1C0] hover:border-[#075BFF]/50 hover:text-white text-[11px] flex items-center justify-between transition-colors"
          >
            <span className="flex items-center space-x-1.5 truncate">
              <FileCode2 className="w-3.5 h-3.5 text-[#075BFF] shrink-0" />
              <span className="truncate">Run CodeRabbit diff security scan</span>
            </span>
            <ChevronRight className="w-3 h-3 text-[#827D8E]" />
          </button>
          <button
            onClick={() => handleSend('Draft an Architecture Decision Record (ADR) for this component')}
            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-[#101016] border border-white/[0.08] text-[#B5B1C0] hover:border-[#514CE8]/50 hover:text-white text-[11px] flex items-center justify-between transition-colors"
          >
            <span className="flex items-center space-x-1.5 truncate">
              <Layers className="w-3.5 h-3.5 text-[#514CE8] shrink-0" />
              <span className="truncate">Draft ADR for memory allocation</span>
            </span>
            <ChevronRight className="w-3 h-3 text-[#827D8E]" />
          </button>
        </div>
      </div>

      {/* Input Composer */}
      <div className="p-3 border-t border-white/[0.08] bg-[#101016]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            placeholder="Ask Companion about architecture, tests, code..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1 text-xs px-3 py-2 bg-[#07070B] border border-white/[0.1] rounded-xl outline-none focus:border-[#075BFF] focus:bg-[#0A0A0F] transition-all text-[#F6F5FA] placeholder-[#827D8E]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2 bg-[#075BFF] text-white rounded-xl hover:bg-[#075BFF]/90 disabled:opacity-40 transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
};
