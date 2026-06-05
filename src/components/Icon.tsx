import type { ReactNode } from "react";

export type IconName =
  | "search"
  | "zap"
  | "folder"
  | "chart"
  | "bed"
  | "flag"
  | "chevron"
  | "plus"
  | "minus"
  | "up"
  | "down"
  | "x"
  | "pencil"
  | "download"
  | "save"
  | "trash"
  | "users"
  | "info"
  | "sun"
  | "cloudSun"
  | "cloud"
  | "rain"
  | "snow"
  | "thunder"
  | "fog"
  | "compass"
  | "loop";

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  folder: (
    <path d="M4 20h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7.5l-1.7-2.1A2 2 0 0 0 9.2 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
  ),
  chart: (
    <>
      <line x1="6" y1="20" x2="6" y2="13" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </>
  ),
  bed: (
    <>
      <path d="M3 7v12" />
      <path d="M3 14h18a0 0 0 0 0 0 0v5" />
      <path d="M21 19v-5a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </>
  ),
  chevron: <polyline points="6 9 12 15 18 9" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  up: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </>
  ),
  down: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </>
  ),
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  cloudSun: (
    <>
      <path d="M7 5V3M3.6 6.6 2.5 5.5M5 10H3M10.6 6.6l1.1-1.1" />
      <circle cx="7" cy="9.5" r="2.4" />
      <path d="M15.5 19a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.3A3.3 3.3 0 0 0 6.5 19z" />
    </>
  ),
  cloud: <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 19z" />,
  rain: (
    <>
      <path d="M17.5 15a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 15" />
      <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
    </>
  ),
  snow: (
    <>
      <path d="M17.5 15a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 15" />
      <path d="M8 19h.01M12 19h.01M16 19h.01M10 21h.01M14 21h.01" />
    </>
  ),
  thunder: (
    <>
      <path d="M17.5 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 14" />
      <path d="M12 13l-2 4h3l-2 4" />
    </>
  ),
  fog: (
    <>
      <path d="M17.5 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 13" />
      <path d="M5 17h14M7 21h12" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.2 7.8 13.4 13.4 7.8 16.2 10.6 10.6 16.2 7.8" />
    </>
  ),
  loop: (
    <>
      <path d="M17 4a8 8 0 1 1-7 4" />
      <polyline points="17 9 17 4 12 4" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
