# Canonical UI-face and feature-flag inventory

**Phase B step 1 for issue #49.** Derived from `design/quiet-pit-wall` @ `951a0c0` (base `e85d6ae`), 2026-08-01.
Nothing here is deleted or disabled. This document names, for each room, the **one canonical
surface** the Quiet Pit Wall rebuild targets and the faces that retire *after* parity and installed
approval — never before.

## How faces are chosen at runtime

There is no central route table. Each room has an **entry component that reads flags and branches**:

```
HomeRoom.tsx      → useHomeConsoleFlag() ? <HomeConsole/> : useHudFlag() ? <HomeHud/> : <HomeV2/>
LabGround.tsx     → useHudFlag() branch
LabV2.tsx         → useHudFlag() branch
BlackbookV2.tsx   → useBlackbookConsoleFlag() && useIntelligenceFlag() branch
App.tsx:1328      → monitorMerged ? <Monitor/> : <Play/>
```

Flag readers and their defaults live in `src/design/theme.ts`; the two navigation-merge readers live
in `src/data/nav-flags.ts`. The convention is `getItem(KEY) !== "0"` for **default ON** and
`getItem(KEY) === "1"` for **default OFF**.

## Flag census — 61 `compy_*` keys

**Default ON** (`!== "0"`) — 17 keys, all shipping behaviour:
`living_instrument` · `lab_bento` · `lab_ground` · `setup_stepper` · `firstcheck_theater` ·
`monitor_cards` · `hologram_v2` · `editorial` (the HUD) · `home_console` · `monitor_console` ·
`blackbook_console` · `gaming_console` · `hud_frame` · `intelligence` · `room_identity` ·
`jarvis_motion` · `dash_v2`. Plus `optimize` and `monitor` (merge readers, default merged-ON).

**Default OFF** (`=== "1"`) — `close_to_tray` · `committed` · `lab_guided` · `two_futures` ·
`home_intake`.

The rest are **not faces**: persisted user state and seen-markers (`onboarded_v1`, `first_check_v1`,
`last_check_v1`, `lab_welcome_seen_v1`, `sessions_seen_v1`, `bb_helpful_*`, `dismissed_recs`,
`changes_active`, `change_ids`, `autopsy_*`, `gpu_profile_*`, `use_profile_v1`, `local_stats_v1`,
`eligibility_overrides`, `ledger_this_rig`), or genuine user preferences that must survive the
redesign (`theme`, `motion`, `lang`, `view_mode`, `expert_view`, `display_refresh_hz`, `overlay_*`,
`room_accents`, `score_face`, `learn_mode`, `settings_v2`, `trust_moment`, `home_rig_3d`).

**One correction to the record:** `compy_monitor_console` is documented in
`docs/UI_VISION_BACKLOG.md` (A0 item 2) as "still DEFAULT OFF" as of 2026-07-11. It is
**default ON** on `main` today — `theme.ts:544` reads `!== "0"`. The backlog line is stale.

## Per room

### Home — canonical: `HomeConsole.tsx` (40 KB)

| Face | Size | Status |
|---|---|---|
| `HomeConsole` | 40 KB | **CANONICAL.** `compy_home_console` default ON. Owns the 3D rig (`compy_home_rig_3d`), the Dock rail, the intake band. |
| `HomeHud` | 28 KB | Retire after parity. Only reachable with `compy_home_console="0"` **and** `compy_editorial` ON. |
| `HomeV2` | 24 KB | Retire after parity. The last-resort branch. |
| `HomeRoom` | 2.4 KB | **Keep** — it is the router, not a face. It becomes the seam where the Quiet Pit Wall Home is introduced. |
| `CompyHero`, `HardwareGrid`, `ScanStream`, `side-pile`, `hud-masthead` | — | Home-owned parts; audit individually, not as faces. |

### Lab — canonical: `LabGround.tsx` entry (5 KB) over the `Lab`/`LabConsole` station body

| Face | Size | Status |
|---|---|---|
| `LabGround` | 5 KB | **CANONICAL entry.** `compy_lab_ground` default ON — the merged proving ground; the single door to applying tweaks. |
| `LabConsole` | 17 KB | The console body `LabGround` renders. Canonical *body* until the Quiet Pit Wall single-decision surface replaces it. |
| `LabBento` | 7 KB | `compy_lab_bento` default ON but downstream of Ground. Retire after parity. |
| `LabV2` | 4.3 KB | Retire — the `compy_lab_ground="0"` failsafe. |
| `Lab` (classic) | 35 KB | Retire — station host (Optimize · Diagnostics · Benchmark · Latency · Tuning · Blackbox). This is the "mega-room" the panel rejected. |
| `OptimizeV2` | 16 KB | Retire — the merged Optimize room under the classic path. |
| `Optimize` (classic) | 11 KB | Retire. |
| `Check` | **52 KB** | Retire — legacy. Its *behaviour* (evidence mapping, friendly names) is portable. |
| `Fix` | **68 KB** | Retire — the single largest surface in the tree. |

`Check` + `Fix` + `Lab` + `Optimize*` = **~181 KB of TSX** on the retirement list for one room. That
is the size of the prize.

### Monitor — canonical: `MonitorConsole.tsx` (25 KB)

| Face | Size | Status |
|---|---|---|
| `MonitorConsole` | 25 KB | **CANONICAL.** `compy_monitor_console` default ON. Carries the v4 session-waterfall work. |
| `Monitor` | 9.4 KB | **Keep** — the entry/router (`App.tsx:1328`), not a face. |
| `MonitorV2` | 10.5 KB | Retire after parity. |
| `MonitorBasic` | 9.4 KB | Retire after parity. |
| `MonitorDomainCards` | 12.5 KB | `compy_monitor_cards` default ON — audit as a part, not a face. |
| `monitor-panels` | 20 KB | Shared parts; audit individually. |
| `Play` | 23 KB | Retire — the `compy_monitor="0"` failsafe. |

### Blackbook — canonical: `BlackbookV2.tsx` (9.3 KB) + `blackbook-console.css`

| Face | Size | Status |
|---|---|---|
| `BlackbookV2` | 9.3 KB | **CANONICAL entry.** Branches to the console face when `compy_blackbook_console` **and** `compy_intelligence` are both ON (both default ON). |
| `BlackBox` | 11 KB | Currently rendered *inside* Lab (`Lab.tsx:299,525`, `LabConsole.tsx:234`). Under Direction D its receipts belong in Blackbook — this is a **move**, not a retirement. |
| `Learn` | 47 KB | The Field Guide. Direction D demotes it to contextual search/help. Retire the standalone room presentation, keep the content. |

### Cross-cutting chrome — all canonical, all in scope for the token layer

`ShellV2` (rail + topbar, the shipped shell) · `WindowChrome` · `HudFrame` (`compy_hud_frame`) ·
`dashboard-skin.css` (`compy_dash_v2`) · `tokens-v2.css` (`[data-v2="on"]`) ·
`tokens-hud.css` (`[data-hud="on"]`) · `room-identity.css` (`[data-room-identity="on"]`) ·
`living-instrument.css` · `jarvis/*` (`compy_jarvis_motion`).

## The one finding that outranks the rest

`src/design/use-motion.ts` defaults `readMotionPref()` to **`"full"` — deliberately ignoring the
Windows reduced-motion setting** (recorded there as an owner decision, 2026-06-19). Direction D and
WCAG 2.2 both require the opposite: the system preference is the default authority, with an explicit
user override allowed but never a silent one. The owner listed this in the redesign brief's conflict
table as "contradicts accessibility direction; fix". It is a default flip plus a migration, not a
rewrite — and it is the cheapest accessibility win available. Handled in the same commit as the token
layer.

Only **13 files** in `src/` reference `prefers-reduced-motion` at all; everything else routes through
`<html data-motion>`. That single attribute is the whole contract, which is why the flip is cheap.

## Retirement rule (binding)

No face on this list is deleted, disabled, or flag-flipped until (1) its Quiet Pit Wall replacement
reaches parity, and (2) that replacement passes installed acceptance on the owner's machine. Legacy
retirement is step 10 of Phase B, not step 2. Deleting early removes the only fallback if a
replacement regresses.

## Scope note — what was verified vs. inferred

**Verified this session:** the full 61-key flag census and every default (read from `theme.ts`,
`nav-flags.ts`, `main.tsx`); the Home face router line-for-line; the flag-branch entry points in
`LabGround`, `LabV2`, `BlackbookV2`; the `Monitor`/`Play` switch at `App.tsx:1328`; every surface
file and its size.

**Not traced line-by-line:** the exact render path from `LabGround`/`LabConsole` down through the six
Lab stations, and from `Monitor` down to `MonitorConsole`. The canonical designations above follow
from the flag defaults and the entry components, which is sufficient to start the token layer — but
the Lab port (Phase B step 6) must re-trace that path before it moves anything.
