import { useState } from "react";

// User dismissal ("Not for me", eligibility train) — deliberate, reversible declines of advisory/
// applicable recs. PREFERENCES, not receipts: frontend localStorage is the right durability (survives
// restarts + the runtime-dir reinstall policy; ledger-grade persistence is NOT required). Zero IPC.
// Dismissal NEVER hides truth — the counts stay honest one tap away, and un-dismiss is always offered.
const DISMISSED_KEY = "compy_dismissed_recs";

function read(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function persist(s: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
  } catch {
    /* localStorage unavailable — degrade to in-memory only for this session */
  }
}

export function useDismissed() {
  const [dismissed, setDismissed] = useState<Set<string>>(read);
  const dismiss = (id: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      persist(next);
      return next;
    });
  const restore = (id: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      persist(next);
      return next;
    });
  return { dismissed, dismiss, restore };
}
