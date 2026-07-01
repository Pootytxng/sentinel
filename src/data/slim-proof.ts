// The slim row's ONE always-visible proof line (P1 UI slim-down — honesty guardrail, council 🔴).
// Built ONLY from the rec's real fields: the provenance tier (the same word today's evidence chip
// renders, via the shared PROVENANCE_LABEL source of truth) + the rec's own impact/reason text +
// the rollback-first promise every appliable rec carries. Never fabricated (no invented numbers),
// never empty (the provenance tier + "reversible" stand even when a rec has no prose), never hidden
// behind the tap. Guarded by slim-row-proof-guard.test.tsx.

import { PROVENANCE_LABEL, type Provenance } from "./provenance";

export function slimProofLine(rec: {
  provenance: Provenance;
  impact?: string | null;
  description?: string | null;
}): string {
  // The same data today's evidence chip + reason line render — the measured/observed evidence text
  // when the rec has one, falling back to its plain reason. No new claims are minted here.
  const evidence = (rec.impact || rec.description || "").trim();
  const tier = PROVENANCE_LABEL[rec.provenance] ?? PROVENANCE_LABEL["expected-impact"];
  return [tier, evidence, "reversible"].filter(Boolean).join(" · ");
}
