import React, { useState } from 'react';
import { X, ArrowRight, Mail, Lock, User, Shield, AlertCircle } from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ChromaWaves } from '../reactbits/ChromaWaves';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'signin' | 'signup';
  onClose: () => void;
  onStartOnboarding: () => void;
  onSuccessAuth: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'signin',
  onClose,
  onStartOnboarding,
  onSuccessAuth,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('product_manager');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
            display_name: displayName.trim() || email.split('@')[0],
            role,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to create enterprise account.');
        }

        factoryStore.setAuthSession(data.access_token, data.user);
        onClose();
        onStartOnboarding();
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Invalid email or password.');
        }

        factoryStore.setAuthSession(data.access_token, data.user);
        onClose();
        if (data.user.onboarded_at) {
          onSuccessAuth();
        } else {
          onStartOnboarding();
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication error.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePersonaLogin = async (personaRole: string, defaultEmail: string, name: string) => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      // Try login first or fallback to client demo session
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: defaultEmail,
          password: 'password123',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        factoryStore.setAuthSession(data.access_token, data.user);
      } else {
        // Fallback for seamless demo
        factoryStore.signInDemo();
        factoryStore.setRole(personaRole as any);
      }
      onClose();
      onSuccessAuth();
    } catch {
      factoryStore.signInDemo();
      factoryStore.setRole(personaRole as any);
      onClose();
      onSuccessAuth();
    } finally {
      setIsLoading(false);
    }
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

        <div className="relative z-10 space-y-5">
          {/* Modal Header */}
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Software Karkhana</h3>
            <p className="text-xs text-blue-400 font-mono mt-0.5">Enterprise Software Delivery Unit</p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex bg-[#080a10] p-1 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => { setMode('signin'); setErrorMsg(null); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'signin' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setErrorMsg(null); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'signup' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Error Message Alert */}
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quick Persona Matrix */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold tracking-wider">
              Quick Enterprise Personas
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handlePersonaLogin('product_manager', 'pm@karkhana.dev', 'Sarah Lin')}
                className="p-2.5 bg-[#101422] hover:bg-[#141a2e] border border-purple-500/20 hover:border-purple-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Sarah Lin</div>
                <div className="text-[10px] text-purple-400 font-mono">Product Manager</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('developer', 'dev@karkhana.dev', 'Devon Hayes')}
                className="p-2.5 bg-[#101422] hover:bg-[#141a2e] border border-blue-500/20 hover:border-blue-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Devon Hayes</div>
                <div className="text-[10px] text-blue-400 font-mono">Staff Engineer</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('executive', 'director@karkhana.dev', 'Jonathan Vance')}
                className="p-2.5 bg-[#101422] hover:bg-[#141a2e] border border-emerald-500/20 hover:border-emerald-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Jonathan Vance</div>
                <div className="text-[10px] text-emerald-400 font-mono">Executive Director</div>
              </button>
              <button
                type="button"
                onClick={() => handlePersonaLogin('qa', 'qa@karkhana.dev', 'Maya Patel')}
                className="p-2.5 bg-[#101422] hover:bg-[#141a2e] border border-amber-500/20 hover:border-amber-500/40 rounded-xl text-left transition-all"
              >
                <div className="text-xs font-bold text-white">Maya Patel</div>
                <div className="text-[10px] text-amber-400 font-mono">QA & Verification</div>
              </button>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-white/10 w-full" />
            <span className="bg-[#0a0c14] px-3 text-[10px] font-mono text-slate-500 uppercase">
              Or Work Credentials
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Full Name</label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="w-full pl-9 pr-4 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Primary Discipline / Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="product_manager">Product Manager (Discovery & Epics)</option>
                    <option value="developer">Lead Developer (Agents & Code)</option>
                    <option value="architect">Systems Architect (ADRs & C4)</option>
                    <option value="executive">Executive / Director (Governance)</option>
                    <option value="qa">QA / QC Lead (Test Plans & Sign-off)</option>
                    <option value="security">AppSec / Pen Tester (SAST & CVE)</option>
                    <option value="devops">DevOps / SRE (CI/CD Pipelines)</option>
                    <option value="admin">Workspace Administrator</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Enterprise Work Email</label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@enterprise.com"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#080a10] border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <span>{isLoading ? 'Verifying with Cloud...' : mode === 'signup' ? 'Create Account & Continue' : 'Sign In to Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
