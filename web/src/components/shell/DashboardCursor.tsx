import React, { useEffect, useRef, useState } from 'react';

/**
 * DashboardCursor — a large, glow-ring custom cursor for the dashboard.
 *
 * Outer ring: 48px translucent purple-blue circle that trails the pointer
 * Inner dot:  8px solid accent dot that snaps instantly
 * Both fade out when the pointer leaves the window.
 */
export const DashboardCursor: React.FC = () => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: -200, y: -200 });
  const targetRef = useRef({ x: -200, y: -200 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY };
      if (!visible) setVisible(true);
      // Inner dot snaps instantly
      if (innerRef.current) {
        innerRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
    };

    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    const loop = () => {
      // Outer ring lerps toward target (smooth lag)
      posRef.current.x += (targetRef.current.x - posRef.current.x) * 0.12;
      posRef.current.y += (targetRef.current.y - posRef.current.y) * 0.12;
      if (outerRef.current) {
        outerRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.documentElement.addEventListener('pointerenter', onEnter);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.documentElement.removeEventListener('pointerenter', onEnter);
    };
  }, []);

  const opacity = visible ? 1 : 0;

  return (
    <>
      {/* Outer trailing ring */}
      <div
        ref={outerRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 48,
          height: 48,
          marginLeft: -24,
          marginTop: -24,
          borderRadius: '50%',
          border: '1.5px solid rgba(180, 151, 207, 0.55)',
          boxShadow: '0 0 14px 2px rgba(83, 0, 255, 0.35), 0 0 4px 1px rgba(180,151,207,0.2)',
          pointerEvents: 'none',
          zIndex: 99999,
          opacity,
          transition: 'opacity 0.2s ease',
          willChange: 'transform',
          backdropFilter: 'blur(0px)',
        }}
      />
      {/* Inner instant dot */}
      <div
        ref={innerRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 8,
          height: 8,
          marginLeft: -4,
          marginTop: -4,
          borderRadius: '50%',
          background: 'rgba(180, 151, 207, 0.9)',
          boxShadow: '0 0 8px 2px rgba(83, 0, 255, 0.7)',
          pointerEvents: 'none',
          zIndex: 99999,
          opacity,
          transition: 'opacity 0.2s ease',
          willChange: 'transform',
        }}
      />
    </>
  );
};

export default DashboardCursor;
