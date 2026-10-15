import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';

export interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  animationFrom?: gsap.TweenVars;
  animationTo?: gsap.TweenVars;
  easing?: string;
  threshold?: number;
  rootMargin?: string;
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'initial' | 'inherit';
  onLetterAnimationComplete?: () => void;
  splitType?: 'chars' | 'words';
}

export const SplitText: React.FC<SplitTextProps> = ({
  text,
  className = '',
  delay = 50,
  duration = 0.6,
  animationFrom = { opacity: 0, y: 40 },
  animationTo = { opacity: 1, y: 0 },
  easing = 'power3.out',
  threshold = 0.1,
  rootMargin = '-50px',
  textAlign = 'center',
  onLetterAnimationComplete,
  splitType = 'chars',
}) => {
  const containerRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const targets = el.querySelectorAll('.split-unit');
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            gsap.fromTo(
              targets,
              { ...animationFrom },
              {
                ...animationTo,
                duration,
                ease: easing,
                stagger: delay / 1000,
                onComplete: onLetterAnimationComplete,
              }
            );
            observer.unobserve(el);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [text, delay, duration, animationFrom, animationTo, easing, threshold, rootMargin, onLetterAnimationComplete]);

  if (splitType === 'words') {
    const words = text.split(' ');
    return (
      <p
        ref={containerRef}
        className={`inline-block overflow-hidden ${className}`}
        style={{ textAlign }}
      >
        {words.map((word, i) => (
          <span
            key={i}
            className="split-unit inline-block will-change-transform will-change-opacity mr-[0.25em]"
          >
            {word}
          </span>
        ))}
      </p>
    );
  }

  // Split by characters
  const words = text.split(' ');
  return (
    <p
      ref={containerRef}
      className={`inline-block overflow-hidden ${className}`}
      style={{ textAlign }}
    >
      {words.map((word, wordIndex) => (
        <span key={wordIndex} className="inline-block whitespace-nowrap mr-[0.25em]">
          {word.split('').map((char, charIndex) => (
            <span
              key={charIndex}
              className="split-unit inline-block will-change-transform will-change-opacity"
            >
              {char}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
};

export default SplitText;
