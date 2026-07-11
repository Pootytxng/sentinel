import type { ReactNode } from "react";

// Shared six-home nav glyphs for the app-shell rail (one-rail pass §1). One glyph source = no drift.
const NAV_ICONS: Record<string, ReactNode> = {
  gauge: (<><path d="M4 18a8 8 0 1 1 16 0" /><line x1="12" y1="18" x2="15.5" y2="11" /></>),
  check: (<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  play: (<><rect x="3" y="7" width="14" height="10" rx="3" /><path d="M17 10h2.5l1.5 1.5v3l-1.5 1.5H17" /><circle cx="7" cy="12" r="0.6" /><circle cx="9.4" cy="12" r="0.6" /></>),
  // "monitor" — a live activity/pulse line, coherent with what the Monitor room shows (live stats +
  // session debriefs). Replaces the gamepad glyph on that tab (2026-06-15 owner rename Play -> Monitor).
  monitor: (<><polyline points="3 13 8 13 10 7 13 17 15 13 21 13" /></>),
  fix: (<><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><circle cx="9" cy="9" r="2.2" /><circle cx="15" cy="15" r="2.2" /></>),
  learn: (<><path d="M5 5.5A2 2 0 0 1 7 4h11v15H7a2 2 0 0 0-2 2z" /><line x1="9" y1="8" x2="15" y2="8" /></>),
  gear: (<><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2M12 18.3v2.2M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" /></>),
  lab: (<><path d="M9 3h6" /><path d="M10 3v5.2L5.4 16.8A2 2 0 0 0 7.2 20h9.6a2 2 0 0 0 1.8-3.2L14 8.2V3" /><line x1="8" y1="14" x2="16" y2="14" /></>),
};

export function NavGlyph({ name }: { name: string }) {
  return (
    <svg
      className="nav-ico"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[name]}
    </svg>
  );
}
