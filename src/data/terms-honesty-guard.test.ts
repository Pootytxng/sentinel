// Honesty regression guard for the knowledge-term corpus (src/data/terms.json).
//
// The Learn term explainers are part of Compy's honesty differentiator — every claim must be
// FACTUAL, never fabricated (Compy's cardinal sin). The 2026-06-25 new-Learn-entry audit caught a
// factual error in `rapid-trigger` (ledger docs/HONESTY_AUDIT_TWEAKS.md) and fixed it. This guard
// PINS that fix so a future edit can't silently re-introduce the falsehood — bug -> guard
// ([[bug-becomes-guard]]). It is the terms.json sibling of tweak-honesty-guard.test.ts and is
// intentionally surgical: it tests only the specific repaired claim, by entry id, so it won't fight
// ordinary rewording of unrelated prose.
//
// NOTE on scope vs the content lane's knowledge-keyboard.test.ts: that guard pins the *durable*
// anti-cheat-aware property (Snap Tap / SOCD is mentioned alongside ban/restrict/rules). It does NOT
// pin which games banned it — so the text could regress to the original "...banned in major games
// such as Counter-Strike 2 and Valorant" and still pass it (both generic words remain present).
// This guard closes exactly that hole: it pins that Valorant is framed as a game that CURRENTLY
// ALLOWS Snap Tap / SOCD, not one that banned it.
//
// If a future, correctly-sourced edit ever NEEDS to change the framing (e.g. Riot actually bans it
// in Valorant later), that's a conscious change — update the matching assertion here in the same
// commit, with the source, rather than deleting the guard.

import { describe, it, expect } from "vitest";
import rawTerms from "./terms.json";

type Term = { id: string; what?: string; more?: string };
const TERMS = rawTerms as Term[];
const bodyOf = (id: string): string => {
  const e = TERMS.find((t) => t.id === id);
  if (!e) throw new Error(`term "${id}" not found — corpus changed; update this honesty guard`);
  return `${e.what ?? ""} ${e.more ?? ""}`.toLowerCase();
};

describe("knowledge-term corpus — honesty regression guard (2026-06-25 audit fixes)", () => {
  // FIX — rapid-trigger: the text once stated Snap Tap / SOCD "has been banned in major games such
  // as Counter-Strike 2 and Valorant." The Valorant half is FALSE — Valve banned it in CS2 (Aug
  // 2024) but Riot's VCT rules explicitly PERMIT Snap Tap / SOCD in Valorant (VCT §2.3.5). The fix
  // reworded it to contrast Valorant as a game that currently allows it. Pin the corrected claim.
  it("rapid-trigger does NOT list Valorant among games that banned Snap Tap / SOCD", () => {
    const body = bodyOf("rapid-trigger");
    // The corrected fact (non-no-op): where Valorant is mentioned it is framed as ALLOWING / PERMITTING
    // it. The pre-fix text named Valorant in the banned list with no allow/permit framing, so it fails
    // this assertion — a regression to that falsehood cannot land green.
    expect(body, "Valorant currently permits Snap Tap/SOCD — it must not be listed as banning it").toMatch(
      /valorant[^.]*\b(allow|permit)/,
    );
    // The TRUE, sourced contrast partner stays named: Counter-Strike 2 is the title that DID ban it,
    // so the nuance can't be gutted down to a vague "some games ban it" that drops the distinction.
    expect(body, "CS2 is the title that actually banned it — keep it named").toMatch(/counter-?strike 2|cs2/);
  });
});
