import React, { useEffect, useRef } from 'react';

export interface LaserFlowProps {
  className?: string;
  beamColor?: string;
  glowColor?: string;
  secondaryGlow?: string;
  particleCount?: number;
  speed?: number;
  intensity?: number;
  fogOpacity?: number;
  flareSize?: number;
  interactive?: boolean;
}

export const LaserFlow: React.FC<LaserFlowProps> = ({
  className = '',
  beamColor = '#a5c4ff',
  glowColor = '#3b82f6',
  secondaryGlow = '#8b5cf6',
  particleCount = 180,
  speed = 1.2,
  intensity = 1.0,
  fogOpacity = 0.65,
  flareSize = 1.0,
  interactive = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0.5, y: 0.5, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Particles converging along the laser beam
    interface Particle {
      x: number;
      y: number;
      speedY: number;
      drift: number;
      size: number;
      alpha: number;
      maxAlpha: number;
      decay: number;
    }

    const particles: Particle[] = [];

    const initParticles = () => {
      particles.length = 0;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: (Math.random() - 0.5) * 80,
          y: Math.random() * height,
          speedY: (1.5 + Math.random() * 3.5) * speed,
          drift: (Math.random() - 0.5) * 0.8,
          size: 0.6 + Math.random() * 1.8,
          alpha: Math.random() * 0.8,
          maxAlpha: 0.3 + Math.random() * 0.7,
          decay: 0.003 + Math.random() * 0.008,
        });
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
      initParticles();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        active: true,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    window.addEventListener('resize', resize);
    if (interactive) {
      window.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseleave', handleMouseLeave);
    }

    resize();

    let time = 0;

    const render = () => {
      time += 0.02 * speed;
      ctx.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const beamTargetY = height * 0.82; // Focal horizon where the beam impacts

      // 1. Broad Volumetric Background Haze
      const hazeGrad = ctx.createRadialGradient(
        centerX,
        beamTargetY * 0.4,
        10,
        centerX,
        beamTargetY * 0.6,
        width * 0.6
      );
      hazeGrad.addColorStop(0, `rgba(59, 130, 246, ${0.15 * fogOpacity * intensity})`);
      hazeGrad.addColorStop(0.35, `rgba(139, 92, 246, ${0.08 * fogOpacity * intensity})`);
      hazeGrad.addColorStop(0.7, `rgba(15, 23, 42, ${0.04 * fogOpacity * intensity})`);
      hazeGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Cosmic Ambient Light Cone (top origin expanding down)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(centerX - 4, 0);
      ctx.lineTo(centerX + 4, 0);
      ctx.lineTo(centerX + width * 0.35, beamTargetY);
      ctx.lineTo(centerX - width * 0.35, beamTargetY);
      ctx.closePath();

      const coneGrad = ctx.createLinearGradient(centerX, 0, centerX, beamTargetY);
      coneGrad.addColorStop(0, `rgba(255, 255, 255, ${0.7 * intensity})`);
      coneGrad.addColorStop(0.1, `rgba(165, 196, 255, ${0.45 * intensity})`);
      coneGrad.addColorStop(0.4, `rgba(99, 102, 241, ${0.2 * intensity})`);
      coneGrad.addColorStop(0.85, `rgba(139, 92, 246, ${0.12 * intensity})`);
      coneGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coneGrad;
      ctx.fill();
      ctx.restore();

      // 3. Central Laser Core Beam (Intense vertical column)
      const corePulse = 1 + Math.sin(time * 3) * 0.08;
      const coreWidth = 2.5 * corePulse;

      // Outer Core Glow
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 35 * intensity;
      ctx.fillStyle = secondaryGlow;
      ctx.fillRect(centerX - coreWidth * 3.5, 0, coreWidth * 7, beamTargetY);
      ctx.restore();

      // Inner Core Glow
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 18 * intensity;
      const beamLinear = ctx.createLinearGradient(centerX, 0, centerX, beamTargetY);
      beamLinear.addColorStop(0, '#ffffff');
      beamLinear.addColorStop(0.3, beamColor);
      beamLinear.addColorStop(0.8, glowColor);
      beamLinear.addColorStop(1, `rgba(255, 255, 255, ${0.9 * intensity})`);
      ctx.fillStyle = beamLinear;
      ctx.fillRect(centerX - coreWidth, 0, coreWidth * 2, beamTargetY);
      ctx.restore();

      // 4. Curved Magnetic Flow Lines (streamlines funneling into the beam)
      ctx.save();
      ctx.lineWidth = 1;
      const lineCount = 14;
      for (let i = 0; i < lineCount; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const offset = ((i + 1) / lineCount) * 140;
        const wave = Math.sin(time + i * 0.4) * 6;
        
        ctx.beginPath();
        ctx.moveTo(centerX + side * (offset + wave), 0);
        ctx.bezierCurveTo(
          centerX + side * (offset * 0.7 + wave),
          beamTargetY * 0.35,
          centerX + side * (12 + wave * 0.5),
          beamTargetY * 0.7,
          centerX + side * 4,
          beamTargetY
        );

        const lineAlpha = (0.15 + (1 - i / lineCount) * 0.35) * intensity;
        ctx.strokeStyle = `rgba(190, 215, 255, ${lineAlpha})`;
        ctx.stroke();
      }
      ctx.restore();

      // 5. Converging Energetic Particle Sparkles
      ctx.save();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y += p.speedY;
        p.x += p.drift;

        // Attract particles inward toward the center beam as they descend
        const distanceToCenter = p.x;
        p.x -= distanceToCenter * 0.015;

        if (p.y > beamTargetY || p.y < 0) {
          p.y = 0;
          p.x = (Math.random() - 0.5) * (width * 0.25);
          p.speedY = (1.5 + Math.random() * 3.5) * speed;
        }

        const currentDistX = Math.abs(p.x);
        const funnelX = centerX + p.x;

        ctx.beginPath();
        ctx.arc(funnelX, p.y, p.size, 0, Math.PI * 2);
        const particleAlpha = Math.max(0, (1 - currentDistX / 100) * p.maxAlpha * intensity);
        ctx.fillStyle = `rgba(255, 255, 255, ${particleAlpha})`;
        ctx.shadowColor = beamColor;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.restore();

      // 6. Horizon Impact Flare & Surface Reflection Bloom (Right above the dashboard)
      const flareRad = Math.min(width * 0.45 * flareSize, 420);
      const flareGrad = ctx.createRadialGradient(
        centerX,
        beamTargetY,
        0,
        centerX,
        beamTargetY,
        flareRad
      );
      flareGrad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
      flareGrad.addColorStop(0.12, `rgba(165, 210, 255, ${0.75 * intensity})`);
      flareGrad.addColorStop(0.35, `rgba(59, 130, 246, ${0.45 * intensity})`);
      flareGrad.addColorStop(0.65, `rgba(139, 92, 246, ${0.2 * intensity})`);
      flareGrad.addColorStop(1, 'transparent');

      ctx.save();
      ctx.fillStyle = flareGrad;
      ctx.beginPath();
      // Elliptical horizon flare
      ctx.ellipse(centerX, beamTargetY, flareRad, flareRad * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      if (interactive) {
        window.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [beamColor, glowColor, secondaryGlow, particleCount, speed, intensity, fogOpacity, flareSize, interactive]);

  return (
    <div className={`relative w-full overflow-hidden pointer-events-none ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default LaserFlow;
