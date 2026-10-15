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
  rootMargin = '-50px',
  onAnimationComplete,
}) => {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const targets = el.querySelectorAll('.blur-unit');
    if (!targets.length) return;

    const fromY = direction === 'top' ? -20 : 20;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            gsap.fromTo(
              targets,
              {
                filter: 'blur(10px)',
                opacity: 0,
                y: fromY,
              },
              {
                filter: 'blur(0px)',
                opacity: 1,
                y: 0,
                duration: 0.6,
                stagger: delay / 1000,
                ease: 'power3.out',
                onComplete: onAnimationComplete,
              }
            );
            observer.unobserve(el);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [text, delay, direction, threshold, rootMargin, onAnimationComplete]);

  return (
    <p ref={ref} className={`inline-flex flex-wrap ${className}`}>
      {elements.map((segment, i) => (
        <span
          key={i}
          className="blur-unit inline-block will-change-transform will-change-filter will-change-opacity mr-[0.25em]"
        >
          {segment === ' ' ? '\u00A0' : segment}
        </span>
      ))}
    </p>
  );
};

export default BlurText;
