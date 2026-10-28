// P6-stutter: what the user came to the Care view with. One-shot: the interview's stutter answer
// writes it right before it opens the view, and the view's stutter comparison (StutterCompare.tsx)
// reads and clears it on mount, so a later visit starts clean. Its own key, beside the station and
// incident keys (App.tsx openLabStation), rather than folded into either of them.
export const CARE_ARRIVAL_KEY = "compy_care_arrival";

export function markStutterArrival(): void {
  try {
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
  } catch {
    /* no storage: the user still lands on the view and can press its button */
  }
}

/** Reads without clearing: the Care view uses it to put the stutter answer first, while
 *  StutterCompare still takes (and clears) the flag on its own mount. */
export function peekStutterArrival(): boolean {
  try {
    return localStorage.getItem(CARE_ARRIVAL_KEY) === "stutter";
  } catch {
    return false;
  }
}

export function takeStutterArrival(): boolean {
  try {
    const v = localStorage.getItem(CARE_ARRIVAL_KEY);
    if (v) localStorage.removeItem(CARE_ARRIVAL_KEY);
    return v === "stutter";
  } catch {
    return false;
  }
}
