---
name: status
description: >-
  Use when the owner asks where things stand rather than for a change. Triggers: "where are we",
  "what's left", "what's next", "show me", "status", "how far along", "what's the state", "show my
  checklist", "did that land", "what am I waiting on" — and at the end of any train, unprompted.
  Also fires when resuming a session cold and the first thing needed is current truth.
---

# Status — reconstruct current truth, never assert it from memory

The owner keeps no notes. More than half of everything he types short-form is a status question, so
this is the single most-used surface in the repo and the one where a confident wrong answer costs the
most: he cannot check it against anything. **Every line you report is read from a source right now, or
it is labeled unverified.** Never answer a status question from session memory or from what you
believe you did — the point of this skill is that the answer is reconstructed.

## Sources, in precedence order

| Source | Answers |
|---|---|
| `git log --oneline -12` · `git status -sb` · `git branch --show-current` | what actually landed, what is uncommitted, where HEAD is vs origin |
| `docs/RELEASE_STATE.md` (gate matrix) | **authoritative** live gate/build/release state |
| `docs/BACKLOG.md` | next non-gated `[ ]` item |
| `docs/OWNER_ACTION_CHECKLIST.md` | what is on **his** hands, eyes, input, money |
| `docs/UI_VISION_BACKLOG.md` 🔴 OPEN | unbuilt visual/motion work — see the trap below |
| `docs/WORK_CONTROL.md` | live claims; an overlapping claim means another lane owns it |

Token law applies: **search these by section, never whole-file.** Dispatch the doc reads to a sonnet
worker and take back only the extracted lines — a status question must not cost a full doc sweep in
the main context.

## Three traps that make a status report a lie

1. **False-done.** Never say "done" / "queue empty" without enumerating what remains AND what is
   gated. A checkbox is not evidence.
2. **The reskin trap.** RELEASE_STATE tracks the shipped Instrument-HUD reskin, not his motion /
   interaction vision. UI is never "complete" while `docs/UI_VISION_BACKLOG.md` has 🔴 OPEN items.
3. **Pushed ≠ landed.** `git status -sb` ahead/behind, and whether CI is green, are separate facts
   from "I committed it." Report the one you actually checked.

Point-in-time claims (`file:line`, build stamps, HEAD) go stale — re-verify before repeating one.

## Report format

```
STATE   <branch> @ <sha> · <ahead/behind origin> · <clean | N uncommitted>
LANDED  <2-4 lines: what actually shipped since he last asked, each with a sha>
GATES   <only rows that changed or block; else "no change since <date>">
NEXT    <the one next non-gated item, named>
ON YOU  <owner-checklist items, or "nothing">
UNVERIFIED  <anything asserted but not read this turn — or "none">
```

Keep it inside that block. If a source disagreed with another, say which won and why in one line —
disagreement between state docs is itself the finding, and it triggers `doc-sync`.
