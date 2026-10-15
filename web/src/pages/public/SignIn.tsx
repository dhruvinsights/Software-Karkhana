import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, GoogleLogo } from '@phosphor-icons/react';
import { useAuth } from '../../auth';
import type { DevUser } from '../../api';

const ROLE_LABEL: Record<string, string> = { pm: 'Project manager', director: 'Director', developer: 'Developer', lead: 'Tech lead' };
const ROLE_BLURB: Record<string, string> = {
  pm: 'Submit ideas, read evaluations',
  director: 'Approve or reject at the gate',
  developer: 'Run the agent, triage reviews',
  lead: 'Merge, verify learnings, system health',
};

export function AuthFrame({ children, headline }: { children: React.ReactNode; headline: React.ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-hero">
        <Link to="/" className="brand" style={{ padding: 0 }}><span className="mark">K</span><b>Software Karkhana</b></Link>
        <h1>{headline}</h1>
        <p className="muted" style={{ maxWidth: '44ch' }}>One record from idea to merged code. Humans decide at every gate; agents do the typing.</p>
      </section>
      <section className="auth-panel"><div className="auth-box">{children}</div></section>
    </div>
  );
}

export default function SignIn() {
  const { config, signInGoogle, signInEmail, signInDev, error } = useAuth();
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (config?.authMode !== 'dev') return;
    fetch('/api/public/dev-users').then((r) => r.json()).then(setUsers).catch(() => setErr('Cannot load local accounts'));
  }, [config?.authMode]);

  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  return (
    <AuthFrame headline={<>Welcome <span className="serif">back</span>.</>}>
      <Link to="/" className="muted sm row" style={{ textDecoration: 'none', gap: 6 }}><ArrowLeft size={14} />Back to overview</Link>
      <h2 style={{ fontSize: 28 }}>Sign in</h2>
      {(error || err) && <div className="err" role="alert">{error ?? err}</div>}
      {config?.authMode === 'dev' ? (
        <>
          <p className="muted sm">Local mode. Pick an account; the server still enforces its role on every request.</p>
          {users === null && !err && <div className="skeleton" style={{ height: 64 }} />}
          {users?.length === 0 && <div className="empty">No users are seeded. Run the seed script.</div>}
          {users?.map((u) => (
            <button key={u.email} className="opt" disabled={busy} onClick={() => run(() => signInDev(u.email))}>
              <span className="stack" style={{ gap: 2 }}><b>{ROLE_LABEL[u.role] ?? u.role}</b><span className="muted sm">{ROLE_BLURB[u.role]}</span></span>
              <span className="muted mono sm">{u.email}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <button className="btn pri" style={{ padding: '12px 16px' }} disabled={busy} onClick={() => run(signInGoogle)}><GoogleLogo size={18} weight="bold" />Continue with Google</button>
          <span className="lbl" style={{ textAlign: 'center' }}>or with email</span>
          <input className="in" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="in" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn" disabled={busy || !email || !password} onClick={() => run(() => signInEmail(email, password))}>Sign in</button>
        </>
      )}
    </AuthFrame>
  );
}
