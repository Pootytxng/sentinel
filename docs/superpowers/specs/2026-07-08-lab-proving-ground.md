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

## ★ PRIMARY BLUEPRINT — owner course-setter (2026-07-09)

> **This is the blueprint the owner named as the one to "set course on for the big overhaul." It amends
> and outranks the original design below where they differ. Verbatim intent:**
>
> *"I'm entirely willing to open the catalog if it's within measurable benefit for any user. Even if the
> individual tweak is negligible, the accumulative measurement of negligible changes theoretically becomes
> considerable. Also I've had thoughts looking into combining the Optimize tab merged into the Lab but
> still allowing the user to have the option to just enable all the tweaks without benchmarking as a
> requirement — but just the utility that can be used in tandem or parallel to the tweaks. This promotes
> the organized and slim easy-to-navigate motto I've been trying to stick to and encourages users to
> explore the utility simply because it's all in the same room with the stuff they really came for
> (assuming most users will want to just enable all the tweaks and never look back)."*

### Directive 1 — OPEN THE CATALOG (owner product decision, lifts the LOCKED-rule-6 freeze)

The frozen-catalog vow is **lifted** by explicit owner decision. New law: **a tweak earns catalog
inclusion by measurable benefit** — even individually-negligible; the **cumulative measured stack** is the
point. The honest vehicle: **aggregate before/after A/B** (measure the whole enabled stack's real delta,
not each tweak in isolation below the noise floor) — this is the loud-but-true Receipts story
("measured X% faster on YOUR rig").

**"Measurable benefit" is an ADD criterion ON TOP OF the permanent safety rails — never instead of them.**
Every catalog tweak MUST still be:
- **Reversible** — captured typed rollback contract + snapshot at apply time (LOCKED rule 3). No rollback → no catalog.
- **No kernel driver / no injection / anti-cheat-safe** (LOCKED rules 1–2).
- **Non-security-weakening** — the UAC/Defender/firewall/`Policies` security-gate stands (the security/system-settings rule).
- **Stability-safe.**

**The old hard blocklist splits in two:**
- **Stays barred regardless of measured fps** (excluded for SAFETY/STABILITY/SECURITY/ANTI-CHEAT, not for
  being unmeasured): timer/HPET hacks, bcdedit boot params, MMCSS abuse, **core-parking writes**, Defender
  disable, MPO disable, fixed pagefile forcing, kernel-level anything, anything that trips EAC/BattlEye.
  Measurement does not make these safe.
- **Becomes a candidate** once it proves measurable benefit AND clears the rails: anything previously
  excluded merely as unmeasured "optimizer-rot / snake-oil."

**Per-tweak rigor is unchanged:** every new tweak rides the full **mutation-gate** — its own apply/rollback
QA + welfare-check — before it ships. Opening the catalog is a POLICY change, not a license to add tweaks
without the per-tweak proof + safety contract.

### Directive 2 — MERGE OPTIMIZE INTO THE LAB (one slim room)

The **Optimize room merges into the Lab.** The Lab becomes the single destination for both paths, so the
"organized, slim, easy-to-navigate, one room" motto holds:
- **Fast path (the default most users want):** **"enable all the good tweaks" in one action, NO benchmarking
  required.** Apply the safe stack and never look back. Benchmarking is a **tool, not a toll** — never a gate
  in front of applying tweaks.
- **Utility path (parallel/in-tandem, optional):** the measure→test→prove loop + the telemetry gallery sit
  right there in the same room — **discoverable precisely because it's beside the thing users came for.**
  Power users prove the stack; casual users ignore it. Both live in one room.

This **re-weights the spine below:** "apply tweaks (incl. enable-all)" is the PRIMARY surface; the
measurement/proving loop is the powerful adjacent UTILITY, not the required entry. The gallery still crowns
the loop.

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

**Catalog EXPANSION — now GREEN (owner decision 2026-07-09, ★ Directive 1 above).** The freeze is lifted:
new measurable-benefit tweaks may be ADDED, under the permanent safety rails (reversible · no-kernel ·
anti-cheat-safe · non-security-weakening · stability-safe). This is the biggest change from the original
scope — the Lab's proving loop is now also the **pipeline that qualifies new catalog tweaks** (a candidate
tweak proves measurable benefit on the bench → clears the rails → rides the mutation-gate QA → joins the
catalog). Each addition is still per-tweak-gated (rollback contract + QA + welfare-check); the POLICY is
open, the per-tweak RIGOR is not relaxed. **Still barred regardless of measurement:** the safety/stability/
security/anti-cheat blocklist (Directive 1). **Still structurally impossible:** GPU-profile apply
(unreadable AMD prior → can't satisfy rollback-first).

**Structurally impossible (don't attempt):** GPU-profile *apply* — AMD profile state isn't user-mode
readable, so it can't satisfy rollback-first (LOCKED rule 3) regardless of rule 6 (`BACKLOG.md:824`).

## 6. Build phases (flag-gated `compy_lab_ground` DEFAULT OFF; each verifiable, P-series eyeball)

1. **Merge + fast path (★ the primary surface)** — merge the Optimize room into the Lab; **"enable all the
   good tweaks" in one action, no benchmarking required** as the lead affordance; collapse the
   bento/guided/classic nav idioms into one slim linear spine; intake router as front door; flag-off
   byte-identity guard. *(Frontend re-org; the existing apply path is unchanged — no new mutation
   primitive.)*
2. **Prove utility (parallel, optional)** — the measure→tweak→prove loop beside the tweaks, incl.
   **aggregate-stack A/B** (measure the whole enabled stack's real delta, the honest cumulative-benefit
   story); wire the Two Futures measured split as the "prove" visual with real `Efficacy` per-part
   emphasis. *(Frontend; reuses existing IPC; may add an aggregate-trial backend path → mutation-gate.)*
3. **The gallery** — the panoramic drag-shell + `TourCamera` fly-to-piece, populated from scoreboard /
   sessions / ledger / black-box (all existing IPC); anti-fabrication empty-state; reduced-motion grid
   fallback; the completion-signal wiring. *(Frontend; new R3F shell over existing primitives.)*
4. **Catalog-expansion pipeline (★ Directive 1)** — the mechanism to qualify + ADD new measurable-benefit
   tweaks: candidate → proves benefit on the bench → clears the safety rails → rides per-tweak
   mutation-gate QA → joins the catalog. Each addition touches `actions.rs`/`history.rs` → **mutation-gate
   + welfare-check per tweak.** Also updates the frozen-catalog doctrine docs (see §7).
5. **Armed-feature test bays (optional, owner nod)** — surface gaming_mode/service_suspend/bloat as
   provable changes in the Lab. *(Wiring of already-armed gates; no new mutation primitive.)*

**Rails (non-negotiable, inherited):** honest measurement (every number measured or honestly absent, no
fabricated trophies) · frontend-first, GPU-cheap, demand-frameloop, pause on blur/game/battery ·
reduced-motion still version · flag-gated DEFAULT OFF + flag-off byte-identical · rollback/TrustSwitch/
mutation boundary untouched (phases 1–3 are zero-src-tauri) · all-original, plain honest voice.

**Verification per phase:** tsc 0 · full vitest (no regress) · flag-off byte-identity guard ·
`self-reviewer` PASS at native 1500×980 · `git diff -- src-tauri` empty for phases 1–3 · ship via the
`ship` skill (silent reinstall + stamp verify) at each eyeball checkpoint.

## 7. Doctrine docs this overhaul must re-sync (the catalog freeze is lifted)

Opening the catalog (★ Directive 1) contradicts the standing "frozen catalog" language in several places —
drift is the project's #1 named risk, so these get updated as tracked step 0 of the build (with the exact
safety-rail framing above; the security/system-settings + rollback-first + no-kernel/no-injection LOCKED
rules are UNCHANGED — only the *freeze* on additions is lifted):
- **`CLAUDE.md` LOCKED rule 6** ("Tweak catalog is frozen (~29 recs) — no new risky tweaks") → reworded to
  the measurable-benefit-under-rails policy. An amendment pointer was added 2026-07-09; the full rule
  rewrite rides the build so the LOCKED wording is changed deliberately, not in passing.
- **`docs/PRODUCT_DIRECTION.md`** (frozen-catalog / "grows upward not sideways" framing) → the catalog now
  also grows by *measured* additions; "sideways into more switches" is re-permitted **when measured + safe**.
- **`docs/RECEIPTS_DOCTRINE.md`** → the aggregate-stack measured-gain is now a first-class marketing engine
  (cumulative "measured X% faster on YOUR rig"); fits the doctrine, worth an explicit line.
- **`docs/RELEASE_STATE.md`** — the mutation-safety posture note references the frozen allowlist; update
  when the first new tweak actually lands (not before — the allowlist is still literally 16 until then).
- **The blocklist** stays documented as-is but reframed: split into "safety/anti-cheat (permanent)" vs
  "unmeasured-until-proven (candidate)."
