# Wayfinding Pass — back button · inline dependencies · named-place links

*2026-06-06, Cowork, from the FIRST live beta feedback (owner-witnessed). Verbatim asks: a
"24/7 back button to simply undo each step forward in order but reverse"; toggles/tweaks need
"attached buttons that send them directly to wherever need be" instead of manual Learn-tab
searching; and the witnessed case — Benchmark requires FPS monitoring that lives on another
page, forcing a leave-find-enable-return loop. Owner's design philosophy, kept verbatim as the
law of this pass:*

> *"Nothing is too obvious — but we also would never put traffic signs naming our hallway after
> some interstate and the street name 'bathroom ave' 1 mile before the right turn either. Don't
> build off a condescending manner but rather perfect the pathing to allow any conscious
> creature to deduce the path to their inherent destination."*

---

## 1. Back button (navigation history)

- App-level history stack: every LOCATION change (active room/tab change — rail click or
  cross-room jump) pushes the previous location; in-place expansions do NOT push (they're not
  location changes under the nav law).
- **Back control:** header, far left, quiet chevron-ghost — visible 24/7, disabled (not
  hidden) when the stack is empty. Pops one location per press, exact reverse order.
- **Keyboard/mouse:** Alt+Left = back (Windows convention). Mouse XButton1 (the side "back"
  button every gaming mouse has) = back, if the webview surfaces it — verify in dev; ship if
  it works, note if not. NO Backspace binding (conflicts with text inputs).
- Forward is NOT in scope (record as a trivial follow-up once the stack exists). Stack cap ~50.
- Frontend-only, zero IPC.

## 2. Inline dependency resolution — "bring the switch to the need"

**RULE: if a feature on surface X requires a state that lives on surface Y, X must offer the
action inline** — same existing command, same consent/elevation flow, zero new IPC. Where
inline genuinely can't work, a direct jump button + Back covers the trip.

- **The witnessed case (fix first):** Benchmark (in Lab) requires FPS monitoring. When
  monitoring is off, Benchmark shows: "Benchmark needs FPS monitoring — it's off." +
  **[Start monitoring]** button right there (same `start_fps_capture` command + UAC flow as
  Play). No trip to Play required.
- **Sweep mandate:** enumerate every other "go elsewhere first" dependency (overlay controls
  vs capture state; comparison arming vs baseline session; any readiness/advisory action that
  names a prerequisite) and inline each one the same way. Report the sweep list in the
  completion report.

## 3. Named-place links — "if it names a place, it takes you there"

- **RULE: any user-facing copy that names another room or feature must BE a navigation
  affordance** (quiet inline chip/link), never a bare noun the user must go find. Grep-sweep
  all user-facing strings for room/feature names; link or reword every hit.
- **Tweak/term cross-links:** every rec card, toggle, and graded row gets a quiet "What's
  this?" affordance opening the EXACT Learn entry resolved by id (the Library quick-look
  overlay — its sanctioned surviving role), with "Open in Learn" inside for the full room
  (deliberate travel; Back returns). Manual search-by-typing as the only path = the bug.

## 4. Tone guardrails (the bathroom law, applied)

- Signpost at the moment of need, not in advance: dependency notices appear only when the
  dependency is unmet; cross-links are quiet chips, not banners.
- Never condescend: no tutorial popups, no "did you know!", no persistent coach marks. The
  affordance IS the guidance.
- Empty states always say the next action plainly ("Play a session and it lands here").

## 5. Acceptance

- [ ] Back: header control 24/7 (disabled on empty), Alt+Left works, XButton1 verified
      (shipped or noted), exact reverse-order pops, expansions don't pollute the stack.
- [ ] Benchmark starts monitoring inline (same command + UAC flow); sweep list of all other
      inlined dependencies reported.
- [ ] Zero bare place-names in user-facing copy (grep-verified); "What's this?" opens the
      exact entry by id — no manual searching required anywhere.
- [ ] Zero new IPC; copy locks untouched; guards green; classic surfaces unaffected.
- [ ] Owner (or the same tester) re-runs the witnessed Benchmark flow and it's one click.
