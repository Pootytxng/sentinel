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
// THE BOX IS GONE TOO (2026-08-18, second pass). The 2026-08-18 pass below dissolved the PANEL but
// left a bordered, icon-bearing "Re-run check" button sitting at the far right of the row — and the
// owner had named that control by name, in the same breath as the panel, as "the exact clutter". A
// capture of the shipped build confirmed it: two of his three objections were fixed and this one was
// not. It is now a quiet text affordance in the same register as the fix link, separated by a middot.
// NOT DELETED, deliberately: this control is the ONLY entry point to <FirstCheck> (App.tsx
// `setShowFirstCheck`), the full-screen check with its own verdict and its own route into the Lab —
// Check.tsx's re-run is a different mechanism on a different surface. Removing the button would have
// stranded a whole flow to satisfy a look. Demoting it costs nothing and keeps the affordance
// reachable and named (src/affordance-census.test.ts still sees its literal t(...) key).
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
//   - NOR IS AN ADVISORY (desk review 2026-11-03). VRR, HDR or a RAM or Wi-Fi note is noted, not
//     graded, so it is left out of "look good" and "needs a look" alike and named after the
//     sentence, the way FirstCheck and Check say it; the readiness ring above counts the same way.
//
// The check→fix hallway (2026-08-06): when the line reports a non-zero fix count it also carries the
// route to those fixes — a text link, not a rival button, so "one primary action" still holds. A
// named flag with no way to act on it is the dead-end this app exists to avoid.


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
  let advisory = 0;
  let unread = 0;
  // Whether the sentence itself already names the unread checks (the partial-clean lines do).
  let unreadSaid = false;

  if (checking) {
    sentence = t("optimize.rerunCheckBand.checking");
  } else if (snap) {
    warn = snap.fixCount > 0;
    advisory = snap.advisory;
    unread = snap.unread;
    const age = formatCheckAge(snap.at, Date.now(), t);
    const noneGraded = Math.max(0, snap.total - snap.unread - snap.advisory) === 0;
    unreadSaid = !warn && unread > 0 && !noneGraded;
    sentence = warn
      ? t("optimize.rerunCheckBand.lastFlagged", { age, count: snap.fixCount })
      : noneGraded
        ? t("optimize.rerunCheckBand.lastNoneGraded", { age })
        : unread > 0
          ? t("optimize.rerunCheckBand.lastCleanPartial", {
              age,
              green: snap.green,
              total: snap.total,
              unknown: unread,
            })
          : t("optimize.rerunCheckBand.lastClean", { age, count: snap.green });
  } else {
    // Fallback: no stored snapshot yet — LIVE counts, NO age.
    const total = readiness?.checks.length ?? 0;
    unread = readiness?.unknown_count ?? 0;
    advisory = readiness?.advisory_count ?? 0;
    // Graded and read: the checks a "look good" or a "needs a look" can honestly be counted out of,
    // the readiness ring's own denominator (desk review 2026-11-03, third pass).
    const graded = Math.max(0, total - unread - advisory);
    const attention = readiness?.attention_count ?? 0;
    warn = attention > 0;
    unreadSaid = !warn && unread > 0 && graded > 0;
    // Nothing recorded and no readiness read: a check has not run, which is not the same as one that graded zero.
    const notRun = !readiness || readiness.checks.length === 0;
    sentence = warn
      ? t("optimize.rerunCheckBand.flagged", { count: attention, total: graded })
      : notRun
        ? t("optimize.rerunCheckBand.notRun")
        : graded === 0
          ? t("optimize.rerunCheckBand.noneGraded")
          : unread > 0
            ? t("optimize.rerunCheckBand.cleanPartial", { measured: graded, total, unknown: unread })
            : t("optimize.rerunCheckBand.clean", { count: graded });
  }
  // Every line says what it did not count: the unread checks (unless the sentence already did) and
  // the advisory ones, flagged or not.
  if (!checking) {
    if (unread > 0 && !unreadSaid)
      sentence += ` · ${t("optimize.rerunCheckBand.unreadNote", { count: unread })}`;
    if (advisory > 0) sentence += ` · ${t("optimize.rerunCheckBand.advisoryNote", { count: advisory })}`;
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
            A text LINK, never a button — Home keeps ONE primary action. */}
        {warn && onSeeInFix ? (
          <button type="button" className="rcb-fix" onClick={onSeeInFix}>
            {t("optimize.rerunCheckBand.fixLink", { room: fixRoomLabel })}
            <span aria-hidden="true"> →</span>
          </button>
        ) : null}
        <span className="rcb-sep" aria-hidden="true">
          {" · "}
        </span>
        <button type="button" className="rcb-run" onClick={onRunCheck} disabled={checking}>
          {checking
            ? t("optimize.rerunCheckBand.checkingButton")
            : t("optimize.rerunCheckBand.rerunButton")}
        </button>
      </p>
    </div>
  );
}
