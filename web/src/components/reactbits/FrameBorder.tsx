import React from 'react';

interface FrameBorderProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}

export const FrameBorder: React.FC<FrameBorderProps> = ({
  children,
  className = '',
  glowColor = '#075BFF',
}) => {
  return (
    <div
      className={`relative p-[1px] rounded-2xl bg-gradient-to-b from-blue-500/40 via-white/10 to-blue-500/10 shadow-[0_0_25px_rgba(7,91,255,0.15)] group ${className}`}
    >
      {/* Corner Laser Reticles */}
      <div className="absolute -top-[2px] -left-[2px] w-3 h-3 border-t-2 border-l-2 border-cyan-400 rounded-tl pointer-events-none" />
      <div className="absolute -top-[2px] -right-[2px] w-3 h-3 border-t-2 border-r-2 border-cyan-400 rounded-tr pointer-events-none" />
      <div className="absolute -bottom-[2px] -left-[2px] w-3 h-3 border-b-2 border-l-2 border-cyan-400 rounded-bl pointer-events-none" />
      <div className="absolute -bottom-[2px] -right-[2px] w-3 h-3 border-b-2 border-r-2 border-cyan-400 rounded-br pointer-events-none" />

      {/* Inner Container */}
      <div className="bg-[#090b12]/95 rounded-[15px] overflow-hidden backdrop-blur-xl h-full">
        {children}
      </div>
    </div>
  );
};
