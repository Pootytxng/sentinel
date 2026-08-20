# Session handoff — 2026-08-19 (C-13 axe-core: BUILT, UNCOMMITTED, suite verdict pending)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room` · branch **`lane/axe-core-vitest`** (cut from
`origin/main @ dd9ee8bf`) · **DIRTY — nothing committed yet.** `main` is checked out by the other
worktree (`C:\Users\Kuya\code\sentinel`), which is why this one keeps a lane branch.

Claim posted on **issue [#150](https://github.com/Pootytxng/sentinel/issues/150)** (C-13), expires
2026-08-20. The three PRs of the previous lane (#145 · #147 · #149) are all landed and pruned; that
work is finished and is recorded in `docs/CHANGELOG.md` + the C-12/C-17b/C-18/C-18b backlog rows.

## The exact uncommitted change set

New:
- `src/test/axe.ts` — the axe harness. `expectNoAxeViolations(container)`, plus the recorded
  measurement for why `color-contrast` is disabled by name.
- `src/design/a11y-axe-guard.test.tsx` — design system + console/bento + vendored primitives.
- `src/design/a11y-axe-shell.test.tsx` — the Tauri-mocked chrome (ShellV2, RoomShell, ForwardDoor,
  CommandPalette, WindowChrome, UpdatePill).
- `src/design/a11y-census-guard.test.ts` + `src/design/a11y-census.baseline.json` — all 46
  `src/design/**/*.tsx` classified; `unrosteredCeiling: 0`.

Modified:
- `package.json` / `package-lock.json` — `axe-core@4.13.0` devDependency.
- `src/design/RoomAccentPicker.tsx` — **product fix.** The two action buttons inside the
  `role="menu"` popover were bare `<button>` children (`aria-required-children`); now `role="menuitem"`.
- `src/design/room-accents.test.tsx` — 3 queries follow that role change (`button` → `menuitem`).
- `src/design/Picker.tsx` — **type hardening.** `PickerProps` is now a union requiring one of
  `aria-label` / `labelledBy` / `id`; omitting all three is a compile error (proven against a probe
  file). All 7 existing call sites already passed one, so nothing broke.
- `src/test/setup.ts` — inert `IntersectionObserver` / `ResizeObserver` stubs (three test files were
  hand-rolling the same pair). Deliberately never fires — a stub reporting "in view" would switch on
  every viewport-gated animation in every test.
- `src/reachability-guard.test.ts` — `test/axe.ts` added to `ALLOWED` with a reason.
- `docs/BACKLOG.md` — C-13 row rewritten to what landed vs what stays owner-gated.

## Verification state — THE ONE OPEN ITEM

- `npx tsc --noEmit` → **clean.**
- Targeted run of the 6 affected files (`a11y-*`, `room-accents`, `reachability-guard`,
  `node-shim-coverage`) → **107/107 pass.**
- **`npm test` (full suite) was running in the background when this file was written and its verdict
  was never read.** The prior full run failed 5 tests in 3 files; all five were fixed and re-proven
  individually, but **the full suite has not been confirmed green end-to-end.**

**Next step, precisely:** re-run `npm test` in this worktree. On green, commit the set above on
`lane/axe-core-vitest`, push, open a PR against `main` referencing #150, and follow
`docs/WORK_CONTROL.md` — save the JSON receipt with the full 40-char head and run
`node scripts/work-control-gate.mjs <receipt.json>` before merging. On red, fix forward; do not
weaken a guard to get green.

## Recorded, not fixed — do not lose these

- **`RoomAccentPicker` claims `role="menu"` without roving tabindex or arrow-key navigation**, which
  the ARIA menu pattern requires. axe cannot see it and the `menuitem` fix above did not address it.
  Written into the C-13 backlog row as still-open.
- **C-13 rank 2 (Figma account + MCP) is the owner's half** and stays open — tracked at
  `docs/OWNER_ACTION_CHECKLIST.md` §B4.
- **axe under jsdom cannot check contrast.** Measured on a deliberate 1.06:1 failure: 0 violations,
  0 passes, 1 incomplete, plus jsdom's `HTMLCanvasElement's getContext()` not-implemented notice.
  Never describe this harness as contrast coverage.

## Still open, untouched by this session

The `.arc-v2` per-section decision (**M2 is LIVE — do not delete on current evidence**) · **C-14**
(`GpuProfile.tsx`, owner fork) · `launch-focus-guard` RUNTIME intermittency (**do not "fix" with a
skip**) · [#121](https://github.com/Pootytxng/sentinel/issues/121) ·
[#140](https://github.com/Pootytxng/sentinel/issues/140).

## The debt that still carries

**The C-17b RESIDUAL visual review — 6 of 12 selectors measured.** The desk build `40682344` predates
#145/#147/#149 and everything above. Next build → `scripts/ship-reinstall.ps1` → the `self-review`
skill against those six selectors. This session's UI change (`RoomAccentPicker`'s menu roles) is
semantic only — no visual delta — but it rides that same next build.
