import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Ledger } from './components/common';
import Projects from './pages/Projects';
import ProjectPage from './pages/ProjectPage';
import Learnings from './pages/Learnings';
import Portfolio from './pages/Portfolio';
import './styles.css';

const ROLE_LABEL = { pm: 'Project manager', director: 'Director', developer: 'Developer', lead: 'Tech lead' };
const DEV_USERS = ['pm', 'director', 'developer', 'lead'];

function Login() {
  const { config, signInGoogle, signInEmail, signInDev, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(String(e)); } finally { setBusy(false); } };
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <div className="card stack" style={{ width: 'min(420px, 100%)' }}>
        <div className="brand"><span className="mark">K</span><span><b>Software Karkhana</b><small>One record, idea to merged code</small></span></div>
        {error && <div className="err">{error}</div>}
        {err && <div className="err">{err}</div>}
        {config?.authMode === 'dev' ? (
          <>
            <p className="muted sm">Local dev mode. Pick a demo user (roles are still checked by the server).</p>
            {DEV_USERS.map((r) => (
              <button key={r} className="btn" disabled={busy} onClick={() => run(() => signInDev(`${r}@karkhana.dev`))}>
                Sign in as {ROLE_LABEL[r as keyof typeof ROLE_LABEL]} <span className="muted mono sm">{r}@karkhana.dev</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <button className="btn pri" disabled={busy} onClick={() => run(signInGoogle)}>Sign in with Google</button>
            <span className="lbl">or demo account</span>
            <input className="in" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="in" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" disabled={busy || !email || !password} onClick={() => run(() => signInEmail(email, password))}>Sign in</button>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectLedger() {
  const { id } = useParams();
  return <Ledger projectId={id} />;
}

function Shell() {
  const { me, logout, config } = useAuth();
  if (!me) return <Login />;
  return (
    <div className="app">
      <aside className="rail">
        <div className="brand"><span className="mark">K</span><span><b>Karkhana</b><small>{config?.runner} runner</small></span></div>
        <nav className="nav">
          <NavLink to="/projects">{me.role === 'director' ? 'Approvals and projects' : me.role === 'developer' ? 'My board' : 'Projects'}</NavLink>
          <NavLink to="/learnings">Learnings</NavLink>
          <NavLink to="/portfolio">Portfolio and gates</NavLink>
        </nav>
        <div className="who">
          <b>{me.display_name}</b>
          <span className="pill outline" style={{ alignSelf: 'flex-start' }}>{ROLE_LABEL[me.role]}</span>
          <span className="muted sm mono">{me.email}</span>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="canvas">
        <div className="wrap">
          <Routes>
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/learnings" element={<Learnings />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </div>
        <Routes>
          <Route path="/projects/:id" element={<ProjectLedger />} />
          <Route path="*" element={<Ledger />} />
        </Routes>
      </main>
    </div>
  );
}

function Root() {
  const { ready } = useAuth();
  if (!ready) return <p className="muted" style={{ padding: 24 }}>Loading<span className="spin" /></p>;
  return <Shell />;
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter><Root /></BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
