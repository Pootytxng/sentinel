# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Desk build `0fbabb93` (stamp-proved, `-VerifyRuntime`, 1 attempt) — #213's B half is DONE.**
`main` is green, nothing half-built, no lane mid-flight. Fleet is still v0.9.26 (`5e64074c`).

| Commit | What |
|---|---|
| `4ec3749b` | **#213's B half was never blocked.** Three ledgers said it "needs the owner's ChatGPT mockups" — invented in `642d48d6`, never re-derived, and it handed his own complaint back to him. His four room comps were **approved 2026-08-23** and bundled. Retracted + guarded (`src/design/approved-comps-guard.test.ts`, which records the bundle path IN the test because prose is what failed). |
| `4d65902e` | **B1 + B5 built, measured off the comps.** The titlebar was grounding on `--ix-base`, which the default violet theme tints (`rgb(12,10,20)` measured on the old binary) — the comps sample `#0a0c10`. The rail seam was drawing a bevel's light half with nothing under it. Both now token-only and pinned. |
| `0fbabb93` | **B5 was a general rule, not one seam.** The comps draw EVERY plane boundary as two rows — highlight on the panel's edge, shadow on the ground outside it — and the app shipped only the light half everywhere. The titlebar/app and topbar/content seams now match (`.wc-bar::after`, `.v2-top` box-shadow). Guard written FIRST: `src/design/seam-bevel-guard.test.ts`, 12 tests, with the PIL samples in the header and a falsification case. |

**The card edges were measured too and deliberately NOT changed** — implied alpha ~0.13 against
0.32–0.43 at the plane seams, i.e. at the render's noise floor. The numbers are in the #213 comment
rather than a second token guessed into existence.

**The other three B items came back wrong, and were NOT built.** B2 is the owner's own 2026-08-23
ruling (`--v2-cta: #2ed083`, sampled off the comps in `a83d4809`). **B4** likewise — the comp draws
the nav numerals as bordered chips. **B3 is disproven by measurement**: the comp's headline measure
is ~16ch, *narrower* than the shipped 20ch, so the three-line wrap is copy length, not type scale.
The real finding under it is `revertedTitle_one` — the title placeholder interpolates an unbounded
recommendation title into a display-size headline. **Two A-list items were wrong too:** A5's fix
deviates from the comp (which prints "Compy" in both places on purpose), and A1's `©ompy` is in the
approved comp, so it is the mark he signed off, not a regression that crept in.

> **The lesson, and it has now cost two sessions: check the owner decision behind a surface before
> "fixing" it.** #213 was filed by an agent audit the day AFTER he approved the comps. Acting on its
> B half unread would have reverted his ruling. Memory: `guard-passing-is-not-owner-conformance`.

## The comps are the spec — read this before any design work

Owner ruling 2026-08-23 (`a83d4809`): where a room's approved picture and your taste disagree, **the
picture wins**, colours are SAMPLED (PIL) and never guessed, and *every* difference is a finding —
judging whether one is justified is not the reviewer's job. The bundle path is pinned in
`src/design/approved-comps-guard.test.ts`; that test SKIPS loudly off this machine rather than
passing vacuously. **jsdom never loads these stylesheets**, so no rendering test can see a colour
regression — only the picture can, and the picture costs a build + install + review round.

## Q9a is closed and STAYS dark

The consent UI PASSed self-review 12/12 via the fixture rig (the surface is unreachable in a build:
`receipts_gate()` at `src-tauri/src/receipts.rs:23` is hard-false). **The owner has the before/after
but has not ruled**, so it is reviewed, not approved. **Do NOT arm it.** Decisions already argued in
the commit bodies — do not re-litigate: ① opt-in, default OFF, and it **stays** off after arming
(owner ruling #207; #217's own success criterion says the opposite and is stale) ② no `ip_hash` on
the receipt row, no CSP widening; `reqwest` carries **no** TLS feature, TLS arrives from
`tauri-plugin-updater` ③ endpoint is `https://compy-bd6.pages.dev/api/usage` — `compy.gg` does not
exist yet; the receiver is live, migrated and empty.

## The design vision is a separate train — do not fold it into a UI fix

- What `docs/UI_VISION_BACKLOG.md` still lists 🔴 OPEN is **DIR-1** (the standing intuitive-UI lens)
  and **§G** (the site's mini demo, his call). The July motion stack (§A) **shipped**, and the
  panoramic gallery he **deleted** — on 2026-08-25 he answered "no" to bringing it back. Read the
  rows; never re-queue this file from a paraphrase.

## Traps that cost real time

- **A rewrite of THIS file can break `src/ui-vision-status-guard.test.ts` rule D**, which counts the
  pointer paragraphs citing the vision file as open and needs at least three across CLAUDE.md, this
  file and the checklist. Dropping the vision section above turns the push red.
- **The fixture rig can be silently dead.** `docs/ui-sweep/fixture/main.tsx` once imported a CSS file
  deleted five weeks earlier; vite answered every request with a 500 and each state rendered blank.
  **If a fixture state looks empty, check the vite response before the component.**
- **The entry guard refuses writes with `FOLDER_UNCLAIMED` until the issue is BOTH labelled
  `work-control` AND has its `Worktree / branch` board field set.** `adopt` says "adopted anyway"
  when the label is missing and then `assert` still fails. Board cache
  `%LOCALAPPDATA%\CompyEntry\board.json`, 10-min TTL. `Claim expires` / `Last verified` are **date**
  fields: `gh project item-edit --date`, not `--text`.
- **`launch-focus-guard` runtime tier is intermittent — NEW lane, needs an idle desk**
  (`docs/BACKLOG.md`). 48/50 isolated; it fails only under full parallelism and names the runner's
  own `node.exe`. **Do not silence it with a skip** — instrument the probe to record WHAT raises the
  window; a raise 2.4s after launch is real while he games.
- **A new script in `scripts/` or `.codex/hooks/` is red until `scripts/gate-residency-guard.test.mjs`
  is told where it runs.**
- **A new command needs FOUR things:** `#[tauri::command]`, registration in `lib.rs`, a name in
  `build.rs` `APP_COMMANDS`, and an `allow-*` grant in `capabilities/default.json`.
- **A new `src/design` component needs an a11y disposition** or `a11y-census-guard` fails.
- **A fresh worktree needs `npm install`** — the pre-push gate `npm ci`s, so junctioning is forbidden.
- **Merge with `gh pr merge --merge`, never `--delete-branch`** (it set `core.bare=true` repo-wide
  once); prune the ref with `git push origin --delete <lane>`, which skips the gate.
- **Bash heredocs eat one backslash level** — use quoted heredocs or the Write tool for TS/JS.
- **Doc budgets are effectively full:** `RELEASE_STATE.md` 41.5/42KB, `BACKLOG.md::NEXT UP` 12.1/12.2KB. `SESSION_HANDOFF.md` 118/120 lines. Overflow is paid by archiving verbatim behind a pointer — **never by raising a cap.**
  Archive a finished row verbatim before adding one; **never raise a cap to make room.**

## Repo state a fresh session should know without re-deriving

- **Eleven worktrees besides `main`; six are spent but FOUR still carry work that is not on main** —
  `lane/cleanup-train-2026-08-20` (PR #163 closed superseded), `feat/user-feedback-lab-recovery`,
  `feat/lab-49-parity-port`, `lane/vision-pointer-guard-2026-08-24`. Do not reset those. The nested
  `.claude/worktrees/merge-prs-tauri-visibility-c5660e` is detached, dirty on `.codex/config.toml`,
  and **cannot be removed** without `--force`, which stays owner-blocked. `sentinel-testrig` holds an
  **ungated draft** receipt for the already-merged PR #194 — preserve it, never commit it as a receipt.
- **The board carries stale rows.** #55/#54 are `Active`/`Review` on the Codex lane and point at
  `sentinel-project-doctor`, **a worktree that no longer exists** — left alone, because a stale claim
  is an alarm, not a takeover (WORK_CONTROL §5).
- **#156 and #128 discharge on evidence, not on work.** #156's silent-install flake needs a
  reproduction; #128's release-side mutex has never been held during a real publish. Both collect
  the next time a ship or a release runs — neither is a task to schedule.
- **Release journals were never committable** (gitignored by construction), so every past "9 of 9"
  claim rests on prose. `scripts/release.ps1` now emits a durable receipt to `docs/release-receipts/`:
  **the next release cut must commit that file.** See [`RELEASE_TRANSACTION.md`](RELEASE_TRANSACTION.md).

## Waiting on the owner (all in `OWNER_ACTION_CHECKLIST.md`)

1. **Register `compy.gg`** (~$50/yr, money). Everything downstream is blocked, including re-pointing
   the endpoint constant off `compy-bd6.pages.dev`.
2. **`B_shelter` (#128).** 1,100 lines of finished, verified collision-guard code, unpushed since
   2026-08-18. One word: land it or retire it.
3. **The Ko-fi URL** (B3a).
4. **Rule on the Q9a consent screens** — he has the before/after; nothing ships on them until he does.
5. Whenever he wants: **#204** (Pro price shape). **#213 A1 is answered** — the `©ompy` glyph is in
   his own approved comp, so there is nothing to decide unless he wants it changed.
