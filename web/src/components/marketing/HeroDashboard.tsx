import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, BookOpen, Bell, Boxes, Check, CheckCircle2, ChevronDown, ChevronRight, Cpu, FolderGit2,
  GitPullRequest, LayoutGrid, Layers, MessageSquare, Plus, Radio, Search, Server, Shield, ShieldCheck,
  Sliders, Sparkles, Terminal, UserPlus, Workflow, X,
} from 'lucide-react';
import type { LedgerEntry, RecordFn } from './ledger';
import { shortHash } from './ledger';
import { Avatar, BORDER, Pill } from './demoKit';

type Screen = 'overview' | 'reviews' | 'engineering' | 'architecture' | 'qa' | 'security' | 'chat';
const CYCLE: Screen[] = ['overview', 'reviews', 'engineering', 'architecture', 'qa', 'security', 'chat'];

interface NavItem { label: string; icon: React.ElementType; screen?: Screen; count?: string }
const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { label: 'Overview', icon: LayoutGrid, screen: 'overview' },
    { label: 'Products', icon: Layers, count: '2' },
    { label: 'Project Hub', icon: FolderGit2, count: '3' },
    { label: 'Reviews', icon: ShieldCheck, screen: 'reviews' },
    { label: 'Team Chat', icon: MessageSquare, screen: 'chat' },
  ] },
  { title: 'Build & Code', items: [
    { label: 'Engineering & Agents', icon: Terminal, screen: 'engineering' },
    { label: 'Pull Requests', icon: GitPullRequest, count: '4' },
    { label: 'System Architecture', icon: Workflow, screen: 'architecture' },
    { label: 'Design System', icon: Cpu },
  ] },
  { title: 'Quality & Ops', items: [
    { label: 'QA Verification', icon: CheckCircle2, screen: 'qa' },
    { label: 'Security & AppSec', icon: Shield, screen: 'security' },
    { label: 'CI/CD Pipelines', icon: Server },
    { label: 'Releases', icon: Radio },
  ] },
  { title: 'Knowledge', items: [
    { label: 'Incidents', icon: Activity },
    { label: 'Knowledge Base', icon: BookOpen },
    { label: 'Factory Governance', icon: Sliders },
  ] },
];

const LABEL: Record<Screen, string> = {
  overview: 'Overview', reviews: 'Reviews', engineering: 'Engineering & Agents', architecture: 'System Architecture',
  qa: 'QA Verification', security: 'Security & AppSec', chat: 'Team Chat',
};

interface Product { name: string; code: string; domain: string; desc: string; stack: string[]; projects: number }
const PRODUCTS: Product[] = [
  { name: 'Payments Gateway', code: 'PAY', domain: 'Fintech', desc: 'Card and UPI payments with fraud scoring and settlement.', stack: ['Python', 'FastAPI', 'Postgres'], projects: 2 },
  { name: 'Merchant Portal', code: 'MER', domain: 'Web', desc: 'Self-serve onboarding and reconciliation for merchants.', stack: ['React', 'TypeScript'], projects: 1 },
];

interface Proposal { id: string; title: string; by: string; problem: string; verdict: string; score: string; decision: 'pending' | 'approved' | 'rejected'; reason?: string }
const PROPOSALS: Proposal[] = [
  { id: 'p1', title: 'Idempotent retries for settlement jobs', by: 'Priya N.', problem: 'Duplicate settlement batches after worker restarts cost ops about 6 hours a week in manual reconciliation.', verdict: 'Proceed', score: '8.4', decision: 'pending' },
  { id: 'p2', title: 'Replace Redis rate limiter with token bucket service', by: 'Arjun K.', problem: 'Burst traffic on the checkout API bypasses the fixed-window limiter during campaign launches.', verdict: 'Proceed with changes', score: '7.1', decision: 'pending' },
];

const WORKERS = [
  { dot: 'bg-blue-400', text: 'worker-04 · Token bucket limiter (PAY-142)', status: 'pytest 14/14 passing', color: 'text-blue-300' },
  { dot: 'bg-emerald-400', text: 'worker-02 · Settlement idempotency keys (PAY-139)', status: 'PR #118 raised', color: 'text-emerald-300' },
  { dot: 'bg-amber-400', text: 'worker-07 · Webhook retry backoff (PAY-151)', status: 'waiting for reviewer', color: 'text-amber-300' },
];

const QA_ROWS = [
  { t: 'Refund exceeding captured amount is rejected', s: 'passed' },
  { t: 'Duplicate webhook delivery is applied once', s: 'passed' },
  { t: 'Expired card at 3DS step shows recoverable error', s: 'failed' },
  { t: 'Settlement file with 0 rows does not create a batch', s: 'pending' },
];

interface Props {
  entries: LedgerEntry[];
  record: RecordFn;
  onGetStarted: () => void;
  cardRef: React.RefObject<HTMLDivElement>;
}

export const HeroDashboard: React.FC<Props> = ({ entries, record, onGetStarted, cardRef }) => {
  const [screen, setScreen] = useState<Screen>('overview');
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<'products' | 'projects' | 'ledger'>('products');
  const [products, setProducts] = useState(PRODUCTS);
  const [newProduct, setNewProduct] = useState('');
  const [proposals, setProposals] = useState(PROPOSALS);
  const [rtab, setRtab] = useState<'pending' | 'decided'>('pending');
  const [deciding, setDeciding] = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState(false);
  const [signed, setSigned] = useState(false);
  const [msgs, setMsgs] = useState([
    { who: 'Priya N.', role: 'PM', text: 'Idempotent retries proposal is in Reviews. @Arjun can you take the architecture call?' },
    { who: 'Arjun K.', role: 'Architect', text: 'On it. ADR-042 covers the key format, signing now.' },
    { who: 'Meera S.', role: 'QA', text: 'Agent flagged a 3DS edge case on PAY-142. Reproducing.' },
  ]);
  const [draft, setDraft] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (touched) return;
    const t = setInterval(() => setScreen((p) => CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]), 6000);
    return () => clearInterval(t);
  }, [touched]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  const go = (s: Screen) => { setTouched(true); setScreen(s); };
  const pending = proposals.filter((p) => p.decision === 'pending');
  const decided = proposals.filter((p) => p.decision !== 'pending');

  const addProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProduct.trim();
    if (!name) return;
    setTouched(true);
    setProducts((p) => [...p, { name, code: name.slice(0, 3).toUpperCase(), domain: 'Cloud Services', desc: 'Production engineering product deliverable.', stack: ['New'], projects: 0 }]);
    record('PRODUCT_CREATED', 'You · Workspace Admin', 'LOGGED');
    setNewProduct('');
  };

  const confirmDecision = () => {
    if (!deciding) return;
    if (deciding.action === 'rejected' && reason.trim().length < 5) { setReasonErr(true); return; }
    const p = proposals.find((x) => x.id === deciding.id)!;
    setProposals((prev) => prev.map((x) => x.id === deciding.id ? { ...x, decision: deciding.action, reason: reason.trim() || undefined } : x));
    record(deciding.action === 'approved' ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED', `You · ${p.title.slice(0, 22)}…`, deciding.action === 'approved' ? 'SIGNED' : 'REASON LOGGED');
    setDeciding(null); setReason(''); setReasonErr(false);
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setTouched(true);
    setMsgs((m) => [...m, { who: 'You', role: 'Director', text: draft.trim() }]);
    setDraft('');
  };

  const navBtn = (it: NavItem) => {
    const Icon = it.icon;
    const active = it.screen === screen;
    const badge = it.label === 'Reviews' && pending.length > 0 ? String(pending.length) : it.count;
    return (
      <button
        key={it.label}
        onClick={() => (it.screen ? go(it.screen) : onGetStarted())}
        title={it.screen ? undefined : 'Open in the live demo workspace'}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900/60'}`}
      >
        <span className="flex items-center gap-2 truncate"><Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-neutral-400'}`} /><span className="truncate">{it.label}</span></span>
        {badge && <span className={`text-[10px] font-mono ${it.label === 'Reviews' ? 'text-amber-300' : 'text-neutral-400'}`}>{badge}</span>}
      </button>
    );
  };

  return (
    <div ref={cardRef} className="w-full h-full rounded-2xl bg-[#07070B] border border-white/15 overflow-hidden flex flex-col text-[#F6F5FA]">
      {/* Sidebar + stage (mirrors AppShell) */}
      <div className="flex flex-1 min-h-0">
        <aside className={`hidden md:flex w-56 lg:w-60 shrink-0 flex-col bg-[#0A0A0F] border-r ${BORDER} text-[#B5B1C0] text-xs`}>
          <div className={`p-3 border-b ${BORDER} space-y-2`}>
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-white tracking-tight">Software Karkhana</span>
              <span className="text-[9px] font-mono tracking-widest text-[#075BFF] uppercase px-1.5 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">v2.4</span>
            </div>
            <div className={`flex items-center justify-between p-2 rounded-lg bg-[#101016] border ${BORDER}`}>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-white truncate">Acme Payments</div>
                <div className="text-[10.5px] text-[#827D8E] font-mono">Production Unit</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#827D8E]" />
            </div>
          </div>
          <div className="px-3 pt-2.5">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-neutral-900/60 border border-neutral-800/80 text-neutral-400">
              <span className="flex items-center gap-2"><Search className="w-3 h-3" />Search or jump to…</span>
              <kbd className="font-mono text-[9px] bg-neutral-800 px-1 rounded">⌘K</kbd>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto mk-scroll px-2 py-2 space-y-3.5">
            <button onClick={onGetStarted} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-white/[0.03] border-white/[0.08] text-neutral-300 hover:text-white hover:border-[#075BFF]/40 cursor-pointer">
              <Sparkles className="w-3.5 h-3.5 text-[#5B8FFF]" />AI Companion
            </button>
            {NAV.map((g) => (
              <div key={g.title} className="space-y-0.5">
                <div className="px-2.5 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">{g.title}</div>
                {g.items.map(navBtn)}
              </div>
            ))}
          </nav>
          <div className={`p-2.5 border-t ${BORDER} bg-[#0A0A0F]`}>
            <div className={`flex items-center gap-2 p-2 rounded-xl bg-[#101016] border border-white/[0.06]`}>
              <Avatar name="Dhruv C" size={30} />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white truncate">Dhruv C.</div>
                <div className="text-[10px] text-[#075BFF] font-mono">DIRECTOR</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 relative">
          <header className={`h-11 bg-[#0A0A0F]/90 border-b ${BORDER} px-4 flex items-center justify-between shrink-0 text-xs`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="md:hidden flex gap-1.5 mr-1"><span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" /><span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" /><span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" /></div>
              <span className="font-semibold text-[#B5B1C0] truncate">Acme Payments</span>
              <ChevronRight className="w-3.5 h-3.5 text-[#827D8E] shrink-0" />
              <span className="font-medium text-[#F6F5FA] truncate">{LABEL[screen]}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => go('reviews')} className="relative h-7 w-7 rounded-lg flex items-center justify-center bg-[#101016] border border-white/[0.08] text-[#827D8E] hover:text-white cursor-pointer" title="Activity & mentions">
                <Bell className="w-3.5 h-3.5" />
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#f0a500] text-black text-[8px] font-bold rounded-full flex items-center justify-center">{Math.max(pending.length, 1)}</span>
              </button>
              <button onClick={() => go('chat')} className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 border cursor-pointer ${screen === 'chat' ? 'bg-[#075BFF]/20 border-[#075BFF]/50 text-[#75aaff]' : 'bg-[#101016] border-white/[0.08] text-[#827D8E] hover:text-white'}`}>
                <MessageSquare className="w-3 h-3" />Chat
              </button>
              <button onClick={onGetStarted} className="hidden sm:flex h-7 px-2.5 rounded-lg bg-[#101016] border border-white/[0.08] text-indigo-300 hover:text-white items-center gap-1.5 cursor-pointer"><UserPlus className="w-3 h-3" />Invite</button>
              <button onClick={onGetStarted} className="h-7 px-2.5 rounded-lg bg-[#075BFF] hover:bg-[#075BFF]/90 text-white font-medium flex items-center gap-1.5 cursor-pointer"><Plus className="w-3 h-3" />Create</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto mk-scroll p-4 sm:p-6 bg-[#07070B]/80 relative">
            {/* ---------------- OVERVIEW ---------------- */}
            {screen === 'overview' && (
              <div key="ov" className="space-y-4 mk-fade">
                <div className={`pb-3 border-b ${BORDER} space-y-1`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest font-mono text-[#075BFF] px-2 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">Acme Payments</span>
                    <span className="text-[11px] text-[#827D8E] font-mono">· Autonomous Factory Unit</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Factory Overview</h3>
                  <p className="text-xs text-[#B5B1C0] max-w-2xl font-light">Product, design, architecture, engineering, QA and security on one project graph, with a named human behind every gate.</p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[['Products', String(products.length), 'Active core products', Layers], ['Projects', '3', 'Engineering streams', FolderGit2], ['Pull Requests', '4', 'Code review pipelines', GitPullRequest], ['Feature Ideas', String(2 + (2 - pending.length)), 'Discovery evaluations', Sparkles]].map(([l, v, n, I]) => {
                    const Icon = I as React.ElementType;
                    return (
                      <div key={l as string} className={`p-3 rounded-xl bg-[#0c0e15] border ${BORDER}`}>
                        <div className="text-[10px] uppercase font-mono tracking-wider text-[#827D8E] flex items-center justify-between"><span>{l as string}</span><Icon className="w-3.5 h-3.5 text-[#5B8FFF]" /></div>
                        <div className="text-3xl font-light text-white mt-1.5">{v as string}</div>
                        <div className="text-[10px] text-[#827D8E] font-mono">{n as string}</div>
                      </div>
                    );
                  })}
                </div>
                <div className={`rounded-xl bg-[#0c0e15] border ${BORDER} p-3 space-y-2`}>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold text-white"><span className="w-1.5 h-1.5 rounded-full bg-[#075BFF] animate-ping" />Quick Real-Time Creation</span><span className="text-[10px] font-mono text-[#827D8E]">Try it, it writes to the ledger</span></div>
                  <form onSubmit={addProduct} className="flex gap-2">
                    <input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Add product name (e.g. Fraud Engine)…" className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B]" />
                    <button type="submit" disabled={!newProduct.trim()} className="px-3 py-1.5 bg-[#075BFF] disabled:opacity-40 text-white rounded-xl text-xs font-medium cursor-pointer">+ Add Product</button>
                  </form>
                </div>
                <div className="space-y-3">
                  <div className={`flex items-center gap-4 border-b ${BORDER} pb-2 text-xs`}>
                    {([['products', `Products (${products.length})`], ['projects', 'Projects (3)'], ['ledger', `Audit Ledger (${entries.length - 1})`]] as const).map(([id, l]) => (
                      <button key={id} onClick={() => { setTouched(true); setTab(id); }} className={`font-medium pb-2 -mb-2.5 cursor-pointer ${tab === id ? 'text-white border-b-2 border-[#075BFF]' : 'text-[#827D8E] hover:text-white'}`}>{l}</button>
                    ))}
                  </div>
                  {tab === 'products' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {products.map((p) => (
                        <div key={p.name} className={`p-4 rounded-xl bg-[#0c0e15] border ${BORDER} hover:border-[#075BFF]/40 transition-colors space-y-2 mk-pop`}>
                          <div className="text-[10px] font-mono text-[#827D8E]">{p.code} · <span className="text-[#075BFF]">{p.domain}</span></div>
                          <div className="text-lg font-medium text-white tracking-tight">{p.name}</div>
                          <p className="text-[11px] text-[#B5B1C0] font-light">{p.desc}</p>
                          <div className="flex flex-wrap gap-1">{p.stack.map((s) => <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#B5B1C0] border border-white/[0.08]">{s}</span>)}</div>
                          <div className={`pt-2 border-t ${BORDER} flex items-center justify-between`}>
                            <span className="text-[10px] font-mono text-[#827D8E]">{p.projects} projects</span>
                            <button onClick={onGetStarted} className="text-[11px] font-semibold text-[#075BFF] flex items-center gap-1 cursor-pointer">Open Workspace<ChevronRight className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'projects' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[['PAY-API', 'Settlement service', 'Build'], ['PAY-FRAUD', 'Fraud scoring', 'QA'], ['MER-WEB', 'Merchant onboarding', 'Design']].map(([c, n, ph]) => (
                        <div key={c} className={`p-4 rounded-xl bg-[#0c0e15] border ${BORDER} space-y-1`}>
                          <div className="text-[10px] font-mono text-[#827D8E]">{c}</div>
                          <div className="text-base font-medium text-white">{n}</div>
                          <div className="text-[10px] font-mono text-[#827D8E]">Phase: <span className="text-white">{ph}</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'ledger' && (
                    <div className={`rounded-xl bg-[#0c0e15] border ${BORDER} divide-y divide-white/[0.06]`}>
                      {entries.slice(1).slice(-6).reverse().map((e) => (
                        <div key={e.seq} className="px-3 py-2 flex items-center justify-between gap-3 text-xs mk-row">
                          <div className="min-w-0"><div className="font-medium text-white truncate">{e.stage}</div><div className="text-[10px] text-[#827D8E] truncate">{e.actor}</div></div>
                          <span className="text-[10px] font-mono text-[#075BFF] shrink-0">#{e.seq} · {shortHash(e.hash)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- REVIEWS ---------------- */}
            {screen === 'reviews' && (
              <div key="rv" className="space-y-4 mk-fade">
                <div className={`rounded-2xl bg-[#0d0f17] border ${BORDER} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#075BFF]"><ShieldCheck className="w-3.5 h-3.5" />Reviewer Council Space</div>
                    <h3 className="text-xl font-semibold text-white tracking-tight">Idea & Architecture Proposals</h3>
                    <p className="text-[11px] text-[#A7ACB8] font-light max-w-lg">Nothing starts building until a named person says yes, or says why not.</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {([['pending', `Pending (${pending.length})`], ['decided', `History (${decided.length})`]] as const).map(([id, l]) => (
                      <button key={id} onClick={() => { setTouched(true); setRtab(id); }} className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer ${rtab === id ? 'bg-[#075BFF] text-white' : 'bg-[#15151F] text-[#827D8E] hover:text-white'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                {(rtab === 'pending' ? pending : decided).length === 0 && (
                  <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <div className="text-sm font-medium text-white">{rtab === 'pending' ? 'All caught up' : 'No decisions yet'}</div>
                    {rtab === 'pending' && <button onClick={() => { setProposals(PROPOSALS); }} className="text-[11px] text-[#5B8FFF] underline cursor-pointer">Reset demo proposals</button>}
                  </div>
                )}
                {(rtab === 'pending' ? pending : decided).map((p) => (
                  <div key={p.id} className="rounded-2xl bg-[#111118] border border-white/[0.08] p-4 space-y-3 mk-pop">
                    <div className="flex items-start justify-between gap-3">
                      <div><div className="text-[11px] text-[#827D8E]">Requested by <strong className="text-white font-medium">{p.by}</strong></div><div className="text-sm font-semibold text-white">{p.title}</div></div>
                      <Pill className={p.decision === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : p.decision === 'rejected' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-blue-500/10 text-blue-300 border-blue-500/20'}>{p.decision}</Pill>
                    </div>
                    <p className="text-[11px] text-[#B5B1C0] leading-relaxed"><strong className="text-white">Problem:</strong> {p.problem}</p>
                    <div className="flex items-center justify-between gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl text-[11px]">
                      <div><div className="text-[9px] font-mono text-blue-400 uppercase font-semibold">Evaluation report</div><span className="text-white font-semibold">{p.verdict}</span> · {p.score}/10 · cites 6 sources</div>
                      <span className="px-2.5 py-1 bg-[#075BFF]/20 text-[#5B8FFF] rounded-lg">Read report</span>
                    </div>
                    {p.decision === 'pending' ? (
                      <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                        <button onClick={() => { setTouched(true); setDeciding({ id: p.id, action: 'rejected' }); }} className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 rounded-xl text-[11px] font-medium cursor-pointer">Reject with reason</button>
                        <button onClick={() => { setTouched(true); setDeciding({ id: p.id, action: 'approved' }); setReason(''); }} className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[11px] font-semibold cursor-pointer flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Approve Proposal</button>
                      </div>
                    ) : p.reason && <div className="text-[11px] text-[#827D8E] italic bg-white/[0.02] p-2.5 rounded-lg">“{p.reason}”</div>}
                  </div>
                ))}
                {deciding && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-[#13131C] border border-white/[0.12] rounded-2xl p-5 space-y-3 mk-pop">
                      <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-white">{deciding.action === 'approved' ? 'Approve proposal' : 'Reject proposal'}</h4><button onClick={() => { setDeciding(null); setReasonErr(false); }} className="text-[#827D8E] hover:text-white cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button></div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#827D8E]">{deciding.action === 'rejected' ? 'Why are you rejecting it? (required)' : 'Comments (optional)'}</label>
                      <textarea value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr(false); }} rows={3} placeholder="Add reasoning or next steps…" className="w-full px-3 py-2 bg-[#1A1A26] border border-white/10 rounded-xl text-xs text-white outline-none" />
                      {reasonErr && <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">Say why: the author needs to know what to change.</div>}
                      <div className="flex justify-end gap-2"><button onClick={() => { setDeciding(null); setReasonErr(false); }} className="px-3 py-1.5 bg-white/[0.06] text-[#A7ACB8] rounded-xl text-xs cursor-pointer">Cancel</button><button onClick={confirmDecision} className={`px-4 py-1.5 text-white rounded-xl text-xs font-semibold cursor-pointer ${deciding.action === 'approved' ? 'bg-emerald-500' : 'bg-rose-500'}`}>Confirm decision</button></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---------------- ENGINEERING ---------------- */}
            {screen === 'engineering' && (
              <div key="en" className="space-y-3 mk-fade">
                <div className={`flex items-center justify-between pb-2 border-b ${BORDER} text-xs`}><span className="flex items-center gap-2 font-bold text-white"><Terminal className="w-4 h-4 text-[#075BFF]" />Engineering & Agents</span><span className="font-mono text-slate-300">3 sandboxes active</span></div>
                {WORKERS.map((w) => (
                  <div key={w.text} className={`p-2.5 rounded-xl bg-[#0c0e15] border ${BORDER} flex items-center justify-between gap-3 text-xs`}>
                    <span className="flex items-center gap-2.5 min-w-0"><span className={`w-2 h-2 rounded-full shrink-0 ${w.dot}`} /><span className="truncate text-slate-200">{w.text}</span></span>
                    <span className={`font-mono text-[10px] shrink-0 ${w.color}`}>{w.status}</span>
                  </div>
                ))}
                <div className={`rounded-xl bg-black/40 border ${BORDER} p-3 font-mono text-[11px] text-slate-400 space-y-1`}>
                  <div><span className="text-emerald-400">$</span> pytest tests/settlement -q</div>
                  <div className="text-slate-300">14 passed in 3.82s</div>
                  <div className="text-[#5B8FFF]">→ PR #118 opened · awaiting Arjun K. (Architect) and Rahul V. (AppSec)</div>
                </div>
              </div>
            )}

            {/* ---------------- ARCHITECTURE ---------------- */}
            {screen === 'architecture' && (
              <div key="ar" className="space-y-3 mk-fade">
                <div className={`flex items-center justify-between pb-2 border-b ${BORDER} text-xs`}><span className="flex items-center gap-2 font-bold text-white"><Workflow className="w-4 h-4 text-[#075BFF]" />System Architecture</span><span className="font-mono text-slate-300">ADR-042 {signed ? 'signed' : 'awaiting signature'}</span></div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#0e1220] border border-white/10 space-y-2">
                    <div className="font-bold text-white">ADR-042 · Idempotency key format</div>
                    <p className="text-slate-400 text-[11px]">Every settlement job carries a deterministic key so a restarted worker can never create a second batch.</p>
                    {signed ? <div className="text-[10px] font-mono text-emerald-400">SIGNED by Arjun K. · on the ledger</div> : (
                      <button onClick={() => { setTouched(true); setSigned(true); record('ADR-042', 'You · Architect', 'SIGNED'); }} className="px-3 py-1.5 rounded-lg bg-[#075BFF] text-white text-[11px] font-semibold cursor-pointer">Sign ADR-042</button>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-[#0e1220] border border-white/10 space-y-1.5">
                    <div className="font-bold text-white">API contract registry</div>
                    <p className="text-slate-400 text-[11px]">OpenAPI diff against main: 0 breaking changes across 14 endpoints.</p>
                    <div className="text-[10px] font-mono text-blue-400">CONTRACT CHECK PASSED</div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- QA ---------------- */}
            {screen === 'qa' && (
              <div key="qa" className="space-y-3 mk-fade">
                <div className={`flex items-center justify-between pb-2 border-b ${BORDER} text-xs`}><span className="flex items-center gap-2 font-bold text-white"><CheckCircle2 className="w-4 h-4 text-emerald-400" />QA Verification</span><span className="font-mono text-slate-300">PAY-142 · in QA</span></div>
                <ul className="space-y-2">
                  {QA_ROWS.map((r) => (
                    <li key={r.t} className="p-2.5 rounded-xl border border-white/[0.06] flex items-center justify-between gap-2 text-xs">
                      <span className="text-white">{r.t}</span>
                      <Pill className={r.s === 'passed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : r.s === 'failed' ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-white/5 text-[#827D8E] border-white/10'}>{r.s}</Pill>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-[#827D8E]">The QA agent only suggests. A person reproduces and files the bug, or dismisses it with a reason. See the full flow below.</p>
              </div>
            )}

            {/* ---------------- SECURITY ---------------- */}
            {screen === 'security' && (
              <div key="se" className="space-y-3 mk-fade">
                <div className={`flex items-center justify-between pb-2 border-b ${BORDER} text-xs`}><span className="flex items-center gap-2 font-bold text-white"><Shield className="w-4 h-4 text-cyan-400" />Security & AppSec</span><span className="font-mono text-cyan-400">Gate: closed</span></div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#0e1220] border border-cyan-500/20 space-y-1"><div className="font-bold text-white">Blocking finding</div><p className="text-[11px] text-slate-400">jinja2 2.x in the reporting worker has a known sandbox escape.</p><div className="text-[10px] font-mono text-rose-300">SIGN-OFF BLOCKED until patched or waived by AppSec</div></div>
                  <div className="p-3 rounded-xl bg-[#0e1220] border border-cyan-500/20 space-y-1"><div className="font-bold text-white">SBOM audit</div><div className="font-mono text-[10px] text-slate-400">248 components scanned</div><div className="text-[10px] text-emerald-400">Licences permissible (MIT / Apache-2.0)</div></div>
                </div>
                <p className="text-[11px] text-[#827D8E]">QA cannot sign off while this gate is closed; the server refuses and says why.</p>
              </div>
            )}

            {/* ---------------- CHAT ---------------- */}
            {screen === 'chat' && (
              <div key="ch" className="h-full flex gap-3 mk-fade min-h-[300px]">
                <div className={`hidden sm:block w-40 shrink-0 rounded-xl bg-[#0b0b11] border ${BORDER} p-2 text-xs space-y-0.5`}>
                  <div className="px-2 py-1 text-[10px] uppercase font-mono text-[#827D8E]">Channels</div>
                  {['general', 'product', 'architecture', 'dev', 'qa', 'security'].map((c, i) => <div key={c} className={`px-2 py-1 rounded-md ${i === 0 ? 'bg-white/[0.07] text-white' : 'text-[#B5B1C0]'}`}># {c}</div>)}
                </div>
                <div className={`flex-1 min-w-0 rounded-xl bg-[#0b0b11] border ${BORDER} flex flex-col`}>
                  <div className="flex-1 overflow-y-auto mk-scroll p-3 space-y-3 max-h-[300px]">
                    {msgs.map((m, i) => (
                      <div key={i} className="flex gap-2.5 mk-pop"><Avatar name={m.who} size={28} online /><div className="min-w-0"><div className="text-xs"><span className="font-semibold text-white">{m.who}</span> <span className="text-[10px] text-[#827D8E] font-mono">{m.role}</span></div><p className="text-[12px] text-[#D1D5DB]">{m.text}</p></div></div>
                    ))}
                    <div ref={chatEnd} />
                  </div>
                  <form onSubmit={send} className={`p-2 border-t ${BORDER} flex gap-2`}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message #general…" className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B]" />
                    <button type="submit" className="px-3 py-1.5 bg-[#075BFF] text-white rounded-xl text-xs font-medium cursor-pointer">Send</button>
                  </form>
                </div>
              </div>
            )}
          </main>

          <div className={`px-4 py-2 border-t ${BORDER} bg-black/60 font-mono text-[10.5px] text-slate-400 flex items-center justify-between gap-3`}>
            <span className="flex items-center gap-2 min-w-0"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" /><span className="truncate">Ledger #{entries[entries.length - 1].seq} · <span className="text-[#5B8FFF]">{shortHash(entries[entries.length - 1].hash)}</span> · {entries[entries.length - 1].stage}</span></span>
            <span className="hidden sm:inline text-slate-500">{touched ? 'Interactive: click around' : 'Auto-tour · click anything to take over'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
