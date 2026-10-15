import React from 'react';

export interface GlassSurfaceProps {
  children?: React.ReactNode;
  className?: string;
  blur?: number;
  opacity?: number;
  borderOpacity?: number;
  glow?: boolean;
  glowColor?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  className = '',
  blur = 16,
  opacity = 0.05,
  borderOpacity = 0.12,
  glow = false,
  glowColor = 'rgba(59, 130, 246, 0.25)',
  rounded = '2xl',
  style,
  onClick,
}) => {
  const roundedMap = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    '3xl': 'rounded-3xl',
    full: 'rounded-full',
  };

  return (
    <div
      onClick={onClick}
      style={{
        backdropFilter: `blur(${blur}px)`,
        WebkitBackdropFilter: `blur(${blur}px)`,
        backgroundColor: `rgba(255, 255, 255, ${opacity})`,
        borderColor: `rgba(255, 255, 255, ${borderOpacity})`,
        boxShadow: glow ? `0 0 30px ${glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.15)` : 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        ...style,
      }}
      className={`border transition-all duration-300 relative overflow-hidden ${roundedMap[rounded]} ${className}`}
    >
      {/* Subtle Specular Top Highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
      {children}
    </div>
  );
};

export default GlassSurface;
