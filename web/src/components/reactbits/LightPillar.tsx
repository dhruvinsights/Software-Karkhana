import React, { useEffect, useRef } from 'react';

export interface LightPillarProps {
  className?: string;
  pillarColor?: string;
  glowColor?: string;
  height?: string | number;
  width?: string | number;
  intensity?: number;
  pulseSpeed?: number;
}

export const LightPillar: React.FC<LightPillarProps> = ({
  className = '',
  pillarColor = '#60a5fa',
  glowColor = '#3b82f6',
  intensity = 1.0,
  pulseSpeed = 1.0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    window.addEventListener('resize', resize);
    resize();

    let t = 0;

    const render = () => {
      t += 0.02 * pulseSpeed;
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const pulse = 1 + Math.sin(t) * 0.12;

      // Volumetric Glow
      const glowGrad = ctx.createRadialGradient(
        centerX,
        height * 0.5,
        10,
        centerX,
        height * 0.5,
        width * 0.5
      );
      glowGrad.addColorStop(0, `rgba(59, 130, 246, ${0.2 * intensity * pulse})`);
      glowGrad.addColorStop(0.5, `rgba(147, 51, 234, ${0.08 * intensity * pulse})`);
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, height);

      // Core Pillar
      const pillarGrad = ctx.createLinearGradient(centerX, 0, centerX, height);
      pillarGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      pillarGrad.addColorStop(0.4, `rgba(96, 165, 250, ${0.6 * intensity})`);
      pillarGrad.addColorStop(0.8, `rgba(59, 130, 246, ${0.3 * intensity})`);
      pillarGrad.addColorStop(1, 'transparent');

      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 30 * intensity;
      ctx.fillStyle = pillarGrad;
      ctx.fillRect(centerX - 3 * pulse, 0, 6 * pulse, height);
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [pillarColor, glowColor, intensity, pulseSpeed]);

  return (
    <div className={`relative w-full h-full overflow-hidden pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

export default LightPillar;
