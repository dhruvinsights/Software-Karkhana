import React, { useEffect, useRef } from 'react';

interface ChromaWavesProps {
  className?: string;
  speed?: number;
  waveColor?: string;
}

export const ChromaWaves: React.FC<ChromaWavesProps> = ({
  className = '',
  speed = 0.012,
  waveColor = 'rgba(7, 91, 255, 0.25)',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let step = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;

      // Draw chromatic sinusoidal wave ribbons
      const waveCount = 4;
      for (let i = 0; i < waveCount; i++) {
        ctx.beginPath();
        ctx.moveTo(0, h * 0.5);

        for (let x = 0; x < w; x += 6) {
          const y =
            h * 0.5 +
            Math.sin(x * 0.003 + step + i * 0.8) * 60 +
            Math.cos(x * 0.002 - step * 0.5 + i) * 35;
          ctx.lineTo(x, y);
        }

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (i === 0) {
          grad.addColorStop(0, 'rgba(7, 91, 255, 0.12)');
          grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.08)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else if (i === 1) {
          grad.addColorStop(0, 'rgba(56, 189, 248, 0.09)');
          grad.addColorStop(0.5, 'rgba(147, 51, 234, 0.06)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          grad.addColorStop(0, 'rgba(14, 165, 233, 0.06)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        ctx.fillStyle = grad;
        ctx.fill();
      }

      step += speed;
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [speed, waveColor]);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
