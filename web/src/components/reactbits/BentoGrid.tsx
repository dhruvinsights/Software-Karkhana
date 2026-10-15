import React from 'react';

export const BentoGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 ${className}`}>
      {children}
    </div>
  );
};

export const BentoCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  colSpan?: string;
  glow?: boolean;
}> = ({ children, className = '', colSpan = '', glow = false }) => {
  return (
    <div
      className={`relative rounded-2xl bg-[#0d0f17] border border-white/[0.08] p-6 text-[#F6F5FA] hover:border-[#075BFF]/30 transition-all duration-300 overflow-hidden group ${
        glow ? 'shadow-[0_0_25px_-5px_rgba(7,91,255,0.2)]' : ''
      } ${colSpan} ${className}`}
    >
      <div className="pointer-events-none absolute -inset-px opacity-0 group-hover:opacity-100 transition duration-500 bg-[radial-gradient(400px_circle_at_50%_0%,_rgba(7,91,255,0.12),_transparent_70%)]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
};
