import React, { useEffect, useState } from 'react';
import { Sparkles, Terminal, CheckCircle2 } from 'lucide-react';
import { ChromaWaves } from '../reactbits/ChromaWaves';
import { ShinyText } from '../reactbits/ShinyText';
import { BlackHole } from '../reactbits/BlackHole';

interface DreamTransitionScreenProps {
  workspaceName: string;
  onFinish: () => void;
  durationMs?: number;
}

const QUOTES = [
  { text: "One record for every team, from idea to merged code.", author: "Software Karkhana Core" },
  { text: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" },
  { text: "Autonomous intelligence begins where verifiable evidence holds.", author: "Systems Architecture" },
  { text: "Ship with confidence: Every gate is a cryptographic guarantee.", author: "Factory Invariants" },
];

export const DreamTransitionScreen: React.FC<DreamTransitionScreenProps> = ({
  workspaceName,
  onFinish,
  durationMs = 2200,
}) => {
  const [opacity, setOpacity] = useState(0);
  const [quoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));

  useEffect(() => {
    // Fade in (dim to appear dream effect)
    const tIn = setTimeout(() => setOpacity(1), 50);
    // Trigger finish
    const tOut = setTimeout(() => {
      onFinish();
    }, durationMs);

    return () => {
      clearTimeout(tIn);
      clearTimeout(tOut);
    };
  }, [durationMs, onFinish]);

  const activeQuote = QUOTES[quoteIndex];

  return (
    <div
      style={{
        opacity,
        transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className="fixed inset-0 z-50 bg-[#05060a] text-white flex flex-col items-center justify-center p-6 selection:bg-[#075bff] select-none overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <ChromaWaves />
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 opacity-30 pointer-events-none">
        <BlackHole />
      </div>

      <div className="relative z-10 max-w-xl text-center space-y-8 animate-fade-in">
        {/* Workspace Brand Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#075bff]/10 border border-[#075bff]/30 text-[#075bff] text-xs font-mono font-medium">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span>Provisioning {workspaceName}...</span>
        </div>

        {/* Inspirational Quote */}
        <div className="space-y-3">
          <blockquote className="text-xl sm:text-2xl font-light text-slate-200 tracking-tight leading-relaxed italic">
            "{activeQuote.text}"
          </blockquote>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            — {activeQuote.author}
          </p>
        </div>

        {/* Cinematic Pulsing Loader */}
        <div className="flex flex-col items-center gap-3 pt-4">
          <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#075bff] via-cyan-400 to-[#075bff] animate-pulse rounded-full w-full" />
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Mounting factory stations & telemetry streams...
          </span>
        </div>
      </div>
    </div>
  );
};
