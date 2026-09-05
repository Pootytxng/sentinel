# Single-entry Compy workflow — implementation plan

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This pre-rebirth build order no longer
> authorizes product work. Current direction and sequence come from `docs/PRODUCT_CONSTITUTION.md`
> and its derived roadmap; useful Work Control implementation provenance remains bounded by current
> `docs/WORK_CONTROL.md`.

**Spec:** [`docs/superpowers/specs/2026-07-30-single-entry-workflow.md`](../specs/2026-07-30-single-entry-workflow.md)
· **Issue:** [#18](https://github.com/Pootytxng/sentinel/issues/18) · **Branch:**
`feat/single-entry-workflow` · **Worktree:** `C:\Users\Kuya\code\sentinel-workflow`

Guard-first throughout: every guard is committed **failing** against current behaviour before the
code that satisfies it exists, and the red output is captured as evidence. A guard that has never been
seen red proves nothing.

---

## Order of work, and why it is this order

Guards 1, 3 and 4 cannot be written until `Worktree / branch` is parseable, and nothing can be
verified until there is a runner that sees `tools/entry`. So: runner → grammar → discovery → the
comparison engine → the two writers (claim, launcher) → the in-session assert → the control folder.
Each phase ends green with its own guards; no phase depends on a later one.

| Phase | Delivers | Guards it unblocks |
|---|---|---|
| 0 | Runner reaches `tools/entry`; lifted `resolveCompactionWindow` | — |
| 1 | Canonical `Worktree / branch` grammar + normalizer + board migration (dry-run) | prerequisite for 1, 3, 4 |
| 2 | Checkout discovery across worktrees **and** separate clones | 6 |
| 3 | Git state inspection | 3, 5 |
| 4 | Settings resolution + hook verification | 2 |
| 5 | The reconciler: named checks → verdict | 4, 7 |
| 6 | `claim.mjs` — post / renew / release | 7 |
| 7 | `session-assert.mjs` + launch token | 1, 8 |
| 8 | `compy-entry.ps1` + `compy-control` + shortcut | end-to-end |

---

## Phase 0 — runner and lifted code

1. Confirm the default vitest `include` picks up `tools/entry/**/*.test.mjs`; add
   `// @vitest-environment node` per file where jsdom is wrong. No config change unless a run proves
   one is needed — a config edit that nothing required is drift.
2. Lift `scripts/lib/compaction-window.mjs` from the `sentinel-feedback` branch **unmodified**
   (`git show feat/user-feedback-lab-recovery:scripts/lib/compaction-window.mjs`), with its tests.
   Reading a blob out of that branch is read-only; it does not touch, merge or reopen it.
3. **Exit:** `node scripts/run-vitest.mjs run tools/entry` runs and reports zero tests, not an error.

## Phase 1 — canonical `Worktree / branch`

**`tools/entry/worktree-field.mjs`**

- `parseWorktreeField(raw)` → `{ ok, entries: [{ path, branch }], reason }`. Splits each entry on the
  **last** ` @ `; git forbids spaces in ref names, which is what makes that split total.
- `normalizeWorktreeField(raw)` → canonical string, or `{ ok: false }` with a named reason.
  Accepts the three legacy formats found on the board; **refuses** genuinely ambiguous values (#12
  names two folders and says the active one is unknown) rather than guessing — collision rule 4.
- Path canonicalization: uppercase drive letter, backslashes, no trailing separator; compare paths
  case-insensitively (Windows) but *store* the on-disk casing, since the drive-letter-casing bug in
  `scripts/run-vitest.mjs` is a live precedent for casing mattering.

**Guards (red first):** round-trip of each legacy format; branch names containing `/` and `-`;
ambiguous multi-folder value refuses; empty/`none`; a path containing `@` without spaces still parses;
case-different paths compare equal but round-trip to their stored casing.

**`tools/entry/migrate-board.mjs`** — reads every item's field, prints a per-item `before → after`
diff, exits 0 without writing. `--apply` writes. Ambiguous items are listed for Kuya, never resolved
by the tool. Run dry-run in this phase; `--apply` is deferred to Phase 8 verification.

## Phase 2 — checkout discovery

**`tools/entry/checkouts.mjs`** → `[{ path, branch, kind: "main" | "linked" | "clone", commonDir, remote }]`

Union of two sources, because neither alone is complete (finding 1):
1. `git worktree list --porcelain` from each known `.git` host;
2. a scan of `C:\Users\Kuya\code\*` for directories containing `.git` (file **or** directory),
   resolving `git rev-parse --git-common-dir` and the `origin` remote for each.

A checkout whose `origin` matches this repository but whose common dir lies inside itself is a
**separate clone** — the class `git worktree list` omits.

**Guard 6 (red first):** a synthetic fixture — `git init` a repo, add a linked worktree, and clone it
separately. Assert `.git` is a file in the linked worktree, that common-dir resolution points at the
host, and that discovery finds the separate clone while `git worktree list` alone does not. Real Git,
no mocks: finding 10 is precisely a case where Git's real behaviour differed from the assumed one.

## Phase 3 — Git state

**`tools/entry/git-state.mjs`** → `{ branch, dirty, untracked, staged, stashed, ahead, behind, detached }`
— five state classes counted **separately**, because "dirty" collapsing them is how a stash gets lost.

**Guards 3 and 5 (red first):** fixtures for each of the five states independently, plus divergence in
each direction, plus detached HEAD; and a checkout on branch `X` whose field claims `Y`.

## Phase 4 — settings and hooks

**`tools/entry/settings-resolve.mjs`** → effective values with **provenance** (`{ value, source }`),
layering user → project → local → environment. Provenance is the deliverable: "150000" is useless
without "from `<folder>/.claude/settings.json`", which is the remediation line.

**`tools/entry/context-policy.json`** — train → intended window. Default 150000. The 300k trial stays
scoped to its own issues and is not adopted globally.

**`tools/entry/hooks-verify.mjs`** — for every hook command in the effective settings, resolve
`$CLAUDE_PROJECT_DIR` against the *target folder* (measured unset in the environment, finding 9) and
assert the file exists. Missing → REFUSE + the exact `--repair` command. `--repair` copies the
canonical set from the control folder and prints what it will write **before** writing.

**Guard 2 (red first):** policy 300000 against a fixture resolving 150000 → refuse, and the message
must name the file and the key. Plus: env overrides project; local overrides project; an unset value
falls back to the documented default.

## Phase 5 — the reconciler

**`tools/entry/preflight.mjs`** — pure functions over injected readers; no process spawning inside the
comparison layer, so every check is unit-testable without a real repository or a live board.

Emits `{ verdict, checks: [{ name, expected, actual, ok }], remediation }`. All checks evaluate even
after the first failure, so Kuya sees the whole picture once instead of peeling failures one launch at
a time.

**Guard 4 (red first):** a board fixture with a second Active item naming the same canonical folder →
refuse, naming the other issue.
**Guard 7 (red first):** the board's `Next action` field compared against the newest `### Handoff`
comment's `Exact next action` line → refuse on drift.

Edge cases from spec §7 each get a case in `preflight.test.mjs`: no task, several Ready, owner-gated,
expired claim, overlapping claims, missing worktree, dirty worktree, branch checked out elsewhere,
live processes, settings needing a fresh session, board unreachable.

## Phase 6 — the claim writer

**`tools/entry/claim.mjs`** — `post` / `renew` / `release`.

- `post` **throws unless handed a PASS verdict object.** The refusal to write without a verdict is
  itself a guard, not a convention.
- Renders the `docs/WORK_CONTROL.md` claim block from *measured* facts — the preflight's own check
  output — so the claim cannot describe a state nobody verified.
- Sets the five minimum fields plus `Status`; uses `--date` for date fields (`--text` fails with
  "Did not receive a date value") and `--clear` to empty `Claim expires`.
- `release` posts the Handoff block, clears the expiry, sets `Last verified`, and sets `Status`/`Gate`
  from the handoff's own declaration.

**Guards:** `post` without a verdict throws; the rendered block contains every WORK_CONTROL field;
`release` clears expiry and writes `Last verified`; date fields use the date form.

## Phase 7 — the in-session assert

**Launch token** at `%LOCALAPPDATA%\CompyEntry\launch.json`:
`{ issue, folder, branch, window, expiresAt, nonce }`. Disposable, outside the repo, single-use nonce.

**`tools/entry/session-assert.mjs`** — compares the real session root against the token and refuses on
disagreement. Registered as a `SessionStart` hook via the Class A overlay (spec §5.3): written into
the target's gitignored `settings.local.json` *after* PASS and *after* the claim is held, disclosed in
the launcher output, followed by re-resolution proving nothing else moved. `--no-overlay` opts out.

**Guard 1 (red first):** token names folder A, assert observes root B → refuse.
**Guard 8 (red first):** simulate a launcher that `cd`s without changing the project root — the
process cwd moves, the recorded root does not, and the assert refuses. This is the guard that would
have caught the #14 wrong-root run.
Plus: expired token refuses; reused nonce refuses; missing token refuses (never silently passes).

## Phase 8 — the launcher and the control folder

**`compy-entry.ps1`** — resolves the control folder from `$PSScriptRoot`, never cwd; asserts its own
pin (remote, tooling branch, common dir inside itself); runs the preflight; on PASS posts/renews the
claim, writes the Class A overlay, opens VS Code with the worktree as the workspace folder, prints one
line; on REFUSE prints expected-vs-actual plus remediation and exits non-zero, writing nothing.

`pwsh` (PS7) only — the ship-script precedent is that PS 5.1 mis-decodes this repo's UTF-8-without-BOM
scripts into parse errors.

**Ordering is the recovery story** (spec §7, "launcher fails halfway"): verdict → claim → overlay →
launch. Every prefix of that sequence is a legal state with a printed next command.

**`compy-control`** — clone `Pootytxng/sentinel` into `C:\Users\Kuya\code\compy-control`, check out the
tooling branch, verify the launcher asserts its own pin, create the Desktop shortcut.
Creating the clone and the shortcut are the only steps that touch anything outside this worktree; both
are additive and removable.

**Guard:** the pin assertion fails when the control folder is on the wrong branch, has the wrong
remote, or is a linked worktree rather than a clone.

---

## End-to-end verification (spec §6 item 12, plan step 6)

From the shortcut only — no `cd`, no absolute paths typed by hand:

1. **REFUSE path first.** Point the entrypoint at #14 (Needs Kuya, Gate Kuya): must refuse, name the
   gate, and write nothing. Then at a fixture with a wrong branch, a dirty tree, and a
   150000/300000 mismatch: each must refuse with a remediation line.
2. **PASS path.** A real Ready task routes to the right folder, posts the claim, and the in-session
   assert agrees. Capture the assert's own output as the proof that the root is real, not assumed —
   the launcher's word for its own correctness is exactly what #14 shows is insufficient.
3. **Release.** Handoff posted, expiry cleared, `Last verified` set, board `Next action` matching the
   handoff (guard 7 green against live data), and the control folder reopened.
4. Full suite green: `node scripts/run-vitest.mjs run` — not just `tools/entry`.
5. Board migration `--apply` after its dry-run diff is reviewed; ambiguous items reported to Kuya.

---

## Preserved throughout

- `feat/user-feedback-lab-recovery` (#14) is read only as a blob source in Phase 0. Not touched,
  merged, rebased, enabled or reopened.
- `code\sentinel-rel` (#17) — working tree, `docs/BACKLOG.md`, and the untracked
  `2026-07-29-product-quality-stabilization-program.md` — preserved exactly. Discovery in Phase 2
  reads only; it never writes into a discovered checkout.
- No Compy build, install, release, distribution, Lab change, or product feature work.
- No merge of this branch without separate authorization.
