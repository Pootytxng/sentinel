// Compy Pro entitlements — DARK SCAFFOLD (R3 Lane E; doctrine Phase 5, lowest rank, built cheap).
// The gaming_mode gate pattern in TS: the tier model exists so future Pro surfaces have ONE
// vocabulary to gate on, but proGate() is HARD-FALSE (test-pinned) — every feature is free and
// runtime behavior is byte-identical to before this module existed. Nothing imports currentTier()
// for gating yet (by design: gating a surface is a future Phase 5 commit, not a side effect).
//
// The gate flips ONLY when ALL owner errands exist (doctrine §4 Phase 5): legal entity +
// merchant-of-record (Paddle-class) + a license verification design with its own security pass.
// The candidate Pro-surface inventory lives in docs/superpowers/AUTONOMOUS_SPRINT_2026-06-12-R3.md.

export type Tier = "free" | "pro";

/** HARD-FALSE until entity + merchant-of-record + license design exist (owner-signed flip). */
export function proGate(): boolean {
  return false;
}

/** The running tier. While the gate is down this is "free" for every install, always. */
export function currentTier(): Tier {
  return proGate() ? /* future: real license check */ "pro" : "free";
}

/** Would `tier` unlock a Pro-marked capability? The single future gating primitive. */
export function entitled(tier: Tier, requirement: Tier): boolean {
  return requirement === "free" || tier === "pro";
}
