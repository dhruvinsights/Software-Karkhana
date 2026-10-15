import React, { useRef, useState, useEffect } from 'react';

export interface AnimatedListProps {
  children?: React.ReactNode;
  items?: React.ReactNode[];
  className?: string;
  itemClassName?: string;
  delay?: number;
  stagger?: number;
  animation?: 'fade' | 'slide-up' | 'scale' | 'slide-right';
  interactive?: boolean;
  onItemSelect?: (index: number) => void;
}

export const AnimatedList: React.FC<AnimatedListProps> = ({
  children,
  items,
  className = '',
  itemClassName = '',
  delay = 100,
  stagger = 60,
  animation = 'slide-up',
  interactive = true,
  onItemSelect,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rawElements = items || React.Children.toArray(children);

  return (
    <div ref={containerRef} className={`flex flex-col gap-2.5 ${className}`}>
      {rawElements.map((item, index) => {
        const isSelected = selectedIndex === index;

        return (
          <div
            key={index}
            onClick={() => {
              if (interactive) {
                setSelectedIndex(index);
                onItemSelect?.(index);
              }
            }}
            style={{
              animationDelay: `${delay + index * stagger}ms`,
              animationFillMode: 'both',
            }}
            className={`
              transition-all duration-200
              ${interactive ? 'cursor-pointer hover:translate-x-1 hover:border-white/20' : ''}
              ${isSelected ? 'border-blue-500/50 bg-blue-500/10' : ''}
              ${itemClassName}
            `}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
};

export default AnimatedList;
