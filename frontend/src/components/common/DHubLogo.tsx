import React from 'react';

interface DHubLogoProps {
  size?: number;
  variant?: 'icon' | 'badge' | 'full' | 'compact';
  animated?: boolean;
  className?: string;
  showSubtitle?: boolean;
  bgCutoutColor?: string;
}

/**
 * DHubLogo - Monochrome Minimalist Database Icon
 * Bold geometric double-D contour with an embedded dual-tier database cylinder in black and white.
 */
export const DHubLogo: React.FC<DHubLogoProps> = ({
  size = 24,
  variant = 'icon',
  animated = false,
  className = '',
  showSubtitle = false,
  bgCutoutColor = '#14151a',
}) => {
  const isBadge = variant === 'badge';
  const cutout = isBadge ? '#0b0c10' : bgCutoutColor;

  const iconSvg = isBadge ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-200 hover:scale-105 ${animated ? 'animate-pulse' : ''}`}
    >
      <defs>
        <linearGradient id="dhub-badge-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#14151b" />
          <stop offset="100%" stopColor="#07080a" />
        </linearGradient>
        <linearGradient id="dhub-badge-border" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3f3f46" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#18181b" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* Squircle Base Frame */}
      <rect x="32" y="32" width="960" height="960" rx="220" fill="url(#dhub-badge-bg)" />
      <rect x="32" y="32" width="960" height="960" rx="220" stroke="url(#dhub-badge-border)" strokeWidth="14" fill="none" />

      {/* Centered Logo Mark */}
      <g transform="translate(164, 164) scale(0.68)">
        {/* Outer D */}
        <path
          d="M 21 21 L 512 21 A 491 491 0 0 1 512 1003 L 21 1003 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="46"
          strokeLinejoin="miter"
        />

        {/* Inner D */}
        <path
          d="M 245 186 L 512 186 A 326 326 0 0 1 512 838 L 245 838 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="46"
          strokeLinejoin="miter"
        />

        {/* Cylinder Bottom Disk */}
        <path d="M 336 530 L 336 646 A 176 56 0 0 0 688 646 L 688 530 Z" fill="#ffffff" />

        {/* Cylinder Top Disk Body & Ellipse */}
        <path d="M 336 380 L 336 530 A 176 56 0 0 0 688 530 L 688 380 Z" fill="#ffffff" />
        <ellipse cx="512" cy="380" rx="176" ry="66" fill="#ffffff" />

        {/* Divider 2 (between disks) */}
        <path d="M 334 530 A 176 56 0 0 0 690 530" fill="none" stroke={cutout} strokeWidth="26" strokeLinecap="round" />

        {/* Divider 1 (top face rim) */}
        <path d="M 334 410 A 176 56 0 0 0 690 410" fill="none" stroke={cutout} strokeWidth="24" strokeLinecap="round" />
      </g>
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="-32 -32 1088 1088"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 text-white transition-transform duration-200 hover:scale-105 ${animated ? 'animate-pulse' : ''}`}
    >
      {/* Outer D */}
      <path
        d="M 21 21 L 512 21 A 491 491 0 0 1 512 1003 L 21 1003 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="44"
        strokeLinejoin="miter"
      />

      {/* Inner D */}
      <path
        d="M 245 186 L 512 186 A 326 326 0 0 1 512 838 L 245 838 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="44"
        strokeLinejoin="miter"
      />

      {/* Cylinder Bottom Disk */}
      <path d="M 336 530 L 336 646 A 176 56 0 0 0 688 646 L 688 530 Z" fill="currentColor" />

      {/* Cylinder Top Disk Body & Ellipse */}
      <path d="M 336 380 L 336 530 A 176 56 0 0 0 688 530 L 688 380 Z" fill="currentColor" />
      <ellipse cx="512" cy="380" rx="176" ry="66" fill="currentColor" />

      {/* Divider 2 (between disks) */}
      <path d="M 334 530 A 176 56 0 0 0 690 530" fill="none" stroke={cutout} strokeWidth="24" strokeLinecap="round" />

      {/* Divider 1 (top face rim) */}
      <path d="M 334 410 A 176 56 0 0 0 690 410" fill="none" stroke={cutout} strokeWidth="22" strokeLinecap="round" />
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
          <span className="font-black text-white text-base tracking-wide">
            D
          </span>
          <span className="font-bold text-zinc-200 text-base tracking-wide">Hub</span>
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
