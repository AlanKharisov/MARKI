import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

const base = (size?: number): React.SVGProps<SVGSVGElement> => ({
  width: size ?? '1em',
  height: size ?? '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export const Icon = {
  Home: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
  ),
  Wallet: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><circle cx="17" cy="15" r="1.2" fill="currentColor" /></svg>
  ),
  Plus: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} strokeWidth={2.2} {...p}><path d="M12 5v14M5 12h14" /></svg>
  ),
  CRM: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 7h11v10H3z" /><path d="M14 10h5l2 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
  ),
  Bell: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" /><path d="M10 21a2 2 0 004 0" /></svg>
  ),
  User: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>
  ),
  Search: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
  Heart: ({ size, filled, ...p }: IconProps & { filled?: boolean }) => (
    <svg {...base(size)} fill={filled ? 'currentColor' : 'none'} {...p}><path d="M12 21s-7-4.5-9.5-9C.5 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4 4.5 8C19 16.5 12 21 12 21z" /></svg>
  ),
  Comment: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <g transform="translate(1 0) rotate(180 12 12)">
        <path d="M21 12a8 8 0 11-3.5-6.6L21 5l-1 4a8 8 0 011 3z" />
      </g>
    </svg>
  ),
  Share: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 11l8-4M8 13l8 4" /></svg>
  ),
  Lock: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
  ),
  Shield: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
  Sparkle: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" /></svg>
  ),
  Check: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} strokeWidth={2.5} {...p}><path d="M5 12l5 5L20 7" /></svg>
  ),
  ArrowRight: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M5 12h14M13 5l7 7-7 7" /></svg>
  ),
  ArrowLeft: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M19 12H5M11 5l-7 7 7 7" /></svg>
  ),
  ChevronRight: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M9 6l6 6-6 6" /></svg>
  ),
  ChevronDown: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>
  ),
  Camera: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.5-3h5L16 7" /></svg>
  ),
  Upload: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 18v2h16v-2" /></svg>
  ),
  Settings: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
  ),
  Globe: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18z" /></svg>
  ),
  Logout: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h12" /></svg>
  ),
  Truck: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 7h11v10H3z" /><path d="M14 10h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
  ),
  Pin: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
  ),
  QR: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M14 19h3M19 14v3M19 19h2" /></svg>
  ),
  X: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M18 6L6 18M6 6l12 12" /></svg>
  ),
  More: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="6" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="18" r="1" fill="currentColor" /></svg>
  ),
  Send: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
  ),
  Receive: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
  ),
  Filter: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
  ),
  Menu: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 12h18M3 6h18M3 18h18" /></svg>
  ),
  Refresh: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8" /><path d="M3 3v5h5" /></svg>
  ),
  Scan: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" /><line x1="7" y1="12" x2="17" y2="12" /></svg>
  ),
};

export type IconKey = keyof typeof Icon;
