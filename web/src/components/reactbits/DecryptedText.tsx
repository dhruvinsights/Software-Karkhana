import React, { useState, useEffect, useRef } from 'react';

export interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: 'start' | 'end' | 'center';
  useOriginalCharsOnly?: boolean;
  characters?: string;
  className?: string;
  parentClassName?: string;
  encryptedClassName?: string;
  animateOn?: 'view' | 'hover';
  [key: string]: any;
}

export const DecryptedText: React.FC<DecryptedTextProps> = ({
  text,
  speed = 40,
  maxIterations = 10,
  sequential = false,
  revealDirection = 'start',
  useOriginalCharsOnly = false,
  characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+~`|}{[]:;?><,./-=',
  className = '',
  parentClassName = '',
  encryptedClassName = '',
  animateOn = 'view',
  ...props
}) => {
  const [displayText, setDisplayText] = useState<string>(text);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [isScrolledIntoView, setIsScrolledIntoView] = useState<boolean>(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let currentIteration = 0;

    const availableChars = useOriginalCharsOnly
      ? Array.from(new Set(text.split(''))).filter((char) => char !== ' ')
      : characters.split('');

    const getRandomChar = () => {
      return availableChars[Math.floor(Math.random() * availableChars.length)];
    };

    if (animateOn === 'view' && !isScrolledIntoView) return;
    if (animateOn === 'hover' && !isHovering) {
      setDisplayText(text);
      return;
    }

    interval = setInterval(() => {
      setDisplayText((_) => {
        return text
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';
            if (sequential) {
              if (index < (currentIteration / maxIterations) * text.length) {
                return text[index];
              }
            } else {
              if (currentIteration >= maxIterations) {
                return text[index];
              }
            }
            return getRandomChar();
          })
          .join('');
      });

      currentIteration++;

      if (currentIteration > maxIterations * (sequential ? 1.5 : 1)) {
        clearInterval(interval);
        setDisplayText(text);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, maxIterations, sequential, isHovering, isScrolledIntoView, animateOn, characters, useOriginalCharsOnly]);

  useEffect(() => {
    if (animateOn !== 'view') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsScrolledIntoView(true);
          if (containerRef.current) observer.unobserve(containerRef.current);
        }
      },
      { threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [animateOn]);

  return (
    <span
      ref={containerRef}
      className={`inline-block whitespace-pre-wrap ${parentClassName}`}
      onMouseEnter={() => animateOn === 'hover' && setIsHovering(true)}
      onMouseLeave={() => animateOn === 'hover' && setIsHovering(false)}
      {...props}
    >
      <span className={className}>{displayText}</span>
    </span>
  );
};

export default DecryptedText;
