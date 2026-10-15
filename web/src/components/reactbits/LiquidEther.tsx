import React, { useEffect, useRef } from 'react';

export interface LiquidEtherProps {
  className?: string;
  colorA?: string;
  colorB?: string;
  colorC?: string;
  speed?: number;
  opacity?: number;
  interactive?: boolean;
}

export const LiquidEther: React.FC<LiquidEtherProps> = ({
  className = '',
  colorA = '#071630',
  colorB = '#120b29',
  colorC = '#05070f',
  speed = 0.5,
  opacity = 0.7,
  interactive = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
    };

    const handlePointerMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    };

    window.addEventListener('resize', resize);
    if (interactive) {
      window.addEventListener('mousemove', handlePointerMove);
    }
    resize();

    let t = 0;

    const render = () => {
      t += 0.005 * speed;
      ctx.clearRect(0, 0, width, height);

      // Liquid Ether Gradient Mesh
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      const x1 = width * (0.3 + Math.sin(t * 1.2) * 0.2 + (mx - 0.5) * 0.15);
      const y1 = height * (0.3 + Math.cos(t * 1.5) * 0.2 + (my - 0.5) * 0.15);
      const r1 = Math.max(width, height) * 0.55;

      const g1 = ctx.createRadialGradient(x1, y1, 10, x1, y1, r1);
      g1.addColorStop(0, `rgba(14, 45, 110, ${0.45 * opacity})`);
      g1.addColorStop(0.5, `rgba(59, 130, 246, ${0.12 * opacity})`);
      g1.addColorStop(1, 'transparent');

      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const x2 = width * (0.7 + Math.cos(t * 0.9) * 0.2 - (mx - 0.5) * 0.15);
      const y2 = height * (0.6 + Math.sin(t * 1.1) * 0.2 - (my - 0.5) * 0.15);
      const r2 = Math.max(width, height) * 0.6;

      const g2 = ctx.createRadialGradient(x2, y2, 10, x2, y2, r2);
      g2.addColorStop(0, `rgba(88, 28, 135, ${0.4 * opacity})`);
      g2.addColorStop(0.5, `rgba(147, 51, 234, ${0.1 * opacity})`);
      g2.addColorStop(1, 'transparent');

      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      if (interactive) window.removeEventListener('mousemove', handlePointerMove);
    };
  }, [speed, opacity, interactive]);

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

export default LiquidEther;
