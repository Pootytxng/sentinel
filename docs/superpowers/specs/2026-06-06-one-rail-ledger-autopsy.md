# One Rail · Ledger Redesign · Autopsy Continuity — owner installed-build sweep #2

*2026-06-06, Cowork, from the owner's packaged-build screenshots. Three asks: a visual critique
pass ("what changes need to be made"), Guide-Autopsy back-navigation ("don't make them re-paste
the video"), and "we gotta rework this trust ledger." Root finding verified in code: the blessed
six-home rail exists only INSIDE CommandCenter; the app shell still renders the legacy rail
(Dashboard/Check/Optimize/Play/Lab/Diagnostics/Ledger via SECTION_META). Two maps, one app —
this spec kills the second map.*

---

## 1. ONE RAIL — the shell adopts the six-home IA (the structural fix)

The app shell's rail becomes **Home · Check · Play · Fix · Learn · Lab** + Settings gear (bottom)
+ Export as a header action — identical to the CommandCenter rail, which stops being a private
Home-only rail and becomes THE rail. Consequences:

- **Labels:** "Dashboard" dies (it's Home). "Optimize" dies as a rail name (it's Fix — classic
  Optimize remains the flag-off fallback only). "Ledger" leaves the rail (lives in Fix, as
  already law). **Learn must be reachable from everywhere** (it's currently absent from the
  legacy rail — a Sarah dead-end).
- **Diagnostics** re-homes into **Lab** as a third inline instrument section (Benchmark ·
  Latency · Diagnostics — it's read-only forensics; the instruments room is its home). Rail
  entry dies.
- **Gaming** (gated, default-hidden) keeps its current conditional slot; unchanged.
- **"Classic home" pill retires** from CommandCenter — classic surfaces remain reachable ONLY
  via Settings → New look toggles (one escape hatch, not a parallel front door).
- The duplicated hero dissolves: the SYSTEM STATUS posture hero belongs to **Home only**;
  Check keeps its own scan header (no second "You're ready to play" banner inside Check).
- **Run affordances deduplicate:** ONE "Re-run check" (in Check + the Home hero CTA where
  already present). The header "Refresh" button and any third variant die.
- Header cleanup: the "Rules: Built-in" chip moves to Settings → About (engineering status,
  not user value). "HARDWARE-AWARE PC OPTIMIZATION · V0.1.0" tagline: version already lives in
  the footer — drop the V0.1.0 from the header tagline (one version source).

## 2. Trust Ledger — from flat receipts to "state first, receipts second"

Owner: "this isn't very intuitive." Verified problems from the screenshot: same tweak applied/
rolled-back 5× shows as 5 equal rows; raw timestamps ("6/3/2026, 6:08:01 AM"); a wall of
identical accent Roll-back buttons (banner blindness); no answer to the only question Sarah has:
**"what is Compy currently doing to my machine?"**

Redesign (inside Fix, where the ledger now lives):

- **Layer 1 — "Active on this PC" (default view):** one card per CURRENTLY-ACTIVE change,
  deduped to latest state per rec id. Each: plain-English name · "since June 3" (humanized) ·
  one-line what-it-does · a quiet ghost "Roll back" (outline; ink-on-accent only on
  hover/confirm). Group by domain if >6 (Power / Windows / Services). The count here must
  match the hero's "N safe changes active."
- **Layer 2 — "Full history" (collapsed below):** the complete chronological audit trail,
  including rolled-back + superseded entries, muted styling, ✓ ROLLED BACK rows stay. Row
  expand keeps the existing typed receipt detail (what/before/after/version/snapshot). Keep
  the "audit trail — click any row to expand" affordance HERE.
- **Churn folding:** repeated apply→rollback→apply cycles of the same rec collapse in history
  to the latest entry + "× N earlier cycles" expander.
- **Timestamps humanized everywhere:** "3 days ago · 6:08 AM", never seconds.
- **Ink verify:** screenshot suggests classic-surface Roll-back pills may still carry white
  labels — sweep classic Ledger/Optimize buttons against the ink law (guard only checks
  tokens; hardcoded button styles in classic CSS could have slipped).
- Rollback BEHAVIOR untouched: resolves from history.json alone, exact stored-plan fidelity —
  this is presentation only. Zero new IPC.

## 3. Guide Autopsy — continuity law (Learn)

Owner: after pasting a guide/video and getting the graded breakdown, clicking an item must not
lose the autopsy. Extend navigation-never-teleports into Learn's autopsy flow:

- **Clicking a graded item expands it IN PLACE** (accordion under the row — definition,
  verdict, why) instead of redirecting to the Library entry. A quiet "open full entry in
  Library" link inside the expansion is allowed (deliberate travel).
- **Autopsy state persists for the session:** the pasted text + parsed results survive tab
  switches and Library detours — returning to Learn shows the autopsy exactly as left, never
  an empty paste box. (Component state lift or session storage; localStorage fine; no backend.)
- A sticky mini-header over the results: "Autopsy: <first 40 chars>… · N claims graded ·
  Clear" — so the user always knows the read-through they're in and ends it deliberately.

## 4. Small fixes (owner screenshots, same pass)

- **Posture ring text clipping:** "all 8 checks ideal" overflows/clips inside the ring —
  subline must fit the inner diameter or move below the ring. Never clipped text.
- **Game names prettified:** "Diablo IV.exe" → "Diablo IV" everywhere user-facing (strip
  extension, title-case where safe; keep raw exe in expanded detail/exports).
- **Theme/ambiance/Classic pills leave Home:** appearance controls live in Settings →
  Appearance (already built); Home keeps at most a small gear shortcut. (Footer cleanup
  precedent: controls don't squat on the canvas.)
- **Reassurance dedupe on Home:** "Nothing changes without your say-so" appears twice (hero
  subline + limiter card echo) — keep it in ONE place (hero).
- Home's lower half is sparse — after the pills leave, pull the cards up; optionally add a
  fourth glanceable (last check time / drift status) ONLY if it carries real data. No filler.

## 5. Sequencing + acceptance

§1 one-rail first (structural; everything else lands inside it) → §2 ledger → §3 autopsy →
§4 smalls. One commit-train each, revertable; zero new IPC; copy locks untouched; contrast +
sweep guards green; classic surfaces stay reachable via Settings flags.

- [ ] ONE rail everywhere: leaving Home never changes the map; Learn reachable from every
      surface; Ledger/Diagnostics rail entries gone (re-homed Fix/Lab); Classic pill gone.
- [ ] Ledger default view = deduped active-state cards matching the hero count; full history
      collapsed below; ghost rollback buttons; humanized times; rollback behavior byte-identical.
- [ ] Autopsy: expand-in-place, state survives tab switches, sticky context header, re-paste
      never required.
- [ ] Ring never clips; no ".exe" in user-facing names; Home carries no appearance controls.
- [ ] Owner re-smoke on a fresh installer build after the train lands.
