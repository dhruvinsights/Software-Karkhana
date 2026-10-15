import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  glowColor?: 'blue' | 'indigo' | 'cyan' | 'purple';
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  glow = false,
  glowColor = 'blue',
  ...props
}) => {
  const glowMap = {
    blue: 'shadow-[0_0_30px_-5px_rgba(7,91,255,0.25)] border-blue-500/20',
    indigo: 'shadow-[0_0_30px_-5px_rgba(81,76,232,0.25)] border-indigo-500/20',
    cyan: 'shadow-[0_0_30px_-5px_rgba(6,182,212,0.25)] border-cyan-500/20',
    purple: 'shadow-[0_0_30px_-5px_rgba(168,85,247,0.25)] border-purple-500/20',
  };

  return (
    <div
      className={`relative rounded-2xl bg-[#0c0e15]/80 backdrop-blur-xl border border-white/[0.08] text-[#F6F5FA] transition-all duration-300 ${
        glow ? glowMap[glowColor] : 'hover:border-white/[0.14]'
      } ${className}`}
      {...props}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
      {children}
    </div>
  );
};
