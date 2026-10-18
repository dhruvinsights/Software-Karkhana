import type { ProviderHealth, RunnerStatus } from '../api';

function Line({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="card raised row between" style={{ alignItems: 'flex-start' }}>
      <div className="stack" style={{ gap: 4 }}><b>{title}</b><span className="muted sm">{detail}</span></div>
      <span className={`pill ${ok ? 'ok' : 'warn'}`}>{ok ? 'ready' : 'not connected'}</span>
    </div>
  );
}

export function HealthPanel({ health: h, runner }: { health: ProviderHealth; runner: RunnerStatus }) {
  const chatOnOllama = h.llm_provider === 'ollama';
  const embedOnOllama = h.embed_provider === 'ollama';
  const embedPresent = h.ollama.models.some((m) => m.startsWith(h.embed_model));
  const geminiVia = h.gemini.backend === 'vertex' ? `Vertex AI (${h.gemini.project})` : 'Gemini API key';
  const geminiDetail = h.gemini.configured ? geminiVia : 'Set GEMINI_API_KEY, or GOOGLE_CLOUD_PROJECT for Vertex AI';
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Line ok={chatOnOllama ? h.ollama.ok && h.ollama.models.some((m) => m === h.chat_model || m.startsWith(h.chat_model)) : h.gemini.configured}
        title={`Chat model: ${h.chat_model}`}
        detail={chatOnOllama ? (h.ollama.ok ? `Ollama at ${h.ollama.base_url}` : `Ollama unreachable: ${h.ollama.error}`) : geminiDetail} />
      <Line ok={embedOnOllama ? h.ollama.ok && embedPresent : h.gemini.configured}
        title={`Embeddings: ${h.embed_model}`}
        detail={embedOnOllama ? (h.ollama.ok ? (embedPresent ? 'Model installed in Ollama' : 'Model not installed: run ollama pull ' + h.embed_model) : `Ollama unreachable: ${h.ollama.error}`) : `Gemini embeddings via ${geminiVia}`} />
      <Line ok={h.review.engine !== 'pr_agent' || h.review.pr_agent_ready}
        title={`PR review engine: ${h.review.engine}`}
        detail={h.review.engine === 'pr_agent' ? (h.review.pr_agent_ready ? 'PR-Agent environment found' : 'Run scripts/setup_pr_agent.sh') : 'Google ADK reviewer'} />
      <Line ok={runner.ready} title={`Runner: ${runner.backend}`} detail={runner.detail} />
    </div>
  );
}
