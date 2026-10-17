import React, { useState } from 'react';
import {
  Cpu,
  Smartphone,
  Tablet,
  Monitor,
  Sparkles,
  Layers,
  MessageSquare,
  CheckCircle2,
  RefreshCw,
  GitBranch,
  ArrowRight,
  Plus,
  Palette,
} from 'lucide-react';
import { factoryStore, FactoryState } from '../../store/factoryStore';
import { SpotlightCard } from '../reactbits/SpotlightCard';
import { ShinyText } from '../reactbits/ShinyText';
import { GlassCard } from '../reactbits/GlassCard';

interface DesignStudioViewProps {
  state: FactoryState;
}

export const DesignStudioView: React.FC<DesignStudioViewProps> = ({ state }) => {
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [activeTab, setActiveTab] = useState<'prototype' | 'tokens'>('prototype');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  const activeProduct = state.products.find((p) => p.id === state.selectedProductId) || state.products[0];

  const handleGenerateVariation = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      factoryStore.logAudit('Generated Design Prototype Variation', `Prompt: "${prompt || 'Modern minimalist editorial canvas'}"`);
      setPrompt('');
    }, 1200);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div className="space-y-2">
          <div className="text-xs uppercase font-mono tracking-widest text-blue-400 font-medium">
            Design System & Tokens
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Design Studio
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Design tokens, atomic layout variables, and responsive prototype verification.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#10131d] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('prototype')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'prototype' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Viewport Canvas
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'tokens' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Design Tokens
          </button>
        </div>
      </div>

      {activeTab === 'prototype' && (
        <SpotlightCard className="p-8 space-y-6 bg-[#0c0f18]/90 border border-white/10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-blue-400" />
              <h3 className="text-base font-bold text-white">Interactive Preview Matrix</h3>
            </div>
            <div className="flex items-center gap-1 bg-[#080a10] border border-white/10 p-1 rounded-lg">
              <button
                onClick={() => setViewport('desktop')}
                className={`p-1.5 rounded ${viewport === 'desktop' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewport('tablet')}
                className={`p-1.5 rounded ${viewport === 'tablet' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
              >
                <Tablet className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewport('mobile')}
                className={`p-1.5 rounded ${viewport === 'mobile' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className={`mx-auto bg-[#080a10] border border-white/10 rounded-2xl p-6 transition-all duration-300 ${
            viewport === 'desktop' ? 'w-full' : viewport === 'tablet' ? 'max-w-xl' : 'max-w-xs'
          }`}>
            <div className="space-y-4 text-center py-10">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold text-white">Software Karkhana Responsive Canvas</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Real-time DOM viewport simulation validating accessibility contrast & token scales.
              </p>
            </div>
          </div>
        </SpotlightCard>
      )}

      {activeTab === 'tokens' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <GlassCard className="p-6 space-y-3">
            <h4 className="text-sm font-semibold text-white">Color Tokens</h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center text-slate-300">
                <span>--bg-canvas</span>
                <span className="text-blue-400">#07070B</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>--bg-surface</span>
                <span className="text-blue-400">#0D0F17</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>--accent-blue</span>
                <span className="text-blue-400">#075BFF</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6 space-y-3">
            <h4 className="text-sm font-semibold text-white">Typography</h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center text-slate-300">
                <span>--font-sans</span>
                <span className="text-[#5B8FFF]">Inter / System</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>--font-mono</span>
                <span className="text-[#5B8FFF]">JetBrains Mono</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6 space-y-3">
            <h4 className="text-sm font-semibold text-white">Border Radius</h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center text-slate-300">
                <span>--radius-card</span>
                <span className="text-emerald-400">16px / 1rem</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>--radius-pill</span>
                <span className="text-emerald-400">9999px</span>
              </div>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
