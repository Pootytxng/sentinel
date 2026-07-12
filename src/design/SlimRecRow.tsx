import { useState } from "react";
import type { ReactNode } from "react";
import "./doorknob.css";
import "./SlimRecRow.css";

// SlimRecRow — the master-detail rec row (P1 UI slim-down, spec 2026-07-01-p1-slimrows-optimize).
// Collapsed: status dot · title + ONE always-visible proof line · badge · one control · chevron —
// ≤3 interactive affordances (the row-toggle, the control, nothing else tabbable). Everything else
// lives in a detail panel that expands IN PLACE (never a route change). Built as a design primitive
// (Home's limiter row + the session list reuse it in later phases), consumed by Fix behind the
// Fixes segment (the standalone Tune view keeps the classic row path).
//
// HONESTY GUARDRAIL (council 🔴, guarded by slim-row-proof-guard.test.tsx): `proof` is required and
// rendered unconditionally — the collapsed row can never hide its measured evidence/reason line.
// The row changes LAYOUT only: the control (Fix passes the existing TrustSwitch) keeps its own
// apply/rollback semantics and sits OUTSIDE the toggle button, so clicking it never toggles detail.

export type SlimRowStatus = "attention" | "ready" | "neutral";
export type SlimRowBadge = "recommended" | "optional";

const BADGE_LABEL: Record<SlimRowBadge, string> = {
  recommended: "Recommended",
  optional: "Optional",
};

// Same enclosed-chevron knob as the app's other doors (doorknob grammar): the chip rotates via
// .cmp-door[aria-expanded]; the glyph stays static.
function Chevron() {
  return (
    <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

// A labeled key → value line inside the detail panel (mirrors the mockup's drow grammar).
export function SlimDetailRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="slimrow-drow">
      <span className="slimrow-dk">{k}</span>
      <span className="slimrow-dv">{v}</span>
    </div>
  );
}

export function SlimRecRow({
  title,
  proof,
  meta,
  badge,
  status,
  control,
  defaultOpen,
  children,
}: {
  title: ReactNode;
  /** The ONE measured proof line — always visible, never empty (slim-row-proof-guard). */
  proof: string;
  /** Optional extra always-visible line under the proof (Expert view's exact-target line). */
  meta?: ReactNode;
  badge: SlimRowBadge;
  status: SlimRowStatus;
  /** The row's single control (Fix passes the existing TrustSwitch — semantics unchanged). */
  control: ReactNode;
  defaultOpen?: boolean;
  /** Detail-panel content, revealed in place on row click / chevron. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <li className="slimrow">
      <div className="slimrow-head">
        <button
          type="button"
          className="slimrow-toggle cmp-door"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`slimrow-dot slimrow-dot-${status}`} aria-hidden="true" />
          <span className="slimrow-main">
            <span className="slimrow-title">{title}</span>
            <span className="slimrow-proof">{proof}</span>
            {meta}
          </span>
          <span className={`slimrow-badge slimrow-badge-${badge}`}>{BADGE_LABEL[badge]}</span>
          <Chevron />
        </button>
        {/* Outside the toggle: clicks on the control never expand/collapse the row. */}
        <span className="slimrow-control">{control}</span>
      </div>
      {open && <div className="slimrow-detail">{children}</div>}
    </li>
  );
}
