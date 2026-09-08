# Lab → linear guided "instrument bench" — spec for owner review (Cowork, 2026-07-05)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The approved “build it all” status and Lab
> product/UI direction below are historical, not current execution authority. Current experience and
> journey law come from `docs/PRODUCT_CONSTITUTION.md`; technical and accessibility details remain
> bounded provenance subject to current code, release truth, and Work Control.
>
> **Owner directive (verbatim intent, 2026-07-05):** Lab should be set up so all the tools are
> **linear** — the user easily understands the use-case for each tool, is **hand-held through
> them all in order**, comprehends **how they coincide with each other**, and each tool
> **specifies what its measurements pertain to** so the user knows what to look for and **which
> tool is the one they need** to resolve or enhance a real-world experience a metric may be
> hindering.
>
> This supersedes the "Latest readings" strip (`d78b0ec`) — the strip's consolidation role is
> absorbed into per-station summaries; the strip is removed in this train.
>
> **Status: APPROVED 2026-07-05 — owner signed off on "build it all in one train"** (router +
> ordered stations + strip removal + the guided walkthrough §C, together, flag-gated). Laws in force: foam-pit (order + purpose *felt*, never taught at a
> lecture), bathroom (signpost at the moment of need, never condescend), doorknob, one-mention
> (RoomShell verdict stays the ONE room summary), honest-measurement (measured or honestly
> absent), all-original, plain-language (Sarah & Caleb). Frontend only: zero `src-tauri` diff,
> zero new IPC, reuse existing probes/commands.

## The problem with today's Lab

Five instruments sit as parallel collapsible sections with a one-line description each. A user
who doesn't already know what "Latency" or "Black Box" *does for them* has no order to follow and
no map from a real-world symptom ("my game stutters", "it crashed") to the right tool. The order
isn't felt; the purpose isn't tied to anything the user actually experiences.

## The redesign: an ordered bench with a symptom router

Lab becomes a **linear bench** — the five instruments in a deliberate diagnostic order, each a
numbered **station**, fronted by a **"Which tool do I need?" router** that maps real-world
symptoms to the station. Nothing is deleted; every existing instrument UI stays exactly as-is
inside its station (expand to reveal the full existing Benchmark/Latency/BlackBox/Tuning/
Diagnostics UI — same commands, same reads).

### A. "Which tool do I need?" — the router (top of room, below the RoomShell verdict)

A short, scannable symptom→tool list (the hand-hold that answers "which one is mine?"). Copy
(plain-language, final unless retuned):

| If you're feeling this… | Reach for | Because |
|---|---|---|
| "My aim/clicks feel a beat behind" | **Latency** | it traces mouse→screen and names what's adding delay |
| "Did that tweak actually help — or did I imagine it?" | **Benchmark** | it grades a real before/after against a noise floor |
| "It runs hot / loud, I want it cooler without losing frames" | **Tuning** | it measures whether an undervolt dropped temps AND held frames |
| "It crashed or froze and I don't know why" | **Black Box** | it reads Windows' own crash & freeze record in plain English |
| "I just want to know what's in this rig" | **Diagnostics** | read-only forensics — everything Compy detected, raw |

Clicking a row scrolls to / expands that station (existing rail-free in-room navigation —
"navigation never teleports").

### B. The stations — order + per-station contract

Order tells a story: **know your rig → measure change → chase input lag → tame heat → explain a
failure.** Benchmark is named as the spine the others plug into.

Each station header carries FOUR plain-English lines (the owner's four asks), above the existing
expandable instrument body:

1. **What it's for** — one line, real-world.
2. **Reach for this when** — the symptom that sends you here (mirrors the router row).
3. **What the reading means** — the metric translated: what a good vs. worth-looking-at reading
   indicates in real life (never a fabricated number; pulls the live value the instrument already
   has, or an honest "no reading yet").
4. **How it connects** — the thread to a sibling station (the "coincide" line).

| # | Station | What it's for | What the reading means (real-world) | Connects to |
|---|---|---|---|---|
| 1 | **Diagnostics** | Know exactly what's in your rig before you change anything | The raw spec + detected state you interpret every other reading against | feeds every station |
| 2 | **Benchmark** | Prove a change actually helped — not a placebo | +% = it moved, inside the noise floor = it didn't; the sign is the evidence | the spine: measure before/after any Optimize/Tuning change |
| 3 | **Latency** | Cut the delay between your hand and the screen | MSI on + low timer = a shorter input path; names the specific delay source | pair with Benchmark to prove a latency change held |
| 4 | **Tuning** | Run cooler/quieter without losing frames (AMD) | "held" = temps dropped and frames stayed; "too aggressive" = you gave up frames | Benchmark grades whether frames held |
| 5 | **Black Box** | Understand a crash or freeze after it happens | Plain-English cause + your last vitals at the time — not raw hex | Diagnostics for the rig state behind it |

Honesty: line 3 uses the SAME live value the instrument body shows (one source, can't disagree),
and reads "no reading yet" when the instrument hasn't been run — never a placeholder metric.
Tuning station renders only when the AMD tuning guide is present (existing `tuningGuideForVendor`
gate); Diagnostics station only when the diagnostics slot has content — the count stays computed,
never hardcoded (unchanged from today).

### C. "Walk me through the bench" — the guided step-through (IN SCOPE, owner-approved)

A quiet **"New here? Walk the bench"** affordance at the top of the room starts a linear,
one-station-at-a-time walkthrough — the literal "hand-held through them all in order" ask. Reuse
the existing SetupTour tooltip/step pattern (no new mechanism, no new IPC): each step parks on one
station in order (Diagnostics → Benchmark → Latency → Tuning → Black Box), showing that station's
four plain-English lines and a "this is the tool for {symptom}" framing, with Back/Next and a Skip.
The step-through only teaches order + purpose — it never runs an instrument or mutates anything
(read-only, same as the rest of Lab). Last step lands on "you've seen the bench — dive into whichever
station your situation calls for" (ties back to the router). Dismissible; a `compy_lab_walk_seen_v1`
localStorage flag mirrors the existing `compy_lab_welcome_seen_v1` so it self-folds once seen but is
always re-openable from the "Walk the bench" affordance.

## Reversibility + staging

Flag-gate the redesign **`compy_lab_guided`, DEFAULT OFF**, Settings → Appearance preview toggle;
flag-off Lab is byte-identical to today (test-pinned, the proven P-series pattern). Owner flips it
on in his profile, eyeballs, and it flips default-ON as a taste call — same contract as P1–P5. The
"Latest readings" strip is removed as part of the flag-on path (its role moves into the stations);
flag-off keeps today's Lab (strip included) untouched.

## Hard lines

- Zero `src-tauri` diff; zero new IPC — every station wraps the EXISTING instrument UI + reads.
- No instrument deleted, moved out of Lab, or demoted — this adds signposting + order around them.
- RoomShell verdict stays the ONE room summary (one-mention); station line 3 pulls the same live
  value the body shows, so nothing contradicts.
- All copy plain-language, measured-or-absent, all-original.

## Verify (per commit)

tsc clean · vitest green incl. new guards (router symptom→station map pinned literally; each
station's four lines render; "no reading yet" honesty state; flag-off byte-identity) ·
`git diff -- src-tauri` empty · self-review on the flag-on dev build, shots to
`docs/ui-sweep/shots/lab-guided/`.

## Build order (once owner approves)

1. `compy_lab_guided` flag + flag-off byte-identity guard (pure addition, no room change yet).
2. The station header contract (four lines) wrapping each existing instrument, ordered per §B.
3. The "Which tool do I need?" router (§A) + symptom→station guard.
4. Remove the "Latest readings" strip on the flag-on path.
5. The "Walk the bench" guided step-through (§C) — reuse the SetupTour step pattern; ordered,
   read-only, self-folding + re-openable.
6. Self-review + shots → silent-reinstall + stamp-verify → owner eyeball (flag on) → default-ON
   flip is his call.
