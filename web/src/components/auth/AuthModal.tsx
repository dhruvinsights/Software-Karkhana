import React, { useState } from 'react';
import { Layers, X, ArrowRight, Sparkles, Mail, Lock, Shield, User, Building, Check } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ChromaWaves } from '../reactbits/ChromaWaves';
import { GlassCard } from '../reactbits/GlassCard';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartOnboarding: () => void;
  onSuccessAuth: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onStartOnboarding,
  onSuccessAuth,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'join'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      if (mode === 'signup') {
        onClose();
        onStartOnboarding();
      } else {
        factoryStore.setAuthStatus('authenticated');
        onSuccessAuth();
        onClose();
      }
    }, 600);
  };

  const handlePersonaLogin = (role: string) => {
    factoryStore.signInDemo();
    factoryStore.setRole(role as any);
    onSuccessAuth();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-[#0a0c14] border border-white/10 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 text-slate-100">
        <ChromaWaves />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-colors z-20"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative z-10 space-y-6">
          {/* Modal Brand Header */}
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Software Karkhana</h3>
            <p className="text-xs text-blue-400 font-mono mt-0.5">Autonomous Software Delivery Factory</p>
          </div>

          {/* Quick Persona Login Matrix */}
          <div className="space-y-2">
            <span className="text-[11px] font-mono uppercase text-slate-400 font-semibold tracking-wider">
              Instant Persona Session Login
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handlePersonaLogin('developer')}
                className="p-3 bg-[#101422] hover:bg-[#141a2e] border border-blue-500/20 hover:border-blue-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Devon Hayes</div>
                <div className="text-[10px] text-blue-400 font-mono">Staff Engineer</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('product_manager')}
                className="p-3 bg-[#101422] hover:bg-[#141a2e] border border-purple-500/20 hover:border-purple-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Sarah Lin</div>
                <div className="text-[10px] text-purple-400 font-mono">Product Director</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('executive')}
                className="p-3 bg-[#101422] hover:bg-[#141a2e] border border-emerald-500/20 hover:border-emerald-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Jonathan Vance</div>
                <div className="text-[10px] text-emerald-400 font-mono">Executive VP</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('release_manager')}
                className="p-3 bg-[#101422] hover:bg-[#141a2e] border border-amber-500/20 hover:border-amber-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Maya Patel</div>
                <div className="text-[10px] text-amber-400 font-mono">Lead SRE</div>
              </button>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-white/10 w-full" />
            <span className="bg-[#0a0c14] px-3 text-[10px] font-mono text-slate-500 uppercase">
              Or Custom Account
            </span>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@enterprise.internal"
                className="w-full px-4 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
            >
              <span>{isLoading ? 'Verifying Credentials...' : 'Sign In to Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
