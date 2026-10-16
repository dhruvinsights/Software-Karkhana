import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';

export interface BlurTextProps {
  text: string;
  delay?: number;
  className?: string;
  animateBy?: 'words' | 'letters';
  direction?: 'top' | 'bottom';
  threshold?: number;
  rootMargin?: string;
  onAnimationComplete?: () => void;
}

export const BlurText: React.FC<BlurTextProps> = ({
  text,
  delay = 50,
  className = '',
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  rootMargin = '0px',
  onAnimationComplete,
}) => {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const targets = el.querySelectorAll('.blur-unit');
    if (!targets.length) return;

    gsap.fromTo(
      targets,
      {
        filter: 'blur(4px)',
        opacity: 0.4,
        y: direction === 'top' ? -10 : 10,
      },
      {
        filter: 'blur(0px)',
        opacity: 1,
        y: 0,
        duration: 0.4,
        stagger: delay / 1000,
        ease: 'power2.out',
        onComplete: onAnimationComplete,
      }
    );
  }, [text, delay, direction, onAnimationComplete]);

  return (
    <p ref={ref} className={`inline-flex flex-wrap text-white font-medium ${className}`}>
      {elements.map((segment, i) => (
        <span
          key={i}
          className="blur-unit inline-block mr-[0.25em]"
        >
          {segment === ' ' ? '\u00A0' : segment}
        </span>
      ))}
    </p>
  );
};

export default BlurText;
