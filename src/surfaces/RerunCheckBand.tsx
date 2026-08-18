import { useTranslation } from "react-i18next";
import type { GameReadiness } from "../types";
import { readLastCheck, formatCheckAge } from "./last-check";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import "./RerunCheckBand.css";

// Home's check status + its single Re-run affordance (RoomShell's `measured` slot; no separate
// primaryAction button — one primary action, never two).
//
// ONE PLAIN SENTENCE (2026-08-18). This used to be a bordered panel: a status dot, a small uppercase
// `CHECKS` tag, and the line `16/16 measured · 1 flagged` stacked beneath it. Two problems the owner
// named on sight, and the navigation audit had already written down:
//   1. It was a THIRD card competing above the fold, after the verdict and its because-line, on a
//      screen whose whole job is to answer one question. Home reads verdict → one action → hero.
//   2. `16/16 clean` is on the audit's own jargon list (docs/decisions/2026-08-11-design-navigation-
//      audit.md §3). A ratio is how the machine thinks. "All 16 checks look good" is the same
//      measured fact in the voice of someone the user would trust, and per the receipts doctrine an
//      amplified measured win is exactly what this line is FOR.
// So: no card, no uppercase tag, one sentence. Same numbers, better voice.
//
// HONEST BY CONSTRUCTION (RECEIPTS DOCTRINE), unchanged and still test-pinned:
//   - An AGE only appears when a real check completed and we stored its record (last-check.ts).
//     With no stored snapshot we use LIVE readiness counts and say NO time at all — never a time we
//     didn't measure. The old tag row (`Last check` vs `Checks`) was carrying that distinction; the
//     sentence now carries it itself, in words, which is strictly clearer than a label.
//   - UNMEASURED IS NEVER COUNTED AS CLEAN. The old clean line printed `measured/total` and stopped,
//     so 14/16 with two unreadable checks rendered identically to two FAILING checks. The partial
//     variants below say which is which. This is a straight honesty upgrade, not a copy change.
//
// The check→fix hallway (2026-08-06): when the line reports a non-zero fix count it also carries the
// route to those fixes — a text link, not a rival button, so "one primary action" still holds. A
// named flag with no way to act on it is the dead-end this app exists to avoid.

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
  onSeeInFix,
  fixRoomLabel,
}: {
  readiness: GameReadiness | null;
  checking: boolean;
  onRunCheck: () => void;
  /** Route to the fixes themselves. A count with no way to act on it is a dead-end flag. */
  onSeeInFix?: () => void;
  fixRoomLabel?: string;
}) {
  const { t } = useTranslation();
  // FULL LITERAL KEYS, never a `k("clean")` shorthand. src/affordance-census.test.ts finds the copy a
  // surface reaches by scanning for literal t("...") arguments, so a computed key makes every control
  // in this file INVISIBLE to the census — the first draft used a helper and the census duly reported
  // Home and the shell as having each lost eleven affordances. Blinding a guard to save keystrokes is
  // strictly worse than the keystrokes are expensive.
  const snap = checking ? null : readLastCheck();

  let sentence: string;
  let warn = false;

  if (checking) {
    sentence = t("optimize.rerunCheckBand.checking");
  } else if (snap) {
    warn = snap.fixCount > 0;
    const age = formatCheckAge(snap.at, Date.now(), t);
    const unknown = Math.max(0, snap.total - snap.green - snap.fixCount);
    sentence = warn
      ? t("optimize.rerunCheckBand.lastFlagged", { age, count: snap.fixCount })
      : unknown > 0
        ? t("optimize.rerunCheckBand.lastCleanPartial", {
            age,
            green: snap.green,
            total: snap.total,
            unknown,
          })
        : t("optimize.rerunCheckBand.lastClean", { age, count: snap.total });
  } else {
    // Fallback: no stored snapshot yet — LIVE counts, NO age.
    const total = readiness?.checks.length ?? 0;
    const unknown = readiness?.unknown_count ?? 0;
    const measured = total - unknown;
    const attention = readiness?.attention_count ?? 0;
    warn = attention > 0;
    sentence = warn
      ? t("optimize.rerunCheckBand.flagged", { count: attention, total })
      : unknown > 0
        ? t("optimize.rerunCheckBand.cleanPartial", { measured, total, unknown })
        : t("optimize.rerunCheckBand.clean", { count: total });
  }

  return (
    <div className="rcb">
      <span
        className={`rcb-dot${warn ? " rcb-dot-warn" : ""}${checking ? " rcb-dot-scan" : ""}`}
        aria-hidden="true"
      />
      <p className="rcb-status">
        {sentence}
        {/* A count is only honest if it goes somewhere: the flag names its own fix inline.
            A text LINK, never a second button — Home keeps ONE primary action. */}
        {warn && onSeeInFix ? (
          <button type="button" className="rcb-fix" onClick={onSeeInFix}>
            {t("optimize.rerunCheckBand.fixLink", { room: fixRoomLabel })}
            <span aria-hidden="true"> →</span>
          </button>
        ) : null}
      </p>
      <button type="button" className="rcb-btn" onClick={onRunCheck} disabled={checking}>
        <span className="rcb-ic">{REFRESH_ICON}</span>
        {checking
          ? t("optimize.rerunCheckBand.checkingButton")
          : t("optimize.rerunCheckBand.rerunButton")}
      </button>
    </div>
  );
}
