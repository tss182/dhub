import React from 'react';

interface DHubLogoProps {
  size?: number;
  variant?: 'icon' | 'badge' | 'full' | 'compact';
  animated?: boolean;
  className?: string;
  showSubtitle?: boolean;
}

export const DHubLogo: React.FC<DHubLogoProps> = ({
  size = 24,
  variant = 'icon',
  animated = false,
  className = '',
  showSubtitle = false,
}) => {
  const iconSvg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${animated ? 'animate-pulse' : ''}`}
    >
      <defs>
        {/* Main Gradient */}
        <linearGradient id="dhub-primary-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>

        {/* Database Platter Gradients */}
        <linearGradient id="dhub-platter-top" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>

        <linearGradient id="dhub-platter-mid" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>

        <linearGradient id="dhub-platter-bot" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>

        <linearGradient id="dhub-core-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>

        {/* Squircle Badge Background Gradients */}
        <linearGradient id="dhub-badge-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1E2230" />
          <stop offset="50%" stopColor="#13151C" />
          <stop offset="100%" stopColor="#0B0D12" />
        </linearGradient>

        <linearGradient id="dhub-badge-border" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.1" />
        </linearGradient>

        {/* Glow Filter */}
        <filter id="dhub-core-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Badge Frame if variant is 'badge' */}
      {variant === 'badge' && (
        <>
          <rect x="4" y="4" width="92" height="92" rx="24" fill="url(#dhub-badge-bg)" />
          <rect x="4" y="4" width="92" height="92" rx="24" stroke="url(#dhub-badge-border)" strokeWidth="1.5" />
        </>
      )}

      {/* Main DHub Geometry */}
      <g transform={variant === 'badge' ? 'scale(0.82) translate(11, 11)' : ''}>
        {/* Left Data Bus Spine */}
        <rect x="14" y="16" width="12" height="68" rx="6" fill="url(#dhub-primary-grad)" />

        {/* Top Database Platter */}
        <path
          d="M 26 16 L 56 16 C 74 16, 86 24, 86 34 C 86 44, 74 48, 56 48 L 26 48 Z"
          fill="url(#dhub-platter-top)"
        />
        <path
          d="M 26 16 L 56 16 C 74 16, 86 24, 86 34"
          stroke="#BAE6FD"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Middle Database Platter (Nexus Ring) */}
        <path
          d="M 26 38 L 62 38 C 82 38, 92 44, 92 50 C 92 56, 82 62, 62 62 L 26 62 Z"
          fill="url(#dhub-platter-mid)"
        />
        <path
          d="M 26 38 L 62 38 C 82 38, 92 44, 92 50"
          stroke="#DBEAFE"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* Bottom Database Platter */}
        <path
          d="M 26 52 L 56 52 C 74 52, 86 56, 86 66 C 86 76, 74 84, 56 84 L 26 84 Z"
          fill="url(#dhub-platter-bot)"
        />
        <path
          d="M 26 52 L 56 52 C 74 52, 86 56, 86 66"
          stroke="#DDD6FE"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* Negative Space Hole of 'D' */}
        <ellipse cx="48" cy="50" rx="14" ry="12" fill="#121317" />

        {/* Glowing Central Hub Core */}
        <circle cx="48" cy="50" r="7.5" fill="url(#dhub-core-grad)" filter="url(#dhub-core-glow)" />
        <circle cx="48" cy="50" r="3" fill="#FFFFFF" />

        {/* Hub Connection Rays */}
        <line x1="48" y1="38" x2="48" y2="28" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
        <circle cx="48" cy="27" r="2" fill="#FFFFFF" />

        <line x1="48" y1="62" x2="48" y2="72" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" />
        <circle cx="48" cy="73" r="2" fill="#FFFFFF" />

        {/* Connection Port Nodes on Left Bus */}
        <circle cx="20" cy="28" r="2" fill="#FFFFFF" opacity="0.9" />
        <circle cx="20" cy="50" r="2.5" fill="#FFFFFF" />
        <circle cx="20" cy="72" r="2" fill="#FFFFFF" opacity="0.9" />
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
          <span className="font-extrabold text-white text-base tracking-wide bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-300 bg-clip-text text-transparent">
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
