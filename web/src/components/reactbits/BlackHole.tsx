import React, { useEffect, useRef } from 'react';

interface BlackHoleProps {
  className?: string;
  glowColor?: string;
  intensity?: number;
}

export const BlackHole: React.FC<BlackHoleProps> = ({
  className = '',
  glowColor = '#075BFF',
  intensity = 1.0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let angle = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 400;
      canvas.height = canvas.parentElement?.clientHeight || 400;
    };
    resize();
    window.addEventListener('resize', resize);

    // Particle field around black hole accretion disk
    const particles: Array<{
      radius: number;
      speed: number;
      angle: number;
      size: number;
      opacity: number;
      hue: number;
    }> = [];

    const numParticles = 65;
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        radius: 40 + Math.random() * 110,
        speed: 0.008 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        size: 1 + Math.random() * 2,
        opacity: 0.2 + Math.random() * 0.7,
        hue: 200 + Math.random() * 40, // deep blue/cyan spectrum
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Draw Smoky Accretion Glow
      const glowGradient = ctx.createRadialGradient(cx, cy, 30, cx, cy, 140);
      glowGradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      glowGradient.addColorStop(0.35, 'rgba(7, 91, 255, 0.45)');
      glowGradient.addColorStop(0.65, 'rgba(56, 189, 248, 0.15)');
      glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.fill();

      // Draw Relativistic Jet / Photon Ring (Lensed Ellipse)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * 0.4);
      ctx.scale(1.2, 0.4);

      ctx.strokeStyle = 'rgba(96, 165, 250, 0.6)';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 18;
      ctx.shadowColor = glowColor;

      ctx.beginPath();
      ctx.arc(0, 0, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Swirling Matter Particles
      particles.forEach((p) => {
        p.angle += p.speed;
        const px = cx + Math.cos(p.angle) * p.radius;
        const py = cy + Math.sin(p.angle) * (p.radius * 0.45);

        ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${p.opacity * intensity})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Event Horizon (Absolute Pitch Black Core with Razor Edge)
      const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
      coreGradient.addColorStop(0, '#000000');
      coreGradient.addColorStop(0.85, '#020305');
      coreGradient.addColorStop(1, 'rgba(7, 91, 255, 0.4)');

      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fill();

      angle += 0.02;
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [glowColor, intensity]);

  return (
    <div className={`relative overflow-hidden pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
