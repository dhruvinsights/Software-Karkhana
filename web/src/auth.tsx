// Auth: Firebase Auth in production, a role picker in local dev mode.
// The server decides the role on every request; the browser only proves identity.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword,
  signInWithPopup, signOut, type Auth,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface PublicConfig {
  authMode: 'firebase' | 'dev';
  firebase: { apiKey: string; authDomain: string; projectId: string };
  githubRepo: string | null;
  runner: string;
  llmProvider: string;
  embedProvider: string;
  reviewEngine: string;
}

export type Role = 'pm' | 'director' | 'developer' | 'lead';
export interface Me { id: string; email: string; display_name: string; role: Role; onboarded_at: string | null }

interface AuthState {
  config: PublicConfig | null;
  me: Me | null;
  ready: boolean;
  error: string | null;
  token: () => Promise<Record<string, string>>;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signInDev: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEV_KEY = 'karkhana-dev-user';
let fbAuth: Auth | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = async (): Promise<Record<string, string>> => {
    if (config?.authMode === 'dev') {
      const u = safeGet(DEV_KEY);
      return u ? { 'X-Dev-User': u } : {};
    }
    const t = await fbAuth?.currentUser?.getIdToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const loadMe = async (headers: Record<string, string>) => {
    const r = await fetch('/api/me', { headers });
    if (r.ok) { setMe(await r.json()); setError(null); }
    else { setMe(null); if (r.status === 403) setError((await r.json()).detail); }
  };

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((cfg: PublicConfig) => {
      setConfig(cfg);
      if (cfg.authMode === 'dev') {
        const u = safeGet(DEV_KEY);
        (u ? loadMe({ 'X-Dev-User': u }) : Promise.resolve()).finally(() => setReady(true));
        return;
      }
      const app: FirebaseApp = initializeApp(cfg.firebase);
      fbAuth = getAuth(app);
      onAuthStateChanged(fbAuth, async (user) => {
        if (user) await loadMe({ Authorization: `Bearer ${await user.getIdToken()}` });
        else setMe(null);
        setReady(true);
      });
    }).catch(() => { setError('Cannot reach the Karkhana API'); setReady(true); });
  }, []);

  const value: AuthState = {
    config, me, ready, error, token,
    signInGoogle: async () => { if (fbAuth) await signInWithPopup(fbAuth, new GoogleAuthProvider()); },
    signInEmail: async (email, password) => {
      if (fbAuth) await signInWithEmailAndPassword(fbAuth, email, password);
    },
    signInDev: async (email) => { safeSet(DEV_KEY, email); await loadMe({ 'X-Dev-User': email }); },
    refreshMe: async () => { await loadMe(await token()); },
    logout: async () => {
      if (config?.authMode === 'dev') safeSet(DEV_KEY, '');
      else if (fbAuth) await signOut(fbAuth);
      setMe(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k) || null; } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked */ }
}
