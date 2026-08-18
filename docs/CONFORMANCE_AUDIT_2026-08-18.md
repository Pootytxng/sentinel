# Product-conformance audit — every recorded owner decision vs. the live code on `main`

**Date:** 2026-08-18 · **Type:** read-only audit. No source file was changed, nothing was checked
out, no branch was merged. The only file this train writes is this one.

## Method and baseline

- **Baseline read:** `main` @ `e6feb861` (*"docs(state): the owner's desk is on 555e2996, not the
  stamp the doc named"*). Every citation below is a `git show main:<path>` / `git grep … main` read
  of main's **committed blob**, not the working tree.
- **Why that matters here:** the checkout was sitting on `fix/owner-decision-conformance-guards`
  (= `main` + one unmerged commit `8db70795`), with uncommitted edits to `docs/UI_VISION_BACKLOG.md`
  and `docs/BACKLOG.md`. Reading the working tree would have shown fixes that are **not on main**.
  See "The unmerged fix branch" at the end.
- **Decision corpus:** `docs/UI_VISION_BACKLOG.md` (923 lines on main) plus all eight files in
  `docs/decisions/`: `2026-07-18-capture-backend`, `2026-07-18-experiment-comparability`,
  `2026-07-18-prove-a-change-overlap`, `2026-08-09-capability-exception-gate`,
  `2026-08-11-design-foundation`, `2026-08-11-design-navigation-audit`,
  `2026-08-18-canonical-data-root`, `2026-08-18-outbound-capability-expansion`.
- **Verdict vocabulary** (one per decision, no hedging):
  - **HONORED** — the code does what the decision says.
  - **SILENTLY REVERSED** — the decision was built, then a later change undid it in effect without
    the decision being revisited, retracted, or logged as a substitution.
  - **NEVER BUILT** — recorded as decided; no implementing code exists.
  - **PARTIAL** — one clause of a multi-clause decision is live, another is not.
  - **NOT VERIFIABLE STATICALLY** — needs a live render to judge; stated rather than guessed.

## Summary

| # | Decision | Source | Verdict |
|---|---|---|---|
| C-01 | `compy_home_intake` stays the owner's off-switch for the intake band | gate 2026-08-09 §Queue 4; owner 2026-08-12 `4d1afa92` | **SILENTLY REVERSED** |
| C-02 | Room renames Blackbook→History, Lab→Test, Monitor→Live | foundation ⑤; owner sign-off 2026-08-12 | **PARTIAL** (frontend done, Rust copy not; one test pins the old name) |
| C-03 | Drop the topbar taglines | foundation/UX-1 decision ②; audit §3 | **NEVER BUILT** |
| C-04 | Rename the Home room to something that answers a question (Health / Diagnosis) | UX-1 decision ①, third clause; audit §3 | **NEVER BUILT** |
| C-05 | First run lands on the diagnosis; the tour becomes a card | UX-1 decision ③; audit §4 | **NEVER BUILT** |
| C-06 | Wording pass + banned-term build guard (step ④) | foundation ⑤ + build order ④ | **NEVER BUILT** |
| C-07 | Instruments move behind a door (step ⑤) | foundation ⑥ + build order ⑤ | **NEVER BUILT** |
| C-08 | Keep the honesty, change the voice (engineer-speak in consumer surfaces) | audit §3 | **NEVER BUILT** |
| C-09 | Build identifiers move out of consumer chrome into Settings/About | audit §4 | **NEVER BUILT** |
| C-10 | No raw OS `<select>` inside the custom UI | audit §4 | **NEVER BUILT** |
| C-11 | Group repeated ledger events ("applied 3×, currently on") | audit §4 | **NEVER BUILT** |
| C-12 | `CommandPalette` was parked, then dropped | UI backlog §D | **DOC DRIFT** — it is built and DEFAULT ON |
| C-13 | Foundation tooling: Figma MCP (rank 2), axe-core in vitest (rank 3), shadcn MCP (rank 4) | foundation §Tooling | **PARTIAL** (only shadcn) |
| C-14 | `GpuProfile.tsx` — wire it in as advisory, or archive it (owner fork) | UI backlog NAV-1 (c) | **NEVER RESOLVED** (still parked by exemption) |
| C-15 | §E trending design tooling (Figma / v0) — owner's call | UI backlog §E | **STILL OPEN** (unchanged, correctly) |
| C-16 | §G site: mini playable demo · `/pricing` · `llms.txt` · `/compare` | UI backlog §G / G.2 | **PARTIAL** |
| C-17 | TYPE-1 residual: mechanize the mono-for-machine-values-only law | UI backlog TYPE-1 | **NEVER BUILT** (self-declared) |
| C-18 | TYPE-1 — six-step scale, 13px floor, Arial killed, guarded | foundation ③ | **HONORED** |
| C-19 | COLOR-1 — rooms give up their hue; picker survives | foundation ④ | **HONORED** |
| C-20 | UX-1 decision ① — the verdict is the H1 | foundation ①; UX-1 ① | **HONORED** |
| C-21 | Care entry always visible, independent of the intake band | gate 2026-08-09 §Queue 4; issue #91 | **HONORED** |
| C-22 | Canonical data root — one resolver, `MutationRoot`, no `C:\Temp` fallback | canonical-data-root 2026-08-18 | **HONORED** |
| C-23 | Rail accessible names carry no shortcut digit | audit §1 | **HONORED** |
| C-24 | Capture backend / two comparability gates / two "prove a change" surfaces | 2026-07-18 ×3 | **HONORED** (spot-checked) |
| C-25 | Tier 2 analytics: arm, default-ON, disclosed | outbound 2026-08-18 §2 | **NOT YET BUILT — no drift** (decided today) |
| C-26 | Amend the Tier-2 default-OFF assertion in the policy guard | outbound 2026-08-18 §"What this changes" | **HONORED** |

---

## The three reversals and near-reversals, in detail

### C-01 — the owner's off-switch no longer switches anything off · **SILENTLY REVERSED**

**The decision.** The capability-exception gate (2026-08-09, §Queue placement item 4) says: *"Add an
always-visible Home Care entry and Crash & Freeze Rescue deep-link … **keep the broad
`compy_home_intake` band default-OFF**."* On 2026-08-12 the owner switched it off **on sight** —
commit `4d1afa92` *"feat(home): the intake band goes back to DEFAULT OFF - owner, on sight"*.

**What main does now.** The flag's reader is still honestly default-OFF:

- `src/design/theme.ts:416–425` — `readHomeIntake()` returns `localStorage.getItem(…) === "1"`,
  falling through to `false`. Nothing about the flag itself drifted.

But UX-1 (`f1766e86`, *"feat(home): UX-1 - the front door is a verdict + one action"*, on `main`)
severed the flag from the thing it gated:

- `src/surfaces/HomeConsole.tsx:557` — *"UX-1: no longer gated on `intakeOn` — the panel's
  visibility is now the front door's business."*
- `src/surfaces/HomeConsole.tsx:580` — `const intakeAvailable = fastPathAvailable ||
  intakeRows.length > 0;` — the existence of the front-door button now depends only on wiring.
- `src/surfaces/HomeConsole.tsx:297` — `const [frontDoorOpen, setFrontDoorOpen] =
  useState(intakeOn);` — the flag survives as the *initial open/closed state of a panel*, nothing
  more.

**Why this is a reversal and not a redesign.** The owner's action was "take this off my Home
screen." After `f1766e86`, setting `compy_home_intake="0"` removes nothing from Home: the intake is
still reachable as the screen's **single filled primary button**, it merely starts collapsed. The
switch was demoted from *presence* to *default open state* without the 2026-08-09 decision being
amended, without the 2026-08-12 owner action being revisited, and without a substitution note in
`UI_VISION_BACKLOG.md` — which that file's own closing rule requires ("if you ship a simpler thing
than the owner asked, it is NOT done — log it here as a substitution needing his sign-off").

**Aggravating detail.** `src/surfaces/home-intake.test.tsx:234` still describes the contract as
*"flag gating (compy_home_intake back to DEFAULT OFF 2026-08-12)"*, so the suite reads green while
asserting a contract the surface no longer implements in the sense the owner meant.

**Not in question:** the Care entry extraction is correct and works — `home-intake-data.ts:63`,
`care-home-route-guard.test.ts`, and `home-intake.test.tsx:289–304` prove crash rescue survives every
flag state. That half is C-21, HONORED.

### C-02 — the room renames stopped at the language boundary · **PARTIAL**

**The decision.** `2026-08-11-design-foundation.md` §5 held the room renames as *"the **only** item
held for owner sign-off."* He signed off 2026-08-12: Blackbook → **History**, Lab → **Test**,
Monitor → **Live** (`UI_VISION_BACKLOG.md` FOUNDATION-1).

**Honored on the frontend.** `src/design/homeRail.ts` carries all three, each with the rename dated
in a comment: `{ id: "play", label: "Live" }`, `{ id: "learn", label: "History" }`,
`{ id: "lab", label: "Test" }` — ids deliberately unchanged (persisted nav keys). The English
locale is clean: `git grep "Blackbook" main -- src/i18n/locales/en` returns **nothing**, and the
tour's room ties were updated too (`setup-steps.ts` PSU step: *"…benchmarks in the **Test** tab."*).

**Not honored in Rust.** Eight user-facing strings compiled into the backend still name the retired
rooms, and they surface in exactly the moments the rename existed to serve — a user reading a
verdict, a hypothesis, or a next-test line:

| File:line | Retired name in shipped copy |
|---|---|
| `src-tauri/src/readiness.rs:837` | *"…turn it back on or roll it back in **the Lab** — either one clears this."* |
| `src-tauri/src/readiness.rs:847` | *"…turn them back on or roll them back in **the Lab** …"* |
| `src-tauri/src/experiment.rs:527` | *"…the result in **the Lab**."* |
| `src-tauri/src/intelligence_patterns.rs:246` | *"Open **Blackbook**, pick the last good {game} session…"* |
| `src-tauri/src/intelligence_patterns.rs:286` | *"…watch the next session's peak temperature in **Monitor**."* |
| `src-tauri/src/intelligence_patterns.rs:329` | *"…watch the next session's peak CPU temperature in **Monitor**."* |
| `src-tauri/src/intelligence_patterns.rs:447` | *"Pick one session from each driver in **Blackbook**…"* |
| `src-tauri/src/intelligence_patterns.rs:552` | *"Watch one long session in **Monitor** …"* |

**The part that makes this structural rather than a missed grep.** A test actively pins the stale
name:

- `src-tauri/src/readiness.rs:1288` — `assert!(c.detail.contains("the Lab"), "points at the real
  undo home (the Lab): {}", c.detail);`

and the assertion directly above it, `readiness.rs:1287`, forbids a *different* retired label
(`assert!(!c.detail.contains("Tune"), "no stale room name")`). So the same test both enforces the
room-labels-vs-nav-ids law and violates it. Correcting the copy currently fails the suite — which is
why this drifted quietly: the guard that should have caught it is the thing holding it in place.

**Also note:** `src-tauri/src/readiness.rs:823` and `:1283–1285` are comments explaining *why* the
backend says "the Lab" (it can't read the runtime rail flag). That reasoning was sound before
2026-08-12 and is stale after it — the rename is unconditional, not rail-flag-dependent.

### C-03 — the topbar taglines are still shipped · **NEVER BUILT**

**The decision.** `2026-08-11-design-navigation-audit.md` §3 and UX-1 decision ②: *"drop the topbar
tagline; keep one name per room"* — naming the exact strings, and calling it a violation of the
project's own title-header law.

**What main has.** Every named string is still declared and still rendered:

- `src/design/ShellV2.tsx:44` — `export const ROOM_CRUMB: Record<HomeRailId, string> = {`
- `src/design/ShellV2.tsx:45–50` — `home: "how your PC is doing"` · `check: "is anything holding you
  back?"` · `fix: "find it, fix it, undo it"` · `play: "watch it live"` · `learn: "what actually
  works — measured"` · `lab: "benchmarks, latency, diagnostics"` — i.e. verbatim the
  `Blackbook · what actually works — measured` / `Monitor · watch it live` /
  `Lab · benchmarks, latency, diagnostics` taglines the decision named.
- `src/design/ShellV2.tsx:269` — `<span className="v2-crumb">· {t(\`common.shellV2.crumb.${active.id}\`)}</span>`
  renders one on every room, on every screen.
- `src/design/ShellV2.test.tsx:83` asserts every rail room **has** a crumb, and `:183` asserts one is
  on screen (`expect(screen.getByText(\`· ${ROOM_CRUMB.play}\`)).toBeTruthy()`).

So this is not an oversight waiting for a sweep — two tests would fail if the decision were carried
out. Same shape as C-02: the guard outranks the decision.

---

## The design-foundation build order — where it actually stands

The foundation decision's build order is ① type + colour · ② front door · ③ interview · ④ wording
pass + banned-term guard · ⑤ instruments behind a door. `UI_VISION_BACKLOG.md` claims ① done and
②–⑤ open. Against main that reads:

- **① TYPE-1 + COLOR-1 — HONORED (C-18, C-19).** `src/design/type-scale-guard.test.ts` exists and is
  the mechanization the decision asked for. `src/surfaces/room-identity.css` on main contains a
  header comment and **zero rules** — the specified *deletion*, not a repaint — with
  `src/surfaces/room-identity.test.ts` pinning that the presets stay dead, and the user's per-room
  accent picker preserved through `theme.ts` (`applyRoomAccents`), per the owner freedom directive.
- **② UX-1 — PARTIAL.** Decision ① of the foundation (verdict = H1, one action) is live:
  `HomeConsole.tsx` renders `posture.headline` as the h1 at `--type-verdict`, with
  `src/surfaces/home-verdict-scale-guard.test.ts` guarding the cascade defect that shipped first.
  **C-20 HONORED.** But two clauses of UX-1 did not ship: the topbar taglines (**C-03**) and the
  room rename Home → Health/Diagnosis (**C-04** — `homeRail.ts` still reads `{ id: "home", label:
  "Home" }`), and UX-1 ③ first-run (**C-05**) did not ship either.
- **③ interview — NEVER BUILT**, and honestly recorded as open. `HomeConsole.tsx`'s own comment says
  the front-door button "opens IN PLACE … there is nowhere to navigate to until step ③ builds the
  interview." No finding; the doc and the code agree.
- **④ wording pass + banned-term guard — NEVER BUILT (C-06).** See below.
- **⑤ instruments behind a door — NEVER BUILT (C-07).** `railFor()` in `src/design/homeRail.ts`
  returns Home · Live · History · Test: Live (Monitor) and Test (Lab) are still first-class rail
  rooms, i.e. still among the first things anyone sees, which is the exact arrangement decision ⑥
  ("they stop being the first thing anyone sees") exists to end.

### C-05 — first run still opens the ten-step tour · **NEVER BUILT**

`2026-08-11-design-navigation-audit.md` §4: *"the tour stops being the front door. Land on the
diagnosis; offer the tour as a card the user can choose."*

`src/App.tsx:590–594`:

```
// Auto-open the tour ONLY on a truly fresh install (never toured AND never onboarded) — never
// re-nag a returning user; they reach it from the Home launcher card or Settings.
const [showSetupTour, setShowSetupTour] = useState(
  () => lsGet(SETUP_TOUR_KEY) !== "1" && lsGet(ONBOARDED_KEY) !== "1",
);
```

A fresh install still opens the Setup & Tour modal before the diagnosis is reachable. The
"launcher card" the decision asked for already exists (`SetupLauncherCard.tsx`) — what did not
happen is removing the auto-open, which is the whole decision.

*(The flow's two names — `GUIDED SETUP` on step 1 vs `HARDWARE TOUR` on step 5 — persist as
`src/i18n/locales/en/home.json:330–331`: `"setup": "Guided setup"`, `"tour": "Hardware tour"`.
The separate finding that the PSU step labels a section `DRIVES` **is fixed** — the eyebrow at
`setup-steps.ts:119` now reads `POWER DELIVERY` and the storage step reads `STORAGE`.)*

### C-06 — the wording pass and its guard · **NEVER BUILT**

The decision (foundation §5) names six substitutions. On main, every retired term is still shipped
in the English locale:

| Decided replacement | Still live on `main` |
|---|---|
| Trust Ledger → *What Compy changed* | `en/home.json:156`, `:223` (`"trustLedgerLabel": "Trust ledger"`), `:291`, `:297`, `:358`; `en/app.json:42`; `en/common.json:105`; `en/settings.json:103` |
| Rollback → *Undo* | "roll back"/"rollback" in `en/app.json` (6), `en/optimize.json` (6), `en/blackbook.json` (2), `en/home.json` (1), `en/settings.json` (1) |
| Drift → *Something changed since* | `en/home.json` (13), `en/optimize.json` (11), `en/lab.json` (3), `en/gaming.json` (1) |
| Frametime → *How smooth it felt* | `en/monitor.json` (5), `en/app.json` (2), `en/settings.json` (2), `en/gaming.json` (2), `en/common.json` (1) |
| Guided setup → *deleted* | `en/home.json:330` `"Guided setup"`; `en/settings.json:63` `"Re-run the guided setup"` |

*(Parenthesised numbers are matching **lines** from `git grep -c … main -- src/i18n/locales/en`, so
they include key names as well as values; the exact quoted strings above were read individually.)*

**The guard does not exist.** `git grep -i "banned-term" main` returns only two hits, both in prose
(`docs/UI_VISION_BACKLOG.md:25`, `docs/decisions/2026-08-11-design-foundation.md:71`). There is no
banned-term test anywhere in `src/`.

---

## The navigation-audit's other decided-not-built items

Each of these is written in `2026-08-11-design-navigation-audit.md` with an explicit *Decision:*,
and each is logged as still-open in `UI_VISION_BACKLOG.md` only implicitly (via "Copy pass: the
jargon list in §3"). None has code on main.

### C-08 — "keep the honesty, change the voice" · **NEVER BUILT**

The audit named two strings by hand. Both are unchanged:

- `src/i18n/locales/en/monitor.json:73`, `:117`, `:263` —
  `" · external · anti-cheat safe — no injection, no kernel driver."`, verbatim.
  **Pinned:** `src/surfaces/Monitor.test.tsx:96` asserts this exact sentence renders.
- `src/i18n/locales/en/home.json:62`, `:121` — `"no temp — this build ships no kernel driver"`.
  **Pinned:** `src/surfaces/home-hud-flag.test.tsx:255`.

Note the *partial* movement here, which is a different decision doing the work: the 2026-08-18
outbound record and `src/capability-exception-policy-guard.test.ts:324–394` retired the **absolute**
("Compy will never ship a kernel driver") in favour of the time-scoped fact ("this build ships no
kernel driver"). That is an honesty fix, correctly landed. The audit's separate ask — say it in the
user's vocabulary, e.g. *"CPU temperature needs a driver we won't install"* — did not happen.

Related and **HONORED**: the 2026-08-18 §4 direction ("make the existing path feel native") shipped —
`en/monitor.json:193–194` carry the driver-free sensor-source copy, and `RELEASE_STATE.md:65` records
the Q9c CPU-temp offer in the 0.9.25 desk build.

### C-09 — build identifiers stay in consumer chrome · **NEVER BUILT**

*Decision: move it into Settings / the About panel.* Both are still in the topbar:
`src/design/ShellV2.tsx:202` (`<span className="v2-version">{version}</span>`) and
`src/design/ShellV2.tsx:293` (`{stamp && <span className="v2-stamp">{stamp}</span>}`, fed by the
`get_build_stamp` probe at `:131`).

### C-10 — the raw OS `<select>` · **NEVER BUILT**

`src/surfaces/WhatChangedPanel.tsx:654`, `:665`, `:675` are three bare `<select>` elements, and the
placeholder the audit quoted is still the shipped string: `src/i18n/locales/en/lab.json:357` —
`"chooseChange": "Choose a change…"`.

### C-11 — group repeated ledger events · **NEVER BUILT**

*Decision: group repeats — "applied 3×, currently on".* No grouping exists: no `applied N×`,
`currently on`, or repeat-count construct appears anywhere under `src/surfaces/blackbook/` or in
`en/blackbook.json`. Rows are still emitted one-per-event by `BlackbookConsole.tsx`.

### C-23 — rail accessible names · **HONORED**

*"The `<kbd>` is now `aria-hidden` and the shortcut declared via `aria-keyshortcuts`."* Confirmed:
`src/design/ShellV2.tsx:216–217`. The follow-on cosmetic decision in §4 ("strengthen the keycap
read, or show the digits only while a modifier is held") is **not verifiable statically** — see
below.

---

## Decisions outside the design lane

### C-22 — canonical data root (2026-08-18) · **HONORED**

The strongest conformance in the corpus; every contract clause has code behind it.

- One resolver, consumed by the old entry point: `src-tauri/src/lib.rs:436–448` —
  `compy_data_dir()` now calls `data_root::decision()`, gates `migrate_legacy_data_once` on
  `DataRootDecision::Canonical`, and returns `decision.effective_root()`. The blind
  `env::var("APPDATA")` join is gone.
- **The `C:\Temp` fallback is gone**, and its absence is guarded: the only occurrence of that string
  left in `src-tauri/` is the assertion forbidding it — `src-tauri/src/data_root.rs:917`,
  `assert!(!eff.contains(r"c:\temp"), "must never fall back to C:\\Temp: {eff}")`.
- Mutation capability as a type: `MutationRoot` appears 24× in `data_root.rs`, 9× in `history.rs`,
  2× in `actions.rs`, 1× in `lib.rs` — i.e. the apply/rollback callers take the token, as specified.
- Preflight parity: `scripts/lib/canonical-data-root.ps1` and the static guard
  `scripts/data-root-guard.test.mjs` both exist on main.

### C-25 / C-26 — the outbound expansion (2026-08-18) · **NO DRIFT**

- `receipts_gate()` at `src-tauri/src/receipts.rs:18` still returns `false`. That is **correct**:
  the decision itself says the gate "flips last", after the endpoint, the Rust send path and the
  CSP widening exist. Recorded here so a future audit does not misread a dark gate as a reversal.
- The amendment the decision ordered **did** land: `src/capability-exception-policy-guard.test.ts:56`
  now speaks of *"the retired 'opt-in, default-OFF'"* rather than asserting it. **C-26 HONORED.**

### C-24 — the three 2026-07-18 measurement decisions · **HONORED** (spot-checked)

`CaptureBackend`/`CaptureCapabilities` (`src-tauri/src/capture.rs`), the separate verdict-confidence
band and `game_match` treatment-side check (`experiment.rs`), the single `MIN_COMPARE_SAMPLES`
(`intelligence.rs`, imported by `intelligence_patterns.rs`), and the kept-separate
`WhatChangedPanel` / `ExperimentBench` surfaces are all present as recorded. No contradiction found.
These were verified by presence and structure, not by re-deriving their guards.

---

## Backlog items whose recorded status disagrees with the code

### C-12 — `CommandPalette` is recorded as dropped; it is built and default-ON · **DOC DRIFT**

`UI_VISION_BACKLOG.md` §D: *"CommandPalette / keyboard-first command flow — parked, then dropped …
explicitly parked as 'new feature, backlog candidate post-P6, owner call' — and then never mentioned
again anywhere."*

It exists and ships: `src/design/CommandPalette.tsx`, imported at `src/design/ShellV2.tsx:31`, behind
`compy_command_palette` — `src/design/command-palette-flag.test.tsx:1` states *"DEFAULT ON (the
feature exists to be found…)"* and `src/design/theme.ts:447` declares the key. The shell's own
comment at `src/design/ShellV2.tsx:9` still says *"CommandPalette was parked pending an owner
call"* — directly above the file that mounts it. This is the inverse of the usual failure: a
shipped feature recorded as dropped, twice. §D should be closed as SHIPPED, or the drift will make
the next reader re-propose a feature that already exists.

### C-13 — the foundation's tooling asks · **PARTIAL**

| Rank | Ask | Status on `main` |
|---|---|---|
| 2 (owner) | Figma account + its MCP server | **not wired** — `.mcp.json` declares only `shadcn` |
| 3 (mine) | `axe-core` in the vitest suite | **not present** — `git grep "axe-core" main` returns nothing |
| 4 (mine) | shadcn component MCP | **wired** — `.mcp.json` |

Rank 3 was self-assigned ("Mine"), so its absence is a dropped commitment, not an owner blocker.

### C-14 — the `GpuProfile.tsx` owner fork · **NEVER RESOLVED**

NAV-1 (c) left exactly one open owner fork: *"wire it in as advisory, or archive it."* Neither
happened. `src/reachability-guard.test.ts:42` carries it as a standing exemption —
`"surfaces/GpuProfile.tsx": "owner decision B_gpu — GPU profile surface parked, not retired"` —
with the component, its store, its hook and 3 test files (`GpuProfile.tsx`, `gpu-profile-store.ts`,
`use-gpu-profile-scope.ts`, + tests) alive and imported by nothing outside tests. The exemption is
honest, so this is a clean open decision rather than drift — but it has been open since 2026-08-04.

### C-15 — §E trending design tooling · **STILL OPEN, CORRECTLY**

*"Owner decision: want the real tooling used, or leave it a deliberate no?"* Unchanged. `.mcp.json`
shows the in-repo substitution (shadcn registry) is what shipped, exactly as the entry describes.

### C-16 — §G site work · **PARTIAL**

| §G ask | Status |
|---|---|
| `/compare` page | **SHIPPED** — `site-app/src/pages/compare.astro` |
| `llms.txt` (listed as an open P2 candidate) | **SHIPPED** — `site/llms.txt` (backlog not updated) |
| `/pricing` page | **not built** — no pricing page; pricing exists only as a landing section (`scripts/site-landing.test.mjs:52`, `:205`) |
| mini playable demo of one real Compy tool | **not built** — no such page or component |
| walkthrough / tour videos | correctly parked LATER by the owner |

### C-17 — TYPE-1's residual mono law · **NEVER BUILT**

`UI_VISION_BACKLOG.md` TYPE-1: *"Still open from this row: the mono-for-machine-values-only law is
still a comment with no guard."* Still true. The law appears only as prose —
`src/design/tokens-v2.css:9` and `:54`, `src/surfaces/home-v2.css:227`,
`src/design/vendor/THIRD_PARTY.md:101` — and no test under `src/design/` references
`--v2-font-mono` usage. The backlog states this accurately; recorded here only so the item is
counted, not as a discrepancy.

---

## Not verifiable from source — needs a live render

Stated rather than guessed, so the next reader does not mistake silence for a pass. Each of these is
a decision or finding in `2026-08-11-design-navigation-audit.md` §§1–4 whose truth depends on
computed style or screen composition, which `jsdom` cannot see (the same blind spot that let the
UX-1 verdict ship at the wrong size — `home-verdict-scale-guard.test.ts` exists because of it):

- **Zero-value stats dimmed.** *"stop dimming zero-value stats"* — `"autopsyTitle": "Guides
  fact-checked"` is still the label (`en/blackbook.json:72`), but no dim rule keyed on a zero value
  was found in `src/surfaces/blackbook/`. Neither confirmed nor refuted.
- **`MEASURED` stamped four times per screen.** `.v2-measured` on main is a single per-room
  provenance line (`src/design/room-shell.tsx:99`), which reads as already-consolidated — but the
  audit measured four *badges* on a live screen, so this needs a capture to close.
- **Corner-scatter wastes the middle** (Home and Lab gauges) — layout, not a string.
- **Visual weight inverted on the tour's controls** (`Back` filled, `Next` outline).
- **Rail shortcut digits styled as unread-count pills** — the a11y half is fixed (C-23); the visual
  decision is a CSS judgement.
- **Six stations at the smallest type on the screen**, `CRASH & FREEZE` dimmest of the six.

Recommended: one `docs/ui-sweep/cdp-eval.mjs` pass on the installed 0.9.25 desk build closes all six
at once, using the same method the original audit used.

---

## The unmerged fix branch

`fix/owner-decision-conformance-guards` @ `8db70795` — *"fix(home+copy): the owner's off-switch is
honored again, and nine dead room names die"* — is **one commit ahead of `main` and not merged**. Its
diffstat touches exactly the two reversals this audit found first:

```
src-tauri/src/experiment.rs            |  2 +-
src-tauri/src/intelligence_patterns.rs | 10 +--
src-tauri/src/readiness.rs             | 15 ++--
src/room-name-copy-guard.test.ts       | 142 +++++++++ (new)
src/surfaces/HomeConsole.tsx           | 11 ++-
src/surfaces/home-console.test.tsx     | 35 ++++--
src/surfaces/home-intake.test.tsx      | 50 ++++++
```

"Nine dead room names" matches this audit's independent count exactly: the eight shipped strings in
the C-02 table plus the `readiness.rs:1288` test pin. **Nothing in that branch is on `main`**, so
every finding above stands as the state of `main` at `e6feb861`. This audit did not review that
branch's correctness; it is noted only so its existence is not mistaken for the fix having landed —
and so C-03 (the topbar taglines, `ShellV2.tsx`) is visibly **not** covered by it.

## What this audit did not cover

- `docs/BACKLOG.md`, `docs/GATE_DECISIONS.md`, `docs/ARCHITECTURE_LOCKS.md` and the
  `docs/superpowers/specs|plans` tree. The brief scoped this to `UI_VISION_BACKLOG.md` +
  `docs/decisions/*`; several decisions above cross-reference those files, and a full sweep of them
  would likely surface more.
- The `zh-CN` locale. C-06's term inventory is English-only; the same retired terms are presumably
  mirrored there.
- Behaviour. Nothing was run — no build, no vitest, no cargo. Every claim is a source read of main's
  committed blobs, and the six items above are marked unverifiable for exactly that reason.

## Pattern worth naming

Three of the four hard findings (C-01, C-02, C-03) share one shape: **a test now holds the old
behaviour in place.** `home-intake.test.tsx:234` describes a gating contract the surface abandoned;
`readiness.rs:1288` asserts the retired room name; `ShellV2.test.tsx:83`/`:183` assert the taglines
exist. In each case the suite is green *because* the decision was not carried out, so the project's
own bug→guard discipline is currently pointed backwards on these three items. Any remediation train
has to change the guard and the code in the same commit — which is also why none of these will be
caught by "run the tests" and all of them need a decision-vs-code read like this one.

## Concurrency note (recorded so the read is reproducible)

The checkout was being edited by another session while this audit ran. At the start of the read
`git status` showed only `docs/BACKLOG.md` and `docs/UI_VISION_BACKLOG.md` modified; by the end,
those had been committed as `fabb82df` (*"docs: record the conformance-drift class where it will
actually be read"*, on top of `8db70795`) and `src/design/ShellV2.tsx`, `ShellV2.test.tsx`,
`shell-v2.css`, `src/surfaces/home-console.css` were freshly modified with a new untracked
`src/side-stripe-guard.test.ts`.

This audit changed **none** of those files — its only write is this document. Every finding above is
against `main` @ `e6feb861`, which is unaffected by branch or working-tree activity. If the
concurrent work lands the topbar-tagline removal, re-verify **C-03** before acting on it.
