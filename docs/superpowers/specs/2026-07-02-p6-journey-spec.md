# P6 "Journey" — detailed spec (Cowork, 2026-07-02)

> **Owner verdict 2026-07-02 (persisted): the default-ON look STAYS** — P5.5 live-reviewed,
> "its good lets continue." This unblocks P4 dedup (build first) and this spec (build second,
> on the deduped tree). Direction doc: `2026-07-02-full-tidy-directive.md`. Laws: foam-pit
> (order is felt, never taught), placement/doorknob, Sarah & Caleb plain language.

## Goal

The rail already reads in story order: **Home → Optimize → Monitor → Blackbook → Lab**.
P6 makes that order *felt*: every room is built on one shared skeleton and ends with ONE
forward door to the next chapter. No new tools, no moved tools, zero Rust, zero IPC.

## Build order (strict)

1. `RoomShell` primitive + guards (no room migrated yet — pure addition).
2. Migrate rooms one commit each: Home → Optimize → Monitor → Blackbook → Lab.
3. Tour alignment last.

Flag: **`compy_journey`, DEFAULT OFF**, Settings → Appearance preview toggle, flag-off
byte-identical (test-pinned, same pattern as P1–P5).

## 1 — `RoomShell` (src/design/room-shell.tsx)

One skeleton, five slots, in fixed order:

| Slot | Contract |
|---|---|
| `verdict` | ONE plain-English verdict line. Required. No jargon; measured facts only (honesty law). |
| `primaryAction` | ONE primary affordance. Optional (Blackbook may have none). Never two. |
| `body` | Ranked list / room content. Required. |
| `quiet` | The "nothing else needs attention" expander (P5 side-pile). Optional. |
| `forwardDoor` | ONE `<ForwardDoor to={room} label={...}/>`. Required except Lab. |

`ForwardDoor` navigates via the existing rail navigation (same handler the rail uses —
"navigation never teleports": it selects the room, no modal, no new window).

## 2 — Forward-door map (copy is final unless owner retunes; plain-language bar applied)

| Room | Door label | Destination | Placement |
|---|---|---|---|
| Home | "Find what's worth fixing" | Optimize | Below the hero verdict, after the rig hologram section (hologram untouched — retained-liveliness law). |
| Optimize | "Watch it live" | Monitor | In the apply-complete / all-clear state ONLY — the door is the reward for finishing the chapter, not a bypass. |
| Monitor | "See what changed" | Blackbook | In the session-end debrief card; absent during a live session. |
| Blackbook | "Open the instruments" | Lab | Foot of the room. |
| Lab | — none — | — | Last chapter. No loop-back door (the rail is the way home; a loop door would teach circles, not order). |

Rules: door renders exactly once per room · door is quiet chrome (text + chevron, no accent
fill — it's a doorknob, not a CTA) · door never appears above the room's own primary action.

## 3 — Guards (bug→guard tier 1)

- `room-shell.test.tsx`: each migrated room renders inside `RoomShell`; exactly ONE
  `ForwardDoor` (zero for Lab); slot order fixed (verdict before primaryAction before body).
- Flag-off byte-identity test per migrated room (P1 pattern).
- Door-destination test: the map above pinned literally, so a copy/destination drift fails CI.
- Existing A6 / contrast / dedup guards stay green.

## 4 — Tour alignment (last commit)

SetupTour visits rooms in rail order already — align its copy to name the journey ("first you
check, then you fix, then you watch it live"), no new tour steps. Align, don't add.

## Hard lines

- Zero `src-tauri` diff across ALL P6 commits.
- TrustSwitch, mutation/rollback paths, GamingMode internals untouched — P6 moves chrome, never handlers.
- No room content deleted or demoted — P6 adds skeleton + doors only (P2/P4 own demotion/deletion).
- Rig hologram stays Home hero (retained-liveliness law).
- All copy passes Sarah & Caleb; no unmeasured claims in verdict lines.

## Verify (per commit)

tsc clean · vitest green (incl. new guards) · flag-off byte-identity proven · self-review
rubric on flag-ON dev build with shots in `docs/ui-sweep/shots/p6/`.

## Sequencing note

P6 builds ONLY after P4 dedup lands — migrating rooms onto RoomShell while classic render
paths still exist would migrate code P4 is about to delete.
