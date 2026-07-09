# The Lab as a Proving Ground — architecture, linear pathing + the telemetry gallery

**Owner directive (2026-07-08, verbatim intent):** research the full Lab framework I built, decide the
best **linear pathing** to introduce its guided utility, **optimize for fluidity + intuitive access**,
and **incorporate the gallery** into its architecture so the Lab is a **cohesive, sensibly constructed
environment**. He explicitly wants **options to make ACTUAL changes to the user's hardware / tweaks that
coincide with better predicted performance, for users to test and prove themselves — all within the Lab.**

**Status:** SPEC — research done (two read-only Explore maps, 2026-07-08), design decided. Build is
flag-gated `compy_lab_ground` DEFAULT OFF (P-series pattern), owner eyeballs the pilot. Tracked in
`docs/UI_VISION_BACKLOG.md` (item C, the Lab-establishment train the owner just handed over).

---

## 0. The one finding that reframes everything

**The "make a real change, test it, prove it" loop already exists and is already inside the Lab.**
`BenchmarkTab`'s "Measure this tweak" flow (`src/surfaces/Benchmark.tsx:426`, backend
`benchmark_trial.rs:164` `start_tweak_trial`):

1. Measures the rig's **baseline** fps/frametime from the live ETW frame stream (with the change OFF).
2. **Applies a REAL Windows change** via the audited `apply_recommendation` path (`benchmark_trial.rs:208`).
3. Arms a `RollbackGuard` (a Drop guard) the instant apply succeeds — **auto-rolls-back on EVERY exit
   path** (success, cancel, panic) (`benchmark_trial.rs:133,220`).
4. Measures again with the change **ON**, computes a bootstrap-CI **verdict** (Keep / Revert /
   Inconclusive).
5. Banks it to the **scoreboard** as a certified receipt only if the verdict is `Keep`
   (`benchmark_scoreboard.rs:159`).

This is exactly the owner's ask — measured, honest, reversible, catalog-safe — and it needs **no new
mutation machinery**. The Lab redesign's job is **presentation + pathing + a results space**, not new
risk. (Mutation-scope boundary in §5.)

## 1. What's actually wrong with the Lab today (the friction to fix)

From the architecture map (`Lab.tsx`, `LabBento.tsx`, `theme.ts`):
- **Three competing nav idioms for the same 5 instruments**, none reused by the others: the **bento
  grid** (`compy_lab_bento`, DEFAULT ON), the **symptom router** "What are you here to do?"
  (`compy_lab_guided`), and the **classic accordion** — with **two different station orders**.
- **The guided flag is a no-op in the shipped default.** `guided && !bento` gates the router+stations,
  but `bento` defaults ON and subsumes it, so turning on "Guided Lab bench" changes *nothing visible*
  (`Lab.tsx:318,380,104`). Dead UX.
- **No progression, no completion.** The only linear cue (the checkup's "next" pointer) is buried at the
  *bottom* of the grid. The Lab is the terminal room with **no forward door by design**
  (`room-shell.tsx:29`) — so the room that most needs "what next?" has no completion signal.
- **Dead surface:** the welcome band only renders when `!guided && !bento` (never, under defaults);
  legacy `Diagnostics`/`History` tabs linger with no rail entry.
- A user can open a "station" (Diagnostics) that has **nothing to show** — membership is gated on the
  prop existing, not on it having a reading.

## 2. The design — the Lab is a PROVING GROUND (one linear spine)

Collapse the three idioms into **one guided environment** built around the loop that already works. The
spine is the scientific method a user already intuits — *measure → change → measure → prove → keep*:

```
   INTAKE            MEASURE           TEST                PROVE              COLLECT
 "what are you  →  baseline your  →  apply a tweak    →  see the measured →  your proven wins
  here to do?"     rig (Diag +       predicted to      before/after on      as pieces in a
  (symptom          Benchmark         help; real +      the rig itself       draggable 3D
  router = the      baseline +        auto-reverted     (Two Futures         telemetry GALLERY
  front door)       noise floor)      (the 16 safe      measured split)      (the trophy room +
                                      recs)                                   Lab's completion)
```

Concretely:

**Front door = the symptom router, promoted to lead the room.** "What are you here to do?" (the existing
`LAB_ROUTER`, `lab-guided-data.ts:70`) is the most intuitive access pattern in the codebase — plain
language, routes straight to the right station. It becomes the Lab's *first* thing, not a buried
alternate. A "run the full checkup" option sits beside it for the thorough user.

**The stations become a progression, not a menu.** One canonical order
(Diagnostics → Benchmark → Latency → Tuning → Black Box), each a step with a clear state (unread /
reading / done) and a single "next" that *leads* the room instead of trailing it. The bento grid's
strength (glanceable status + one synthesized checkup report) is kept as the **progress dashboard**; the
router is the intake; the accordion is retired. No more two-orders, no more no-op flag.

**Benchmark is the centerpiece — the "dyno."** The measure→tweak→prove loop is elevated from "one station
among five" to the beating heart of the Lab: pick a tweak the app *predicts* will help (each of the 16
recs carries its measured/expected rationale), run the real A/B trial, watch your own fps move.

**Prove it visually = the Two Futures measured split, finally given its purpose.** The owner's own note
on Two Futures was *"cool split but the hologram has no visible purpose/information."* Here it gets one:
after a trial, the split renders **baseline (ghost) vs after (accent)** on the rig hologram with the
**changed part emphasized by its measured `delta_pct`** (`partGlow` from real `Efficacy`,
`two-futures-view.ts`). The number moved; the rig shows *where*. That closes the Two Futures loop (item
B) inside the Lab.

## 3. The telemetry GALLERY — the Lab's trophy room + completion signal

The gallery is not a bolt-on; it's the **COLLECT** stage — where proven results live and the terminal
room finally gets its "you did something" payoff. The owner's highest-wow item (the sister-site
"drag-to-explore a 3D space") pointed at real data.

**It already has all its assets** (Part-B map): reuse `RigHologram`/`RigPart`/`use-rig-colors`/
`camera-fit`/`buildRigParts` + the `HardwareTourScene` **`TourCamera` fly-to-a-piece primitive**
(`HardwareTourScene.tsx:131`) — the exact "camera glides to the focused piece, click to inspect" motion
the gallery needs. Nothing new in 3D infra; a new **panoramic drag-shell** wraps them.

**The pieces are measured proofs, each honest and clickable-for-detail** — all cross IPC today:
- **Scoreboard awards** (`ScoreboardView`/`AwardEntry`, `types.ts:248`) — certified "Keep" tweaks with
  effect % + CI, anchored to the rig part they improved.
- **Sessions** (`SessionSummary`, `types.ts:63`) — past game sessions with fps/frametime/stutter, tagged
  by rig fingerprint.
- **Ledger receipts** (`AppliedChange`, `types.ts:20`) — what's applied now, with before→after labels.
- **Black Box incidents** (`CrashReceipt`, `types.ts:292`) — the honest failure records.

Drag to explore the space; a piece glides forward on click and opens its measured detail. **THE LAW
(inherited from Two Futures):** every piece traces to a measured struct — no fabricated trophies; an
empty gallery says *"prove a tweak in the bench to earn your first piece,"* which loops the user back to
the front. That circular pathing (gallery → bench → gallery) is the Lab's cohesion.

## 4. Fluidity + intuitive access (the "optimize" ask)

- **One flag, one environment:** `compy_lab_ground` replaces the bento/guided/classic tangle; flag-off is
  byte-identical to today's Lab (P-series guard). Retire the no-op `compy_lab_guided` visible-nothing
  state and the dead welcome band under the new flag.
- **The "next" leads, not trails** — the room always shows one obvious next action at the top.
- **In-place motion, GPU-cheap:** section jumps keep the existing scroll+expand (no route churn); the
  gallery rides `frameloop="demand"` (idle GPU ~0) like every other canvas; reduced-motion → a static
  grid of the same pieces (the sister-site's own "prefer the classic grid" fallback).
- **Completion signal:** finishing the loop (a proven Keep) lights the gallery entry — the Lab's answer
  to having no forward door.

## 5. Mutation scope — what I build now vs. the one LOCKED line

**Build now, no new safety decision needed** (all already owner-decided / catalog-safe):
- The **16 appliable recs** (`APPLIABLE_REC_IDS`, `history.rs:35`) via the existing trial loop — this IS
  "make real changes + test + prove," fully reversible.
- Surfacing the **already-ARMED gated features** — `gaming_mode` (LIVE), `service_suspend` (ARMED),
  `bloat_removal` (ARMED) — as testable/provable changes reachable from the Lab is **wiring, not a new
  safety decision** (their gates are already `true`, same `actions.rs`/`history.rs` boundary). This
  widens "actual changes you can make and prove" meaningfully, within the locks.

**NOT built without an explicit owner product decision (LOCKED rule 6 — frozen ~29 catalog, no new risky
tweaks):** widening the tweak *set itself* — any new tweak beyond the frozen catalog. If living with the
proving-ground makes the owner want *more* levers than the safe set offers, that is a deliberate
catalog-expansion decision (welfare-check, per-tweak apply/rollback QA) — surfaced to him, never taken
unilaterally. **The Lab as designed fully delivers his ask on the safe set; catalog expansion is an
optional later escalation, not a prerequisite.**

**Structurally impossible (don't attempt):** GPU-profile *apply* — AMD profile state isn't user-mode
readable, so it can't satisfy rollback-first (LOCKED rule 3) regardless of rule 6 (`BACKLOG.md:824`).

## 6. Build phases (flag-gated `compy_lab_ground` DEFAULT OFF; each verifiable, P-series eyeball)

1. **Spine refactor** — collapse bento/guided/classic into the one linear proving-ground layout behind
   the flag; router promoted to front door; canonical order; progress-leading "next"; flag-off
   byte-identity guard. *(Frontend only; zero src-tauri.)*
2. **Benchmark-as-centerpiece** — elevate the measure→tweak→prove loop; wire the Two Futures measured
   split as the "prove" visual with real `Efficacy` per-part emphasis. *(Frontend; reuses existing IPC.)*
3. **The gallery** — the panoramic drag-shell + `TourCamera` fly-to-piece, populated from scoreboard /
   sessions / ledger / black-box (all existing IPC); anti-fabrication empty-state; reduced-motion grid
   fallback; the completion-signal wiring. *(Frontend; new R3F shell over existing primitives.)*
4. **Armed-feature test bays (optional, owner nod)** — surface gaming_mode/service_suspend/bloat as
   provable changes in the Lab. *(Wiring of already-armed gates; no new mutation primitive.)*

**Rails (non-negotiable, inherited):** honest measurement (every number measured or honestly absent, no
fabricated trophies) · frontend-first, GPU-cheap, demand-frameloop, pause on blur/game/battery ·
reduced-motion still version · flag-gated DEFAULT OFF + flag-off byte-identical · rollback/TrustSwitch/
mutation boundary untouched (phases 1–3 are zero-src-tauri) · all-original, plain honest voice.

**Verification per phase:** tsc 0 · full vitest (no regress) · flag-off byte-identity guard ·
`self-reviewer` PASS at native 1500×980 · `git diff -- src-tauri` empty for phases 1–3 · ship via the
`ship` skill (silent reinstall + stamp verify) at each eyeball checkpoint.
