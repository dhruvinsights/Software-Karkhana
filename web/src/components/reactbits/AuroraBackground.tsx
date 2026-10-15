import React from 'react';

interface AuroraBackgroundProps {
  children?: React.ReactNode;
  className?: string;
}

export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({
  children,
  className = '',
}) => {
  return (
    <div className={`relative overflow-hidden bg-[#07070B] ${className}`}>
      <div className="pointer-events-none absolute -inset-[10px] opacity-40">
        <div
          className="absolute -top-[40%] left-[20%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,_rgba(7,91,255,0.25)_0%,_transparent_70%)] blur-[90px] animate-pulse"
          style={{ animationDuration: '8s' }}
        />
        <div
          className="absolute top-[10%] right-[10%] h-[450px] w-[450px] rounded-full bg-[radial-gradient(circle,_rgba(81,76,232,0.2)_0%,_transparent_70%)] blur-[100px] animate-pulse"
          style={{ animationDuration: '12s' }}
        />
        <div
          className="absolute -bottom-[20%] left-[30%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,_rgba(14,165,233,0.15)_0%,_transparent_70%)] blur-[120px]"
        />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
};
