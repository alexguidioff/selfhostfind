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
  Gaming: wrap(<><path d="M7 8h10l3 9a2 2 0 0 1-3 2l-3-3h-4l-3 3a2 2 0 0 1-3-2z" /><path d="M6 12h4M8 10v4M16 11h.01M18 13h.01" /></>),
  Bookmarks: wrap(<path d="M6 3h12v18l-6-4-6 4z" />),
  'RSS & News': wrap(<><circle cx="5" cy="19" r="1" /><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /></>),
  Automation: wrap(<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h9v9M15 12l3 3 3-3" /></>),
  Analytics: wrap(<path d="M4 3v17h17M8 16v-5M13 16V6M18 16V9" />),
  'AI & LLM': wrap(<><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M19 9h4M1 15h4M19 15h4M9 10h.01M15 10h.01M9 14h6" /></>),
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
