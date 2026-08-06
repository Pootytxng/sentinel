import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";

// KEEPALIVE-IDLE GUARD (2026-08-04, Q7 idle-cost audit — the second half).
//
// WHY THIS EXISTS — a signal that reads TRUE while the user sees nothing:
//
//   `hidden-poll-guard.test.ts` covers the WINDOW being hidden. This covers the other axis, and the
//   two are not interchangeable. App.tsx kept Optimize MOUNTED behind `display: none` for the rest
//   of the session — a deliberate perf win, but it meant "unmounted" stopped being the signal a
//   room-scoped timer could rely on. A component in a hidden room still has running effects, and
//   `useDocumentVisible` reads TRUE the whole time, because the window is perfectly visible.
//
//   What that cost in practice: `Walkthrough` mounts a 2.2s auto-advance carousel, and Check + Fix
//   mounted it unconditionally inside a COLLAPSED `<details>` — React renders `<details>` children
//   whatever `open` says, so every walkthrough-bearing row started a carousel nobody had opened.
//   One trip to Optimize left N of them ticking in every other room, and behind a fullscreen game.
//   It also fabricated the "N walkthroughs opened" number the Export modal shows the user.
//
// THE RULE, stated mechanically: a module reachable from a keepalive room that starts a timer must
// reference BOTH idle signals — `useDocumentVisible` (can you see this window?) and `useRoomActive`
// (can you see this room?). Continuous work stands down when EITHER is false.
//
// The corpus is INVERTED on purpose — walk the whole import closure, exempt explicitly WITH A
// REASON. Same lesson as the mutation-boundary, outbound-claim and hidden-poll guards: the logic is
// never the weak part, the corpus is. A new timer inside the keepalive is in scope the moment it is
// imported, with no list to remember to update.
//
// SCOPE, stated honestly: the import closure OVER-approximates the render closure. Optimize imported
// app-wide chrome (HudFrame, LenisSpine, use-update) for types and hooks, but ShellV2 renders those
// ONCE, above the room switch — never inside the hidden div. Those were exempt on the merits (the
// retired reasons are kept below). And this is a FILE-level check, not an AST one: it proves the
// signals are wired into a timer-owning file, not that the gate landed on the right effect. Cheap
// and robust beats clever and brittle, and it catches the failure that actually happened.
//
// DORMANT BUT ARMED (2026-08-06 generation prune). App.tsx renders NO keepalive room today: both
// roots were Optimize faces, and both were deleted with the dead generations — Optimize's live home
// is `lab/OptimizeStation` inside LabGround, an ordinary mounted child. So the closure walk has
// nothing to walk, and the population this guard governs is legitimately empty.
//
// It is kept, not deleted, because the FAILURE it describes is a property of the idiom, not of
// Optimize: the day someone hides a room behind display:none again, every timer inside it goes on
// running invisibly. The two tests that still bite unconditionally — "nobody hand-rolls a keepalive"
// and "the signals it points at are the real ones" — are what keep the idiom honest in the meantime;
// the closure tests re-arm the moment a root is added back to KEEPALIVE_ROOTS.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const WINDOW_SIGNAL = "useDocumentVisible";
const ROOM_SIGNAL = "useRoomActive";

// The rooms App.tsx keeps warm instead of unmounting. Kept in step with the real call sites by the
// count assertion below: a `<KeepaliveRoom>` fails this guard until its root is declared here.
// EMPTY since 2026-08-06 — see the dormant-but-armed note above.
const KEEPALIVE_ROOTS: string[] = [];

// A timer, of either kind. `setInterval` survives `display: none` outright; `requestAnimationFrame`
// keeps firing too while the WINDOW is visible, because rAF is document-scoped, not element-scoped.
// (CSS animation is the one thing that is already free — a `display: none` ancestor generates no
// boxes, so it never runs. That is why this guard is about JS timers and not about animation CSS.)
const TIMER = /\bsetInterval\s*\(|\brequestAnimationFrame\s*\(/;

// Exemptions carry a REASON, never a bare path — an unexplained exemption is how a guard rots into
// a formality. Every one of these is a refusal on the merits, with its render site named.
//
// EMPTY since the 2026-08-06 prune, because an exemption from an empty closure is meaningless — and
// the stale-exemption test below would (correctly) fail on every one of them. The five retired
// reasons are kept VERBATIM here so the next keepalive inherits the reasoning instead of re-deriving
// it; move the ones that still apply back into EXEMPT when a root returns.
//
//   src/design/console/HudFrame.tsx
//     App-wide chrome. Rendered ONLY at ShellV2.tsx:233, above the room switch — never inside the
//     hidden div. Reachable here because Optimize imports it for types/hooks. Its 1Hz clock already
//     gates on useDocumentVisible (75ce9b3); a room signal would be meaningless for a frame that
//     belongs to no room.
//   src/design/jarvis/LenisSpine.tsx
//     App-wide scroll spine. Rendered ONLY at ShellV2.tsx:231, above the room switch. Its rAF loop
//     is the shell's, not a room's — so the ROOM axis this guard enforces genuinely does not apply.
//     The third axis ('is anyone interacting?') is enforced by src/shell-idle-guard.test.ts, which
//     pins the interaction stand-down this file gained on 2026-08-06: the loop parks a second after
//     the lane stops moving and re-arms on input.
//   src/design/use-update.ts
//     App-wide update hook, single instance: called ONLY by UpdatePill.tsx:14, rendered at
//     ShellV2.tsx:205. update-prefs.ts:18 documents that a second instance is forbidden. Its recheck
//     timer is session-scoped, deliberately independent of which room is on screen.
//   src/design/console/ReticleCursor.tsx
//     rAF loop, pointer-driven: it starts on pointer-enter and stops on pointer-leave, so a room
//     nobody is pointing at costs nothing. Rendered at ShellV2.tsx:234 (app-wide) and in the Home,
//     Lab and Monitor consoles — none of which sit inside a keepalive room.
//   src/design/vendor/DecryptedText/DecryptedText.tsx
//     Was genuinely inside the keepalive (OptimizeV2 rendered it), but self-terminating: the
//     interval is gated on isAnimating, clears itself when the decode completes, and a decode-once
//     registry stops it re-running. It is a one-shot reveal, not a loop — nothing to stand down.
const EXEMPT: Record<string, string> = {};

// ── Corpus: the transitive import closure of the keepalive rooms ─────────────────────────────────

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
  const queue = [...KEEPALIVE_ROOTS];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const next = resolve(m[1], file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].sort();
}

/** Files in the keepalive closure that start a timer — the population this guard governs. */
function timerModules(): { file: string; text: string }[] {
  return closure()
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => TIMER.test(text));
}

// ── The guard ────────────────────────────────────────────────────────────────────────────────────

describe("keepalive-idle guard", () => {
  it("still reaches the keepalive rooms at all (the corpus is the weak part)", () => {
    // A moved root or a broken resolver would silently empty the closure and turn every assertion
    // below into a no-op. Pin the floor: the walk found 60 modules on 2026-08-04.
    //
    // Conditional since the 2026-08-06 prune ONLY because there are no roots to walk — an empty
    // KEEPALIVE_ROOTS is a fact about App.tsx, not a broken resolver, and the count test below is
    // what proves that (it fails the moment App.tsx renders a keepalive this list doesn't know).
    // The floors are unchanged and re-arm with the first root.
    for (const root of KEEPALIVE_ROOTS) {
      expect(existsSync(root), `${root} is gone — update KEEPALIVE_ROOTS`).toBe(true);
    }
    if (KEEPALIVE_ROOTS.length) {
      expect(closure().length).toBeGreaterThanOrEqual(50);
      expect(timerModules().length).toBeGreaterThanOrEqual(6);
    }
  });

  it("every timer reachable from a keepalive room stands down when it can't be seen", () => {
    const offenders = timerModules()
      .filter(({ file }) => !(file in EXEMPT))
      .filter(({ text }) => !text.includes(WINDOW_SIGNAL) || !text.includes(ROOM_SIGNAL))
      .map(({ file }) => file);

    expect(
      offenders,
      `A timer reachable from a keepalive room never pauses when nobody can see it.\n` +
        `A hidden room's effects keep running — ${WINDOW_SIGNAL} alone is NOT enough, because the\n` +
        `window stays perfectly visible while the room sits behind display:none.\n` +
        `    const visible = ${WINDOW_SIGNAL}();      // src/data/use-document-visible\n` +
        `    const roomActive = ${ROOM_SIGNAL}();     // src/data/use-room-active\n` +
        `    useEffect(() => { if (!visible || !roomActive) return; ... }, [visible, roomActive]);\n` +
        `If the timer genuinely must keep running, add it to EXEMPT WITH A REASON.\n`,
    ).toEqual([]);
  });

  it("every exemption still exists, is still reachable, and still owns a timer", () => {
    // An exemption that outlives its file is a lie the next reader has to disprove.
    const governed = new Set(timerModules().map((m) => m.file));
    const stale = Object.keys(EXEMPT).filter((f) => !governed.has(f));
    expect(stale, `EXEMPT names files that no longer own a timer in the closure — delete them`).toEqual(
      [],
    );
  });

  it("nobody hand-rolls a keepalive — the hiding div and the room signal ship together", () => {
    // The default of RoomActiveContext is TRUE (a subtree with no provider is on screen, which is
    // the honest answer). That fails OPEN, which is right for a UI signal — but it means a keepalive
    // that forgot its provider goes wrong SILENTLY. So the pairing isn't left to memory: hiding a
    // room is only spelled one way, and that spelling carries the provider with it.
    const HIDE = /display:\s*["']none["']/;
    const handRolled = closure()
      .concat("src/App.tsx")
      .filter((f) => f !== "src/design/KeepaliveRoom.tsx")
      .filter((f) => HIDE.test(readFileSync(f, "utf8")));

    expect(
      handRolled,
      `A room is hidden with an inline display:none instead of <KeepaliveRoom active={...}>.\n` +
        `A raw hiding div leaves every timer inside it running with no way to know it — use\n` +
        `src/design/KeepaliveRoom.tsx, which provides RoomActiveContext from the same prop.\n`,
    ).toEqual([]);

    const keepalive = readFileSync("src/design/KeepaliveRoom.tsx", "utf8");
    expect(keepalive).toContain("RoomActiveContext.Provider");
    expect(keepalive).toMatch(/value=\{active\}/);
  });

  it("App.tsx declares no more keepalive rooms than this guard knows roots for", () => {
    // The one place the closure can go stale: a THIRD keepalive room whose subtree is never walked.
    const app = readFileSync("src/App.tsx", "utf8");
    const rendered = app.match(/<KeepaliveRoom\b/g)?.length ?? 0;
    expect(
      rendered,
      `App.tsx renders ${rendered} keepalive rooms but KEEPALIVE_ROOTS lists ` +
        `${KEEPALIVE_ROOTS.length}. Add the new room's root surface so its timers are governed.\n`,
    ).toBe(KEEPALIVE_ROOTS.length);
  });

  it("the signals it points at are the real ones", () => {
    // The whole guard is a pointer to two files. If either moves, every message above misleads.
    expect(readFileSync("src/data/use-document-visible.ts", "utf8")).toContain(
      `export function ${WINDOW_SIGNAL}(): boolean`,
    );
    const room = readFileSync("src/data/use-room-active.ts", "utf8");
    expect(room).toContain(`export function ${ROOM_SIGNAL}(): boolean`);
    expect(room).toContain("export const RoomActiveContext");
  });
});
