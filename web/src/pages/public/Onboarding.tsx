import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, useGet, type ProviderHealth, type RunnerStatus } from '../../api';
import { useAuth, type Role } from '../../auth';
import { ErrorBox, Loading } from '../../components/common';
import { HealthPanel } from '../../components/Health';
import { ROLE_LABEL } from '../../shell/Shell';
import { AuthFrame } from './SignIn';

const ROLE_CAN: Record<Role, string[]> = {
  pm: ['Write ideas and submit them for evaluation', 'Read the AI scorecard, gaps and epics', 'Re-evaluate after a director rejects'],
  director: ['Approve or reject at the gate', 'See every project and the portfolio', 'Read the evidence ledger'],
  developer: ['Hand approved stories to the Coder agent', 'Triage every AI review comment', 'Merge once tests and triage are clear'],
  lead: ['Everything a developer does', 'Verify learnings so they feed future projects', 'See live system and runner health'],
};

export default function Onboarding() {
  const { me, refreshMe, logout } = useAuth();
  const call = useApi();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const health = useGet<ProviderHealth>(['health'], step === 1 ? '/api/providers/health' : null);
  const runner = useGet<RunnerStatus>(['runner'], step === 1 ? '/api/runner/status' : null);
  if (!me) return null;

  const finish = async () => {
    setBusy(true); setErr(null);
    try { await call('/api/me/onboarded', { method: 'POST' }); await refreshMe(); nav('/', { replace: true }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <AuthFrame headline={<>Set up your <span className="serif">workspace</span>.</>}>
      <div className="steps" aria-label={`Step ${step + 1} of 2`}><i className="on" /><i className={step > 0 ? 'on' : ''} /></div>
      {step === 0 ? (
        <>
          <span className="eyebrow">Step 1 of 2 · Your role</span>
          <h2 style={{ fontSize: 28 }}>You are signed in as {ROLE_LABEL[me.role]}</h2>
          <p className="muted">Your role is set by the server. Your sidebar shows only what it allows.</p>
          <div className="card stack" style={{ gap: 8 }}>
            {ROLE_CAN[me.role].map((c) => <div key={c} className="chk"><span className="pill ok" />{c}</div>)}
          </div>
          <button className="btn pri" style={{ padding: '12px 16px' }} onClick={() => setStep(1)}>Continue</button>
          <button className="btn sm" style={{ alignSelf: 'center' }} onClick={logout}>Not you? Sign out</button>
        </>
      ) : (
        <>
          <span className="eyebrow">Step 2 of 2 · Connections</span>
          <h2 style={{ fontSize: 28 }}>What this workspace can reach</h2>
          <p className="muted">Live checks. Anything marked not connected is shown honestly, never faked.</p>
          {health.data && runner.data ? <HealthPanel health={health.data} runner={runner.data} /> : <Loading />}
          <ErrorBox error={health.error ?? runner.error ?? err} />
          <div className="row">
            <button className="btn" onClick={() => setStep(0)}>Back</button>
            <button className="btn pri" style={{ flex: 1, padding: '12px 16px' }} disabled={busy} onClick={finish}>{busy ? 'Finishing…' : 'Enter workspace'}</button>
          </div>
        </>
      )}
    </AuthFrame>
  );
}
