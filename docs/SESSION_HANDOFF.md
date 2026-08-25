# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Q9a is built, dark, merged.** [#217](https://github.com/Pootytxng/sentinel/issues/217) closed via
PR [#218](https://github.com/Pootytxng/sentinel/pull/218), merged `8b2f0f64`; the lane ref is pruned.
`C:\Users\Kuya\code\sentinel-q9a` is spent and still stands on `c6d8da3e` — a merge updates no
existing worktree, so delete or reset it before reusing it. `receipts_gate()`
(`src-tauri/src/receipts.rs:23`) is still **false** — this train built the path, it did not arm it.

| Commit | What |
|---|---|
| `8d8feddd` | Tier 2 receiver: `functions/api/usage.ts`, `migrations-reports/0001_usage.sql`, `REPORTS` binding, `scripts/usage-endpoint-guard.test.mjs` |
| `6efd01bf` | the Rust send path: `send_decision` (gate → disclosure → opt-in), `post_receipt`, consent store, 11 tests |
| `3f033573` | nine live docs stopped claiming "no send path exists"; PRIVACY v0.6; the missing policy-guard assertion |
| `c6d8da3e` | first-run disclosure + a real off switch; `Toggle` moved to `src/design/` |

`scripts/verify-local.ps1` **PASS** at `c6d8da3e` — 376 files, 5170 tests, tsc, build, Rust 975,
clippy. CI is `workflow_dispatch`-only, so the local gate IS the gate.

### Decisions already made — do not re-litigate, they are argued in the commit bodies

1. **Opt-in, default OFF, and it STAYS off after arming.** #217's own success criterion said to
   amend the guard to "default-ON + disclosure"; the owner **overruled that on 2026-08-24 (#207)** —
   the shipped app description and public download page already promise "No telemetry". The doc and
   guard changes went the TIGHTER way. Do not walk it back off the stale issue text.
2. **No `ip_hash` on the receipt row.** The hash lives only in `usage_rate`, counts only, and every
   POST deletes rows past the hour **inside the same batch as the insert**.
3. **No CSP / webview-capability widening** — the send is Rust-side.
4. **`reqwest` is declared with `default-features = false, features = ["json"]` and NO TLS feature.**
   Adding `rustls` pulled **11 new crates** (aws-lc-sys, cmake, quinn — measured in `Cargo.lock`,
   reverted). TLS arrives from `tauri-plugin-updater`. Pinned by three tests in
   `src/support-evidence-outbound-guard.test.ts`.
5. **Endpoint constant is `https://compy-bd6.pages.dev/api/usage`** — `compy.gg` does not exist
   (#201 §1). Re-pointing is a pre-arming checklist item.

### What Q9a still owes

- **The visual self-review was NOT run, so the consent UI is NOT owner-approved.** The surface is
  dark and cannot be captured from a running build; the fixture-preview route
  (`[[live-fixture-preview-via-vite-cdp]]`) is how to reach the disclosure and switch states. This
  is the one open item from the merged lane — it is in the Q9a BACKLOG row too, not only here.
- Before arming could ever be *considered* (owner territory, not an engineering task): the
  independent security review, and the EU/UK region check. **Do NOT arm `receipts_gate()`.**

## The money-stack Phase 2 ask was answered by measuring, not building

The owner asked for a new lane for the compy.gg one-pager + waitlist. **It is already built and has
been deployed since 2026-07-15** — so no build lane was cut. What the KPI actually says:

**5 waitlist signups, every one of them 2026-06-12/13. Nothing in ten weeks.** The lever is traffic
(#206) and the domain (#201 §1), not more website. Building a second one-pager would have produced a
prettier page with the same zero.

Production had also been **2 weeks stale**, still calling Compy *"a free desktop app"*. **Deployed
2026-08-25** on the owner's yes, after he was told the staged tree now also carried
`functions/api/usage.ts`: `npx wrangler pages deploy dist-site --project-name compy`. Promotion
proven by hash — `compy-bd6.pages.dev` and the deployment URL return byte-identical HTML, so a
"stale" apex is his browser cache, not the deploy.

**The Tier 2 receiver is LIVE and inert.** `compy_reports` migration 0001 applied, `IP_PEPPER` set,
`/api/usage` answers GET with 405 and a junk POST with 400 `{"ok":false}`. Nothing on any PC sends
to it — `receipts_gate()` is false — and the table is empty. Standing it up before the arming
commit is the sequence `functions/api/usage.ts` was designed around, not a step ahead of the gate.

## The design vision is a separate train — do not fold it into a UI fix

- What `docs/UI_VISION_BACKLOG.md` still lists 🔴 OPEN is **DIR-1** (the standing intuitive-UI lens)
  and **§G** (the site's mini demo, his call). The July motion stack (§A) **shipped**, and the
  panoramic gallery he **deleted** — on 2026-08-25 he answered "no" to bringing it back. Read the
  rows; never re-queue this file from a paraphrase.

## Traps that cost this session real time

- **The entry guard refuses writes with `FOLDER_UNCLAIMED` until the issue is BOTH labelled
  `work-control` AND has its `Worktree / branch` board field set.** `adopt` says "adopted anyway"
  when the label is missing and then `assert` still fails. The board cache is
  `%LOCALAPPDATA%\CompyEntry\board.json`, 10-minute TTL — after editing the board, call
  `invalidateBoardCache()` or wait it out. `Claim expires` / `Last verified` are **date** fields:
  `gh project item-edit --date`, not `--text`.
- **`scripts/launch-focus-guard.test.mjs` fails only under full parallelism** and names the test
  runner's own `node.exe` console as the minimised window. It passes 49/49 isolated. It failed one
  push and passed the retry — re-run before believing it.
- **A rewrite of THIS file can break `src/ui-vision-status-guard.test.ts` rule D**, which counts the
  pointer paragraphs citing the vision file as open and needs at least three across CLAUDE.md, this
  file and the checklist. Dropping the vision section above turns the push red.
- **A new command needs FOUR things or it fails at runtime:** `#[tauri::command]`, registration in
  `lib.rs`, a name in `build.rs` `APP_COMMANDS`, and an `allow-*` grant in
  `capabilities/default.json`. `src/command-authority-guard.test.ts` catches it; the permission
  `.toml`s are gitignored and regenerate on build.
- **A new `src/design` component needs an a11y disposition** or `a11y-census-guard` fails — roster it
  in `a11y-axe-guard.test.tsx` rather than writing a reason string.
- **A fresh worktree needs `npm install`** — the pre-push gate `npm ci`s, so junctioning is forbidden.
- **`git fetch origin --prune` before trusting the disposition audit**; add a lane's own row only
  **after** its first push, and delete the row again once the lane merges and its ref is pruned.
- **Merge with `gh pr merge --merge`, never `--delete-branch`** (it set `core.bare=true` repo-wide
  once); prune the ref afterwards with `git push origin --delete <lane>`, which skips the gate.
- **Bash heredocs eat one backslash level** — use quoted `<<'EOF'` or the Write tool for TS/JS.
- `docs/RELEASE_STATE.md` hit its 42KB ceiling this session; the resolved #130 row was archived to
  make room. Archive before adding — never raise a cap.

## Waiting on the owner (all in `OWNER_ACTION_CHECKLIST.md`)

1. **Register `compy.gg`** (~$50/yr, money). Everything downstream of it is blocked, not scheduled —
   including re-pointing the endpoint constant off `compy-bd6.pages.dev`.
2. **The Ko-fi URL** (B3a).
3. Whenever he wants: **#204** (Pro price shape) · **#213 A1** — the wordmark renders `©ompy`, a
   recommendation is attached in §D · **#213 B** needs his ChatGPT mockups.
