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
//   unattended window costs it nothing. LenisSpine's was unconditional — the only always-mounted
//   loop with no stand-down.
//
// CLOSED 2026-08-06 (idle-cost teardown). The subtraction waterfall in docs/perf/raw/
// idle-attribution.json sized the whole rAF band at 6.83% of a core out of 49.3% — real, but the
// minority term; two decorative CSS animations owned 80%. LenisSpine now parks a second after the
// lane stops moving and re-arms on input, so it is a STANDS_DOWN entry and the always-on class is
// EMPTY. The finding this file was written to hold open is closed; what it now enforces is that
// nothing re-opens it.
//
// THE RULE — the shell's rAF owners are an EXACT, declared set. Two ways to fail:
//
//   • A new shell module starts a rAF loop → it is in neither list → fail. Add it to STANDS_DOWN
//     with the mechanism named, or admit it is always-on (and then the empty-class assertion bites).
//   • A stand-down gets deleted → its signature stops matching → fail. The mechanism is the whole
//     value of the entry; an entry describing a stand-down that is gone is worse than no entry.
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
  "src/design/jarvis/LenisSpine.tsx": {
    why:
      "Motion-driven: the loop parks IDLE_AFTER_MS after the lane's last observed pixel of " +
      "movement and re-arms from wake() on wheel/touch/key/pointer/scroll. Parking is keyed on " +
      "wrapper.scrollTop actually changing rather than on any library flag, so no internal Lenis " +
      "state can leave it spinning for a scroll that already ended. Also still stands down on " +
      "document.hidden, and deliberately does NOT re-arm on the way back to visible — an " +
      "unattended foreground window was the original defect.",
    requires: [/IDLE_AFTER_MS/, /const wake = /, /raf = 0; \/\/ Parked/, /document\.hidden/],
  },
};

/**
 * Loops that keep running with nobody there. EMPTY, and that is the assertion — see the header.
 * An entry here is an open finding against the shell, never an exemption.
 */
const ALWAYS_ON: Record<string, { finding: string; requires: RegExp[] }> = {};

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

  it("the always-on class is empty, and stays empty", () => {
    // The one entry that used to live here was closed on 2026-08-06. Re-opening it is allowed —
    // but only loudly, by editing this assertion, never by quietly appending to the record.
    expect(
      Object.keys(ALWAYS_ON),
      `A shell rAF loop was declared always-on. Nothing in the shell is allowed to run frames at\n` +
        `rest: the shell is mounted in EVERY room for the whole session, including behind the game\n` +
        `Compy is supposed to be optimizing. The measured cost of the last one to try is in\n` +
        `docs/perf/raw/idle-attribution.json (rAF band: 6.83% of a core, idle, nobody present).\n` +
        `Give it a stand-down and move it to STANDS_DOWN — do not log it here.\n`,
    ).toEqual([]);
  });

  it("the finding this file was opened for is still closed", () => {
    // Belt and braces on the STANDS_DOWN signature above, and deliberately NOT a check on the
    // shape of the re-arm statement. The first draft of this assertion banned a bare
    // `raf = requestAnimationFrame(loop);` line, guessing the fix would be `if (awake) raf = ...`.
    // The fix that actually landed returns EARLY above an unchanged re-arm line, so that
    // assertion failed against correct code — a guard that pins an imagined implementation
    // instead of the behaviour is worse than none.
    //
    // What matters is that the loop carries its OWN exit. A re-arm anywhere in the file proves
    // nothing; a `loop` whose body can only ever call requestAnimationFrame again is the bug.
    // So: isolate the loop body and require the idle park to live inside it.
    const spine = readFileSync("src/design/jarvis/LenisSpine.tsx", "utf8");
    const open = spine.indexOf("const loop = ");
    expect(open, `LenisSpine no longer declares 'const loop = ' — rewrite this guard`).toBeGreaterThan(-1);

    // Brace-match from the arrow body: text-level, but exact, and it cannot drift into wake().
    const bodyStart = spine.indexOf("{", open);
    let depth = 0;
    let bodyEnd = -1;
    for (let i = bodyStart; i < spine.length; i++) {
      if (spine[i] === "{") depth++;
      else if (spine[i] === "}" && --depth === 0) {
        bodyEnd = i;
        break;
      }
    }
    expect(bodyEnd, `Could not brace-match LenisSpine's loop body — rewrite this guard`).toBeGreaterThan(-1);
    const body = spine.slice(bodyStart, bodyEnd + 1);

    const message =
      `LenisSpine's rAF loop no longer contains its own exit — that is the 2026-08-05 idle\n` +
      `finding returning. Whatever arms the loop, the loop itself must be able to STOP:\n` +
      `park on ${"IDLE_AFTER_MS"} of no observed motion and let wake() re-arm it. A loop whose\n` +
      `only outcome is another frame runs forever in every room, for the whole session,\n` +
      `including behind the game Compy is supposed to be optimizing.\n`;
    expect(body.includes("IDLE_AFTER_MS"), message).toBe(true);
    expect(/raf = 0;/.test(body), message).toBe(true);
    expect(/\breturn\b/.test(body), message).toBe(true);
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
