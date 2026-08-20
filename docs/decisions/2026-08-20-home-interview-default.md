# The interview ships OFF by default — and that is an open owner fork (2026-08-20)

**Status:** DECIDED for now (off), **OPEN for the owner to overrule in one word.**
**Applies to:** `compy_home_interview` (`src/design/theme.ts`), the front door on Home.
**Pinned by:** `src/surfaces/home-interview-default-guard.test.ts`.

## What happened

Design foundation step ③ — the interview (issue [#177](https://github.com/Pootytxng/sentinel/issues/177),
decision 2 of [`2026-08-11-design-foundation.md`](2026-08-11-design-foundation.md)) — is **built,
gated, tested and installed**. The only question left is whether it is on when the app opens.

The first draft shipped it **default ON**. The self-review caught that on rubric item 10 (prior
owner decisions) and it was right, so the default was flipped **before** the change was claimed done.

## Why ON was wrong

The interview replaces the intake band. The band's flag, `compy_home_intake`, was the owner's
off-switch, and **he set it off twice**:

1. `4d1afa92` (2026-08-12) — on sight: *"the what are you here to do text box was ugly looks cleaner
   without it."*
2. `8db70795` — after he caught UX-1 (`f1766e86`) bypassing that removal by narrowing the flag to
   mean "pins the panel open" while the question rendered unconditionally as the screen's largest
   button. That commit's fix: **"intakeAvailable now leads with intakeOn: off means the question is
   not asked."**

Retiring `compy_home_intake` and defaulting its successor ON is **the same bypass, done more
thoroughly** — the switch survives under a new name and answers the opposite way. Whether the new
artifact is better-looking is an engineering opinion; whether his switch stays where he put it is
not.

## Why the default being off is not the same defect the audit found

The audit's finding was real and is fixed separately: `compy_home_intake` had **no Settings toggle
anywhere in `src`**, so the only way to set it was devtools, and UX-1's "verdict + ONE action" front
door shipped its one action to nobody. **Undiscoverable was the defect — not off.** ③ ships a real
**Settings → Behavior → "Ask me a question on Home"** toggle, so off now means *off and one click
from on*, which is a materially different state from what he was living with.

## The fork, stated for the owner

**What he sees today (default off):** Home is unchanged — verdict, counters, "Fix in Test →", the
always-visible Crash & Freeze Rescue entry. The one visible difference is the new Settings toggle.

**What one toggle gets him:** Home's primary button becomes **"Help me with my PC"**. It opens a
short interview — one plain question per screen, spoken-English answers, "I'm not sure" first-class
on every screen — ending on a finding card: a level chip (Measured / Likely / Unknown), one
sentence, the measured readings it is speaking from, one action, and the undo promise when that
action changes Windows.

**Recommendation: turn it on.** The thing he rejected was a 9px band that put a question on Home
unasked; this puts no question on Home at all — it puts a door there, and the question lives behind
the click. Step ③'s value is exactly the part a default-off flag withholds. **But it is his slot to
fill**, he cleared it deliberately, and one word flips the default in one line plus this record.

## The measured cost of off, stated so it is not rediscovered later

With the interview off, **UX-1 decision 1's "verdict + ONE action" front door has no action** —
`HomeConsole.tsx` renders `primaryAction={undefined}`, so Home is a verdict, a re-run band, the
counters and the Care entry, with no filled primary button anywhere on the screen.

This is **not new damage**: `compy_home_intake` also defaulted off *and* had no Settings toggle, so
this is the state every real install has been in since UX-1 shipped. But it is the strongest
argument for turning the interview on, and it belongs in front of the owner as a measured fact
rather than an opinion. Pinned by the test *"default OFF: Home is a verdict with no filled primary —
the open cost of the owner's switch"* in `src/surfaces/home-console.test.tsx`, which flips with the
default if the default flips.

## What must happen to change it

Not an edit to the guard's expectation. Owner's call → amend this file with his words and the date →
flip the default and the guard in the same commit, citing this record. If the guard is red and this
section has not changed, the answer to find is *"did he say yes"*, not *"what number makes it pass"*.

---

## OWNER ANSWERED — 2026-08-20: YES, turn it on

He tried it on the installed `1d5b3c4c` build and said, verbatim:

> "i like it i just dont like the placement for the help me with my pc"

**Status changes from DECIDED-for-now (off) to DECIDED (on), with one condition of his own making:**
the placement of the front-door button is wrong to him. So the flip does **not** ride alone — the
default flips to ON **in the same lane that fixes the placement**, so the first Home a user meets by
default is the version he approved, not the version he objected to.

Sequencing, stated so it is not re-litigated: fix placement → self-review PASS → flip
`readHomeInterview()` to default-true → update `home-interview-default-guard.test.ts` and the
"default OFF: Home is a verdict with no filled primary" case in `home-console.test.tsx` (that test's
premise is retired by his answer, not weakened) → cite this section in the commit.

Tracked as part of the comprehensibility sweep — see
[`2026-08-20-comprehensibility-sweep.md`](../superpowers/plans/2026-08-20-comprehensibility-sweep.md).
