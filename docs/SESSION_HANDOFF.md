# Session handoff — 2026-08-19 (C-04: the front door is now **Health**)

**Lane CLOSED, and the debt is now paid too.** Merged to `main` as `ad793f63` (PR #144, issue #143), disposition row updated in
`c492c472`, tree clean. The one thing it carried forward — the visual self-review — was owed
until a build existed to look at; that build now exists, is installed, and the review **PASSED**
(see "The one debt" below). **Nothing carries forward from this lane.**

## What happened

The previous session was killed after it had claimed the lane and before it wrote anything, so this
one resumed the same claim in the same worktree (`C:\Users\Kuya\code\sentinel-home-room`, branch
`agent/home-room-question`) and built the item.

**C-04 — rename the Home room to a question it answers.** UX-1 decision ① third clause, decided
2026-08-11, never built. The word was owner territory: he picked **Health** from Health / Checkup /
Diagnosis. "Diagnosis" was offered with the reason to decline it — it frames the machine as already
broken, the fear frame that retired "Fix" in 2026-06. The id stays `home`, the persisted nav key,
same rule as Monitor→Live, Blackbook→History, Lab→Test.

Renamed everywhere the user reads it: rail/topbar/palette label, the tour's two rail-recap
sentences, the CPU-temp honesty note, the memory lesson's tie line. The tour blurb stopped opening
"Your dashboard" — a shape, not an answer — and now states the question the room answers.

**The rename found a live drift hole with the fix half applied.** `HOME_RAIL[0].label` is NOT what
the app prints: `ShellV2.tsx:94` renders `t("common.rail." + id)` and `App.tsx:1447` derives the
front door's dock names the same way. Renaming only `homeRail.ts` ships the OLD word with
`homeRail.test.ts` green, because that test asserts the literal the app does not use.

**Guards, before the fix counted (bug→guard):**

1. `src/design/rail-label-locale-guard.test.ts` (new) — pins the rail literal to `common.rail.<id>`
   for every room, covers the merged rail's `Optimize` relabel and locale-key parity, carries a
   disarm proof. **Falsified against the half-applied rename**: seeding the old locale value turns
   the first test red naming both words.
2. `room-name-copy-guard.test.ts` — `Home` joined the RETIRED map, so the old word cannot return to
   English locale copy or Rust literals. One KNOWN LIMIT is recorded rather than engineered around:
   "the Home key" (the keyboard key) trips the lead pattern; nothing in scope says it today, and
   `room-name-allow` is the hatch.

**Doc drift fixed in the same commit:** `DESIGN.md` still named the rail "Home · Monitor · Blackbook
· Lab" — two labels retired 2026-08-12 — and `UI_VISION_BACKLOG.md` still called UX-1 ③ "NEVER
BUILT" a day after C-05 shipped it. **UX-1 is now CLOSED**; FOUNDATION-1 is three of five (① type +
colour, ② front door, ④ wording pass; ③ interview and ⑤ instruments behind a door remain open).

## State

- Verification at the merged head: `tsc` clean · vitest **344 files / 4486 passed**, 6 skipped ·
  doc-budget **14/14 PASS** · `verify-release-state` 31/31 · pre-push local gate (cargo test +
  clippy) PASS. Work-control receipt PASS for the merge, with the independent review recorded
  *not practical* (no non-writing model attached) rather than silently self-approved.
- `docs/BACKLOG.md` cycle **2026-08-19d**. To stay under the byte wall, cycle 2026-08-19c and the
  conformance queue's SHIPPED rows (C-05/C-19, C-06/C-08/C-09, C-10, C-11, C-17) moved verbatim to
  `docs/BACKLOG_ARCHIVE.md` behind a pointer stub.
- `docs/RELEASE_STATE.md` untouched — no gate moved, no artifact changed. **The rename is not in any
  published build**; the fleet is on v0.9.26 and it ships with the next cut.
- The worktree had no `node_modules` (fresh clone of the folder); `npm ci` at the root and inside
  `site-app/` were both needed before the suite could run. Three site tests fail with
  "site-app dependencies missing" until the second one is done — environmental, not a defect.

## The one debt — DISCHARGED 2026-08-19

**The self-review on the installed binary is done and it PASSED.** `npm run tauri build` →
`scripts/ship-reinstall.ps1` → `-ProofOnly -ExpectedCommit`: the owner's desk now runs the rename,
proved live-equals-build by the **stamp** (`40682344 · release · shell 0.9.26`, attempt 1, 0 expected
transient), installer SHA-256 `114B7FFDDC8031F24019152D4FA4B312853702D59F353292C4DB87BB0B93744B`,
one installer on the Desktop.

**VERDICT: PASS.** All four surfaces were looked at on that binary at 1484x971 — rail label, room
breadcrumb, command palette, and the tour (reached live via Settings → "Take the tour", all 10 steps,
recap rendered verbatim). Rail labels measured unclipped; the regression sweep found **zero
user-visible "Home"** on Health/Live/History/Test, and a palette search for "home" returns Health
plus one unrelated powerline-adapter line — no stale room entry, no duplicate row.

*Recorded rather than engineered around:* the live rail on this build is **Health · Live · History ·
Test** — four rooms, because `compy_lab_ground` defaults ON and drops the standalone Optimize room,
so `JOURNEY_RECAP_BODY` (the five-room string) is not what this build renders; `GROUND_RECAP_BODY` is.
Both were renamed, so nothing is wrong — but a five-room expectation is the wrong test of this build.

**Desk is AHEAD of the fleet again:** same version number, different commit. The published v0.9.26 is
source `5e64074c` and does NOT contain the rename; it ships with the next cut.

## Next session

Take the next non-gated `[ ]` in `docs/BACKLOG.md`. The conformance queue's open rows are C-17b (12
mono-on-prose violations), C-14 (`GpuProfile.tsx` — advisory or archive, owner fork), C-12 (doc-only
CommandPalette drift) and C-13 (axe-core in vitest). #121, #140 and the Codex weekly-automation
scope item are untouched and open.
