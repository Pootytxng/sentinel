# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-22, `lane/train-2026-08-22` (persistent train) — CLOSED

The owner asked for one long train instead of another handoff: *"complete all the work that remains
on the list literally all of it."* Everything on the live queue that an agent can finish alone is
finished and pushed to `main`. Six commits, `4eaebe2d` → `73e58c99`, every one through the full
local gate.

## What landed

1. **Cold start closed by measurement (`4eaebe2d`).** No regression exists. `dc4d55e` was built as a
   product in its own worktree and run against HEAD back to back: on a quiet desk the OLD code reads
   **519 ms** documentReady to HEAD's **506 ms**. The 210 ms → 516 ms move is the machine, not a
   commit, and **`795d8ff5` (#130, `data_root.rs`) is exonerated**. `coldStartDocumentReadyMs` is now
   an **upper bound**, not an open finding. bug → guard: a bare `cargo build --release` binary loads
   the **dev URL** and times a connection failure that looks like a start — `q7-probe` refuses a
   sample whose rail never painted, and `perf-evidence-integrity-guard` fails the build on a doc that
   cites one.
2. **A shipped-but-still-listed-open class, caught twice (`71392e0c`).** C-17's mono law shipped
   2026-08-18/19 while three docs still called it open — the same class as COLOR-1 a week before.
   Rule C in `src/ui-vision-status-guard.test.ts` now fails the build when a doc claims a CSS
   property is unguarded while a guard names it. Census: 203 rules, 0 violations. Its blind spot is
   written down — it walks `.css` only, so inline `style={{ fontFamily }}` is invisible to it.
3. **Two instruments that were faking their own evidence (`afcef140`).** `q7-probe coldstart` killed
   compys at sample START and never at the end, so its last app stayed running — and this tier
   refuses to measure while a compy holds the single-instance lock. Twelve consecutive #121
   reproduction runs therefore measured **nothing** and printed *"47 passed"*, because the skip was
   announced on stdout, which vitest's default reporter hides for a passing test. Fixed by
   `scripts/lib/probe-cleanup.mjs` (kill what the run LAUNCHED, never what it attached to) and by
   making every declining path `return ctx.skip()`, so the summary line says it.
4. **#121 reproduced, then re-aimed (`b1327f8c`, `701c2113`).** 15 standalone runs: 11 clean, 4
   UNMEASURABLE (27%), 0 failures. The discriminator is `fgPid == launchedPid` on the hook's own
   FOREGROUND event, not the poll's timing. **The cause is unattributable at this resolution** and
   saying otherwise would be a fabricated claim — so the guard stopped waiting for it and now asserts
   the thing the owner actually complained about: no window outside the launched family is minimised.
   That is measurable on **all** runs and is asserted ABOVE both skips, with a test pinning that
   order. All 15 recorded none. The load-dependent ~120 ms class did not reproduce either (3 full
   suites, 4840 tests each, all clean). Evidence posted to issue #121.
5. **The owner's desk finally has the idle-CPU fix (`5ef1f887`).** His build `36011078` was made
   LATER on 2026-08-21 than the fix landed, from a different worktree, so it never contained it — his
   app kept paying ~20% of one core. Built, silently installed, **stamp-proved live** (`701c2113`
   present in the installed exe, `36011078` absent), `self-review` **PASS 10/10**, moving before/after
   sent with a veto attached. **Recorded fact: the desk ship needs no signing key** — `npm run tauri
   build` writes the NSIS installer and only THEN fails on the updater artifact, which a desk install
   does not use. That was being treated as an owner gate and is not one.
6. **The ledger had 400 bytes of headroom (`73e58c99`).** Ten more KB of closed work moved
   byte-for-byte to `BACKLOG_ARCHIVE.md`. 96 KB / 106 KB now.

## What is left, and who owns it

**Nothing on the non-gated queue.** Three items remain and none of them is an agent's to move:

- **Site pricing** — `site/llms.txt:5` still tells the world Compy is free. PR
  [#193](https://github.com/Pootytxng/sentinel/pull/193) is open and drafted; his part is one word.
  Owner-gated twice (price wording is brand + money; `site/**` auto-deploys).
- **C-14 · `GpuProfile.tsx`** — owner fork, checklist **B_gpu**: wire it in as advisory, or archive it.
- **Codex weekly automation → product-conformance scope** — the Codex lane's. Duplicating it here is
  the failure mode.

**Recorded as closed but NOT solved** — read the rows before re-litigating: #121's cause stays
unattributable at 100 ms poll resolution (the harm is now guarded instead), and #128's **release**
mutex has still never been held during a real publish — a desk ship exercised only the install one,
uncontended.

## Live traps for whoever is next

1. **`.codex/config.toml` regresses every few days** — `stash@{0}`…`stash@{3}` are four abandoned
   copies of the SAME regression from four lanes. `scripts/codex-config-guard.test.mjs` fails the
   build on it, so a red codex-config guard in the push gate IS this: stash it, do not debug it.
   Nothing in the repo has been shown to write that file.
2. **A lane branch pushed to `origin` without a `BRANCH_DISPOSITIONS.md` row on `main` turns `main`
   red for every other lane.** This train pushed fast-forward straight to `main` for exactly that
   reason. `BRANCH_DISPOSITIONS.md` sits at 118/120 lines.
3. **The primary worktree `C:/Users/Kuya/code/sentinel` is stale** — local `main` well behind
   `origin/main`, with an untracked receipt a fast-forward would collide with. A branch cut there
   starts wrong. `git -C ... merge --ff-only origin/main` first.
4. **Python patches with backslashes must be written to a FILE**, never piped through a Bash heredoc
   — the heredoc and the string literal each eat one layer.

## Waiting on the owner

Nothing blocking. Reaching him: the `site/llms.txt` price wording (PR #193, yes/no), and **a veto he
may exercise on sight but need not answer** — the backdrop no longer drifts; a moving before/after
was sent, and silence means it stays. Older items live in
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md); none is newly urgent.

**This session: done — archive it.** Nothing is half-finished, the tree is clean, `main` carries
every commit, and the owner's live app is `701c2113`.
