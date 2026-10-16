import React from 'react';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  disabled = false,
  speed = 5,
  className = '',
}) => {
  const animationDuration = `${speed}s`;

  return (
    <span
      className={`inline-block bg-clip-text text-transparent bg-gradient-to-r from-slate-200 via-white to-slate-200 bg-[length:200%_100%] animate-shine font-semibold ${className}`}
      style={{
        backgroundImage: disabled
          ? undefined
          : 'linear-gradient(120deg, #e2e8f0 10%, #ffffff 50%, #93c5fd 90%)',
        WebkitBackgroundClip: 'text',
        animationDuration: animationDuration,
      }}
    >
      {text}
    </span>
  );
};
