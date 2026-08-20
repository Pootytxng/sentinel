// What is LEFT of the Home intake band (BACKLOG:916) after the interview replaced it on 2026-08-20
// (design foundation step 3, issue #177). The band's rows, its panel, its fast-path state machine
// and its flag are deleted; the successor is home-interview-data.ts + HomeInterview.tsx.
//
// Three things stayed behind because they were never really the band's:
//   - `HomeIntakeRoom` — the room routing key, now the vocabulary the interview routes in too.
//   - `homeCareEntry` — the always-visible crash-rescue door (issue #91). It was extracted from
//     the band on 2026-08-12 precisely so it would outlive the band's flag, and it just did.
//   - the fast-path copy helpers — still the wording of the one-tap safe stack, which the
//     interview now offers from its sweep finding and the confirm dialog still quotes, including
//     the honest applied/skipped receipt (J, 2026-07-22).
//
// The file keeps its name on purpose: renaming it would rewrite every import in a diff that is
// already large, for no reader's benefit. The comment is the truth, not the filename.
//
// i18n note: this is a plain data module, not a component — it can't call useTranslation() itself.
// Every export below takes `t: TFunction` as its LAST parameter (mirrors ago()/smoothness()
// elsewhere in this codebase); the caller passes its own `t` from useTranslation().

import type { TFunction } from "i18next";
import type { LabStationKey } from "./lab-guided-data";

// The room routing key = the persisted nav id the app-shell/Dock route through (homeRail.ts).
// Under the live flags (labGround default ON) the rendered rooms are play=Monitor, learn=Blackbook,
// lab=Lab; these three are the only routing targets the interview and the Care entry may name.
export type HomeIntakeRoom = "play" | "learn" | "lab";


// ── The Care entry (Compy Care Tier 1, issue #91 — the VISIBLE half) ────────────────────────────
// Discovery contract (docs/BACKLOG.md §Discovery contract, owner-approved 2026-08-09): a compact
// Care entry is ALWAYS visible on Home, independent of the broad `compy_home_intake` band —
// whatever that band's default happens to be. (The contract's own wording assumed the band was
// default-off; it graduated to default-ON on 2026-08-11, which changes nothing about this entry:
// "independent" is the load-bearing word, not the default.) So this is NOT an intake row.
// It lived as one (`crashedFroze`) from 2026-08-09
// until 2026-08-12, which meant the single affordance a crashing user needs inherited the intake
// band's flag — a user who turned the band off in Settings lost crash rescue with it, and that is
// precisely the population most likely to have turned a busy band off.
//
// It is extracted here, rendered outside the band's gate, and REMOVED from homeIntakeRows above:
// two doors to one station on one screen is the duplication rubric 3 exists to catch.
//
// Copy: the symptom + because keys are the SAME ones the row used — the words were never the
// problem (the tester's problem was the station's NAME, fixed separately), and reusing them keeps
// the affordance census's reachable-key set a superset rather than a re-record.
//
// NOT built here, deliberately: the optional exact-incident deep-link the plan (Task 8) describes.
// Nothing produces an incident ID until the dark half of Tier 1 exists, and a parameter no caller
// can fill is capability before need. It arrives with its producer.
export type HomeCareEntry = {
  /** The entry's own name — the sign a crashing user is scanning for. */
  label: string;
  /** The user's own felt words. */
  symptom: string;
  /** What the destination actually does — names the action, never the room. */
  because: string;
  /** The room the station lives in (used only as the no-station-writer fallback). */
  room: HomeIntakeRoom;
  /** The in-room instrument this lands ON. */
  station: LabStationKey;
};

export function homeCareEntry(t: TFunction): HomeCareEntry {
  return {
    label: t("home.homeConsole.care.label"),
    symptom: t("home.homeConsole.intake.rows.crashedFroze.symptom"),
    because: t("home.homeConsole.intake.rows.crashedFroze.because"),
    room: "lab",
    station: "blackbox",
  };
}

// The ready headline for the fast path — honest singular/plural, no "(s)".
export function fastPathReadyHeadline(n: number, t: TFunction): string {
  return t("home.homeConsole.intake.fastpath.ready", { count: n });
}

// The receipt line. J (2026-07-22): a fast path that reports only a COUNT is a dead end — the
// batch primitive returns title+reason per skip, and throwing that away is what made "1 safe tweak
// not applied" unanswerable. This composes the honest sentence; the WHICH and WHY ride alongside it
// in the disclosure the caller renders. Guarded by fastpath-skipped-detail-guard.test.ts.
export function fastPathAppliedNote(applied: number, skipped: number, t: TFunction): string {
  const appliedPart = t("home.homeConsole.intake.fastpath.appliedPart", { count: applied });
  if (skipped === 0)
    return t("home.homeConsole.intake.fastpath.appliedAllReversible", { appliedPart });
  const skippedPart = t("home.homeConsole.intake.fastpath.skippedPart", { count: skipped });
  return t("home.homeConsole.intake.fastpath.appliedWithSkipped", { appliedPart, skippedPart });
}

// The apply-button label — honest singular/plural.
export function fastPathApplyLabel(n: number, t: TFunction): string {
  return t("home.homeConsole.intake.fastpath.apply", { count: n });
}
