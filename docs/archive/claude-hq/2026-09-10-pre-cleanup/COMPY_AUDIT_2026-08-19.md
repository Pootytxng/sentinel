# Compy bring-current audit — 2026-08-19

**Why:** the HQ ledger was last written 2026-08-18 ~22:00Z, mid-day. Three lanes landed on `main`
after that and the ledger never saw them. This audit re-derived every volatile claim from live git,
live GitHub and the live desk, and rewrote `claude/HQ_DECISION_LEDGER.md` to match.

**Method:** read-only. Five batched PowerShell surveys plus one verification pass, run through
Desktop Commander against `C:\Users\Kuya\code\sentinel`. No branch, no commit, no build, no publish.
Scripts left in `C:\Users\Kuya\code\compy-visual-review\` (outside the repo, so no dirty tree).

---

## 1. Live truth as of 2026-08-19

| Fact | Value | Evidence |
|---|---|---|
| `main` HEAD | **`4d1b3d8e`** | `git rev-parse` |
| `main` vs `origin/main` | **0 ahead / 0 behind**, tree clean, on `main` | `git status --short` empty |
| Owner desk build | **v0.9.25, embedded stamp `2f79febb`**, installed, runtime-proved | `docs/SESSION_HANDOFF.md`, RELEASE_STATE `candidate_installed=yes-owner-desk-only` |
| Fleet (published) | **v0.9.25**, release id **370249321**, published **2026-08-13T22:34:15Z** | `gh api repos/Pootytxng/compy-releases/releases/latest` |
| `source_main_commit` anchor | **`2f79febb`** (was `f9303c45` when the ledger flagged it stale) | `docs/RELEASE_STATE.md:28` |
| Compy process on desk | **running (1)** at audit time | `Get-Process compy` |
| Open issues | 133, 129, 128, 127, 126, 125, 121, 64, 55, 54, 49 | `gh issue list` |

**The release repo is `Pootytxng/compy-releases`, not `Pootytxng/sentinel`.** `gh release list` run
against the source repo returns empty and `releases/latest` 404s — that is correct behaviour, not a
finding. Recorded because it cost a round-trip here and will cost the next session one too.

---

## 2. What landed after the ledger stopped looking (17 commits, `94db990b..4d1b3d8e`)

**a. DATA-ROOT INTEGRITY (#130) — CLOSED 2026-08-18T09:23:15Z, `COMPLETED`.**
The ledger still called this "the ACTIVE lane, P0". It is finished:
- Resolver shipped: `795d8ff5` — *"resolve the persistence root by where it LANDS, and make mutation
  need a capability"*. `src-tauri/src/data_root.rs` carries `DataRootDecision`, `MutationRoot` and
  `GetCurrentPackageFamilyName`; `actions.rs` consumes it.
- **`compy_data_dir()` is wired to it.** At `lib.rs:436` it calls `data_root::decision()` and returns
  `decision.effective_root()` — no longer a plain `%APPDATA%` join — and **GUARD 1 gates the legacy
  `Sentinel→Compy` migration on `Canonical`**, because that migration is a recursive COPY that would
  otherwise duplicate the whole Trust Ledger into a sandbox.
- **The `C:\Temp` fallback is gone from the resolution path, and pinned gone by a test.** The one
  remaining occurrence in `src-tauri/src/` is `data_root.rs:917` —
  `assert!(!eff.contains(r"c:\temp"), "must never fall back to C:\Temp: {eff}")`. *(An earlier pass
  of this audit reported "no match remains"; that was wrong in a way that would have read as "the
  fallback is unguarded". Corrected here.)*
- **Recovery actually ran, under owner GO,** which the ledger's design section said would be a
  separate owner-gated lane: `scripts/recover-data-root.mjs --apply` unioned canonical (3 receipts)
  with overlay (61) into **64 receipts** (39 applied / 25 rolled back, 2026-05-28 → 2026-07-29), zero
  id collisions, read-back 64/64 unique. Both inputs backed up first to
  `C:\Users\Kuya\code\compy-data-root-recovery\` (verified present). The overlay `Compy` folder was
  **moved, not deleted** (58 files). Resolver re-run on the real desk now returns
  `C:\Users\Kuya\AppData\Roaming\Compy` → **Canonical**, no longer Conflict.
- Deliberate scope: only `history.json` was unioned. `sessions.json` (1.1 MB), `benchmark.json`,
  `experiments.json`, `drift.json`, `intelligence.json`, `exports/` were archived intact, not merged.
- Branch `agent/data-root-integrity` and worktree `sentinel-data-root-integrity` are both gone.

**⚠️ The one live caveat, and it survives the close:** the **published** v0.9.25 does not carry
`data_root.rs` — it still joins `%APPDATA%`. Until a build carrying the resolver ships, launching
Compy from inside another app's terminal re-splits the ledger. **`release.ps1` /
`ship-reinstall.ps1` Gaming-Mode preflights: the ledger froze them as failing OPEN under a packaged
host. That freeze was NOT re-verified in this audit** — treat it as still in force until someone
reads those two lines.

**b. FRONT DOOR C-05 + C-19 (#137) — CLOSED 2026-08-18T23:23:16Z.** PR #138, squashed as `f86ed9df`.
Both filed premises were wrong and were corrected before code: `SetupLauncherCard` was mounted in
`HomeHud` and `HomeV2` but **not in `HomeConsole`**, which is the default Home — verified live on the
shipped build (`document.querySelectorAll('.stl-card').length === 0`). Deleting the auto-open alone
would have stranded the whole tour behind Settings on the build every user runs. C-19's "three clicks
deep" was generous: on default flags the CPU-temp offer had **no path at all**.

**c. CONFORMANCE C-10 / C-11 / C-17 — merged as `2f79febb` (PR #139), lane closed at `4d1b3d8e`.**
- C-10: last five native `<select>`s gone; `src/design/Picker.tsx` is the one dropdown;
  `src/design/no-raw-select-guard.test.ts` bans the element under `src/`.
- C-11: repeated ledger applies collapse — the owner's 64 applies (37 the same tweak) render as 17
  rows instead of 30.
- C-17: the mono-is-for-machine-values law becomes a census with a down-only ratchet
  (`src/design/mono-law-guard.test.ts`).
- Three independent review rounds: REQUEST CHANGES → APPROVE → APPROVE. It caught **two defects in
  guards written the same day**, plus one false documentation claim.

**d. The two doc-byte ratchets are PAID.** The ledger listed them as outstanding debt. Live:
`docs/BACKLOG.md` **115,228 B** (target was 120 KB) and `docs/RELEASE_STATE.md` **45,890 B** (target
48 KB) — both now *under* target, landed in `fd90a007`/`e0da2f26`. `CLAUDE.md` is **24,962 B**
against the 25,000-byte ceiling in `src/claude-md-laws-guard.test.ts`: **38 bytes of headroom.**

**e. `docs/SESSION_HANDOFF.md` is no longer stale.** The ledger said *"stale v0.9.15/v0.9.17; NEVER
resume from it."* It was rewritten 2026-08-18 19:30 and is now accurate. That warning is retired.

---

## 3. New lessons the ledger did not have

1. **A guard's mutation test must run the guard's REAL code path.** `no-raw-select-guard` could not
   see a `<select` that ENDED a line — the scan splits on newlines and the lookahead had no character
   left. Its own mutation test passed because it fed the matcher a string that still carried its
   newline: a path the real sweep never runs. **Feeding the matcher a hand-built string proves the
   matcher, not the guard.** The sharpest refinement yet of the falsify-every-guard law: a guard can
   be falsifiable *and* blind at the same time.
2. **A lead smaller than your sampling interval is not a measurement.** `classifyForegroundReading`
   split a red gate green on the premise that `firstForegroundMs < firstWindowMs` proved Windows
   fronted the launch. The probe reads foreground first and window second within one 100 ms
   iteration with a `Process.Refresh()` between. It now demands a full poll of margin and reports
   `unattributable-at-launch`.
3. **A documented enforcement that does not exist.** `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF` was
   documented as enforced by "the release gate". No release gate exists and nothing sets it.
4. **#121 is sharper now, and is NOT a flake.** Compy raises its own window ~120 ms after it appears,
   under load — measured twice against the release binary (132 ms / 128 ms, window at 13 ms). The
   guard fails it correctly. Telling the two launch causes apart needs an `EVENT_SYSTEM_FOREGROUND`
   hook, not a finer reading of a 100 ms poll. **Do not close it with a skip.**
5. **A worktree path that does not exist still runs.** The data-root session's working directory
   `.claude/worktrees/data-root-integrity-432797` was absent from disk; every git command silently
   resolved to the main checkout. A session launched there loads no project hooks and no memory —
   relaunch rooted at `C:\Users\Kuya\code\sentinel`.

---

## 4. Ledger claims this audit CORRECTED

| Ledger said | Live truth |
|---|---|
| `main` at `94db990b`, "re-derive from live git" | **`4d1b3d8e`** — 17 commits later |
| #130 is the ACTIVE P0 lane; branch unpushed at `6aa5c8c9` | **CLOSED**; resolver merged `795d8ff5`; recovery executed; branch and worktree gone |
| Runtime data root is `compy_data_dir()` = `%APPDATA%\Compy` | **delegates to `data_root::decision()`** and returns `effective_root()`; describing it as a join would have hidden the fix |
| RELEASE_STATE:28 says `f9303c45` | now **`2f79febb`**, current |
| RELEASE_STATE:177 says fleet v0.9.24 | fleet row now reads v0.9.25 correctly |
| `docs/SESSION_HANDOFF.md` stale — never resume from it | **rewritten 2026-08-18, accurate** |
| Two doc-byte ratchets outstanding (142 KB / 57 KB) | **paid** — 115 KB / 46 KB, both under target |
| Worktree `sentinel-data-root-integrity` is live | **gone** |
| Open-issue table (11 rows) | **#133 [CARE] capability exception rails was missing entirely**; #130 moved to closed; #122 confirmed closed 2026-08-13 |

**Unchanged and re-confirmed:** fleet v0.9.25 / id 370249321 / 2026-08-13T22:34:15Z · #127, #121,
#125, #126, #128, #129, #49, #54, #55, #64 all still open · `beta/private-beta-001` intact.

---

## 5. What this audit did NOT verify (say it plainly)

- **The Gaming-Mode preflight freeze** on `release.ps1:100` / `ship-reinstall.ps1:118`. Not re-read.
  Assume still frozen.
- **#127's attribution has not been re-measured** since 2026-08-13 on v0.9.25 (`efde8310`). One
  commit since then touched rig files — `3eca4a9f` (the Picker port). Numbers are 6 days and 4 lanes
  old.
- **`package-lock.json` has not moved since `efde8310`** — so the "a lockfile refresh pulled in r3f's
  `frames = 2`" hypothesis must be tested *before* that commit, not after. Still unchecked.
- `docs/RELEASE_STATE.md:221-225`'s falsified font hypothesis — not re-checked.
- Nothing was launched, built, installed or published. No CDP look was taken (still do the look from
  a normal session: the *installed* build predates the resolver).

---

## 6. Verification pass

Every commit hash, repo-relative path and external folder named in the rewritten ledger was resolved
live: **21 commits all exist**, 18 are ancestors of `origin/main`, and the three that are not
(`707572f1` local-collision-guard, `63e74591` the unsalvaged skill edit, `defcf0ff` the dead
worktree) are the three the ledger deliberately marks as not-in-main. **14 repo paths and 7 external
folders all resolve.** Guard files were located rather than assumed: `no-raw-select-guard.test.ts`
and `mono-law-guard.test.ts` live under `src/design/`, not `src/` — the ledger now names their real
paths. That pass is what caught the `compy_data_dir()` and `C:\Temp` wording errors above.

---

## 7. The audit's call for the next lane

**#130 was the only thing ahead of #127, and #130 is closed — so RIG-IDLE #127 is now the active
lane.** That is the ledger's own queue order executed, not a new decision. Start with the rig-off Q7
A/B, re-measure on the CURRENT desk build before trusting the 2026-08-13 numbers, and read
`claude/RIG_IDLE_DOSSIER.md` §4 before repeating the page-level rAF probe.

**Separately, and it is the owner's call because it needs his publish GO: the fleet is 6 days and
three lanes stale.** Published v0.9.25 predates the data-root resolver, the front-door fix and the
conformance lane, and marathon law 4 says the fleet moves weekly. Tester J is still on a build that
carries none of it — and the published build is the one that can still re-split its own ledger.
