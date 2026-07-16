import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Side-pile collapse (P5 UI slim-down, plan §4.1/§5.5).
// The merged Optimize "Fixes" segment stacks five "leave it alone" piles across TWO components
// (Check: measured fine · not worth touching; Fix: not for this rig · dismissed · the refuse
// pile). The plan's contract wants ONE quiet "Nothing else needs attention" expander
// per room — so the Optimize shell owns the expander and each surface TELEPORTS its pile into it
// via a portal, keeping the pile's data, state, and audited handlers exactly where they live today.
//
// Contract:
//   • No provider (classic surfaces, standalone Check/Tune, flag off) → children render IN PLACE,
//     byte-identical to today.
//   • Provider present, host not yet mounted → render nothing (never double-render a pile).
//   • Provider + host → portal into the shell's expander body; `order` keeps the pile sequence
//     deterministic regardless of mount timing (scan verdict lands after first paint).
// Honesty guardrail: this MOVES piles, it never drops one — content, counts, and reasons unchanged.

export const SidePileContext = createContext<{ host: HTMLElement | null } | null>(null);

export function SidePileItem({ order, children }: { order: number; children: ReactNode }) {
  const ctx = useContext(SidePileContext);
  if (!ctx) return <>{children}</>;
  if (!ctx.host) return null;
  return createPortal(
    <div className="sidepile-item" style={{ order }}>
      {children}
    </div>,
    ctx.host,
  );
}

// Fixed pile order inside the expander (flex `order` on the host column).
export const SIDE_PILE_ORDER = {
  measuredFine: 1,
  notWorthTouching: 2,
  notForThisRig: 3,
  dismissed: 4,
  refusePile: 5,
} as const;
