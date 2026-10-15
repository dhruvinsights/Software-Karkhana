import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Lightbulb, SealCheck, Code, GitPullRequest, BookOpen, Notebook } from '@phosphor-icons/react';
import type { PublicStats } from '../../api';

// Design read: a calm, confident dark-navy product page, big sans headline with one
// serif-italic emphasis word, one electric-blue accent, tonal surfaces.

const STEPS = [
  { icon: Lightbulb, name: 'Evaluate', body: 'An idea becomes a scored evaluation with gaps and epics, every epic quoting the author’s own words.', tag: 'Gemini or local Ollama' },
  { icon: SealCheck, name: 'Approve', body: 'A director passes or rejects at a hard gate. The server refuses anyone else.', tag: 'Human gate' },
  { icon: Code, name: 'Build', body: 'A Coder agent implements one approved story in an isolated workspace and runs the tests.', tag: 'Google ADK · AX' },
  { icon: GitPullRequest, name: 'Review', body: 'A real pull request is opened and reviewed by PR-Agent. A developer triages every comment before merge.', tag: 'PR-Agent' },
  { icon: BookOpen, name: 'Learn', body: 'Each merge leaves a learning. Once verified, it informs the next evaluation.', tag: 'Verified memory' },
  { icon: Notebook, name: 'Prove', body: 'Every step lands in an append-only, hash-chained ledger you can verify.', tag: 'SHA-256 chain' },
];

const ROLES = [
  ['Project manager', 'Submits ideas and reads the evaluation.'],
  ['Director', 'Owns the approval gate and the portfolio.'],
  ['Developer', 'Runs the agent and triages review comments.'],
  ['Tech lead', 'Merges, verifies learnings and watches system health.'],
];

const BUILT_ON = ['Google ADK', 'Google AX', 'Gemini', 'Ollama', 'PR-Agent', 'PostgreSQL'];

export default function Landing() {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => { fetch('/api/public/stats').then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => setStats(null)); }, []);
  const rise = (i = 0) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.6, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const } });
  const real = stats && (stats.projects > 0 || stats.agent_runs > 0);

  return (
    <div style={{ background: 'var(--bg)' }}>
      <header style={{ position: 'absolute', inset: '0 0 auto 0', zIndex: 5 }}>
        <div className="row between" style={{ maxWidth: 1240, margin: '0 auto', padding: '22px 32px' }}>
          <Link to="/" className="brand" style={{ padding: 0 }}><span className="mark">K</span><b>Karkhana</b></Link>
          <nav className="row" style={{ gap: 6 }} aria-label="Site">
            <a className="btn sm" style={{ background: 'transparent', border: 0 }} href="#flow">How it works</a>
            <a className="btn sm" style={{ background: 'transparent', border: 0 }} href="#roles">Roles</a>
            <Link className="btn pri sm" to="/signin">Sign in</Link>
          </nav>
        </div>
      </header>

      <section style={{ minHeight: '100dvh', position: 'relative', display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
        background: 'radial-gradient(1200px 800px at 12% 105%, rgb(45 92 255 / .75), transparent 62%), radial-gradient(900px 600px at 95% -10%, rgb(45 92 255 / .22), transparent 60%), linear-gradient(180deg, #0a1030 0%, var(--bg) 100%)' }}>
        <div style={{ maxWidth: 1240, width: '100%', margin: '0 auto', padding: '140px 32px 64px' }}>
          <motion.h1 {...(reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } })}
            style={{ fontSize: 'clamp(44px, 8.4vw, 124px)', lineHeight: 0.98, letterSpacing: '-0.045em', fontWeight: 600, maxWidth: '12ch', color: '#fff' }}>
            Idea to merged code, <span className="serif" style={{ fontSize: '1.04em' }}>on the record.</span>
          </motion.h1>
          <div className="row between" style={{ marginTop: 40, alignItems: 'flex-end', gap: 32 }}>
            <p style={{ maxWidth: '38ch', fontSize: 18, color: '#c3cbe6' }}>A software factory where agents write the code and people hold every gate.</p>
            <div className="row">
              <Link className="btn pri" style={{ padding: '14px 24px', fontSize: 15 }} to="/signin">Open workspace<ArrowRight size={16} weight="bold" /></Link>
              <a className="btn" style={{ padding: '14px 24px', fontSize: 15, background: 'transparent' }} href="#flow">See the flow</a>
            </div>
          </div>
          {real && (
            <div className="row" style={{ marginTop: 56, paddingTop: 28, borderTop: '1px solid var(--line)', gap: 56 }}>
              {([['Projects', stats.projects], ['Agent runs', stats.agent_runs], ['Merged PRs', stats.merged_prs], ['Ledger entries', stats.ledger_entries]] as const).map(([l, v]) => (
                <div key={l}><div style={{ fontSize: 'clamp(34px, 4.6vw, 58px)', fontWeight: 500, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{v}</div><span className="lbl">{l}</span></div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="flow" style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px 40px' }}>
        <motion.div {...rise()} className="row between" style={{ alignItems: 'flex-end', marginBottom: 40 }}>
          <h2 style={{ fontSize: 'clamp(34px, 5vw, 64px)', letterSpacing: '-0.035em' }}>How the <span className="serif">factory</span> runs</h2>
          <p className="muted" style={{ maxWidth: '36ch' }}>Six steps, each owned by a person or an agent, each written to the ledger.</p>
        </motion.div>
        <div>
          {STEPS.map((s, i) => (
            <motion.div key={s.name} {...rise(i)} className="svc">
              <span className="mono muted sm">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.name}</h3>
              <p className="muted">{s.body}</p>
              <span className="pill outline">{s.tag}</span>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="roles" style={{ maxWidth: 1240, margin: '0 auto', padding: '100px 32px 40px' }}>
        <motion.h2 {...rise()} style={{ fontSize: 'clamp(34px, 5vw, 64px)', letterSpacing: '-0.035em', marginBottom: 36 }}>One workspace, <span className="serif">four</span> dashboards</motion.h2>
        <div className="g3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          {ROLES.map(([name, body], i) => (
            <motion.div key={name} {...rise(i)} className="card raised" style={{ padding: 28, minHeight: 190, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 24 }}>{name}</h3>
              <p className="muted">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1240, margin: '0 auto', padding: '100px 32px 80px' }}>
        <span className="lbl">Built on open source</span>
        <div className="row" style={{ marginTop: 16, gap: 12 }}>
          {BUILT_ON.map((n) => <span key={n} className="pill outline" style={{ fontSize: 13, padding: '8px 18px' }}>{n}</span>)}
        </div>
      </section>

      <section style={{ padding: '0 32px 120px' }}>
        <motion.div {...rise()} className="card raised" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(32px, 6vw, 72px)', textAlign: 'center', background: 'radial-gradient(700px 300px at 50% 120%, rgb(200 210 230 / .12), transparent 70%), var(--surface2)' }}>
          <h2 style={{ fontSize: 'clamp(32px, 5vw, 60px)', letterSpacing: '-0.035em', color: '#fff' }}>Ship the next story <span className="serif" style={{ color: '#b0bcd4' }}>with a paper trail.</span></h2>
          <Link className="btn pri" style={{ marginTop: 28, padding: '14px 26px', fontSize: 15 }} to="/signin">Sign in<ArrowUpRight size={16} weight="bold" /></Link>
        </motion.div>
      </section>

      <footer style={{ borderTop: '1px solid var(--line)', padding: '24px 32px' }}>
        <div className="row between muted sm" style={{ maxWidth: 1240, margin: '0 auto' }}>
          <span>Software Karkhana</span><span>Open-source components are listed in THIRD_PARTY_NOTICES.md</span>
        </div>
      </footer>
      <style>{`
        .svc { display: grid; grid-template-columns: 56px minmax(120px, 1fr) minmax(0, 2fr) auto; gap: 24px; align-items: center; padding: 28px 8px; border-top: 1px solid var(--line); transition: background .2s, padding .2s; }
        .svc:last-child { border-bottom: 1px solid var(--line); }
        .svc:hover { background: var(--surface); padding-left: 20px; }
        .svc h3 { font-size: clamp(28px, 4vw, 52px); letter-spacing: -0.04em; }
        .svc:hover h3 { color: var(--accent-hi); }
        @media (max-width: 800px) { .svc { grid-template-columns: 36px 1fr; } .svc p, .svc .pill { grid-column: 2; justify-self: start; } }
      `}</style>
    </div>
  );
}
