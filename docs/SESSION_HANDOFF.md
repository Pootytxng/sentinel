# Session handoff — 2026-08-19 (#145 · #147 · #149 landed; lane CLOSED)

**Lane CLOSED.** Worktree `C:\Users\Kuya\code\sentinel-home-room` sits on `lane/prune-c18b-row`,
even with `origin/main @ ef93c546`, clean. No claim is open, no ref is unpruned, nothing is
in flight. `main` itself is checked out by the other worktree (`C:\Users\Kuya\code\sentinel`), which
is why this one keeps a lane branch.

## Landed on `main` this session

1. **PR [#145](https://github.com/Pootytxng/sentinel/pull/145) → `12d9c96a`** — C-17b mono ceiling
   12 → 0, C-12's `shipped-feature-doc-truth` guard, the re-disposition. Ref pruned + row dropped in
   `65dd6110`.
2. **PR [#147](https://github.com/Pootytxng/sentinel/pull/147) → `ebc49da9`** — C-18 (issue #146).
   `TuningPresets` extracted verbatim; the classic Monitor shell, its CSS and its test deleted (353
   lines); the reachability guard's **second tier** (a default-exported room with no production
   importer), falsified against the pre-fix tree. `docs/BACKLOG.md` 111.4KB → 106.5KB by archiving
   the fully-shipped LIVE UPDATER section **verbatim** to `docs/BACKLOG_ARCHIVE.md`. Pruned in
   `377b5eac`.
3. **PR [#149](https://github.com/Pootytxng/sentinel/pull/149) → `68bc1221`** — C-18b (issue #148).
   `Onboarding.tsx` + `.css` deleted (C-05 had already retired the modal); `ONBOARDED_KEY` +
   `type RigLine` moved to `SetupTour.tsx`; four source-text guards moved with it; vendored code
   exempted **by rule** (`VENDOR_PREFIX`) instead of an allowlist entry, pinned narrow by two tests.
   `DEFAULT_ALLOWED` is empty. Pruned in `ef93c546`.

Every merge carried a **work-control receipt PASS** bound to the exact head, gates `npm test` +
`cargo test` from the pre-push local gate, independent review recorded *not practical* with a reason.

## Two findings worth carrying forward

- **The `.arc-v2` row was materially wrong and is now corrected in `docs/BACKLOG.md`.** It called the
  whole skin dead on the strength of `grep -rn "arcV2={" src` — which cannot see JSX shorthand.
  `App.tsx:1228` passes bare `arcV2` to `<FirstCheck/>`, so **M2 (`arc-instrument.css:124–302`, ~39%)
  is LIVE**. M1 (6–123) now has no subject at all. **No line of that file was touched** — the owner's
  "do not delete on current evidence" stands. Next step is per-section, shorthand-aware.
- **bug→guard:** `capability-exception-policy-guard` walked a copy root that no longer existed and
  passed in silence. It now fails on any missing `COPY_ROOTS`/`COPY_DOCS` path.

## Next, in order

1. **C-13 · axe-core in vitest** — the next non-gated `[ ]` (the row above it, Codex weekly-automation
   scope, says "still delegated; do not duplicate"). It is the one with a guard shape.
2. Still open, untouched: the `.arc-v2` per-section decision · **C-14** (`GpuProfile.tsx`, owner fork)
   · `launch-focus-guard` RUNTIME intermittency (**do not "fix" with a skip**) · #121 · #140.

## The debt that still carries

**The C-17b RESIDUAL visual review — 6 of 12 selectors measured.** The desk build `40682344`
predates all three merges. Next build → `scripts/ship-reinstall.ps1` → the `self-review` skill against
those six selectors. Nothing this session adds to it: two deletions of unmounted code and one verbatim
move, all pinned by tests.
