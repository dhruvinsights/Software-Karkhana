import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Play,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Command,
  CornerDownLeft,
} from 'lucide-react';

export interface TerminalMessage {
  id: string;
  type: 'input' | 'output' | 'system' | 'error' | 'success';
  content: string;
  timestamp?: string;
}

export interface TerminalProps {
  className?: string;
  initialPrompt?: string;
  placeholder?: string;
  title?: string;
  suggestedCommands?: Array<{ label: string; command: string; desc?: string }>;
  onExecute?: (command: string) => Promise<string | void> | string | void;
  messages?: TerminalMessage[];
  showShortcuts?: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({
  className = '',
  initialPrompt = '',
  placeholder = 'Describe your software feature, PRD idea, or type a command...',
  title = 'karkhana-ai-terminal (v2.4.0)',
  suggestedCommands = [
    { label: '💡 Validate Idea', command: 'evaluate-idea --target "Autonomous Real-time Log Engine"', desc: 'Run multi-agent JTBD & viability scoring' },
    { label: '📐 Generate PRD', command: 'generate-prd --module "Auth & Multi-sig RBAC"', desc: 'Synthesize user stories & acceptance gates' },
    { label: '🧪 Chaos Test', command: 'run-qa-matrix --chaos --fault-injection', desc: 'Synthesize edge-case test suite' },
    { label: '🛡️ Audit AppSec', command: 'scan-sbom --cosign-verify --cve-triage', desc: 'Scan dependencies & verify cryptographic keys' },
  ],
  onExecute,
  messages: externalMessages,
  showShortcuts = true,
}) => {
  const [input, setInput] = useState(initialPrompt);
  const [logs, setLogs] = useState<TerminalMessage[]>([
    {
      id: 'sys-1',
      type: 'system',
      content: '⚡ Software Karkhana Autonomous AI Terminal connected to Gemini 3.8 Flash & Evidence Ledger.',
      timestamp: new Date().toLocaleTimeString(),
    },
    {
      id: 'sys-2',
      type: 'system',
      content: 'Type your intent below or select a predefined autonomous workflow to execute.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeLogs = externalMessages || logs;

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeLogs, isExecuting]);

  const handleRun = async (cmdToRun?: string) => {
    const targetCommand = cmdToRun !== undefined ? cmdToRun : input;
    if (!targetCommand.trim() || isExecuting) return;

    const time = new Date().toLocaleTimeString();
    const newLogs: TerminalMessage[] = [
      ...logs,
      {
        id: `input-${Date.now()}`,
        type: 'input',
        content: targetCommand,
        timestamp: time,
      },
    ];
    setLogs(newLogs);
    setInput('');
    setIsExecuting(true);

    try {
      if (onExecute) {
        const result = await onExecute(targetCommand);
        if (result && typeof result === 'string') {
          setLogs((prev) => [
            ...prev,
            {
              id: `out-${Date.now()}`,
              type: 'output',
              content: result,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
      } else {
        // Simulated AI response stream
        await new Promise((resolve) => setTimeout(resolve, 800));
        setLogs((prev) => [
          ...prev,
          {
            id: `out-${Date.now()}`,
            type: 'success',
            content: `✓ [Autonomous Agent]: Evaluated '${targetCommand}'. Generated 4 architectural invariants, 12 test assertions, and recorded cryptographic digest to SHA-256 evidence ledger.`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: 'error',
          content: `✗ Error: ${err?.message || 'Execution failed'}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
  };

  const copyLogs = () => {
    const text = activeLogs.map((l) => `[${l.timestamp || ''}] ${l.type.toUpperCase()}: ${l.content}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearLogs = () => {
    setLogs([
      {
        id: `sys-${Date.now()}`,
        type: 'system',
        content: 'Terminal logs cleared. System ready.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  return (
    <div className={`flex flex-col bg-[#07090e]/95 border border-white/10 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl font-mono ${className}`}>
      {/* Top Window Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d111a]/90 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56]/90 border border-[#e0443e]/40 inline-block" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e]/90 border border-[#dea123]/40 inline-block" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f]/90 border border-[#1aab29]/40 inline-block" />
          </div>
          <div className="flex items-center gap-1.5 ml-3 text-xs text-slate-400">
            <TerminalIcon className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-slate-300">{title}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyLogs}
            title="Copy Logs"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-xs flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={clearLogs}
            title="Clear Logs"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Suggested Autonomous Commands */}
      {showShortcuts && suggestedCommands && (
        <div className="flex items-center gap-2 px-4 py-2 bg-black/40 border-b border-white/5 overflow-x-auto text-xs no-scrollbar">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
            <Sparkles className="w-3 h-3 text-purple-400" /> Quick Workflows:
          </span>
          {suggestedCommands.map((sc, idx) => (
            <button
              key={idx}
              onClick={() => {
                setInput(sc.command);
                if (textareaRef.current) textareaRef.current.focus();
              }}
              className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-blue-500/20 hover:border-blue-500/40 border border-white/10 text-slate-300 hover:text-blue-300 transition-all shrink-0 cursor-pointer"
            >
              {sc.label}
            </button>
          ))}
        </div>
      )}

      {/* Logs Output Container */}
      <div
        ref={logContainerRef}
        className="p-4 space-y-2.5 min-h-[180px] max-h-[320px] overflow-y-auto text-xs leading-relaxed select-text"
      >
        {activeLogs.map((msg) => (
          <div key={msg.id} className="flex items-start gap-2.5">
            {msg.type === 'input' && (
              <>
                <span className="text-blue-400 select-none">❯</span>
                <span className="text-white font-medium">{msg.content}</span>
              </>
            )}
            {msg.type === 'system' && (
              <>
                <span className="text-purple-400 select-none">✦</span>
                <span className="text-slate-400">{msg.content}</span>
              </>
            )}
            {msg.type === 'output' && (
              <>
                <span className="text-emerald-400 select-none">↳</span>
                <span className="text-emerald-300 whitespace-pre-wrap">{msg.content}</span>
              </>
            )}
            {msg.type === 'success' && (
              <>
                <span className="text-teal-400 select-none">✔</span>
                <span className="text-teal-300">{msg.content}</span>
              </>
            )}
            {msg.type === 'error' && (
              <>
                <span className="text-red-400 select-none">✖</span>
                <span className="text-red-300">{msg.content}</span>
              </>
            )}
          </div>
        ))}

        {isExecuting && (
          <div className="flex items-center gap-2 text-blue-400 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span>AI swarm synthesis & ledger invariant verification in progress...</span>
          </div>
        )}
      </div>

      {/* Input Prompt Box */}
      <div className="p-3 bg-[#0a0d14] border-t border-white/10 flex items-end gap-2">
        <div className="flex items-center gap-1.5 text-blue-400 pb-2 pl-1 select-none">
          <Command className="w-4 h-4" />
          <span className="text-xs font-bold">❯</span>
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent border-0 text-white placeholder-slate-500 focus:outline-none focus:ring-0 text-xs py-2 resize-none max-h-24 leading-relaxed"
        />
        <button
          onClick={() => handleRun()}
          disabled={!input.trim() || isExecuting}
          className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20"
        >
          {isExecuting ? (
            <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <CornerDownLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default Terminal;
