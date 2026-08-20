# Session handoff — 2026-08-19/20 (C-13 axe-core LANDED; lane CLOSED)

**Lane CLOSED.** Worktree `C:\Users\Kuya\code\sentinel-home-room` sits on `lane/c13-handoff`, even
with `origin/main`, clean. Issue [#150](https://github.com/Pootytxng/sentinel/issues/150) is closed,
PR [#151](https://github.com/Pootytxng/sentinel/pull/151) is merged, `lane/axe-core-vitest` is
pruned, no claim is open, nothing is in flight. `main` is checked out by the other worktree
(`C:\Users\Kuya\code\sentinel`), which is why this one keeps a lane branch.

## Landed this session

**PR [#151](https://github.com/Pootytxng/sentinel/pull/151) → `63ee75e1`** (commit `57bc5c0d`) —
**C-13, the axe-core half.** The rank-3 tooling ask from the 2026-08-11 design-foundation decision
was *mine*, not the owner's, and had never landed.

- `src/test/axe.ts` — the harness (`expectNoAxeViolations`).
- `src/design/a11y-axe-guard.test.tsx` — **49** mounts: design system, console/bento, vendored.
- `src/design/a11y-axe-shell.test.tsx` — **6** mounts: the Tauri-mocked chrome.
- `src/design/a11y-census-guard.test.ts` + `a11y-census.baseline.json` — **all 46**
  `src/design/**/*.tsx` classified, `unrosteredCeiling: 0`, `rostered` verified against the guard
  files' real import list. Falsified against a probe component.
- `src/test/setup.ts` — inert `IntersectionObserver`/`ResizeObserver` stubs (three test files were
  hand-rolling the same pair). Inert on purpose: an "always in view" stub would switch on every
  viewport-gated animation in every test.

**Two defects it caught on day one, both fixed in the same commit:**

1. `RoomAccentPicker` — the `role="menu"` popover's two action buttons were bare `<button>` children
   (`aria-required-children`, critical). Now `role="menuitem"`; three `room-accents` queries follow.
2. `Picker` — its doc-comment demanded an accessible name and nothing enforced it. `PickerProps` is
   now a union requiring one of `aria-label`/`labelledBy`/`id`; omitting all three is a **compile
   error**, proven against a probe file. All seven call sites already passed one.

Gates: `npx tsc --noEmit` clean · pre-push local gate PASS (`npm test` 347 files / 4550 passed,
4 skipped; `cargo test`; clippy) · work-control receipt **PASS** at
`57bc5c0deac8d4775642bf4587ee3d150276bfcf`, independent review recorded *not practical* with a
reason (no second model reachable).

## The honest bound — never restate this harness as contrast coverage

jsdom has no canvas, no layout, and `vitest.config.ts` sets `css: false`. Measured against markup
with a deliberate **1.06:1** failure, axe returned **0 violations, 0 passes, 1 incomplete** plus
jsdom's `HTMLCanvasElement's getContext()` notice. `color-contrast` is therefore disabled BY NAME,
with that measurement recorded in `src/test/axe.ts`. Contrast stays in `src/theme-contrast.test.ts`
and `src/design/type-scale-guard.test.ts`.

## Carried forward from C-13, recorded and NOT fixed

- **`RoomAccentPicker` claims `role="menu"` without roving tabindex / arrow-key navigation**, which
  the ARIA menu pattern requires. axe cannot see it; the `menuitem` fix did not address it. In the
  C-13 backlog row.
- **C-13 rank 2 — the owner's Figma account + MCP server** — his hands, tracked at
  `docs/OWNER_ACTION_CHECKLIST.md` §B4. It is the only reason the C-13 row is still `[ ]`.

## Next, in order

1. Take the next non-gated `[ ]` in `docs/BACKLOG.md` (the Codex weekly-automation row above C-13
   still says *"still delegated; do not duplicate"*).
2. Still open, untouched: the `.arc-v2` per-section decision (**M2 is LIVE — do not delete on
   current evidence**) · **C-14** (`GpuProfile.tsx`, owner fork) · `launch-focus-guard` RUNTIME
   intermittency (**do not "fix" with a skip**) · [#121](https://github.com/Pootytxng/sentinel/issues/121)
   · [#140](https://github.com/Pootytxng/sentinel/issues/140).

## The debt that still carries

**The C-17b RESIDUAL visual review — 6 of 12 selectors measured.** The desk build `40682344` predates
#145/#147/#149/#151. Next build → `scripts/ship-reinstall.ps1` → the `self-review` skill against
those six selectors. This session's one UI-touching change (`RoomAccentPicker`'s menu roles) is
**semantic only — no visual delta** — but it rides that same next build.
