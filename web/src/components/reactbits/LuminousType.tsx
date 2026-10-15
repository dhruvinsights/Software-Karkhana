import React, { useState, useRef, useEffect } from 'react';

interface LuminousTypeProps {
  text: string;
  className?: string;
  highlightWords?: string[];
  spotlightRadius?: number;
}

export const LuminousType: React.FC<LuminousTypeProps> = ({
  text,
  className = '',
  highlightWords = [],
  spotlightRadius = 140,
}) => {
  const containerRef = useRef<HTMLHeadingElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLHeadingElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  const words = text.split(' ');

  return (
    <h2
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative inline-block cursor-default select-none ${className}`}
    >
      {/* Dimmed Base Text */}
      <span className="text-slate-500/60 transition-colors duration-300">
        {words.map((word, idx) => {
          const isHighlight = highlightWords.some((hw) =>
            word.toLowerCase().includes(hw.toLowerCase())
          );
          return (
            <span
              key={idx}
              className={`inline-block mr-[0.28em] transition-all duration-200 ${
                isHighlight ? 'text-slate-300/90 font-semibold' : ''
              }`}
            >
              {word}
            </span>
          );
        })}
      </span>

      {/* Illuminated Spotlight Text Overlay */}
      {mousePos && (
        <span
          className="absolute inset-0 pointer-events-none text-white font-bold transition-opacity duration-150"
          style={{
            clipPath: `circle(${spotlightRadius}px at ${mousePos.x}px ${mousePos.y}px)`,
            textShadow: '0 0 20px rgba(220,225,235,0.6), 0 0 40px rgba(180,190,210,0.4)',
          }}
        >
          {words.map((word, idx) => {
            const isHighlight = highlightWords.some((hw) =>
              word.toLowerCase().includes(hw.toLowerCase())
            );
            return (
              <span
                key={idx}
                className={`inline-block mr-[0.28em] ${
                  isHighlight ? 'text-white' : 'text-white'
                }`}
              >
                {word}
              </span>
            );
          })}
        </span>
      )}
    </h2>
  );
};
