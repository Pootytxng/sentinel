# Session handoff — 2026-08-20 (#121 launch-focus runtime tier: INSTRUMENT BUILT, cause NOT yet measured)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`, branch **`lane/focus-121`** cut from
origin/main `616c6fe2`. Issue [#121](https://github.com/Pootytxng/sentinel/issues/121) claimed
(ownership claim posted 2026-08-20). No build, no install — the desk still runs `ab54f1e4`.
**Branch is LOCAL ONLY, not pushed** (see "Why not pushed").

## What this lane did

- **`9f4e8eca`** — carried the untracked PR #185 merge receipt + the #171 handoff refresh (the
  #181–#185 chain).
- **`adaa9a86`** — the instrument the 2026-08-18 split asked for. `scripts/lib/foreground-events.cs`
  is a WinEvent hook (FOREGROUND, FOCUS, window CREATE/SHOW/DESTROY for the launched tree,
  MINIMIZESTART/END); `scripts/lib/foreground-probe.ps1` runs it around every launch, pumping
  instead of sleeping, and emits a per-measurement `events` trace with class names + owning
  process. `scripts/launch-focus-guard.test.mjs` gains `summarizeTrace`/`formatTrace` — the focus
  taker's class + process attributes a raise to `webview2-runtime` / `in-process` /
  `outside-family`, and a non-family window minimising/dying ≤500ms before Compy got the
  foreground is `inherited-after-another-window-left`. Every runtime message (fail / unmeasurable
  / clean) carries it. 37/37 in the file; four new guards mutation-tested. **Pass/fail policy is
  unchanged** — `classifyForegroundReading` still decides until a real failure has been read.
- **`95e24fbc`** — `COMPY_FOREGROUND_TRACE_DIR=<dir>` keeps each raw probe JSON.

## The lead (recorded, NOT confirmed — BACKLOG #121 row has the full text)

The hook's smoke test launched a hidden `powershell.exe` (`Start-Process -WindowStyle Hidden`)
and recorded **Windows Terminal fronted at +59ms, minimised at +307ms, foreground falling to the
next Z-order window**. Sibling suites do that launch during the full gate
(`runtime-proof-guard.test.mjs:122-125`, `detached-window-guard`'s Minimized control child, every
`Start-NativeProcess -Detached` console child), a fresh never-activated window is top of Z-order,
and the terminal can only be fronted while the foreground lock is open (input-idle desk). That
explains full-suite-only, idle-only, ~120ms-after-the-window and "not ours" in one mechanism. If
true, the fix is in how the siblings launch console children + a guard that no suite opens a
console host — Compy itself is already quiet.

**My miss this session (so it is on record):** that smoke test ran while the owner was in-game;
the trace says Windows Terminal took his foreground for ~250ms. From then on: no launches of any
kind while a game is in front.

## Why not pushed

The pre-push gate is the full suite: heavy CPU and it opens console hosts (the very mechanism
above) — not while the owner is gaming with Compy open. Push when the desk is free:
`git push -u origin lane/focus-121`, then `gh pr create` against main and merge green.

## Next action — the deciding measurement (needs: no compy running, no game in front)

1. Standalone baseline: `COMPY_FOREGROUND_TRACE_DIR=<dir> npx vitest run scripts/launch-focus-guard.test.mjs`
   — expect clean; read the first-line trace summary.
2. Targeted repro: the same with `scripts/runtime-proof-guard.test.mjs scripts/detached-window-guard.test.mjs`
   added to the invocation (parallel workers) — look for `inherited-after-another-window-left`
   with `WindowsTerminal` as the handoff. Then the full `npm test` once, ideally on a desk idle
   ≥90s (the failing condition in the issue).
3. If confirmed: move the sibling console launches to CreateNoWindow (no ShellExecute-Hidden
   console), add a suite-wide guard, then re-run #2 and let the trace show zero handoffs. If
   refuted: the trace names the real taker — follow it.
4. Close #121 with the trace quoted in the issue; update the BACKLOG row + RELEASE_STATE if a gate
   flips.

## Queue after this

`docs/BACKLOG.md`: #126 (retire stranded origin lanes), #156, #128, #125. Nothing blocked on the
owner.
