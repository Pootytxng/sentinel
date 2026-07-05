import { useState } from "react";

// A5 applicability override ("My hardware supports this") — the user's deliberate, reversible
// assertion that Compy's hardware READ was wrong for a capability-gated rec (e.g. a dock's wired
// NIC the probe missed). Mirrors dismissed.ts exactly: a PREFERENCE, not a receipt — frontend
// localStorage durability, zero IPC. Scope is honest by construction: only capability-gated recs
// ever reach the "Not for this rig" pile (relevance-gated recs are omitted by the backend and
// can't be overridden), and an overridden rec applies through the SAME audited apply/rollback
// path with the same snapshot + ledger receipt — the override changes which list a rec sits in,
// never what an apply does. "Set aside again" is always offered.
const OVERRIDE_KEY = "compy_eligibility_overrides";

function read(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function persist(s: Set<string>): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify([...s]));
  } catch {
    /* localStorage unavailable — degrade to in-memory only for this session */
  }
}

export function useEligibilityOverrides() {
  const [overridden, setOverridden] = useState<Set<string>>(read);
  const override = (id: string) =>
    setOverridden((prev) => {
      const next = new Set(prev);
      next.add(id);
      persist(next);
      return next;
    });
  const clearOverride = (id: string) =>
    setOverridden((prev) => {
      const next = new Set(prev);
      next.delete(id);
      persist(next);
      return next;
    });
  return { overridden, override, clearOverride };
}
