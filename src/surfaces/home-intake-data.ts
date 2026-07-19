// Home intake band — the pure taxonomy behind the pre-room intent router (BACKLOG:916). Lifts the
// proven Lab "What are you here to do?" symptom→station idiom UP one level to Home: same shape, but
// each row routes to a ROOM (Monitor / Blackbook / Lab) instead of an in-Lab station. Pure data +
// copy only — no DOM, no state. HomeConsole filters these rows to the rooms the live rail actually
// renders (a row must never point at a room that isn't there — no dead ends), and resolves the room
// LABEL live from that rail rather than hardcoding it here (the because-line names the room's
// ACTION, never its name, so this file can never drift against a rail relabel).

// The room routing key = the persisted nav id the app-shell/Dock route through (homeRail.ts).
// Under the live flags (labGround default ON) the rendered rooms are play=Monitor, learn=Blackbook,
// lab=Lab; these three are the only intent-row targets.
export type HomeIntakeRoom = "play" | "learn" | "lab";

export type HomeIntakeRow = {
  symptom: string; // the user's own felt words — what they'd say out loud
  room: HomeIntakeRoom; // where that intent lives
  because: string; // plain-English why THAT room — names the action, never the room label
};

// The intent rows (option A). Symptom-first, one room each, honest because-line. Order: the two
// single-room intents (Monitor, Blackbook) then the three Lab diagnostics — the user scans by their
// own symptom, not by destination, so several routing to the Lab reads fine (that's where those
// three distinct instruments genuinely live). Filtered live by the rendered rail before display.
export const HOME_INTAKE_ROWS: HomeIntakeRow[] = [
  {
    symptom: "How did my last gaming session actually go?",
    room: "play",
    because: "reads back your session debrief — fps, stutters, and what changed",
  },
  {
    symptom: "I want to understand a setting before I touch it",
    room: "learn",
    because: "explains what actually works, measured — before you change a thing",
  },
  {
    symptom: "Did a change actually help — or did I imagine it?",
    room: "lab",
    because: "grades a real before/after against the noise floor — proof, not vibes",
  },
  {
    symptom: "It runs hot, loud, or a beat behind",
    room: "lab",
    because: "measures heat, noise, and mouse-to-screen delay on your actual rig",
  },
  {
    symptom: "It crashed or froze and I don't know why",
    room: "lab",
    because: "reads Windows' own crash & freeze record in plain English",
  },
];

// The one-click fast path (option C — the always-available hands-free "just make it faster, safely"
// button). Static copy; the count-bearing lines are built with proper singular/plural in the
// component (never "(s)" — the plain-language bar). Reuses the audited batch-apply primitive, so it
// applies ONLY the safe-tier, one-tap, not-yet-applied, not-drifted stack (safeFixesReadyList) —
// the SAME set the Optimize verdict counts, never a broader one.
export const HOME_INTAKE_FASTPATH = {
  symptom: "I just want my PC faster — safely, no fiddling",
  // Shown while the catalog hasn't resolved yet (recs === null) — no button on a placeholder.
  loading: "Checking what's safe to change…",
  // Shown when the safe stack is empty — honest, never invents work to look busy.
  allClear: "Every safe tweak is already on — your rig is set. Nothing to do here.",
  // The rollback-first law, stated plainly, standing under the button (not trapped in a dialog).
  reversible: "Every apply captures its undo first — roll anything back from Applied.",
};

// The ready headline for the fast path — honest singular/plural, no "(s)".
export function fastPathReadyHeadline(n: number): string {
  return n === 1
    ? "1 safe tweak is ready — one tap does it."
    : `${n} safe tweaks are ready — one tap does them all.`;
}

// The apply-button label — honest singular/plural.
export function fastPathApplyLabel(n: number): string {
  return n === 1 ? "Apply 1 safe tweak · one tap" : `Apply ${n} safe tweaks · one tap`;
}

// The post-apply receipt line, from the REAL batch result (applied count + skipped count). Honest:
// names what landed AND what didn't, never rounds a skip up into a win.
export function fastPathAppliedNote(applied: number, skipped: number): string {
  const appliedPart =
    applied === 1 ? "Applied 1 safe tweak" : `Applied ${applied} safe tweaks`;
  if (skipped === 0) return `${appliedPart} — all reversible from Applied.`;
  const skippedPart = skipped === 1 ? "1 was skipped" : `${skipped} were skipped`;
  return `${appliedPart} · ${skippedPart} — all reversible from Applied.`;
}
