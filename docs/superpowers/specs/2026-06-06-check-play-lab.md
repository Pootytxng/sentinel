> **PARTIALLY SUPERSEDED (2026-06-06, owner course-correction):** the radar references below are
> **RETIRED** (light sweep per `2026-06-06-halfway-home.md` §2), and Play/Lab's route-to-classic-tab
> behavior is replaced by in-place expansion per the same spec's §1 navigation law. Everything else
> stands.

# Check · Play · Lab — the consolidation surfaces (final reskin stretch)

*2026-06-06, Cowork. Builds the three blessed six-home consolidations (governance entry
2026-06-06). These are RE-HOMINGS of existing functionality, not new features: every control and
data source already exists. Mocks: Check ≈ the approved radar first-check; Play + Lab per the
two-room board presented 2026-06-06. Kernel rules apply throughout.*

---

## Shared rules (all three)

- Flags: `compy_check_v2` / `compy_play_v2` / `compy_lab_v2` (default ON in dev). The classic tabs
  each absorbs (Readiness, Priorities, Sessions, Monitoring, Benchmark, Latency) remain reachable
  when flags are off — **parity governance applies**: classics can't retire until parity or a
  recorded re-home.
- Existing commands ONLY — zero new IPC, zero new polling. Consolidation is presentation.
- Tokens-only; reduced-motion; small revertable commits; build sequentially (Check → Play → Lab),
  one flag per commit-train so each is independently revertable.
- Plain-English one-liners on every instrument (Lab is visible to everyone — Caleb must never
  bounce off jargon; the one-liner is the bridge).

## CHECK — scan → ranked findings (absorbs Readiness + Priorities)

- **Top: the scan.** Reuse/share the FirstCheck radar + streaming-rows components (one source of
  truth — extract shared pieces rather than duplicating). "Re-run check" runs it on demand; real
  elapsed time; blips = real findings.
- **Below: the ranked result.** Priorities' buckets as the permanent content: biggest limiters
  (rank-ordered rows; trust-switch where appliable, advisory affordance otherwise) → "already
  fine" collapsed green strip → "not worth touching" links into Fix's refuse-pile / Library
  entries. Drift-watch cards surface here when a regression-outside-Compy is detected.
- Ambiance: radar during an active scan; Calm otherwise. Zero-case is the win state, styled as one.

## PLAY — live + debrief (absorbs Sessions + Monitoring + overlay control)

- **Live monitor card:** existing capture toggle + live FPS/GPU/temp values when capturing +
  the honesty line ("ETW · external · anti-cheat safe"). UAC/elevation flow unchanged.
- **Overlay card:** show/hide, density (Min/Standard/Full), corner — the same settings as
  Settings→Behavior (shared state, one source; this is a convenience surface, not a fork).
- **Sessions list:** condensed debrief rows (game · duration · short verdict · mono avg + 1% low),
  unviewed-dot via the existing badge state, "comparison armed" chip where applicable; click opens
  the full existing debrief. Comparison results surface here as today.
- Calm ambiance. Honest empty state when no sessions ("Play a session to see this…" — existing copy).

## LAB — the instruments (absorbs Benchmark + Latency; visible to everyone)

- Header one-liner: "The measured instruments — prove it, don't vibe it."
- **Two instrument cards** (Benchmark / Latency), each: icon + name + plain-English one-liner +
  a recent-results mini-list (real data: last benchmark verdicts; latency signal statuses) + the
  primary action ("Run a baseline" / "Measure input path") routing into the EXISTING full
  benchmark/latency UIs. **v1 scope: Lab is the launcher + recent-results room — the deep
  benchmark/latency internals keep their existing UIs (reachable from the cards) and get re-dressed
  incrementally later, NOT rebuilt this pass.**
- Dot-grid calm ambiance (instrument-room quiet).

## Acceptance (per surface; report each separately)

- [ ] Renders behind its flag; absorbed classic tabs reachable when off; nav rail routes correctly.
- [ ] All data/controls are the existing ones (diff-verifiable: no new commands/polling).
- [ ] Check: scan components shared with FirstCheck (no duplication); blips/rows real; buckets
      render with working trust-switches; drift cards appear when present.
- [ ] Play: capture + overlay controls share state with their existing sources; sessions list
      opens real debriefs; armed/unviewed states correct.
- [ ] Lab: cards route into existing benchmark/latency UIs; recent results are real; one-liners
      per the spec copy.
- [ ] Tokens-only · reduced-motion · `npm run tauri dev` live for owner sign-off per surface.
