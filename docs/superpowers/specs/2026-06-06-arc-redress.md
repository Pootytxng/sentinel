> **PARTIALLY SUPERSEDED (2026-06-06, owner course-correction):** the RADAR visualization
> prescribed below is **RETIRED** — replaced by the light sweep per `2026-06-06-halfway-home.md`
> §2. Copy locks and all non-radar content still stand.

# First-Experience Arc — Instrument re-dress spec (fourth live pass)

*2026-06-06, Cowork. Re-dresses the four arc surfaces (onboarding · first-check landing · session
debrief · comparison verdict cards) in the Instrument language. The arc's COPY and CHOREOGRAPHY are
double-locked by `2026-06-04-first-experience-arc-design.md` (owner-approved verbatim) — this pass
changes pixels, not words or mechanics. Kernel: `2026-06-05-compy-design-system.md`.*

---

## 0. Locks (stop-and-flag if a change would violate one)

- **Copy:** every user-facing string ships verbatim from the arc spec (incl. "No measurable
  change" subtitle's "session-to-session swing" hedge, "estimate" labels, hedged "prime suspect"
  language, the zero-case win states). The only NEW copy permitted is what the kernel already
  locked (e.g. the trust-switch snapshot line, "logged to Trust Ledger").
- **Choreography/mechanics:** real-elapsed scan speed (no artificial sleeps), verdict bands,
  max-one-insight, comparison arming/confound/expiry rules, never-credit-inside-noise — untouched.
  Behavior tests stay green unchanged; styling-only selector updates flagged in the report if any.
- **Honesty:** every visual element maps to real data (radar blips = actual findings; bars = actual
  numbers). No invented metrics, no decorative data.

## 1. Flag + reversibility

One flag for the whole pass: `compy_arc_v2` (default ON in dev) — the four classic arc surfaces
stay in the tree and render when the flag is off. Additive, small revertable commits, tokens-only,
pure frontend (Rust untouched).

## 2. Surface-by-surface re-dress

**M1 — Onboarding (3 steps):** obsidian glass card; pulse-C wordmark in the header; the detect
lines keep their stagger + real-snapshot-only rule, restyled as mono accent rows; the step-2 demo
card uses the shared TrustSwitch in demo mode (still mutates NOTHING); house-rules rows get the
glass treatment + Tabler line icons; final CTA unchanged ("Run my first check").

**M2 — First-check landing:** adopts the approved RADAR visualization — sweep + concentric rings,
findings appear as blips (accent = fine, amber = worth fixing) AS the real checks complete; the
streaming mono check rows remain beside it (radar augments, never replaces, the legible list).
Real elapsed time stays in the header. Verdict block re-dressed glass; #1 limiter spotlight uses
the shared TrustSwitch; green strip + zero-case win state restyled. The radar canvas is
data-bearing (scan-time only, seconds), reduced-motion → static end-state with blips placed.

**M3 — Session debrief:** glass card per the approved Instrument debrief mock — mono header
(GAME · duration · range), verdict sentence + feel-translation subtitle, four glass metric tiles
("1% low · est" label mandatory), the amber ONE-THING insight box, mono context strip, primary
CTA (apply #1 + arm). Share affordance unchanged.

**M4/4b — Comparison verdict cards:** null case = frost/neutral re-dress (never red), receipts
mini-bars + mono delta line + noise floor; win case = identical layout/evidence standard, and the
improved metric's after-bar carries **the single earned shimmer** (one sweep on reveal, periodic
slow repeat OK, reduced-motion → none) — this is the ONLY celebratory flourish in the entire app
(kernel law). Regressed = danger-tinted, calm. Tally footer style: mono, muted (content unchanged;
it remains owner-cuttable).

## 3. Ambiance

Arc surfaces are MOMENTS, not dashboards: no full hyperspeed behind them. Onboarding + verdicts
get the faint backdrop at Calm (or none); first-check's radar IS its visual; debrief faint-calm.
Step-aside + reduced-motion rules apply as everywhere.

## 4. Acceptance

- [ ] All four surfaces render behind `compy_arc_v2`; classics reachable by toggling off.
- [ ] Every locked string byte-identical to the arc spec (spot-check list in report: detect lines,
      house rules, verdict headlines, "estimate", "prime suspect", null subtitle, zero-cases).
- [ ] Scan still streams at real completion speed; radar blips correspond 1:1 to real findings.
- [ ] Win shimmer appears ONLY on the win card's improved bar; nothing else shimmers app-wide.
- [ ] Arc behavior tests pass unchanged (or styling-only selector diffs, flagged).
- [ ] Tokens-only; reduced-motion static end-states; `npm run tauri dev` live for owner sign-off.
