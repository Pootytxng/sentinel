# Version policy proposal — getting past `0.1.0`

**Status:** DECIDED — owner call 2026-07-16: **"0.9.0 now, 1.0.0 at your bar"** (Option B). Applied
same day: all three manifests + Cargo.lock bumped to `0.9.0`; `scripts/ship-reinstall.ps1` now
DERIVES the installer filename from `tauri.conf.json` (hardcoded literal removed); three-way+lock
drift-guard added (`scripts/version-drift-guard.test.mjs`). 1.0.0 fires when Claude judges the
1.0 bar met (release-hardening checklist green) and the owner confirms.
**Provenance:** panel-review brief 2026-07-15 §4.9 (`docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`)
+ archived review (`docs/reviews/2026-07-15-consumer-panel-review.md`).
**Rule:** Claude drafts, the owner decides the scheme + the next number. Never renumbered unilaterally.

## The problem

Every version string in the repo still reads `0.1.0` — `src-tauri/tauri.conf.json:4`,
`src-tauri/Cargo.toml:3`, `package.json:4` — so the NSIS installer presents as `Compy 0.1.0`. A panel
reviewer read that as "early alpha, don't trust it with my registry," which directly undercuts the
trust-engine identity. The number has never been bumped since scaffold; it carries zero information
about the app's actual maturity (Gaming Mode live, field QA 10/10, private-beta kit frozen).

The build STAMP (`COMPY_GIT_HASH`, `get_build_stamp`) is the *internal* truth for "which build is
this" and is unaffected by any choice here — this proposal is purely about the human-facing number.

## What a version must do for Compy

1. **Signal trustworthiness** to a non-technical user reading an installer dialog (the panel finding).
2. **Order builds** for support ("what version are you on?") without needing a git hash.
3. **Never overpromise** — honest-measurement law applies to the number too: `1.0` says "I consider
   this done"; we don't ship that signal until the 1.0 bar is actually met.

## Options

### Option A — SemVer with an honest pre-1.0 bump (RECOMMENDED)
Jump to **`0.9.0`** now (reads "release candidate era, actively polished"), bump patch per shipped
installer batch (`0.9.1`, `0.9.2`, …), and reserve **`1.0.0`** for the owner-declared 1.0 gate
(product-perfection focus per the 2026-06-16 directive). Pros: standard, honest, the `0.9` band
matches where the product actually is, and `1.0.0` stays a meaningful event. Cons: still a `0.x` on
the installer until 1.0 — a skeptic can still read "beta" (which is currently *true*, so this is
honest, not a flaw).

### Option B — CalVer (`2026.7.0`)
Year.month.patch. Pros: always looks current, no "alpha" smell, zero ceremony. Cons: loses the 1.0
moment entirely (there is never a "we're done polishing" signal), and gamers expect SemVer-shaped
versions in installers.

### Option C — Straight to `1.0.0` at beta send
Pros: strongest trust signal. Cons: violates the never-overpromise rail — the owner has explicitly
kept 1.0 as the perfection bar; shipping the number before the bar is a fabricated claim in version
form. Not recommended.

## Mechanics of a bump (any option, ~10 min, reversible)

- Set the same string in `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` + `package.json`
  (three files, one commit; `Cargo.lock` updates on next build).
- NSIS filename + installer metadata pick it up automatically on the next `tauri build`.
- Frozen `beta-001` refs (`16069fa`) are untouched — historical artifacts keep their number.
- Add a guard: a tiny script/test asserting the three version strings match, so they can't drift
  (bug→guard; wire into the existing test lane).

## The owner call (one line is enough)

Pick: **A (`0.9.0` now, `1.0.0` at your bar)** · B (CalVer) · C (1.0 now) · or name your own number.
On the answer, Claude applies the bump + match-guard in one commit and rebuilds/reinstalls per the
ship law.
