// Home intake band — the pure taxonomy behind the pre-room intent router (BACKLOG:916). Lifts the
// proven Lab "What are you here to do?" symptom→station idiom UP one level to Home: same shape, but
// each row routes to a ROOM (Monitor / Blackbook / Lab) instead of an in-Lab station. Pure data +
// copy only — no DOM, no state. HomeConsole filters these rows to the rooms the live rail actually
// renders (a row must never point at a room that isn't there — no dead ends), and resolves the room
// LABEL live from that rail rather than hardcoding it here (the because-line names the room's
// ACTION, never its name, so this file can never drift against a rail relabel).
//
// i18n note: this is a plain data module, not a component — it can't call useTranslation() itself.
// Every export below takes `t: TFunction` as its LAST parameter (mirrors ago()/smoothness()
// elsewhere in this codebase); HomeConsole passes its own `t` from useTranslation() at each call.

import type { TFunction } from "i18next";
import type { LabStationKey } from "./lab-guided-data";

// The room routing key = the persisted nav id the app-shell/Dock route through (homeRail.ts).
// Under the live flags (labGround default ON) the rendered rooms are play=Monitor, learn=Blackbook,
// lab=Lab; these three are the only intent-row targets.
export type HomeIntakeRoom = "play" | "learn" | "lab";

export type HomeIntakeRow = {
  symptom: string; // the user's own felt words — what they'd say out loud
  room: HomeIntakeRoom; // where that intent lives
  because: string; // plain-English why THAT room — names the action, never the room label
  // Optional in-room destination. A room that answers the symptom with ONE instrument should hand
  // the user that instrument, not the room's dock — landing on the dock after naming the symptom is
  // the same dead end the check->fix hallway closed (post-check-lab-route-guard). When present,
  // HomeConsole routes through App's single station-intent writer instead of a bare room nav.
  station?: LabStationKey;
};

// The intent rows (option A). Symptom-first, one room each, honest because-line. Order: the two
// single-room intents (Monitor, Blackbook) then the three Lab diagnostics — the user scans by their
// own symptom, not by destination, so several routing to the Lab reads fine (that's where those
// three distinct instruments genuinely live). Filtered live by the rendered rail before display.
export function homeIntakeRows(t: TFunction): HomeIntakeRow[] {
  return [
    {
      symptom: t("home.homeConsole.intake.rows.lastSession.symptom"),
      room: "play",
      because: t("home.homeConsole.intake.rows.lastSession.because"),
    },
    {
      symptom: t("home.homeConsole.intake.rows.understandSetting.symptom"),
      room: "learn",
      because: t("home.homeConsole.intake.rows.understandSetting.because"),
    },
    {
      symptom: t("home.homeConsole.intake.rows.changeHelped.symptom"),
      room: "lab",
      because: t("home.homeConsole.intake.rows.changeHelped.because"),
    },
    {
      symptom: t("home.homeConsole.intake.rows.hotLoudBehind.symptom"),
      room: "lab",
      because: t("home.homeConsole.intake.rows.hotLoudBehind.because"),
    },
  ];
}

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

// The one-click fast path (option C — the always-available hands-free "just make it faster, safely"
// button). Static copy; the count-bearing lines are built with proper singular/plural in the
// component (never "(s)" — the plain-language bar). Reuses the audited batch-apply primitive, so it
// applies ONLY the safe-tier, one-tap, not-yet-applied, not-drifted stack (safeFixesReadyList) —
// the SAME set the Optimize verdict counts, never a broader one.
export function homeIntakeFastpath(t: TFunction): {
  symptom: string;
  loading: string;
  allClear: string;
  reversible: string;
} {
  return {
    symptom: t("home.homeConsole.intake.fastpath.symptom"),
    // Shown while the catalog hasn't resolved yet (recs === null) — no button on a placeholder.
    loading: t("home.homeConsole.intake.fastpath.loading"),
    // Shown when the safe stack is empty — honest, never invents work to look busy.
    allClear: t("home.homeConsole.intake.fastpath.allClear"),
    // The rollback-first law, stated plainly, standing under the button (not trapped in a dialog).
    reversible: t("home.homeConsole.intake.fastpath.reversible"),
  };
}

// The ready headline for the fast path — honest singular/plural, no "(s)".
export function fastPathReadyHeadline(n: number, t: TFunction): string {
  return t("home.homeConsole.intake.fastpath.ready", { count: n });
}

// The apply-button label — honest singular/plural.
export function fastPathApplyLabel(n: number, t: TFunction): string {
  return t("home.homeConsole.intake.fastpath.apply", { count: n });
}

// The post-apply receipt line, from the REAL batch result (applied count + skipped count). Honest:
// names what landed AND what didn't, never rounds a skip up into a win.
export function fastPathAppliedNote(applied: number, skipped: number, t: TFunction): string {
  const appliedPart = t("home.homeConsole.intake.fastpath.appliedPart", { count: applied });
  if (skipped === 0)
    return t("home.homeConsole.intake.fastpath.appliedAllReversible", { appliedPart });
  const skippedPart = t("home.homeConsole.intake.fastpath.skippedPart", { count: skipped });
  return t("home.homeConsole.intake.fastpath.appliedWithSkipped", { appliedPart, skippedPart });
}
