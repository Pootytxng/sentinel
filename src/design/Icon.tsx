import type { ReactNode } from "react";

export const ICONS: Record<string, ReactNode> = {
  grid: (<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>),
  shield: (<><path d="M12 3l7 2.5v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.5L12 3z" /><path d="M9 12l2 2 4-4" /></>),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>),
  pulse: (<path d="M3 12h4l2-6 4 12 2-6h6" />),
  chart: (<><line x1="4" y1="20" x2="20" y2="20" /><rect x="5.5" y="11" width="3" height="7" /><rect x="10.5" y="7" width="3" height="11" /><rect x="15.5" y="13" width="3" height="5" /></>),
  ledger: (<><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></>),
  check: (<path d="M5 12l5 5 9-9" />),
  alert: (<><path d="M12 8v5" /><path d="M12 16h.01" /><circle cx="12" cy="12" r="9" /></>),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
