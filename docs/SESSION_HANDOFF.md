# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue [#49](https://github.com/Pootytxng/sentinel/issues/49)'s work is ON `main`.** 49 commits,
fast-forward, no lane branch left on origin. The desk build `ccc17355` is no longer a thing one disk
holds — `main` carries the screen code the owner is actually running.

Worktree `C:\Users\Kuya\code\sentinel-visual-2026-08-24` · branch `lane/four-room-land-2026-08-24`
(local only, never pushed under its own name). The building lane's own worktree
`C:\Users\Kuya\code\sentinel-fourroom` is clean and its tip `f07ae1c2` is contained in `main`.

**#49 is NOT closed.** Its direction half (B1–B5 below) has not been built.

## What this session did

The owner handed over the merge decision — *"it starts with your merge decision"* — and it was made
**land it**: 49 commits of installed, self-review-PASSed work existed on one local disk plus a single
backup ref, and [#213](https://github.com/Pootytxng/sentinel/issues/213)'s fixes live in exactly the
files this lane owns, so writing them anywhere else guaranteed a merge back through it. Landed on a
copy branch so the live `sentinel-fourroom` claim was never touched. Four doc conflicts, **zero
source conflicts.**

1. **Disk bloat — resolved in both halves.** The flag was not green because the machine was clean; it
   was *structurally blind*. Six build trees held **59.08 GB** and not one was over the 20 GB
   per-tree line, on a drive at 92%. `cargo clean` on the four trees no lane was using returned
   **35.9 GB** (81 → 112 GB free); the two live lanes were left alone. Then the rule itself was
   extended — an **IDLE** class (under the line, untouched 14 days) and a **FLEET** total (40 GB
   across all worktrees) — with 11 new guard cases, so that blindness cannot recur. Still report-only
   in every class: `scripts/disk-bloat-guard.test.mjs` asserts the source can never delete.
2. **INSTALLED-STAMP-DRIFT settled from the real machine** — `verify-release-state.mjs --strict` is
   **31/31 ok, 0 state-drift**, and its check (7) reads the actual installed `compy.exe`. The Cowork
   container's `8b1599b3` reading was its own overlay view and is **not** truth about this desk.
3. **`origin/backup/four-room-preservation-2026-08-23` deleted**, its disposition row dropped in the
   same change, after proving `f07ae1c2` is an ancestor of what landed.

## What is left, and who owns it

**[#213](https://github.com/Pootytxng/sentinel/issues/213) is the next work, and it splits in two.**
The amendment the Cowork lane earned holds: *a clipped element, an overlapping glyph, or an unstyled
native control is a correctness failure, not a matter of taste.*

- **A2–A5 + [#211](https://github.com/Pootytxng/sentinel/issues/211) — correctness, mine, no
  direction needed.** Two causes are already pinned: **A4** is `title={railLabel(item)}` at
  `src/design/ShellV2.tsx:231`, a raw native tooltip duplicating the visible label two lines below
  it; **A5** is the duplicate "Compy" — `wc-title` (`src/design/WindowChrome.tsx:61`) sitting within
  60 vertical px of the rail `<Wordmark>` (`ShellV2.tsx:204`). **A2** (orphan corner bracket, top
  left) and **A3** (fragment clipped off the left window edge) still need their causes found; a grep
  for negative offsets across `src/design/*.css` did not settle either.
- **A1 (`©ompy`) is the owner's**, and only because the taste decree names the logo as its one
  exception. `src/design/Wordmark.tsx`'s pulse-C arc plus `Wordmark.css`'s `-0.053em` tuck reads as a
  copyright glyph at rail size. Goes to him **with a recommendation and a rendered before/after**,
  never as a menu.
- **B1–B5 is direction and belongs to #49** — it needs the owner's ChatGPT mockups, which no session
  in this repo has yet.
- **[PR #163](https://github.com/Pootytxng/sentinel/pull/163) is still open** and needs a
  disposition; its handoff-block half already reached `main` as `39841601`.

## Live traps for whoever is next

1. **A short-lived PR branch is a trap here, not a convenience.** The disposition audit fails **both**
   ways, so a pushed lane ref with no row turns `main` red for every other lane, and a row for a ref
   the merge deletes turns it red the other way. Land fast-forward to `main` and carry no lane branch.
2. **Deletion-only pushes skip the gate** (`.githooks/pre-push`), which is the ONLY way out of the
   deadlock where the audit fails *because* the ref it wants deleted still exists.
3. **`.codex/config.toml` regresses every few days** ([#196](https://github.com/Pootytxng/sentinel/issues/196))
   — a red `codex-config-guard` in the push gate IS that regression: discard it, do not debug it.
4. **`npm run tauri build` exits 1 on a desk build and that is not a failure.** Both bundles are
   written; the non-zero comes from the updater-signature step alone. Read the log, not the exit
   code — and never pipe the build through `tail`, which reports `tail`'s exit code instead.
5. **The owner-installed row is byte-capped at 3000** (`LINEAGE_ROW_CAPS`, check 5b), and **check 9
   reads the Bottom line too** — re-stamping the row and the `STATE:` anchor is not enough.
6. **A fresh worktree needs its own `npm ci`**, and its `node_modules` must never be junctioned from
   a neighbour: the pre-push gate `npm ci`s through the link and wipes the other tree.

## Waiting on the owner

1. **The `©ompy` wordmark call** — brand territory, the one thing in #213 that is not mine.
2. **His ChatGPT mockups for the four rooms**, which unblock #213's B half and the rest of #49.
3. **PR #163's disposition.**

Full standing list: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
