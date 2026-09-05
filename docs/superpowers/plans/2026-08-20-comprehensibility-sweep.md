# Plan — the comprehensibility sweep (owner directive, 2026-08-20)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The queued status, owner-message authority,
> and BACKLOG priority override below are historical and no longer executable. Current product and
> experience direction comes from `docs/PRODUCT_CONSTITUTION.md`; current sequence and ownership
> require the Roadmap and Work Control. The body remains historical product evidence.
>
> **Status:** QUEUED, not started. Execution belongs to a FRESH session (see §6).
> **Authority:** owner message 2026-08-20, quoted in §1. It re-ranks the `BACKLOG.md` NEXT UP queue.
> **Scope rule from him:** *"dont create any new or unecessary work"* — every item below is either
> something he named by hand or a direction this repo already committed to. Nothing here is invented.

## 1. The directive, verbatim

> "the absolute number 1 priority through the build process whether its made as a more immediate
> focused task to be completed or in the grand scheme of things to focus on familiarity,
> navigability, user intuitive and comprehensibility throughout any function or text or tool
> etc.... in the app the goal is to make the app universally valuable and easy to operate/interprate
> whilst appealing to a optimal mass variety of consumer types."

And on the three things he saw on the `1d5b3c4c` desk build:

> "i like it i just dont like the placement for the help me with my pc also noticed the spplied compy
> changes with the fine text paragrapgh still underneath it looking very unnapealing especially for
> the home page."

> "the jarvis toggle is back in the settings the expert view is still there and the other toggle
> on/off settings."

> "the basic and advanced tab in the live section are still both present when i recall us agreeing
> the advanced mode was the obvious and more sensible default seeing as how it literally had 1
> noticable difference between its basic counter part. so removing basic mode i was thought to
> believe was the result to be had."

**He asked whether these are "just taste calls" low on the list. They are not.** He named
navigability and comprehensibility as the #1 priority in the same message; a mis-placed primary
button, an unreadable block on the front page, duplicate switches and a redundant tab ARE that
priority. They are ranked #1 here, above the gate/governance rows that previously held the top of
the queue.

## 2. The drift question — answered with evidence, because he was half right

He read the Settings toggles as an old regression re-landing. Checked with `git log -S` over
`Settings.tsx` and `en/settings.json`: **`jarvisMotion`, `monitorConsole` and `expertView` each
appear in exactly two commits — the one that added them and the zh-CN i18n pass. None was ever
removed, so none came back.**

**But the instinct behind it is correct and is the real finding:** those are *rollout* switches. Each
shipped DEFAULT OFF to de-risk a feature, the feature graduated to default-ON, and the switch stayed
behind. Settings now carries developer-era forks next to genuine user preferences, and a
mass-market user cannot tell which is which. That is the same defect class as Live's Basic tab.

## 3. The work, in execution order

### A. Live room — one face (his explicit ask)
- Verify first, do not assume: diff what `MonitorBasic.tsx` (211 lines) shows against
  `MonitorConsole` advanced. His recollection is "1 noticeable difference." **Anything Basic has
  that Advanced lacks must be carried over — the ask is to remove the fork, not to lose content.**
- Delete `MonitorBasic.tsx`, the `mode: "basic" | "advanced"` fork in `MonitorConsole.tsx`, the
  segment control + `basic` branches in `MonitorV2.tsx`, and `ViewMode`/`readViewMode`/
  `applyViewMode`/`compy_view_mode` in `theme.ts` plus the `<html data-view-mode>` mirror.
- Precedent, so this is continuation not invention: `1ab831fb` (2026-08-06) already deleted 29
  unreachable faces under "one blessed face per room."

### B. Settings — one switch per real choice
- **Fold "JARVIS motion" into "Motion."** Two motion controls on one screen is the comprehensibility
  failure; the JARVIS sub-text already concedes *"The Motion setting below still wins."* Result: one
  Motion preference (Full / Follow system / Reduced), Full meaning what JARVIS-on means today.
- **Remove the "Live console" toggle** and the classic-tiles path it preserves — same one-face rule
  as §A.
- **Keep** (these are genuine user preferences, not rollout debt): theme, language, close-to-tray,
  Motion, "Ask me a question on Home", Expert view, overlay density, overlay backdrop, update checks.
  He listed Expert view as suspect; it is a real tinkerer preference that shipped as one on purpose
  (`5850ac0f`) and it earns its place — flagged here so the call is visible rather than silent.

### C. Home — the two things he looked at and disliked
- **Front-door placement.** Capture the current Home first; the placement complaint is about where
  the button sits relative to the verdict, and the fix has to be judged on sight, not described.
- **The applied-changes block and the fine-print paragraph under it.** Same treatment.
- **Then flip `compy_home_interview` to default ON** — he answered yes. Sequencing and the guard
  edits are pinned in
  [`docs/decisions/2026-08-20-home-interview-default.md`](../../decisions/2026-08-20-home-interview-default.md).
  The flip lands *after* the placement fix so the default Home is the version he approved.

### D. Guards, so none of this re-accumulates (bug -> guard law)
- A test that fails the build when Settings gains a *rollout* switch (a toggle whose only job is to
  preserve a superseded face) — the mechanism that would have caught §B years earlier.
- A test pinning Live to a single face, so the Basic fork cannot return.
- Both are the automated tier, which the law prefers over another paragraph.

## 4. Explicitly NOT in this sweep

Gate/governance rows #171, #121, #126, #156, #128, #125 keep their places in `BACKLOG.md` but drop
below this sweep. **One caveat carried forward, not buried:** #171 (`verify-local` invents failures
under concurrent lane load) is the gate every merge receipt rests on. It is intermittent *under
concurrent lanes*; a single-lane marathon is the low-risk case, so this sweep proceeds — but a
random red gate mid-sweep is #171, not a real regression, and must not be waved through.

## 5. Definition of done

Every one of A-D built, `verify-local.ps1` PASS read in full, a `self-reviewer` PASS verdict quoted,
`npm run tauri build` + `scripts/ship-reinstall.ps1`, live == build proved by the embedded stamp, and
a before/after the owner can look at via `SendUserFile` for §C.

## 6. Why a fresh session runs this

The session that wrote this plan had already compacted once and carries a large summary that would
be re-sent on every turn of a multi-file refactor. Carried context is ~85% of measured spend
(`claude/TOKEN_ECONOMY_LAW.md`), so the cheapest form of this marathon is a clean context booted
from `CLAUDE.md` plus this file.
