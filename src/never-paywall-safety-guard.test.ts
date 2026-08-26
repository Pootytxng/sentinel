import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { proStateFrom, showsProFeature } from "./data/pro";

/* #195 §5 — "never paywall safety" becomes a guard, not a paragraph.
 *
 * The rule is written in three places already (RECEIPTS_DOCTRINE, the header of `data/pro.ts`, the
 * header of `ProGate.tsx`) and enforced by none of them. Prose is the weakest tier: a future
 * session adding a Pro gate reads the component, not the doctrine, and the component's own comment
 * is the thing it is about to contradict. So this file asserts the rule mechanically.
 *
 * WHAT "SAFETY" MEANS HERE, derived rather than listed: any frontend file that touches the
 * mutation / rollback / snapshot / Trust Ledger IPC surface. Deriving it means a NEW safety surface
 * is covered the day it is written, without anyone remembering to add it to a list.
 *
 * NOTE ON TODAY'S RUNTIME. Licensing is dark — `armed` is false, so `showsProFeature` returns true
 * for everyone and no gate anywhere locks. That is exactly why a guard is needed rather than a
 * test of behaviour: the paywall bug this prevents is invisible until the day the owner arms
 * licensing, which is the worst possible day to discover it.
 */

// Relative to the repo root, the way every other static guard in this suite reads the tree — the
// vitest tsconfig has no `node` types, so `__dirname` is not available here.
const SRC = "src";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments are stripped for the PRO half and kept for the SAFETY half, and the asymmetry is the
 *  whole point.
 *
 *  Pro usage is a fact about CODE: `Play.tsx` explains in prose why `SessionTrends` is gated
 *  without gating anything itself, and flagging it would make the allowlist a list of files that
 *  mention a word.
 *
 *  Safety membership is the opposite. Most of these surfaces do not `invoke("rollback_change")`
 *  directly — they route through a helper and NAME the command in a comment explaining what the
 *  screen is for. Stripping comments there shrank the derived surface from 14 files to 3 and the
 *  guard passed anyway; it was caught only because the falsification run failed to fail. Prose
 *  about rollback is exactly as good a signal that a file is on the undo path as an invoke is. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const FILES = walk(SRC).map((p) => {
  const raw = readFileSync(p, "utf8");
  return { path: p.slice(SRC.length + 1).replace(/[\\/]+/g, "/"), raw, code: strip(raw) };
});

/** The Windows-mutation / rollback / ledger IPC surface, as named on the Rust side. */
const SAFETY_IPC =
  /apply_recommendation|rollback_change|get_applied_changes|dispatch_rollback|resolve_rollback|start_gaming_session|stop_gaming_session|recover_orphan|set_startup_entry_enabled|apply_startup_entry_enabled/;

const USES_PRO = /\bProGate\b|\busePro\b|\bshowsProFeature\b|\bproStateFrom\b/;

describe("#195 §5 — safety is never behind Pro", () => {
  const safety = FILES.filter((f) => SAFETY_IPC.test(f.raw));

  it("finds a real safety surface to guard (the derivation is not silently empty)", () => {
    // 15 files on 2026-08-26 (14 + FirstWin.tsx, which offers the undo on a user's first live
    // change and so is squarely on the path this rule protects). Held near the real number, not at
    // a token 1, because the failure this catches is a derivation that quietly stops matching and
    // lets the guard pass on nothing. A NEW file here is expected to raise this number — the count
    // is a non-vacuity floor, not a cap on how much of the app may be safety-critical.
    expect(
      safety.map((f) => f.path),
      "the mutation/rollback surface shrank — either a refactor renamed the commands (update SAFETY_IPC) or the match is broken",
    ).toHaveLength(15);
  });

  it("no file that applies, rolls back, or reads the Trust Ledger touches the Pro gate", () => {
    const offenders = safety.filter((f) => USES_PRO.test(f.code)).map((f) => f.path);
    expect(
      offenders,
      "a paywall on the undo path would strand a user mid-change — see RECEIPTS_DOCTRINE 'never paywall safety'",
    ).toEqual([]);
  });

  it("keeps the Pro gate to a named, reviewed set of additive features", () => {
    // Not a style rule. Every entry here is a claim that the feature is PURELY ADDITIVE — removing
    // it leaves the app safe, honest and able to undo everything it did. Adding a line means
    // making that claim deliberately, in the file that states the rule.
    const ADDITIVE = ["data/pro.ts", "surfaces/ProGate.tsx", "surfaces/SessionTrends.tsx"];
    const users = FILES.filter((f) => USES_PRO.test(f.code)).map((f) => f.path).sort();
    expect(users).toEqual([...ADDITIVE].sort());
  });
});

describe("#195 §3 — the gate fails OPEN, so an accidental gate is harmless", () => {
  it("renders in full before the license status has loaded", () => {
    expect(showsProFeature(proStateFrom(null))).toBe(true);
  });

  it("renders in full while licensing is disarmed — the shipped default", () => {
    const dark = proStateFrom({ valid: false, tier: "free", armed: false, reason: "disarmed" } as never);
    expect(dark.armed).toBe(false);
    expect(showsProFeature(dark)).toBe(true);
  });

  it("FALSIFICATION: a fail-CLOSED gate would lock the dark default, and this file would say so", () => {
    const failClosed = (s: ReturnType<typeof proStateFrom>) => s.ready && s.isPro;
    expect(failClosed(proStateFrom(null))).toBe(false);
    expect(showsProFeature(proStateFrom(null))).toBe(true);
  });
});
