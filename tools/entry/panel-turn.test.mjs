// Guard: one launch starts ONE session. The open-URI is a fallback, not the first move.
//
// Measured on this machine, 2026-07-31, journey 4 of the acceptance run (the cold start, from the
// Desktop shortcut with no editor window open):
//
//   09:52:25.923Z  a session claimed the launch token          -> lineage seenCount 1
//   09:52:26.750Z  a SECOND session verified on that lineage   -> lineage seenCount 2
//
// Two sessions, one claim, one worktree. One of the two died on an unrelated API error, which is the
// only reason it did not become two agents editing the same files under a single Work Control claim
// — the exact condition the claim protocol exists to prevent.
//
// The cause is not the hook and not the URI handler. VS Code restores the Claude panel a workspace
// had open, and a restored panel starts its own session: measured separately, `code <folder>` ALONE
// — no URI, nothing else — claimed a freshly minted token in 10s. So on every launch into a folder
// Kuya has used before, the workspace open already completes the handoff, and firing the open-URI
// into that same window opens a second panel on top of it.
//
// The fix is ordering, not suppression: the restored panel gets the first turn, and the URI is kept
// for the window that has no panel of its own to restore (a first-ever open, where nothing starts by
// itself and the URI is the whole mechanism). Both paths still end at the same nonce-checked proof.
//
// This reads the launcher's source because the ordering IS the fix, and a comment describing an
// order is not an order. The assertions are deliberately shape-level — which call comes first, and
// what the URI is conditional on — so that rewording the narration does not fail the guard, but
// moving the URI back ahead of the grace does.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, "..", "..", "compy-entry.ps1");

const lines = () => readFileSync(LAUNCHER, "utf8").split(/\r?\n/);

/** Every line that is code rather than commentary — the launcher explains itself at length. */
const code = () => lines().map((l, i) => ({ n: i + 1, text: l })).filter((l) => !/^\s*#/.test(l.text) && l.text.trim() !== "");

const handoffCalls = () => code().filter((l) => /\bcli\.mjs|\$Cli\b/.test(l.text) && /\bhandoff\b/.test(l.text));
const uriCalls = () => code().filter((l) => /Start-Process\s+\$OPEN_URI/.test(l.text));

describe("the panel that restores itself gets the first turn", () => {
  it("fires the open-URI exactly once", () => {
    // Twice would be two panels by construction, whatever the ordering around them says.
    expect(uriCalls()).toHaveLength(1);
  });

  it("waits for a session BEFORE asking the window for one", () => {
    const uri = uriCalls()[0];
    const before = handoffCalls().filter((l) => l.n < uri.n);
    expect(before.length).toBeGreaterThan(0);
  });

  it("only asks when that wait came back empty", () => {
    const uri = uriCalls()[0];
    const guard = code()
      .filter((l) => l.n < uri.n && /^\s*if\s*\(/.test(l.text))
      .pop();
    expect(guard, "the open-URI is unconditional — it fires even when a session already took the launch").toBeDefined();
    expect(guard.text).toMatch(/\$handoff\b/);
    expect(guard.text).toMatch(/-ne\s+0/);
    // Inside the block, not merely after it.
    expect(uri.text).toMatch(/^\s+\S/);
  });

  it("gives the restored panel a turn, not the whole budget", () => {
    const uri = uriCalls()[0];
    const ms = (l) => Number(/--timeout\s+(\d+)/.exec(l.text)?.[1] ?? NaN);
    const grace = ms(handoffCalls().filter((l) => l.n < uri.n).pop());
    const afterUri = handoffCalls().filter((l) => l.n > uri.n).map(ms);

    // A grace long enough to cover the 10s measured above, with margin, and short enough that a
    // first-ever open — where nothing restores — is not left staring at a blank window.
    expect(grace).toBeGreaterThanOrEqual(12000);
    expect(grace).toBeLessThanOrEqual(20000);
    expect(afterUri.length).toBeGreaterThan(0);
    for (const t of afterUri) expect(t).toBeGreaterThan(grace);
  });
});
