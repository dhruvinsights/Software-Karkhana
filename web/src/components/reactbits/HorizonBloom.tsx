import React from 'react';

interface HorizonBloomProps {
  className?: string;
  glowColor?: string;
  sunColor?: string;
  children?: React.ReactNode;
}

export const HorizonBloom: React.FC<HorizonBloomProps> = ({
  className = '',
  glowColor = '#075BFF',
  sunColor = '#60A5FA',
  children,
}) => {
  return (
    <div className={`relative overflow-hidden w-full ${className}`}>
      {/* Background Starfield & Deep Space */}
      <div className="absolute inset-0 bg-[#050609] pointer-events-none" />

      {/* Sun Core / Dawn Light Source */}
      <div
        className="absolute left-1/2 -top-[120px] -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-[90px] opacity-75 pointer-events-none transition-all duration-1000 animate-pulse"
        style={{
          background: `radial-gradient(circle, ${sunColor} 0%, ${glowColor} 45%, transparent 70%)`,
        }}
      />

      {/* Radiant Horizon Flare Beam */}
      <div
        className="absolute left-1/2 top-0 -translate-x-1/2 w-[1200px] h-[2px] blur-[1px] opacity-90 pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.2) 20%, #ffffff 50%, rgba(96,165,250,0.2) 80%, transparent 100%)`,
          boxShadow: `0 0 35px 8px ${glowColor}, 0 0 70px 20px rgba(7,91,255,0.4)`,
        }}
      />

      {/* Curved Planet Rim (Dark Sphere with Rim Light) */}
      <div className="absolute left-1/2 -top-[480px] -translate-x-1/2 w-[1600px] h-[650px] rounded-[100%] border-t border-cyan-300/40 bg-gradient-to-b from-[#090b14] via-[#05060a] to-transparent shadow-[0_-20px_100px_rgba(7,91,255,0.35)] pointer-events-none" />

      {/* Atmosphere Glow Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050609]/60 to-[#050609] pointer-events-none" />

      {/* Content Layer */}
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
};
