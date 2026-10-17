import React, { useEffect, useId, useState } from 'react';

/** Renders Mermaid source to SVG. Mermaid loads on first use (it is large). */
export const MermaidDiagram: React.FC<{ source: string; className?: string }> = ({ source, className }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        // "strict" sanitises labels, so text from a document cannot inject markup.
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const { svg: out } = await mermaid.render(`mmd${id}`, source);
        if (!cancelled) setSvg(out);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error) return <pre className="text-[11px] text-rose-300 whitespace-pre-wrap">{error}</pre>;
  if (!svg) return <p className="text-xs text-[#827D8E]">Drawing diagram…</p>;
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
};
