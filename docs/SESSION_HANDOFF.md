# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**The 2026-08-25 persistent-workflow session cleared its queue and closed three issues.** `main` is
green and pushed. Nothing is half-built and no lane is mid-flight. The desk build is `b2b740bf`,
installed and stamp-proved; the published fleet is still v0.9.26 (`5e64074c`).

| Commit | What |
|---|---|
| `041cabbc` | the fixture preview rig had been **dead since #148** — one import of a deleted CSS file made vite 500 on every state; repaired + guarded, and four Q9a states built |
| `b20e59dc` | error copy that read like calm body text, in **three** surfaces; fixed + guarded |
| `e1837670` | #199 items 3–4: `scripts/emit-release-receipt.mjs`, wired into `release.ps1`, plus its guard |
| `e7111bd9` | the "not re-verifiable" caveat given an expiry so it cannot become permanent |
| `493dcc18` | `.claude/`'s three prose invariants (skills index ↔ disk, unwired hooks) became a test |
| `3b279ddf` | the Q9a consent card's two choices sat ~700px apart; given a measure and regrouped |

**Closed:** [#199](https://github.com/Pootytxng/sentinel/issues/199) (all four items),
[#133](https://github.com/Pootytxng/sentinel/issues/133) (Tasks 4–7),
[#203](https://github.com/Pootytxng/sentinel/issues/203) (`.mcp.json` pinned to `shadcn@4.19.0`).
Each carries a gated work-control receipt under `.claude/work-control/`.

## Q9a's one open item is now closed — the consent UI has been reviewed

The visual self-review ran and **PASSed 12/12**, after one round-trip. It could not run on a build:
`receipts_gate()` (`src-tauri/src/receipts.rs:23`) is hard-false, so the surface is unreachable in
anything installable. The route is the fixture rig — and the rig itself was dead and had to be fixed
first. **The owner has the before/after but has not ruled**, so the UI is reviewed, not approved.

What round 1 caught is worth carrying: both failure messages rendered in `receipts-hint`, the calm
grey of ordinary copy, so a refused consent write read as a footnote — and the same defect sat in
`Fix.tsx` (a refused apply reading as an explanation) and `LicensePanel.tsx`. All three fixed;
`src/error-styling-guard.test.ts` fails any component rendering an error in its calm copy's classes.

**Still not arming.** `receipts_gate()` stays false. Before arming could be *considered* — owner
territory, not an engineering task — the independent security review and the EU/UK region check.
**Do NOT arm it.**

### Q9a decisions already made — do not re-litigate, they are argued in the commit bodies

1. **Opt-in, default OFF, and it STAYS off after arming** (owner ruling #207, 2026-08-24). #217's own
   success criterion said the opposite; it is stale. Do not walk it back off the issue text.
2. **No `ip_hash` on the receipt row** — the hash lives only in `usage_rate`, counts only.
3. **No CSP / webview-capability widening** — the send is Rust-side.
4. **`reqwest` carries NO TLS feature** (`default-features = false, features = ["json"]`). Adding
   `rustls` pulled 11 new crates, measured and reverted. TLS arrives from `tauri-plugin-updater`.
5. **Endpoint is `https://compy-bd6.pages.dev/api/usage`** — `compy.gg` does not exist (#201 §1).
   The receiver is live, migrated and **empty**; nothing sends to it.

## What #199 changed about release evidence — read this before the next release

Release-transaction journals live under `src-tauri/target/release/bundle/nsis/`, which is gitignored
by construction, so **no journal has ever been committed** and every past "9 of 9" claim rests on
prose. That is now said out loud in the six affected `RELEASE_STATE.md` rows rather than papered over.

For the future, `scripts/release.ps1` emits a sanitized durable receipt to `docs/release-receipts/`
after the transaction completes. **The next release cut must commit that file** — the guard accepts
the honest caveat only up to v0.9.26, and demands a real receipt for anything newer. Mechanism and
reasoning: [`RELEASE_TRANSACTION.md`](RELEASE_TRANSACTION.md) § Durable receipt.

## The design vision is a separate train — do not fold it into a UI fix

- What `docs/UI_VISION_BACKLOG.md` still lists 🔴 OPEN is **DIR-1** (the standing intuitive-UI lens)
  and **§G** (the site's mini demo, his call). The July motion stack (§A) **shipped**, and the
  panoramic gallery he **deleted** — on 2026-08-25 he answered "no" to bringing it back. Read the
  rows; never re-queue this file from a paraphrase.

## Traps that cost this session real time

- **The fixture rig can be silently dead.** `docs/ui-sweep/fixture/main.tsx` imported a CSS file
  deleted five weeks earlier; vite answered every request with a 500 and each state rendered blank.
  Nothing failed loudly. `src/fixture-parity-guard.test.ts` now resolves every relative import in the
  rig's own sources. **If a fixture state looks empty, check the vite response before the component.**
- **The entry guard refuses writes with `FOLDER_UNCLAIMED` until the issue is BOTH labelled
  `work-control` AND has its `Worktree / branch` board field set.** `adopt` says "adopted anyway"
  when the label is missing and then `assert` still fails. Board cache
  `%LOCALAPPDATA%\CompyEntry\board.json`, 10-min TTL. `Claim expires` / `Last verified` are **date**
  fields: `gh project item-edit --date`, not `--text`.
- **`scripts/launch-focus-guard.test.mjs` fails only under full parallelism** and names the test
  runner's own `node.exe`. It passes 49/49 isolated — re-run before believing it.
- **A rewrite of THIS file can break `src/ui-vision-status-guard.test.ts` rule D**, which counts the
  pointer paragraphs citing the vision file as open and needs at least three across CLAUDE.md, this
  file and the checklist. Dropping the vision section above turns the push red.
- **A new script in `scripts/` is red until `scripts/gate-residency-guard.test.mjs` is told where it
  runs.** It caught `emit-release-receipt.mjs` on the first push of this session.
- **A new command needs FOUR things:** `#[tauri::command]`, registration in `lib.rs`, a name in
  `build.rs` `APP_COMMANDS`, and an `allow-*` grant in `capabilities/default.json`.
- **A new `src/design` component needs an a11y disposition** or `a11y-census-guard` fails.
- **A fresh worktree needs `npm install`** — the pre-push gate `npm ci`s, so junctioning is forbidden.
- **Merge with `gh pr merge --merge`, never `--delete-branch`** (it set `core.bare=true` repo-wide
  once); prune the ref with `git push origin --delete <lane>`, which skips the gate.
- **Bash heredocs eat one backslash level** — use quoted heredocs or the Write tool for TS/JS.
- **Two doc budgets are effectively full:** `RELEASE_STATE.md` 41/42KB and `BACKLOG.md::NEXT UP`
  12.2/12.2KB. Archive a finished row before adding one; **never raise a cap to make room.**

## Repo state a fresh session should know without re-deriving

- **Seven worktrees, all spent.** None is mid-flight; delete or hard-reset before reusing one. The
  nested `.claude/worktrees/merge-prs-tauri-visibility-c5660e` is detached and dirty on
  `.codex/config.toml` and **cannot be removed** without `--force`, which stays owner-blocked.
- **PR [#163](https://github.com/Pootytxng/sentinel/pull/163) is CONFLICTING/DIRTY** and belongs to
  another lane. Do not adopt it opportunistically.
- **#156 and #128 discharge on evidence, not on work.** #156's silent-install flake needs a
  reproduction; #128's release-side mutex has never been held during a real publish. Both collect
  the next time a ship or a release runs — neither is a task to schedule.

## Waiting on the owner (all in `OWNER_ACTION_CHECKLIST.md`)

1. **Register `compy.gg`** (~$50/yr, money). Everything downstream is blocked, including re-pointing
   the endpoint constant off `compy-bd6.pages.dev`.
2. **The Ko-fi URL** (B3a).
3. **Rule on the Q9a consent screens** — he has the before/after; nothing ships on them until he does.
4. Whenever he wants: **#204** (Pro price shape) · **#213 A1** — the wordmark renders `©ompy`, a
   recommendation is attached in §D · **#213 B** needs his ChatGPT mockups.
