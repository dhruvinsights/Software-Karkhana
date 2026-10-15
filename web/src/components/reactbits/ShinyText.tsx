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
      className={`inline-block bg-clip-text text-transparent bg-gradient-to-r from-neutral-200 via-white to-neutral-400 bg-[length:200%_100%] animate-shine font-medium ${className}`}
      style={{
        backgroundImage: disabled
          ? undefined
          : 'linear-gradient(120deg, rgba(255, 255, 255, 0) 20%, rgba(255, 255, 255, 0.9) 50%, rgba(255, 255, 255, 0) 80%)',
        WebkitBackgroundClip: 'text',
        animationDuration: animationDuration,
      }}
    >
      {text}
    </span>
  );
};
