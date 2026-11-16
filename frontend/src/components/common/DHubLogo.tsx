import React, { useId } from 'react';

interface DHubLogoProps {
  size?: number;
  variant?: 'icon' | 'badge' | 'full' | 'compact';
  animated?: boolean;
  className?: string;
  showSubtitle?: boolean;
  bgCutoutColor?: string;
}

const OUTER_D_PATH =
  'M 188 272 A 96 96 0 0 1 284 176 L 508 176 A 336 336 0 0 1 508 848 L 284 848 A 96 96 0 0 1 188 752 Z';
const INNER_D_PATH =
  'M 292 332 A 52 52 0 0 1 344 280 L 508 280 A 232 232 0 0 1 508 744 L 344 744 A 52 52 0 0 1 292 692 Z';
const CYLINDER_MIDDLE_PATH =
  'M 378 444 A 6 6 0 0 1 390 444 A 110 32 0 0 0 610 444 A 6 6 0 0 1 622 444 L 622 504 A 122 44 0 0 1 378 504 Z';
const CYLINDER_BOTTOM_PATH =
  'M 378 538 A 6 6 0 0 1 390 538 A 110 32 0 0 0 610 538 A 6 6 0 0 1 622 538 L 622 598 A 122 44 0 0 1 378 598 Z';

/**
 * DHubLogo - Smooth Modern Concentric Double-D & Layered Database Icon
 * Tangent-continuous geometry with pure positive-space 3-tier database stack.
 */
export const DHubLogo: React.FC<DHubLogoProps> = ({
  size = 24,
  variant = 'icon',
  animated = false,
  className = '',
  showSubtitle = false,
  bgCutoutColor: _bgCutoutColor = '#14151a',
}) => {
  const rawId = useId();
  const uid = `dhub-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const bgGradId = `${uid}-bg`;
  const glowGradId = `${uid}-glow`;
  const borderGradId = `${uid}-border`;
  const markGradId = `${uid}-mark`;

  const showBadge = variant === 'badge' || variant === 'full' || variant === 'compact';

  const renderLogoMark = (paint: string) => (
    <g>
      {/* Outer D */}
      <path
        d={OUTER_D_PATH}
        fill="none"
        stroke={paint}
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Inner D */}
      <path
        d={INNER_D_PATH}
        fill="none"
        stroke={paint}
        strokeOpacity="0.88"
        strokeWidth="38"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 3-Tier Database Cylinder */}
      <ellipse
        cx="500"
        cy="410"
        rx="122"
        ry="44"
        fill={paint}
      />
      <path
        d={CYLINDER_MIDDLE_PATH}
        fill={paint}
        fillOpacity="0.92"
      />
      <path
        d={CYLINDER_BOTTOM_PATH}
        fill={paint}
        fillOpacity="0.82"
      />
    </g>
  );

  const iconSvg = showBadge ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-200 hover:scale-105 ${animated ? 'animate-pulse' : ''}`}
    >
      <defs>
        <linearGradient id={bgGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1d28" />
          <stop offset="50%" stopColor="#0f1118" />
          <stop offset="100%" stopColor="#07080c" />
        </linearGradient>
        <radialGradient id={glowGradId} cx="22%" cy="18%" r="72%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.16" />
          <stop offset="65%" stopColor="#3b82f6" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={borderGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient
          id={markGradId}
          gradientUnits="userSpaceOnUse"
          x1="188"
          y1="176"
          x2="844"
          y2="848"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
      </defs>

      {/* Dimensional Squircle Base Frame */}
      <rect x="32" y="32" width="960" height="960" rx="228" fill={`url(#${bgGradId})`} />
      <rect x="32" y="32" width="960" height="960" rx="228" fill={`url(#${glowGradId})`} />
      <rect
        x="38"
        y="38"
        width="948"
        height="948"
        rx="222"
        stroke={`url(#${borderGradId})`}
        strokeWidth="12"
        fill="none"
      />

      {/* Centered Smooth Logo Mark */}
      {renderLogoMark(`url(#${markGradId})`)}
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="124 120 784 784"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 text-zinc-100 transition-transform duration-200 hover:scale-105 ${animated ? 'animate-pulse' : ''}`}
    >
      {renderLogoMark('currentColor')}
    </svg>
  );

  if (variant === 'icon' || variant === 'badge') {
    return <div className={`inline-flex items-center justify-center ${className}`}>{iconSvg}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {iconSvg}
      <div className="flex flex-col">
        <div className="flex items-center tracking-tight leading-none">
          <span className="font-black text-zinc-100 text-base tracking-wide">
            D
          </span>
          <span className="font-bold text-zinc-300 text-base tracking-wide">Hub</span>
        </div>
        {showSubtitle && (
          <span className="text-[9px] font-semibold text-zinc-400 tracking-widest uppercase mt-0.5">
            Database IDE
          </span>
        )}
      </div>
    </div>
  );
};

export default DHubLogo;
