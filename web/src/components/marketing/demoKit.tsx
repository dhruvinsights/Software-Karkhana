import React from 'react';

export const BORDER = 'border-white/[0.08]';

export const Pill: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide border ${className}`}>
    {children}
  </span>
);

export const Avatar: React.FC<{ name: string; size?: number; online?: boolean }> = ({ name, size = 28, online }) => {
  const initials =
    name
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-lg flex items-center justify-center font-semibold text-white bg-gradient-to-br from-[#075BFF] to-indigo-600"
        style={{ fontSize: size * 0.38 }}
      >
        {initials}
      </div>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0A0A0F] ${
            online ? 'bg-[#00d9a6]' : 'bg-[#5b5866]'
          }`}
        />
      )}
    </div>
  );
};

/** Window chrome used for the standalone interactive demos below the hero. */
export const Frame: React.FC<{ title: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  title,
  hint,
  children,
  className = '',
}) => (
  <div className={`rounded-2xl bg-[#0a0b12] border border-white/15 overflow-hidden flex flex-col ${className}`}>
    <div className={`flex items-center justify-between px-4 py-2.5 bg-[#0a0d16] border-b ${BORDER} text-xs select-none`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
        </div>
        <span className="font-mono text-[#827D8E] pl-2 border-l border-white/10">{title}</span>
      </div>
      {hint && <span className="hidden sm:inline text-[11px] text-[#075BFF] font-medium">{hint}</span>}
    </div>
    {children}
  </div>
);

export const SectionHeading: React.FC<{ eyebrow?: string; lead: string; accent: string; sub?: string }> = ({
  eyebrow,
  lead,
  accent,
  sub,
}) => (
  <div className="space-y-3">
    {eyebrow && (
      <span className="inline-block text-[11px] uppercase tracking-widest font-mono text-[#5B8FFF] px-2 py-0.5 rounded bg-[#075BFF]/10 border border-[#075BFF]/20">
        {eyebrow}
      </span>
    )}
    <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white max-w-3xl">
      {lead} <span className="font-serif italic font-normal text-[#2f5bff]">{accent}</span>
    </h2>
    {sub && <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">{sub}</p>}
  </div>
);

export const fieldCls =
  'w-full px-3 py-2 rounded-xl border border-white/[0.08] text-xs text-white placeholder-[#827D8E] outline-none focus:border-[#075BFF] bg-[#07070B]';
