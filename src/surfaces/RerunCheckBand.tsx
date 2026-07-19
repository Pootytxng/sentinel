import type { ReactNode } from "react";
import type { GameReadiness } from "../types";
import { readLastCheck, formatCheckAge } from "./last-check";
import "./RerunCheckBand.css";

// The Home masthead status + action module — owner-approved "A · Status band" (relocated + redesigned
// out of Settings to verdict-card quality). It IS Home's single Re-run affordance (RoomShell's
// `measured` slot; no separate primaryAction button — one primary action, never two).
//
// Honest by construction (RECEIPTS DOCTRINE): an AGE only appears when a real check completed and we
// stored its record (last-check.ts). With no stored snapshot we fall back to the LIVE readiness
// counts and show NO age — never a time we didn't measure.

const REFRESH_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export function RerunCheckBand({
  readiness,
  checking,
  onRunCheck,
}: {
  readiness: GameReadiness | null;
  checking: boolean;
  onRunCheck: () => void;
}) {
  const snap = checking ? null : readLastCheck();

  let tag: string;
  let status: ReactNode;
  let warn = false;

  if (checking) {
    tag = "Checking";
    status = "running checks…";
  } else if (snap) {
    warn = snap.fixCount > 0;
    tag = "Last check";
    const age = formatCheckAge(snap.at, Date.now());
    status = warn ? (
      <>
        {age} · <b className="rcb-num">{snap.fixCount}</b> to fix
      </>
    ) : (
      <>
        {age} ·{" "}
        <b className="rcb-num">
          {snap.green}/{snap.total}
        </b>{" "}
        clean
      </>
    );
  } else {
    // Fallback: no stored snapshot yet — LIVE counts, NO age. Same measured/total ratio the
    // provenance line always showed, so the "3/3"-style guard stays honest and green.
    const total = readiness?.checks.length ?? 0;
    const measured = total - (readiness?.unknown_count ?? 0);
    const attention = readiness?.attention_count ?? 0;
    warn = attention > 0;
    tag = "Checks";
    status = warn ? (
      <>
        <b className="rcb-num">
          {measured}/{total}
        </b>{" "}
        measured · {attention} flagged
      </>
    ) : (
      <>
        <b className="rcb-num">
          {measured}/{total}
        </b>{" "}
        clean
      </>
    );
  }

  return (
    <div className="rcb">
      <div className="rcb-left">
        <span
          className={`rcb-dot${warn ? " rcb-dot-warn" : ""}${checking ? " rcb-dot-scan" : ""}`}
          aria-hidden="true"
        />
        <div>
          <div className="rcb-tag">{tag}</div>
          <div className="rcb-status">{status}</div>
        </div>
      </div>
      <button type="button" className="rcb-btn" onClick={onRunCheck} disabled={checking}>
        <span className="rcb-ic">{REFRESH_ICON}</span>
        {checking ? "Checking…" : "Re-run check"}
      </button>
    </div>
  );
}
