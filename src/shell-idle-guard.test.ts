import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";

// SHELL-IDLE GUARD (2026-08-05, Q7 idle-cost sweep — the THIRD axis).
//
// THREE AXES, and the app already answered only two of them:
//
//   1. Can the user see the WINDOW?  → hidden-poll-guard.test.ts   (document.hidden)
//   2. Can the user see the ROOM?    → keepalive-idle-guard.test.ts (useRoomActive)
//   3. Is anyone INTERACTING?        → this file
//
//   At rest with the app on screen, axes 1 and 2 both answer YES — truthfully — and work keeps
//   happening anyway. Nothing in the repo asked the third question, so nothing caught it.
//
// WHAT THE SWEEP MEASURED (docs/perf/raw/, installed build dc4d55e · release):
//
//   • rooms.json — Blackbook, sitting idle: 0 IPC calls, 0 canvas draws, and 3751 rAF callbacks in
//     15 s, `concurrentRafLoops: 1.00`. A room doing nothing, at 250 fps, forever. Home (1.00) and
//     Lab (1.00) read the same. Blackbook matters most: it mounts no chart, no bay, no border —
//     so the loop that survives there is the SHELL's, not the room's.
//   • idle-bare.json — two independent 10-minute bare recordings, 50.17% and 50.71% of one core,
//     with nothing on screen moving and no user present.
//
//   Attribution, stated exactly as far as the evidence goes: the shell owns exactly two rAF loops
//   (asserted below). ReticleCursor's starts on pointer-enter and cancels on pointer-leave, so an
//   unattended window costs it nothing. LenisSpine's is unconditional. That makes LenisSpine the
//   only always-mounted loop with no stand-down — not a profiler attribution of the whole 50%, and
//   this comment does not claim one.
//
// WHY A GUARD AND NOT JUST A FIX: the fix is a scroll-feel change to a component the owner has
// explicit UI-vision investment in (Lenis), so it is queued rather than smuggled into an
// accessibility lane. What must NOT wait is the class growing. This file freezes the population.
//
// THE RULE — the shell's rAF owners are an EXACT, declared set. Two ways to fail:
//
//   • A new shell module starts a rAF loop → it is in neither list → fail. Add it to STANDS_DOWN
//     with the mechanism named, or admit it is always-on (and then the second assertion bites).
//   • LenisSpine gets fixed → it stops matching ALWAYS_ON's shape → fail, deliberately. The
//     finding is written down in three places; whoever fixes it moves it to STANDS_DOWN and the
//     ledger stays honest instead of quietly describing a bug that no longer exists.
//
// SCOPE, honestly: the corpus is ShellV2's import closure — the chrome mounted in EVERY room for
// the whole session, which is the only place a loop can be "always-on" in the sense that matters.
// Room-level loops are the keepalive guard's business (ElectricBorder, for one, runs a permanent
// loop but only while Home is mounted, and Home unmounts). And this is a FILE-level text check: it
// pins WHICH modules own loops and whether the stand-down mechanism is still present, not that
// every branch of every effect is correct.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const SHELL_ROOT = "src/design/ShellV2.tsx";
const RAF = /\brequestAnimationFrame\s*\(/;

/**
 * Loops that stand down when nobody is interacting — each with the mechanism that stops them, and
 * a text signature that fails if that mechanism is deleted.
 */
const STANDS_DOWN: Record<string, { why: string; requires: RegExp[] }> = {
  "src/design/console/ReticleCursor.tsx": {
    why:
      "Pointer-driven: onEnter starts the loop, onLeave cancels it and zeroes the handle. An " +
      "unattended window runs no frames — the reticle is invisible then anyway, so there is " +
      "nothing to animate. This is the pattern the shell should use everywhere.",
    requires: [/pointerleave/, /cancelAnimationFrame/],
  },
};

/**
 * Loops that keep running with nobody there. Not exemptions — OPEN FINDINGS, carried here so the
 * class cannot grow and so the fix has somewhere to land.
 */
const ALWAYS_ON: Record<string, { finding: string; requires: RegExp[] }> = {
  "src/design/jarvis/LenisSpine.tsx": {
    finding:
      "Q7 open finding (2026-08-05): the rAF loop re-arms unconditionally and is cancelled only by " +
      "the visibilitychange handler. Mounted app-wide at ShellV2.tsx, so it runs in every room for " +
      "the whole session — see rooms.json Blackbook (0 IPC, 0 draws, 3751 callbacks / 15 s). " +
      "Smooth scroll only has work to do while a scroll is in flight; the loop should idle out " +
      "after the last one settles and restart on wheel/touch/key input, the way ReticleCursor does " +
      "with the pointer. Deliberately not fixed in the a11y lane: it changes scroll feel on a " +
      "surface the owner has design investment in, and that needs its own self-review pass.",
    // The shape of the bug. When it is fixed these stop matching and this guard fails ON PURPOSE.
    // The re-arm is anchored to a WHOLE line on purpose: the likeliest fix is a condition in front
    // of it (`if (scrolling) raf = ...`), and an unanchored substring would still match that and
    // report the finding as open after it was closed.
    requires: [/^\s*raf = requestAnimationFrame\(loop\);\s*$/m, /document\.hidden/],
  },
};

// ── Corpus: the transitive import closure of the shell ───────────────────────────────────────────

const IMPORT_RE = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function resolve(spec: string, fromFile: string): string | null {
  if (!spec.startsWith(".")) return null; // package import — not our source
  const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const parts = `${dir}/${spec}`.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  const base = stack.join("/");
  for (const cand of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(cand)) return cand;
  }
  return null; // .css and friends
}

function closure(): string[] {
  const seen = new Set<string>();
  const queue = [SHELL_ROOT];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const next = resolve(m[1], file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].sort();
}

/** Shell modules that start an animation frame loop — the population this guard governs. */
function rafOwners(): string[] {
  return closure().filter((f) => RAF.test(readFileSync(f, "utf8")));
}

// ── The guard ────────────────────────────────────────────────────────────────────────────────────

describe("shell-idle guard — the shell's rAF loops are a declared set", () => {
  it("still reaches the shell at all (the corpus is the weak part)", () => {
    // A moved shell or a broken resolver would empty the closure and turn every assertion below
    // into a no-op that still reads as coverage. The walk found 21 modules on 2026-08-05.
    expect(existsSync(SHELL_ROOT), `${SHELL_ROOT} is gone — update SHELL_ROOT`).toBe(true);
    expect(closure().length).toBeGreaterThanOrEqual(15);
  });

  it("every rAF loop in the shell is declared, one way or the other", () => {
    const declared = new Set([...Object.keys(STANDS_DOWN), ...Object.keys(ALWAYS_ON)]);
    const undeclared = rafOwners().filter((f) => !declared.has(f));

    expect(
      undeclared,
      `A shell module started an animation-frame loop without declaring what stops it.\n` +
        `Shell chrome is mounted in EVERY room for the whole session, so "always-on" here means\n` +
        `always-on for the user — including behind the game Compy is supposed to be optimizing.\n` +
        `The window-visible and room-active guards both pass at rest; they cannot catch this.\n\n` +
        `If the loop stands down when nobody is interacting, add it to STANDS_DOWN with the\n` +
        `mechanism named (see ReticleCursor: start on pointer-enter, cancel on pointer-leave).\n` +
        `If it does not, it is a new instance of an open finding — fix it rather than logging it.\n`,
    ).toEqual([]);

    // ...and the reverse: a declaration that outlived its loop is a lie the next reader must disprove.
    const owners = new Set(rafOwners());
    const stale = [...declared].filter((f) => !owners.has(f));
    expect(stale, `Declared above but no longer owns a rAF loop in the shell closure — delete it`).toEqual(
      [],
    );
  });

  it("the stand-down mechanisms are still there", () => {
    for (const [file, { why, requires }] of Object.entries(STANDS_DOWN)) {
      const text = readFileSync(file, "utf8");
      for (const re of requires) {
        expect(re.test(text), `${file} lost its stand-down (${re}).\n${why}\n`).toBe(true);
      }
    }
  });

  it("the always-on class has not grown", () => {
    // One is a finding with a fix queued. Two is a habit.
    expect(
      Object.keys(ALWAYS_ON).length,
      `A second always-on shell loop was declared. The first one costs ~50% of a core at idle\n` +
        `(docs/perf/raw/idle-bare.json); do not add another — fix the loop instead.\n`,
    ).toBeLessThanOrEqual(1);
  });

  it("the open finding is still open, and still shaped the way it is written down", () => {
    // This fails when the bug is FIXED, which is the point: the finding is described in this file,
    // in keepalive-idle-guard.test.ts's exemption, and in the Q7 spec. Whoever fixes it moves the
    // entry to STANDS_DOWN and corrects the other two, instead of leaving three files describing a
    // bug that no longer exists.
    for (const [file, { finding, requires }] of Object.entries(ALWAYS_ON)) {
      const text = readFileSync(file, "utf8");
      for (const re of requires) {
        expect(
          re.test(text),
          `${file} no longer matches the open finding — if you FIXED it, thank you: move it from\n` +
            `ALWAYS_ON to STANDS_DOWN here, drop the "not a clean bill of health" paragraph from\n` +
            `src/keepalive-idle-guard.test.ts, and re-run the idle recording so the baseline in\n` +
            `docs/perf/q7-baseline.json stops citing a cost that is gone.\n\nThe finding as written:\n${finding}\n`,
        ).toBe(true);
      }
    }
  });

  it("the sibling axes it defers to are real", () => {
    // This guard's whole claim is "the other two answer YES at rest". If either moves, that claim
    // is unverifiable and this file's reasoning silently loses its footing.
    for (const sibling of ["src/hidden-poll-guard.test.ts", "src/keepalive-idle-guard.test.ts"]) {
      expect(existsSync(sibling), `${sibling} is gone — the three-axis story above needs rewriting`).toBe(
        true,
      );
    }
  });
});
