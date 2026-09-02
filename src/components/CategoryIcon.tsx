// Inline SVG icons for each catalog category. Inline (not imported from a file) so the
// bundle stays small and there's no extra network request. Each icon is a 24x24 viewBox
// that scales cleanly to whatever size the consumer asks for.
//
// Adding a new category? Drop a new entry in the ICONS map below. The category list itself
// lives in src/lib/constants.ts so the catalog and the icon set can drift independently if
// you want to add an icon later without bumping the catalog.

import type { JSX } from 'react';

type IconPath = JSX.Element;

const wrap = (children: IconPath) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS: Record<string, IconPath> = {
  Finance: wrap(
    <>
      <path d="M12 2v20" />
      <path d="M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
    </>,
  ),
  Photos: wrap(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>,
  ),
  Media: wrap(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </>,
  ),
  Documents: wrap(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>,
  ),
  Notes: wrap(
    <>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>,
  ),
  Passwords: wrap(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </>,
  ),
  Productivity: wrap(
    <>
      <path d="M3 6h18M3 12h18M3 18h12" />
    </>,
  ),
  Dashboard: wrap(
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="5" rx="1" />
      <rect x="13" y="10" width="8" height="11" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
    </>,
  ),
  Monitoring: wrap(
    <>
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </>,
  ),
  'Home Automation': wrap(
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  Backup: wrap(
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>,
  ),
  'File Sharing': wrap(
    <>
      <path d="M16 16l-4-4-4 4" />
      <path d="M12 12v8" />
      <path d="M4 4h16v6" />
    </>,
  ),
  'Developer Tools': wrap(
    <>
      <path d="M9 8l-5 4 5 4" />
      <path d="M15 8l5 4-5 4" />
    </>,
  ),
  'Project Management': wrap(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 4v5" />
    </>,
  ),
  Communication: wrap(
    <>
      <path d="M21 12a8 8 0 1 1-3-6.2L21 4l-1 4-2 .5" />
    </>,
  ),
  Security: wrap(
    <>
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  ),
};

const FALLBACK = wrap(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 9h6M9 13h6M9 17h3" />
  </>,
);

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const icon = ICONS[name] ?? FALLBACK;
  return <span className={className}>{icon}</span>;
}
