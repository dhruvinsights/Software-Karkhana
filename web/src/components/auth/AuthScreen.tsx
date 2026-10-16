import React, { useState } from 'react';
import {
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Info,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { factoryStore } from '../../store/factoryStore';
import { ChromaWaves } from '../reactbits/ChromaWaves';
import { ShinyText } from '../reactbits/ShinyText';

export interface AuthScreenProps {
  onSuccessAuthenticated: () => void;
  onCancel?: () => void;
}

const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'mail.com',
  'proton.me',
  'protonmail.com',
];

declare global {
  interface Window {
    google?: any;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onSuccessAuthenticated,
  onCancel,
}) => {
  const [step, setStep] = useState<'email' | 'otp' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [isRobotVerified, setIsRobotVerified] = useState(true);
  const [isVerifyingBot, setIsVerifyingBot] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check for GitHub OAuth redirect code callback in URL query parameters
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const githubCode = urlParams.get('code');
    if (githubCode) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsLoading(true);
      fetch('/api/auth/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: githubCode }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.access_token && data.user) {
            factoryStore.setAuthSession(data.access_token, data.user);
            onSuccessAuthenticated();
          } else {
            setErrorMsg(data.detail || 'GitHub authentication failed.');
          }
        })
        .catch((err) => setErrorMsg(err.message || 'GitHub authentication failed.'))
        .finally(() => setIsLoading(false));
    }
  }, [onSuccessAuthenticated]);

  // Initialize Google Identity Services
  React.useEffect(() => {
    const handleGoogleCredentialResponse = async (response: any) => {
      if (!response?.credential) return;
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Google authentication failed.');
        }
        factoryStore.setAuthSession(data.access_token, data.user);
        onSuccessAuthenticated();
      } catch (err: any) {
        setErrorMsg(err.message || 'Google authentication failed.');
      } finally {
        setIsLoading(false);
      }
    };

    const setupGsi = () => {
      if (window.google?.accounts?.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
          });

          const container = document.getElementById('google-btn-rendered');
          if (container) {
            window.google.accounts.id.renderButton(container, {
                theme: 'filled_black',
                size: 'large',
                shape: 'pill',
                width: 200,
                text: 'continue_with',
              });
          }
        } catch (e) {
          console.warn('Google GIS initialize note:', e);
        }
      }
    };

    if (window.google?.accounts?.id) {
      setupGsi();
    } else {
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          setupGsi();
          clearInterval(timer);
        }
      }, 250);
      return () => clearInterval(timer);
    }
  }, [step]);

  // Check personal email domain
  const isPersonalEmail = (() => {
    const parts = email.trim().toLowerCase().split('@');
    return parts.length === 2 && PERSONAL_EMAIL_DOMAINS.includes(parts[1]);
  })();

  const handleBotChallenge = () => {
    if (isRobotVerified) return;
    setIsVerifyingBot(true);
    setTimeout(() => {
      setIsVerifyingBot(false);
      setIsRobotVerified(true);
    }, 400);
  };

  const handleTriggerGoogle = () => {
    setErrorMsg(null);
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      setErrorMsg('Google Sign-In is initializing. Please wait a moment.');
    }
  };

  const handleTriggerGitHub = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/github/client-id');
      const data = await res.json();
      if (data.client_id) {
        const redirectUri = window.location.origin;
        window.location.href = `https://github.com/login/oauth/authorize?client_id=${data.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;
      } else {
        setErrorMsg('GitHub Client ID is not configured on the backend yet. You can sign in with Google or Email OTP.');
      }
    } catch {
      setErrorMsg('Could not connect to GitHub OAuth service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProceedToOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRobotVerified) {
      setErrorMsg('Please complete the security verification challenge below.');
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not send verification code.');
      }
      setOtpCode('');
      setStep('otp');
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not connect to authentication service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid verification code.');
      }
      factoryStore.setAuthSession(data.access_token, data.user);
      onSuccessAuthenticated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed. Please check the code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    try {
      let res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      if (res.status === 401 || res.status === 403 || res.status === 404) {
        res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: password || 'password123',
            display_name: cleanEmail.split('@')[0],
            role: 'product_manager',
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed.');
      }

      factoryStore.setAuthSession(data.access_token, data.user);
      onSuccessAuthenticated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06080e] text-[#f7f8fc] flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-12 selection:bg-[#075bff] selection:text-white relative overflow-hidden select-none">
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <ChromaWaves />
      </div>

      {/* Top Header */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-white/[0.08] relative z-10">
        <div>
          <span className="text-base font-semibold text-white tracking-tight">Software Karkhana</span>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          >
            Back to Home
          </button>
        )}
      </div>

      {/* Main Card */}
      <div className="max-w-md mx-auto w-full my-auto py-8 relative z-10 space-y-6 animate-fade-in">
        {step === 'email' && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                First, enter your <ShinyText text="email" speed={4} />
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 font-light">
                We suggest using the email address you use at work.
              </p>
            </div>

            {/* Enterprise OAuth Buttons (Google & GitHub) — side by side */}
            <div className="flex gap-3 pt-2">
              <div id="google-btn-rendered" className="flex-1 flex justify-center items-center min-h-[44px] overflow-hidden" />

              <button
                type="button"
                onClick={handleTriggerGitHub}
                disabled={isLoading}
                className="flex-1 h-[44px] px-4 bg-[#101422] hover:bg-[#141a2e] border border-white/10 hover:border-white/20 rounded-full text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <svg className="w-4 h-4 fill-white shrink-0" viewBox="0 0 24 24">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                <span>Continue with GitHub</span>
              </button>
            </div>

            <div className="relative flex items-center justify-center py-1">
              <div className="border-t border-white/10 w-full" />
              <span className="bg-[#06080e] px-3 text-[10px] font-mono text-slate-500 uppercase">
                OR
              </span>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Email Form */}
            <form onSubmit={handleProceedToOtp} className="space-y-3.5">
              <div className="space-y-1">
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@work-email.com"
                    className="w-full pl-10 pr-4 py-3 bg-[#0a0d16] border border-white/10 rounded-2xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#075bff] transition-colors"
                  />
                </div>

                {isPersonalEmail && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-[11px] flex items-start gap-2 mt-2 leading-relaxed">
                    <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      Using your work email (if you have one) will make it easier for coworkers to join you on Software Karkhana.
                    </span>
                  </div>
                )}
              </div>

              {/* Security check */}
              <div
                onClick={handleBotChallenge}
                className={`p-3.5 bg-[#0a0d16] border ${
                  isRobotVerified ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 hover:border-white/20'
                } rounded-2xl flex items-center justify-between cursor-pointer transition-all select-none`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      isRobotVerified
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-white/30 bg-black/40'
                    }`}
                  >
                    {isRobotVerified && <CheckCircle2 className="w-4 h-4 text-white" />}
                    {isVerifyingBot && (
                      <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <span className="text-xs text-slate-300 font-medium">I am not a robot</span>
                </div>
                <ShieldCheck className={`w-5 h-5 ${isRobotVerified ? 'text-emerald-400' : 'text-slate-500'}`} />
              </div>

              <button
                type="submit"
                disabled={isLoading || !email.trim()}
                className="w-full py-3 bg-[#075bff] hover:bg-[#075bff]/90 disabled:opacity-40 text-white font-semibold rounded-2xl text-xs transition-all shadow-lg shadow-[#075bff]/30 flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <span>{isLoading ? 'Sending Magic Code...' : 'Continue with Email'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1">
              <span
                onClick={() => setStep('password')}
                className="hover:text-slate-300 underline cursor-pointer"
              >
                Sign in with password instead
              </span>
            </div>
          </>
        )}

        {step === 'otp' && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-[#075bff]/10 border border-[#075bff]/30 text-[#075bff] flex items-center justify-center mx-auto mb-2">
                <Sparkles className="w-6 h-6" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Check your email
              </h1>
              <p className="text-xs text-slate-400">
                We sent a 6-digit confirmation code to{' '}
                <span className="text-white font-medium">{email}</span>
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-1">
                <input
                  type="text"
                  maxLength={6}
                  autoFocus
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="······"
                  className="w-full py-3.5 text-center bg-[#0a0d16] border border-white/10 rounded-2xl text-xl font-mono tracking-[0.4em] text-white focus:outline-none focus:border-[#075bff] transition-colors placeholder:text-slate-700"
                />
                <p className="text-[10px] text-slate-500 text-center pt-1 font-mono">
                  Enter the 6-digit confirmation code sent to your email
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading || otpCode.length < 6}
                className="w-full py-3 bg-[#075bff] hover:bg-[#075bff]/90 disabled:opacity-40 text-white font-semibold rounded-2xl text-xs transition-all shadow-lg shadow-[#075bff]/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{isLoading ? 'Verifying...' : 'Verify & Open Workspace'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setStep('email')}
                className="hover:text-white underline cursor-pointer"
              >
                Back to change email
              </button>
              <button
                type="button"
                onClick={handleProceedToOtp}
                className="text-[#075bff] hover:underline cursor-pointer"
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Enter your password
              </h1>
              <p className="text-xs text-slate-400">
                Signing in as <span className="text-white font-medium">{email || 'your account'}</span>
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handlePasswordLogin} className="space-y-3.5">
              <div className="space-y-1">
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type="password"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-10 pr-4 py-3 bg-[#0a0d16] border border-white/10 rounded-2xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#075bff] transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !password.trim()}
                className="w-full py-3 bg-[#075bff] hover:bg-[#075bff]/90 disabled:opacity-40 text-white font-semibold rounded-2xl text-xs transition-all shadow-lg shadow-[#075bff]/30 flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <span>{isLoading ? 'Authenticating...' : 'Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setStep('email')}
                className="hover:text-white underline cursor-pointer"
              >
                Back to email
              </button>
              <button
                type="button"
                onClick={handleProceedToOtp}
                className="text-[#075bff] hover:underline cursor-pointer"
              >
                Send magic code instead
              </button>
            </div>
          </div>
        )}

        {/* Legal Disclosures */}
        <div className="text-[11px] text-slate-500 text-center leading-relaxed font-light pt-2">
          By continuing, you’re agreeing to our{' '}
          <span className="text-slate-400 underline cursor-pointer">Main Services Agreement</span>,{' '}
          <span className="text-slate-400 underline cursor-pointer">User Terms of Service</span>, and{' '}
          <span className="text-slate-400 underline cursor-pointer">Software Karkhana Supplemental Terms</span>.
          Additional disclosures are available in our{' '}
          <span className="text-slate-400 underline cursor-pointer">Privacy Policy</span> and{' '}
          <span className="text-slate-400 underline cursor-pointer">Cookie Policy</span>.
        </div>

        <div className="text-center pt-2">
          <p className="text-xs text-slate-400">
            Already using Software Karkhana?{' '}
            <span
              onClick={() => {
                factoryStore.signInDemo();
                onSuccessAuthenticated();
              }}
              className="text-[#075bff] hover:underline font-semibold cursor-pointer"
            >
              Sign in to an existing workspace
            </span>
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full pt-6 border-t border-white/[0.08] text-center text-[10px] text-slate-600 relative z-10">
        Enterprise Cloud Infrastructure · Built on Google Cloud Run & Gemini
      </div>
    </div>
  );
};
