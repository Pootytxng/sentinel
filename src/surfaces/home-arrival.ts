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

export function markInterviewArrival(finding: InterviewFindingId): void {
  try {
    localStorage.setItem(INTERVIEW_ARRIVAL_KEY, finding);
  } catch {
    /* no storage: the user still lands on Home, where the interview's own door is */
  }
  try {
    window.dispatchEvent(new Event(INTERVIEW_ARRIVAL_EVENT));
  } catch {
    /* no window event support: the mount-time read still catches a fresh Home */
  }
}

export function takeInterviewArrival(): InterviewFindingId | null {
  try {
    const v = localStorage.getItem(INTERVIEW_ARRIVAL_KEY);
    if (v != null) localStorage.removeItem(INTERVIEW_ARRIVAL_KEY);
    return v != null && (INTERVIEW_FINDINGS as string[]).includes(v) ? (v as InterviewFindingId) : null;
  } catch {
    return null;
  }
}
