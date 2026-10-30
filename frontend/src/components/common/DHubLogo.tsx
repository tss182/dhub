import React from 'react';

interface DHubLogoProps {
  size?: number;
  variant?: 'icon' | 'badge' | 'full' | 'compact';
  animated?: boolean;
  className?: string;
  showSubtitle?: boolean;
}

/**
 * DHubLogo - Varian 2 (Obsidian Glass)
 * Monolithic 3D frosted obsidian glass letter 'D' with internal glowing cyan/blue
 * database conduit layers, electric violet rim accents, and a central nexus hub core.
 */
export const DHubLogo: React.FC<DHubLogoProps> = ({
  size = 24,
  variant = 'icon',
  animated = false,
  className = '',
  showSubtitle = false,
}) => {
  const isBadge = variant === 'badge';

  const iconSvg = (
    <svg
      width={size}
      height={size}
      viewBox={isBadge ? '0 0 128 128' : '0 0 100 100'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-200 hover:scale-105 ${animated ? 'animate-pulse' : ''}`}
    >
      <defs>
        {/* Squircle Base (For Badge Mode) */}
        <linearGradient id="v2-obsidian-base" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#181c26" />
          <stop offset="45%" stopColor="#0f1118" />
          <stop offset="100%" stopColor="#07080c" />
        </linearGradient>

        <linearGradient id="v2-obsidian-border" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="35%" stopColor="#818cf8" stopOpacity="0.4" />
          <stop offset="70%" stopColor="#c084fc" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#1e2230" stopOpacity="0.3" />
        </linearGradient>

        {/* Monolithic Frosted Obsidian Glass Body */}
        <linearGradient id="v2-glass-body" x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#1f2536" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#121622" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0a0d14" stopOpacity="0.98" />
        </linearGradient>

        {/* Glass Specular Reflection */}
        <linearGradient id="v2-specular" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>

        {/* Violet to Cyan Outer Rim */}
        <linearGradient id="v2-violet-rim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="35%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>

        {/* Conduit Gradients */}
        <linearGradient id="v2-cyan-conduit" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00f2fe" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>

        <linearGradient id="v2-mid-conduit" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>

        <linearGradient id="v2-bot-conduit" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>

        {/* Core Glow Filter */}
        <filter id="v2-nexus-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <radialGradient id="v2-core-ambient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0284c7" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#7c3aed" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Render Badge Frame if requested */}
      {isBadge && (
        <>
          <rect x="6" y="6" width="116" height="116" rx="30" fill="url(#v2-obsidian-base)" />
          <rect x="6" y="6" width="116" height="116" rx="30" stroke="url(#v2-obsidian-border)" strokeWidth="1.75" />
          <circle cx="64" cy="64" r="42" fill="url(#v2-core-ambient)" />
        </>
      )}

      {/* Main Vector Shape (Centered) */}
      <g transform={isBadge ? 'scale(0.92) translate(5, 5)' : ''}>
        {/* Monolithic Frosted Obsidian Glass Body */}
        <path
          d={
            isBadge
              ? 'M 32 24 L 66 24 C 88 24, 102 38, 102 64 C 102 90, 88 104, 66 104 L 32 104 C 28.5 104, 26 101.5, 26 98 L 26 30 C 26 26.5, 28.5 24, 32 24 Z'
              : 'M 18 12 L 56 12 C 80 12, 94 28, 94 50 C 94 72, 80 88, 56 88 L 18 88 C 14.5 88, 12 85.5, 12 82 L 12 18 C 12 14.5, 14.5 12, 18 12 Z'
          }
          fill="url(#v2-glass-body)"
          stroke="#273044"
          strokeWidth="1.5"
        />

        {/* Specular Sheen */}
        <path
          d={
            isBadge
              ? 'M 32 24 L 66 24 C 88 24, 102 38, 102 64 L 26 64 L 26 30 C 26 26.5, 28.5 24, 32 24 Z'
              : 'M 18 12 L 56 12 C 80 12, 94 28, 94 50 L 12 50 L 12 18 C 12 14.5, 14.5 12, 18 12 Z'
          }
          fill="url(#v2-specular)"
        />

        {/* Inner Recessed Cavity */}
        <path
          d={
            isBadge
              ? 'M 46 42 L 62 42 C 74 42, 82 50, 82 64 C 82 78, 74 86, 62 86 L 46 86 C 43.8 86, 42 84.2, 42 82 L 42 46 C 42 43.8, 43.8 42, 46 42 Z'
              : 'M 34 30 L 52 30 C 66 30, 74 38, 74 50 C 74 62, 66 70, 52 70 L 34 70 C 31.8 70, 30 68.2, 30 66 L 30 34 C 30 31.8, 31.8 30, 34 30 Z'
          }
          fill="#0b0e15"
          stroke="#1c2230"
          strokeWidth="1.2"
        />

        {/* Outer Violet to Cyan Bevel Accent */}
        <path
          d={
            isBadge
              ? 'M 66 24 C 88 24, 102 38, 102 64 C 102 90, 88 104, 66 104'
              : 'M 56 12 C 80 12, 94 28, 94 50 C 94 72, 80 88, 56 88'
          }
          stroke="url(#v2-violet-rim)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Left Spine Cyan Power Rail */}
        <line
          x1={isBadge ? 26 : 12}
          y1={isBadge ? 30 : 18}
          x2={isBadge ? 26 : 12}
          y2={isBadge ? 98 : 82}
          stroke="#00f2fe"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Horizontal Database Conduits */}
        {/* Top Conduit */}
        <path
          d={isBadge ? 'M 28 38 L 84 38' : 'M 14 26 L 76 26'}
          stroke="url(#v2-cyan-conduit)"
          strokeWidth="2"
          strokeLinecap="round"
          filter="url(#v2-nexus-glow)"
        />
        <circle cx={isBadge ? 28 : 14} cy={isBadge ? 38 : 26} r="2" fill="#ffffff" />
        <circle cx={isBadge ? 84 : 76} cy={isBadge ? 38 : 26} r="2" fill="#ffffff" />

        {/* Middle Conduit */}
        <path
          d={isBadge ? 'M 26 64 L 100 64' : 'M 12 50 L 92 50'}
          stroke="url(#v2-mid-conduit)"
          strokeWidth="2.4"
          strokeLinecap="round"
          filter="url(#v2-nexus-glow)"
        />
        <circle cx={isBadge ? 26 : 12} cy={isBadge ? 64 : 50} r="2.2" fill="#ffffff" />
        <circle cx={isBadge ? 100 : 92} cy={isBadge ? 64 : 50} r="2.2" fill="#ffffff" />

        {/* Bottom Conduit */}
        <path
          d={isBadge ? 'M 28 90 L 84 90' : 'M 14 74 L 76 74'}
          stroke="url(#v2-bot-conduit)"
          strokeWidth="2"
          strokeLinecap="round"
          filter="url(#v2-nexus-glow)"
        />
        <circle cx={isBadge ? 28 : 14} cy={isBadge ? 90 : 74} r="2" fill="#ffffff" />
        <circle cx={isBadge ? 84 : 76} cy={isBadge ? 90 : 74} r="2" fill="#ffffff" />

        {/* Nexus Interlink Line */}
        <line
          x1={isBadge ? 56 : 45}
          y1={isBadge ? 38 : 26}
          x2={isBadge ? 56 : 90}
          y2={isBadge ? 90 : 74}
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeDasharray="2 3"
          opacity="0.75"
        />

        {/* Nexus Core Hub */}
        <circle
          cx={isBadge ? 56 : 45}
          cy={isBadge ? 64 : 50}
          r="6.5"
          fill="#00f2fe"
          filter="url(#v2-nexus-glow)"
        />
        <circle cx={isBadge ? 56 : 45} cy={isBadge ? 64 : 50} r="2.5" fill="#ffffff" />
        <circle
          cx={isBadge ? 56 : 45}
          cy={isBadge ? 64 : 50}
          r="10"
          stroke="#38bdf8"
          strokeWidth="1"
          strokeDasharray="3 2"
          opacity="0.6"
        />
      </g>
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
          <span className="font-extrabold text-white text-base tracking-wide bg-gradient-to-r from-cyan-400 via-sky-300 to-purple-400 bg-clip-text text-transparent">
            D
          </span>
          <span className="font-bold text-white text-base tracking-wide">Hub</span>
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
