// Single source of truth for the three evidence/provenance tiers' user-facing wording — so the
// chip LABEL and the honesty NOTE can never drift across surfaces (the Fix row, the Home limiter,
// and the "Details ›" action-details sheet all read from here).
//
// Mirrors the Rust Provenance enum doc in src-tauri/src/recommendations.rs: "Verified" means Compy
// directly observes the FACT the rec claims (current vs max refresh, free disk space, driver age) —
// the claim IS the measurement, NOT a benchmarked performance gain. Honesty doctrine (LOCKED rule):
// never imply a gain Compy never measured.

import i18n from "../i18n";

export type Provenance = "verified" | "measured-signal" | "expected-impact";

// D4: the chip label's i18n key (common.provenance.*; en text: Verified / Measured elsewhere /
// Not measured on your PC, the last was "Expected" until e5b), so a zh-CN screen shows Chinese.
const PROVENANCE_LABEL_KEY: Record<Provenance, string> = {
  verified: "common.provenance.verified",
  "measured-signal": "common.provenance.measuredSignal",
  "expected-impact": "common.provenance.expectedImpact",
};

/** The chip label in the current language (reads the raw i18n instance, like `restoresCopy`, so
 *  plain helpers such as `slimProofLine` can call it; a component that renders it re-renders on a
 *  language change through its own `useTranslation`). */
export function provenanceLabel(p: Provenance): string {
  return i18n.t(PROVENANCE_LABEL_KEY[p]);
}

// The chip label. Verified / Measured elsewhere / Expected — identical on every surface. Each entry
// is read at ACCESS time (a getter), so it is always in the current language; never copy a value into
// a module-level constant.
export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = Object.freeze({
  get verified() {
    return provenanceLabel("verified");
  },
  get "measured-signal"() {
    return provenanceLabel("measured-signal");
  },
  get "expected-impact"() {
    return provenanceLabel("expected-impact");
  },
});

// The plain-English evidence note shown in the action-details sheet. "Verified" describes the FACT
// and is careful to call the performance feel EXPECTED, not benchmarked — Compy measured the value,
// never a per-rig gain.
export const PROVENANCE_NOTE: Record<Provenance, string> = {
  verified:
    "Compy reads this directly on your PC — the claim is the measurement (your current vs max refresh, free space, driver age). The smoother feel is expected, not benchmarked here.",
  "measured-signal": "Backed by third-party / community measurement.",
  "expected-impact": "Sound from how Windows works — not yet benchmarked here.",
};
