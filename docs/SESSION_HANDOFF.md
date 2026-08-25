# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**The [#216](https://github.com/Pootytxng/sentinel/issues/216) entry-verification rebuild is DONE
and ON `main`** (`9cc778cb` the rebuild, `92752920` a measured-fact comment fix, `5c3689be` the
work-control receipt; fast-forward push 2026-08-25, `scripts/verify-local.ps1` PASS at `92752920`,
log `logs/verify-local-2026-08-25T09-32-09Z.log`). Worktree
`C:\Users\Kuya\code\sentinel-vision-pointer` · branch `lane/vision-pointer-guard-2026-08-24` (no
lane ref pushed; main carries everything). Immediately before it, [#215](https://github.com/Pootytxng/sentinel/issues/215)
landed the UI-vision pointer guard (`7e875a0a`) and [#214](https://github.com/Pootytxng/sentinel/issues/214)
the design-system drift-lock (`6c054b77`).

**The owner's desk still runs the `6c054b77` build.** Nothing since then touches `src-tauri`, so
there is nothing to reinstall — but the next ship's self-review must eyeball the Setup back-button
fade (`66bd28c2`, a 350ms opacity snap→fade in the tour footer; end state was always correct).

## What the entry rebuild changed (so nobody re-litigates it)

A session used to prove itself with a LAUNCH TOKEN — one folder, one conversation, claimed once.
Exactly one session could hold it and it kept holding it after that session died, which is how a
launcher CLI with no process and no transcript locked the owner's own window out of this folder for
twelve hours. Verification is now BY FACTS, measured at SessionStart and on every project write:

1. the folder is a git work tree of `Pootytxng/sentinel`;
2. Work Control names it — an issue's `Worktree / branch` field points here and the live branch is
   the one the board put that issue on (cached 10 min machine-wide; `launch.mjs` clears that cache
   the moment it posts a claim, or a fresh worktree reads as unclaimed);
3. no **live** competing writer holds it.

Any Claude tab in the right folder verifies, launched or not. The per-folder record is a WRITER
LEASE — it names the conversation and its pid, authorizes nobody, and enforces one-writer-per-folder
only. **Liveness ordering is load-bearing: the pid may only PROMOTE a lease to live; the transcript
at `~/.claude/projects/*/<sessionId>.jsonl` is what CONDEMNS.** Measured 2026-08-25: a lease written
at 09:16 recorded pid 26224 and that pid was gone fourteen minutes later while the session was still
typing, so a pid-only rule would condemn live sessions. Unknown still locks the folder (collision
rule 4). Guard: `tools/entry/writer-contention.test.mjs` (54). `launch.json` survives as launcher
plumbing (ide-bridge nonce + brief digest) and no assert reads it — pinned by extracting every
`refuse("CODE")` literal from the hook source.

Two deliberate calls, both reported to the owner: the token file was demoted rather than deleted,
and the context-window check dropped from a refusal to a recorded note.

## What is left on this arc, and who owns it

- **Nothing mechanical.** #216 is closed with a gate-PASS receipt
  (`.claude/work-control/2026-08-25-close-issue-216.json`), evidence in
  [#216 issuecomment-5408439086](https://github.com/Pootytxng/sentinel/issues/216#issuecomment-5408439086).
- **The owner's larger design VISION is not this train.** What `docs/UI_VISION_BACKLOG.md` still
  lists 🔴 OPEN is DIR-1 (the standing intuitive-UI lens) and §G (the site's mini demo, his call).
  The July motion stack (§A: magnetic cursor, Lenis, GSAP ticks, wipe) SHIPPED `1d310e12`; the
  panoramic gallery he DELETED (`2de8d17c`) and on 2026-08-25 he answered **"no"** to bringing a
  drag surface back — §A.1 records it. Do not re-queue any of them from a paraphrase.
- **Take the top unblocked row in `BACKLOG.md` ▶ NEXT UP.** There is no #216 follow-up.

## Live traps for whoever is next

- `.claude/hooks/session-root-assert.mjs` may import `node:` builtins ONLY (it is copied flat by
  `--repair`); `tools/entry/tracked-hooks.test.mjs` enforces it. That is why `canonicalizePath` and
  the `Worktree / branch` grammar are duplicated there and pinned equal by test.
- The impeccable hook fires from tracked `.claude/settings.json` — do NOT re-add it to
  settings.local.json, and never hand-edit `.claude/skills/impeccable/` (re-vendor instead).
- Bash edits bypass the write guard and the impeccable hook — use Edit/Write tools in `src/`.
- `BACKLOG.md`'s NEXT UP section sits at 12503/12544 bytes — **41 bytes of headroom, so the next row
  added there fails `doc-budget.ps1` until its oldest CLOSED row moves to `BACKLOG_ARCHIVE.md`
  verbatim.** Archive first, then add. Never raise the cap.
- The pre-push gate npm-ci's; never junction node_modules between worktrees.
- Commit-body keywords close issues on push — reference issues bare unless closing is intended.
- Room labels on the rail are Health · Live · History · Test — never speak an internal id
  (`lab`/`fix`/…) as a room name to the owner.

## Waiting on the owner

Nothing new from this train, and **B5.1 is now ANSWERED** ("no" to a panoramic drag surface).
Standing items live in `OWNER_ACTION_CHECKLIST.md` §A/§B/§C/§D (updater key backup A0, two settings
lines A_settings, updater-widening B2, funnel B3, monetization B6, substituted asks B4, the #49
mockups B5.2, wordmark `©ompy` call in §D).
