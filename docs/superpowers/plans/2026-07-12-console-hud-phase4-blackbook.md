# Console HUD — Phase 4: the Blackbook "Logbook" console

> **Entry gate CLEARED (owner, 2026-07-12): direction A "The Logbook" picked** from the concept
> Artifact <https://claude.ai/code/artifact/b00295a5-97d0-4f33-9703-0ae975951e91> ("blackbook looks
> good" + A). Naming default accepted: the room stays **"Blackbook"**, its timeline is **"the
> logbook"**, and the existing Lab **"Black Box"** (crash-forensics, `BlackBox.tsx`) is left alone.
> This is the next per-tab Console-HUD rollout after Home (Phase 2, default-ON) and Monitor (Phase 3,
> owner-eyeball pending). **Build in a FRESH session** (Home/Monitor pattern) — this file is the resume.

## What Blackbook is today (verified 2026-07-12, Explore map)

- Live surface: `src/surfaces/BlackbookV2.tsx` → wraps `RoomShell` + composes `src/surfaces/Learn.tsx`
  (1064 lines) verbatim with `v2` + `keepRecord` props. Rail id `learn`, label "Blackbook"
  (`src/design/homeRail.ts:23`); routed at `src/App.tsx:1531-1537`. (Dead branch at `App.tsx:1239-1246`
  never fires — `roomPanels` is guarded `activeTab !== "Learn"`.)
- It is the **knowledge LIBRARY**, not a records room. Two modes (`Learn.tsx:838-855`):
  1. **"Look it up"** — search + type filters + category sections of `EntryCard`s over the bundled
     `KNOWLEDGE` corpus (`src/data/knowledge.ts:380`): 186 static entries (84 tweaks · 81 terms ·
     14 tricks · 7 guides) + `TUNING_GUIDE_ENTRIES`. Zero IPC, fully offline.
  2. **"Autopsy a guide"** — `AutopsyPanel` (`Learn.tsx:544-667`): paste a guide → `autopsyScan()`
     (`src/data/knowledge-autopsy.ts`) grades every claim real/placebo/risky/unknown, client-side.
     "Your autopsy record" rollup from `readAutopsyLedger()`/`autopsyStats()`
     (`src/data/autopsy-ledger.ts`, localStorage `compy_autopsy_ledger_v1`).
- HUD today: only the generic four-room masthead (`HudMasthead label="Field records"`, no LED — the
  room computes no live health state) via `useHudFlag()` (`compy_editorial`). `blackbook-v2.css` is a
  token re-point over the SAME classic DOM. **No `compy_blackbook_console` flag exists yet**, no
  bespoke instrument — unlike `HOME_CONSOLE_KEY`/`MONITOR_CONSOLE_KEY` (`theme.ts:471,500`).

## The direction (A · The Logbook)

Blackbook keeps the field-guide **and** gains its own record. One room, two faces:

- **Logbook (new, default face under the flag):** a single reverse-chronological **tape** unifying the
  user's REAL events into typed records — each with a type tag, a timestamp, an outcome, and (for
  changes) its rollback:
  - **Change** records ← applied-changes ledger (`get_applied_changes` → `history.json`, already in App
    state `changes`, `App.tsx:759`), each carrying its rollback.
  - **Session** records ← `get_session_summaries` (already in App state, `App.tsx:741`): game · avg fps ·
    1% low · duration · vs-previous.
  - **Autopsy** records ← the local autopsy-ledger (`readAutopsyLedger`): guide graded, real/placebo/
    risky counts.
  Below the tape, a **compact library strip** (a few "start here" / rig-fit entries) that doors into
  the full field-guide.
- **Field guide (the existing room):** the full "Look it up" + "Autopsy a guide" library, unchanged —
  reached via the mode toggle. This IS the flag-off classic room, so byte-identity is free here.

**Why A:** delivers the flight-recorder signature the direction spec wanted WITHOUT demoting the
186-entry library (a core trust asset), and gives Blackbook a signature no other room wears (Home =
identity hologram · Monitor = live scope · Lab = instrumented bench · Blackbook = **the record**).

## Rails (non-negotiable — same as every Console phase)

- **Flag-gated, DEFAULT OFF:** new `compy_blackbook_console`, `readBlackbookConsole()` → `=== "1"`
  (`theme.ts`, mirror `MONITOR_CONSOLE_KEY`). Flag OFF ⇒ Blackbook byte-identical to today (the
  Learn library), test-pinned for BOTH `compy_editorial` states (mirror `monitor-console-flag.test.tsx`).
- **Zero new IPC, zero `src-tauri`:** every record already crosses IPC today. `git diff -- src-tauri`
  MUST be empty. The unified tape is a PURE frontend builder over data App already holds.
- **The tape MIRRORS, never MOVES:** applied changes still live in the Lab's Optimize station,
  sessions still in Monitor. The Logbook is a read view over the same structs — deleting/rolling back
  is the same audited path, not a fork.
- **Rollback affordance = the EXISTING audited path.** A change record's "undo" calls the SAME
  `rollback_change` IPC the Fix ledger already uses (`App.tsx:856`) — no new IPC, no new mutation
  primitive. **Even as reuse, any surface that can trigger a mutation gets the mutation-gate glance**
  (`.claude/skills/mutation-gate`); if it's simpler/safer, a "manage in Optimize" jump to the existing
  ledger is an acceptable v1 instead of an in-room rollback button — build-session call, mutation-gate-aware.
- **Honesty rail:** the tape shows ONLY real records. No records ⇒ honest empty ("No record yet —
  Compy logs changes, sessions and guide checks as they happen"), never a fabricated row. Cross-game /
  partial data labeled honestly (reuse the Monitor conventions).
- **Title-header law (owner 2026-07-10):** the room h1 stays the bare title **"Blackbook"**. The
  "N records · since <date>" status + any logbook framing lives in the BODY, not the header
  (mirror the Home-console `.hc-verdict` pattern / `home-console.test.tsx` title pin).
- **Theme accent only** (no vendor purple `132,0,255` — test-pinned law) · **reduced-motion ⇒ still**
  (no tape scrub/reveal animation under `data-motion="reduced"`; gate via resolved reduced-motion).
- **Naming:** the new copy must NOT introduce a second "Black Box" (collision with `BlackBox.tsx`
  crash-forensics). Call the timeline "the logbook". Guard: no "Black Box"/"black box" string in the
  new Blackbook-console copy.

## Build tasks (TDD where it's logic; self-review before done)

1. **T1 — flag + reader.** `BLACKBOOK_CONSOLE_KEY = "compy_blackbook_console"`, `readBlackbookConsole()`
   in `theme.ts` (`=== "1"`, default OFF) + Settings → Appearance "Blackbook console (preview)" row
   (mirror the Monitor row). Guard: default-off + round-trip.
2. **T2 — the pure tape builder.** `src/surfaces/blackbook/logbook.ts` (or `src/data/`):
   `buildLogbook({changes, sessions, autopsy}) → LogbookRecord[]` (typed union, reverse-chron, only
   real, rollback flag only on changes). Full truth-table test (empty / each-source-only / mixed /
   ordering / partial-fields) — the honesty spine. This is the highest-value guard; write it first.
3. **T3 — the Logbook face.** New `src/surfaces/blackbook/BlackbookConsole.tsx` (+ css) rendering under
   the flag: HudMasthead title "Blackbook" · body status line · the tape (hairline records, LEDs, mono
   timestamps, type tags, undo affordance per T-rails) · the compact library strip · the mode toggle to
   the field-guide. Reuse the Console kit + `hud-rooms.css` atoms; no new color/spacing literals.
   Wire it into `BlackbookV2.tsx` behind `readBlackbookConsole()`; flag-off renders today's Learn tree
   untouched.
4. **T4 — guards.** Flag-off byte-identity (both editorial states) · title-header h1 pin · honest-empty ·
   theme-accent/no-vendor-purple · reduced-motion still · naming (no "Black Box" string). 
5. **T5 — self-review (dispatch the self-reviewer, NEVER inline)** at the owner's real 1500×980 on the
   live dev instance: real tape with real records if present, honest empty if not, flag round-trip,
   title-only header, idle-still. Fix → re-review → PASS.
6. **T6 — ship** (`.claude/skills/ship`): build → silent-reinstall → stamp-verify live == build → one
   installer on the Desktop. Then RELEASE_STATE banner + installer row, BACKLOG cycle, UI_VISION §C,
   OWNER_ACTION_CHECKLIST A8 → "shipped behind flag, owner eyeball = the gate".

## Owner eyeball (the gate after build)
Settings → Appearance → "Blackbook console (preview)" → open Blackbook. Looks-good ⇒ default-ON flip
rides its own commit (the Home/Monitor-console pattern; `readBlackbookConsole` → `!== "0"`, classic
library stays reachable via the "0" failsafe).
