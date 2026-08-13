// Single source of truth for the three evidence/provenance tiers' user-facing wording — so the
// chip LABEL and the honesty NOTE can never drift across surfaces (the Fix row, the Home limiter,
// and the "Details ›" action-details sheet all read from here).
//
// Mirrors the Rust Provenance enum doc in src-tauri/src/recommendations.rs: "Verified" means Compy
// directly observes the FACT the rec claims (current vs max refresh, free disk space, driver age) —
// the claim IS the measurement, NOT a benchmarked performance gain. Honesty doctrine (LOCKED rule):
// never imply a gain Compy never measured.

export type Provenance = "verified" | "measured-signal" | "expected-impact";

// The one-word chip label. Verified / Measured / Expected — identical on every surface.
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: "Verified",
  "measured-signal": "Measured",
  "expected-impact": "Expected",
};

// The plain-English evidence note shown in the action-details sheet. "Verified" describes the FACT
// and is careful to call the performance feel EXPECTED, not benchmarked — Compy measured the value,
// never a per-rig gain.
export const PROVENANCE_NOTE: Record<Provenance, string> = {
  verified:
    "Compy reads this directly on your PC — the claim is the measurement (your current vs max refresh, free space, driver age). The smoother feel is expected, not benchmarked here.",
  "measured-signal": "Backed by third-party / community measurement.",
  "expected-impact": "Sound from how Windows works — not yet benchmarked here.",
};
