import React, { useState } from 'react';

interface ShaderCardProps {
  children: React.ReactNode;
  className?: string;
  flameColor?: string;
}

export const ShaderCard: React.FC<ShaderCardProps> = ({
  children,
  className = '',
  flameColor = 'rgba(7, 91, 255, 0.45)',
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative group rounded-2xl transition-all duration-500 ${className}`}
    >
      {/* Dynamic Luminous Plasma Flame behind the card */}
      <div
        className={`absolute -inset-1 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-all duration-700 pointer-events-none`}
        style={{
          background: `radial-gradient(circle at 50% 100%, ${flameColor} 0%, rgba(56,189,248,0.2) 40%, transparent 75%)`,
          transform: isHovered ? 'scale(1.04) translateY(-4px)' : 'scale(1) translateY(0)',
        }}
      />

      {/* Obsidian Card Body */}
      <div className="relative z-10 h-full bg-[#0a0c14]/95 border border-white/10 group-hover:border-blue-500/40 rounded-2xl p-6 backdrop-blur-xl transition-colors duration-300">
        {children}
      </div>
    </div>
  );
};
