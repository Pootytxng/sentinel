// Compy Pro — model-agnostic gating plumbing (the "rest of licensing" mechanism). Pairs with
// license.rs + LicensePanel. DARK by construction: while licensing is disarmed (the shipped default),
// `armed` is false and every Pro-gated feature renders in FULL — nothing is paywalled. Only when the
// owner arms licensing (real key) AND the user isn't Pro does a gate lock. Safety is NEVER gated — only
// wrap genuinely-additive features (history / multi-rig) per the ratified split.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LicenseStatus } from "../types";

export type ProState = {
  ready: boolean; // license status has loaded
  armed: boolean; // licensing is active (a real key is embedded) — false today (dark)
  isPro: boolean; // a valid Pro license is present
};

/** Pure: derive Pro state from a license status. `armed` is false while the backend reports
 *  "licensing not active" (the dark default), so gating stays INERT — everything is free. */
export function proStateFrom(status: LicenseStatus | null): ProState {
  if (!status) return { ready: false, armed: false, isPro: false };
  const armed = status.reason !== "licensing not active";
  const isPro = status.valid && status.tier === "pro";
  return { ready: true, armed, isPro };
}

/** Should a Pro-gated feature render in FULL? Yes while still loading or licensing is disarmed (free for
 *  everyone today), yes if the user is Pro; locked ONLY when armed + not Pro. Never paywalls by accident. */
export function showsProFeature(s: ProState): boolean {
  return !s.ready || !s.armed || s.isPro;
}

export function usePro(): ProState {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  useEffect(() => {
    invoke<LicenseStatus>("get_license_status")
      .then(setStatus)
      .catch(() => {});
  }, []);
  return proStateFrom(status);
}
