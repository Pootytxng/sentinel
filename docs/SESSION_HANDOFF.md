# Session handoff — 2026-08-20 (night): rail door merged, History pass shipped, Live + Test next

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`, branch `lane/rooms-intimidation`.

## Landed this session

- **PR #186 merged (`aff85bd6`)** — `lane/focus-121`: the #121 WinEvent trace instrument + decision 2,
  plus two things the gate caught: BACKLOG over its byte budget (A4's 42 shipped rows → `docs/archive/
  BACKLOG_A4_SHIPPED_2026-08-20.md`, ratchet 114 → 106 KB) and the **site-build lock's reclaim race**
  (`scripts/stage-dist-site.mjs` `reclaimLock`, five deterministic guards).
- **PR #187 merged (`70a8ba0e`)** — `lane/rail-door`: design foundation ⑤, instruments behind a door
  (Health the front door, Live · History · Test under "Look deeper"). Desk build `0808e33e`,
  self-review PASS 10/10; superseded the same evening by the build below.
- **Desk build `8ba6a6d1` — the History intimidation pass (room 1 of 3)** on `lane/rooms-intimidation`
  (`fcc957b2` the pass, `8ba6a6d1` the BentoTile header fix its first self-review caught). Screenshots
  of the installed build came first (`docs/ui-sweep/shots/rooms-before/`, gitignored): History measured
  worst. Now: month-grouped record, 8-row screenful + honest "show N older", a row that cannot overlap,
  plain undo door, HUD readout fades the scroll lane under itself, tile titles never wrap.
  Self-review PASS 10/10 on the installed build. Before/after handed to the owner (`SendUserFile`).

## Next action

1. **Owner's eye** on the rail door and on History (both shipped; veto on sight).
2. **⭐ STANDING DIRECTIVE — Live, then Test** (same loop: screenshots already in `rooms-before/`;
   restructure as layout, never a switch; self-review; ship; before/after to the owner). Live's
   targets: the all-caps mono delta string under the frametime deck (`.mc-delta` in
   `MonitorConsole.tsx`) → a boxed template with three value cells and a sans label; the two "NO
   SIGNAL" boxes need a one-line "start a capture and play — the trace draws here"; controls sit
   before any orientation line. Test's targets: the "Controlled experiments" jargon opener, "Your rig"
   repeating Health's numbers, six equal-weight station buttons with no "start here", "SAFE STACK
   READY 0" reading as an alarm.
3. Then `docs/BACKLOG.md` ▶ NEXT UP: #126, #156, #128, #125. Nothing blocked on the owner.
