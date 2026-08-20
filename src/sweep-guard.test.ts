import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — no @types/node. CSS is read from disk because vitest
// stubs CSS module imports, so import.meta.glob('?raw') comes back empty.)

// Kernel law (owner, 2026-06-06): the win card's earned shimmer is the ONLY celebratory sweep in the
// app. This guard makes it grep-provable. (Loading skeletons are opacity-pulses; the radar was a
// rotation and is gone; the legacy hero-sheen was removed.)
//
// 2026-08-20 — THE LAW HAD ONE IMPLEMENTATION AND IT WAS NEVER REACHABLE. `cmp-winshimmer` lived in
// `src/arc-instrument.css` on `.cmp-improved.arc-v2 .cmp-bar-after`, i.e. behind the `arcV2` prop —
// and no screen ever set that prop, so the celebration could not fire for any user, ever. The
// arc-v2 cleanup deleted the unreachable skin and the shimmer went with it. That is recorded here
// rather than papered over: the count is now ZERO, and re-homing it onto the live comparison card
// is a VISUAL change that owes its own build → install → self-review, not a side effect of a
// deletion. Open row in docs/BACKLOG.md.
function shimmerKeyframes(): string[] {
  const files = (readdirSync("src", { recursive: true }) as string[]).filter((f) =>
    f.endsWith(".css"),
  );
  const names = new Set<string>();
  for (const rel of files) {
    const css = readFileSync(join("src", rel), "utf8");
    for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]*(?:shimmer|sheen)[A-Za-z0-9_-]*)/gi)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

describe("kernel law: one celebratory sweep", () => {
  it("admits no sweep but the win card's — a second one is a new sweep, not a variant", () => {
    // The teeth of the law, unchanged and still absolute: whatever exists must be `cmp-winshimmer`.
    // A new shimmer/sheen anywhere in src/ fails here — convert it to a pulse.
    expect(shimmerKeyframes().filter((n) => n !== "cmp-winshimmer")).toEqual([]);
  });

  it("records that the celebration is currently UNBUILT, not merely unseen", () => {
    // Deliberately pinned to the real count so it cannot drift in either direction unnoticed:
    // re-home the shimmer and this fails, which is the prompt to update the BACKLOG row and put the
    // change through a visual review — the review it never got while it sat behind a dead prop.
    expect(
      shimmerKeyframes(),
      "the win-card shimmer is back in the tree. Good — but it is a user-visible animation that has " +
        "never been reviewed on a real build (it spent its whole life behind the unreachable arcV2 " +
        "prop). Update the shimmer row in docs/BACKLOG.md and put it through build → install → " +
        "self-review, then set this expectation to [\"cmp-winshimmer\"].",
    ).toEqual([]);
  });
});
