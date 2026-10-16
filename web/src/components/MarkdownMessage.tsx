import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold text-white mt-6 mb-3 pb-2 border-b border-white/10">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold text-white mt-6 mb-3 pb-1.5 border-b border-white/[0.06]">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-[#C7D2FE] mt-5 mb-2">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-semibold text-white mt-4 mb-2">{children}</h4>,
  p: ({ children }) => <p className="my-3 leading-[1.75]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#D1D5DB]">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-[#5B8FFF] hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1.5 marker:text-[#075BFF]">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1.5 marker:text-[#075BFF]">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  hr: () => <hr className="my-6 border-white/10" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-[#075BFF] bg-[#075BFF]/[0.06] pl-4 pr-3 py-2 rounded-r-lg text-[#D1D5DB]">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-[13px] leading-relaxed font-mono">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} text-[#E5E7EB]`}>{children}</code>
    ) : (
      <code className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[#A5B4FC] text-[0.88em] font-mono">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.06]">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-white/[0.06] last:border-0 even:bg-white/[0.02]">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-wider text-[#A7ACB8] font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-4 py-2.5 align-top text-[#ECECF1]">{children}</td>,
};

export const MarkdownMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="text-[16px] text-[#ECECF1] font-light selection:bg-[#075BFF]/30 [&>*:first-child]:mt-0">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  </div>
);
