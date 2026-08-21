# Session handoff — 2026-08-20 (#171 verify-local flake: ROOT-CAUSED, FIXED, GUARDED, MERGED, CLOSED)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`, branch **`lane/gate-171`** cut from
origin/main `25e2b019`. Issue [#171](https://github.com/Pootytxng/sentinel/issues/171) claimed at
session start (ownership claim posted). No build, no install — the desk still runs `ab54f1e4`.

## What this lane did

- **`cf77ea24`** — carried the untracked PR #183 merge receipt + the sweep-180 handoff refresh
  (the chain #181/#182/#183 all used).
- **`e52133b2`** — the fix. Root cause **reproduced on demand**: three site suites each rebuilt
  `site-app/dist` from separate vitest workers; two `astro build`s in one `dist/` delete each
  other's SSR intermediates, the loser dies with "Cannot find module dist/renderers.mjs", and
  Node 24 on Windows turns that `process.exit(1)` into a `0xC0000409` abort (nodejs/node#56645,
  open upstream). Before: 2/2 runs crash with the issue's exact exit code. After: 0/3.
  - `scripts/stage-dist-site.mjs` — `withSiteBuildLock` (atomic mkdir, orphan/stale reclaim) +
    `ensureSiteAppBuilt` (freshness check INSIDE the lock). The three suites use it.
  - `scripts/verify-local.ps1` — a Node-hosted check that exits with exactly the abort code is
    re-run ONCE, with a WARN naming the cause; never cargo, never any other code.
  - Guards: `scripts/site-build-collision-guard.test.mjs` (real 4-process race),
    `scripts/local-gate-guard.test.mjs` §"Node-runtime-abort re-run" (source pins + a PowerShell
    5.1 behavioural probe of the real `Invoke-Check`). Both mutation-tested.
- **Unverified, stated plainly:** the issue's single `npm run build` abort shares the death
  signature; its trigger was not captured and cannot be now (`sentinel-prune` is gone, no
  junctioned `node_modules` exist today). The once-only re-run covers it and a repeat now prints
  `LOCAL CHECK WARN … see issue #171`.
- **Not changed on purpose:** vitest's worker count (the issue's second suggestion) — no evidence
  it was the cause, and shrinking it blind is the mistake `nested-vite-server-guard` documents.

- **`553d6911` (PR #185)** — bug→guard on my own miss: the #184 merge used `gh pr merge
  --delete-branch`, which `RELEASE_AUTONOMY.md:26` bans (`core.bare` stayed false — checked; the
  remote ref needed a manual prune). Now a permission-layer deny in `.claude/settings.json`; the
  literal flag must appear, so plain merges are untouched. Carried the #184 receipt.

## For the NEXT lane's first commit

1. **`.claude/work-control/2026-08-20-merge-pr-185.json`** sits untracked here — it rides the next
   lane's first commit, same chain as #181–#184.
2. This file's refresh (uncommitted here) rides that same commit.

## Queue

`docs/BACKLOG.md` top after this: **#121** (`launch-focus-guard` RUNTIME tier intermittent — no
longer "the same cause as #171", whose cause was the site build race), then #126, #156, #128
and #125. Nothing blocked on the owner.
