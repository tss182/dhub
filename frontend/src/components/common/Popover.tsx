import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverProps {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  delay?: number;
  children: React.ReactElement;
  disabled?: boolean;
}

export const Popover: React.FC<PopoverProps> = ({
  content,
  shortcut,
  side = 'bottom',
  align = 'center',
  delay = 120,
  children,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<React.CSSProperties>({});

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const calculatePosition = useCallback(() => {
    if (!targetRef.current) return;
    const rect = targetRef.current.getBoundingClientRect();
    const gap = 6;
    const style: React.CSSProperties = {};

    if (side === 'bottom') {
      style.top = `${rect.bottom + gap}px`;
    } else if (side === 'top') {
      style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else if (side === 'left') {
      style.right = `${window.innerWidth - rect.left + gap}px`;
    } else if (side === 'right') {
      style.left = `${rect.right + gap}px`;
    }

    if (side === 'bottom' || side === 'top') {
      if (align === 'center') {
        style.left = `${rect.left + rect.width / 2}px`;
        style.transform = 'translateX(-50%)';
      } else if (align === 'start') {
        style.left = `${Math.max(8, rect.left)}px`;
      } else if (align === 'end') {
        style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      }
    } else {
      // left or right side
      if (align === 'center') {
        style.top = `${rect.top + rect.height / 2}px`;
        style.transform = 'translateY(-50%)';
      } else if (align === 'start') {
        style.top = `${Math.max(8, rect.top)}px`;
      } else if (align === 'end') {
        style.bottom = `${Math.max(8, window.innerHeight - rect.bottom)}px`;
      }
    }

    setCoords(style);
  }, [side, align]);

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      calculatePosition();
      setIsOpen(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(false);
  };

  const handleClick = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleScrollOrResize = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  // Clone child to attach event listeners and ref safely
  const child = React.Children.only(children) as React.ReactElement<any>;
  const childProps: any = {
    ref: (node: HTMLElement | null) => {
      targetRef.current = node;
      const { ref } = child as any;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref && typeof ref === 'object') {
        ref.current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      handleMouseEnter();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      handleMouseLeave();
    },
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      handleClick();
    },
    // Explicitly delete native title attribute so OS/browser does not render native tooltips
    title: undefined,
  };

  return (
    <>
      {React.cloneElement(child, childProps)}
      {isOpen &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none rounded border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl px-2 py-1 text-xs text-zinc-200 flex items-center gap-1.5 whitespace-nowrap animate-in fade-in zoom-in-95 duration-100"
            style={coords}
          >
            <span className="font-medium text-[11px] text-zinc-200">{content}</span>
            {shortcut && (
              <kbd className="text-[9px] font-mono font-semibold text-zinc-400 bg-[#252834] px-1 py-0.5 rounded border border-[#363a48]">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
export default Popover;
