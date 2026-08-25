# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**The [#214](https://github.com/Pootytxng/sentinel/issues/214) design-system drift-lock train is
DONE and ON `main`** (`6c054b77` the lock + fixes, `98e27e34` the state row; fast-forward push
2026-08-24, local gate PASS). The owner's desk runs the `6c054b77` build, installed silently,
stamp-proven attempt 1, one installer on the Desktop, self-review **PASS** on the installed binary.
Worktree `C:\Users\Kuya\code\sentinel-home-room` · branch `lane/train-2026-08-22` (no lane ref
pushed; main carries everything).

## What the lock is (so nobody re-litigates it)

`src/design-detector-guard.test.ts` runs the vendored impeccable detector over `src/` inside
vitest: zero findings pinned · falsification probe (planted defects must still be caught) ·
suppression census (every ignore argued, rule/file-wide ignores banned, inline waivers pinned to
exactly Benchmark.css + home-interview.css) · per-edit hook pinned in TRACKED
`.claude/settings.json` (the 2026-08-21 settings.local.json unwire class is dead) · Codex hook
pinned at the tracked copy · version floor ≥3.9.1 (**`npx impeccable update` DOWNGRADES** — npm
"latest" is 3.6.0) · motion-law absolutes (`transition: all`, standalone `ease-in`, `scale(0)`)
with comments stripped before scanning. DESIGN.md §Motion carries the prose law + the
four-question gate for new motion. Skill-shed verdicts (emilkowalski ×4, anthropics
frontend-design, vercel web-design-guidelines — evaluated, extracted, not added) are recorded in
`.claude/skills/INDEX.md`.

## What is left on this arc, and who owns it

- **Nothing mechanical.** The lock is a build gate; drift now fails `npm test` and the pre-push
  gate on any editor/agent/hookless session.
- **The owner's larger design VISION is not this train** and remains open by his own backlog:
  `docs/UI_VISION_BACKLOG.md` 🔴 OPEN (panoramic drag telemetry gallery, magnetic cursor, Lenis,
  GSAP data-reactivity). The self-review verdict said this plainly: 6c054b77 is one scoped
  increment; a reskin/lock is not the vision. That is the natural next design train.
- #214 close-out (evidence comment + close under a work-control receipt) was in flight at the end
  of the writing session — if #214 is still open, the evidence lives in the issue comments and
  RELEASE_STATE row; verify and close it rather than redoing anything.

## Live traps for whoever is next

- The impeccable hook now fires from tracked `.claude/settings.json` — do NOT re-add it to
  settings.local.json, and never hand-edit `.claude/skills/impeccable/` (re-vendor instead).
- Bash edits bypass the write guard and the impeccable hook — use Edit/Write tools in src/.
- The pre-push gate npm-ci's; never junction node_modules between worktrees.
- Commit-body keywords close issues on push — reference issues bare unless closing is intended.
- Room labels on the rail are Health · Live · History · Test — never speak an internal id
  (`lab`/`fix`/…) as a room name to the owner.

## Waiting on the owner

Nothing new from this train. Standing items live in `OWNER_ACTION_CHECKLIST.md` §A/§B/§C/§D
(updater key backup A0, two settings lines A_settings, updater-widening B2, funnel B3, monetization
B6, substituted asks B4, UI-vision pick B5, wordmark `©ompy` call in §D).
