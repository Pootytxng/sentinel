# Owner directive 2026-07-02 — "full tidy" feedback + the ruled path

> Verbatim intent, captured per PERSIST-TO-DISK: owner wants every tab slimmer/tidier and more
> consolidated; can't tell what Fable's work is actually changing; is considering a **full
> refactor** prioritizing intuitive architecture + UI, "react-style web-design templates within
> the app," everything flush/easy-access, all existing tools kept, and — the core ask — an
> **inherent usage order**: like reading a book left-to-right, the user should just *know* the
> sequence to use the tools in.

## Ruling (Cowork design lane): NO ground-up rewrite. Here's why + what instead.

**Why "nothing looks fixed": every slim-down deliverable landed DEFAULT-OFF.** P1 slimRows
(`5bb13f4`), P2 Basic/Advanced (`db00a44`), P3 HomeV3 — all behind Settings → Appearance preview
toggles awaiting the owner taste call. The live app is *byte-identical by design* until he flips
them. The work exists; the visibility gate is him.

**Why no rewrite:** the frontend already IS React/TS with a mature token + primitive system
(`Card/Gauge/Stat/StatusPill/SegmentedControl/TrustSwitch`) and CI design guards. The audit
(UI_SLIMDOWN_PLAN §1) found the mess is (a) triple render paths per room and (b) too many
elements per screen — both are *deletion and template* problems, not architecture problems.
A rewrite re-risks the mutation/rollback boundary + 800 green tests for zero user-visible gain,
and burns the last on-plan Fable week (token protocol) on re-doing what exists.

**Decompose the ask → existing plan + ONE new item:**

| Owner ask | Maps to |
|---|---|
| "consolidated, tidy, so much duplication" | **P4 dedup** — delete classic/losing render paths (already planned; gated on owner default-ON) |
| "react-style templates, flush" | **The per-room contract** (plan §5: one template — verdict hero → primary action → detail on tap) applied to EVERY room, enforced by a shared `RoomShell` layout primitive + guard test |
| "tools used in an inherent order, left-to-right like a book" | **NEW → P6 "Journey" pass** (below) |
| "keep every tool integrated" | Nothing is deleted, only demoted to Advanced/detail layers (P2 contract) |

## P6 — the Journey pass (the genuinely new work)

The rail already reads in story order: **Home (how am I doing) → Optimize (find + fix) →
Monitor (play + measure) → Blackbook (understand) → Lab (instruments)**. The chapters are in
order — they're missing chapter numbers and a "continue" at the end of each. Spec direction:

1. **Every room ends with ONE forward door** to the next chapter ("navigation never teleports"
   law — e.g. Optimize's apply-complete state offers "Watch it live → Monitor"; Monitor's
   session-end debrief offers "What changed? → Blackbook"). The order becomes *felt*, never taught
   (foam-pit law).
2. **Shared `RoomShell` template** — one skeleton per room: verdict line → primary action →
   ranked list → quiet "nothing else needs attention" expander → forward door. P1–P3 already
   built the pieces; P6 makes the skeleton a single primitive + guard so rooms can't drift.
3. **First-run tour rides the same order** (SetupTour already exists — align, don't add).
4. Flag-gated (`compy_journey`), DEFAULT OFF, zero Rust, zero IPC — same reversibility contract
   as P1–P3.

## Sequence (unchanged gates)

1. 🔴 **Owner eyeballs P1/P2/P3 flag-on + v2 mockup** (the standing blocker — everything queues behind this).
2. Owner default-ON call per flag → **P4 dedup** (CC build — the consolidation he's asking for).
3. **P5 side-pile/chrome pass** → **P6 Journey** (Cowork specs it in detail after the P1–P3 verdict,
   since his taste notes will shape the template).

Full refactor = rejected as scoped; superseded by P4 (consolidation) + room contract (templates)
+ P6 (order). If the owner still wants a deeper architectural rework after seeing P1–P3 ON, that's
a new council question — revisit then with his specific dissatisfactions as input.
