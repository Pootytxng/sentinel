// P7-palette (ROADMAP P7 bullet 1, Constitution §27): what the user came to Home with — a plain
// problem typed into the command palette, which lands on the interview's finding card for it. Same
// one-shot pattern as care-arrival.ts and lab-arrival.ts: the palette writes the key right before
// it navigates, and the Home console reads and clears it. Two readers of one key would race, so
// there is one: HomeConsole, on mount AND on the `compy:interview-arrival` event the writer fires,
// because Home is often already mounted when the palette is used (the palette floats over any
// room). A later visit starts clean.
import { INTERVIEW_FINDINGS, type InterviewFindingId } from "./home-interview-data";

export const INTERVIEW_ARRIVAL_KEY = "compy_interview_arrival";
export const INTERVIEW_ARRIVAL_EVENT = "compy:interview-arrival";
/** An arrival older than this is not the one the user just typed (review r1: a key left behind
 *  while Home could not mount — no hardware yet, a flag flipped — must not open the sheet on some
 *  later visit). It is cleared and ignored. */
export const INTERVIEW_ARRIVAL_TTL_MS = 60_000;

export function markInterviewArrival(finding: InterviewFindingId, now: number = Date.now()): void {
  try {
    localStorage.setItem(INTERVIEW_ARRIVAL_KEY, JSON.stringify({ finding, at: now }));
  } catch {
    /* no storage: the user still lands on Home, where the interview's own door is */
  }
  try {
    window.dispatchEvent(new Event(INTERVIEW_ARRIVAL_EVENT));
  } catch {
    /* no window event support: the mount-time read still catches a fresh Home */
  }
}

export function takeInterviewArrival(now: number = Date.now()): InterviewFindingId | null {
  try {
    const v = localStorage.getItem(INTERVIEW_ARRIVAL_KEY);
    if (v == null) return null;
    localStorage.removeItem(INTERVIEW_ARRIVAL_KEY);
    const parsed = JSON.parse(v) as { finding?: unknown; at?: unknown };
    const { finding, at } = parsed ?? {};
    if (typeof finding !== "string" || !(INTERVIEW_FINDINGS as string[]).includes(finding)) return null;
    if (typeof at !== "number" || !Number.isFinite(at) || now - at > INTERVIEW_ARRIVAL_TTL_MS || at > now + 5_000)
      return null;
    return finding as InterviewFindingId;
  } catch {
    return null; // junk in the key: it was removed above, and nothing opens
  }
}
