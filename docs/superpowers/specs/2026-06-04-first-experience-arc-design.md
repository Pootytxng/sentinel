# First-Experience Arc — Onboarding → First Check → Debrief → Verdict

*Design spec, 2026-06-04, from the outside-review (Cowork) session's interactive mocks.*
*Owner approval: Moments 1–3 approved VERBATIM ("i want all of it just as you have it shown here…
we need this exactly as you have it"). Moment 4 designed the same session.*

**Sequencing constraint:** build this AFTER the rename one-shot is committed (see
`docs/RENAME_COMPLETION_AUDIT.md`). It is its own feature pass — do not mix UI redesign into the
rename commit. Gates untouched: Gaming Mode stays dark, remote fetch off, updater off, catalog
frozen.

---

## Cross-cutting design laws (apply to every moment)

1. **Show, don't vow.** Each screen demonstrates a value instead of declaring it.
2. **No fake scan time.** Display work as fast as it really completes; stagger display ≤~350ms/row
   for legibility, never `sleep()` for drama. Show real elapsed time in the header.
3. **Absolution-first verdicts.** Lead with "you're fine / N things worth fixing," never alarm
   counts. The zero-case ("nothing worth fixing today") is a *win state*, styled as one.
4. **One insight per surface.** Ten insights is zero insights.
5. **Hedge language is mandatory.** "Prime suspect," "estimate," "expected impact — not yet
   measured on this rig." Credit is never claimed without an armed, measured comparison that
   clears the noise floor.
6. **Never display hardware that wasn't probed.** Shimmer/skeleton until real values exist; no
   placeholders, ever.
7. **Demo elements mutate nothing.** Onboarding's apply/undo card is visual only.
8. **Quiet entrances.** Toasts, not popups. Compy is a colleague, not a carnival barker.
9. **One swagger wink max in the whole app** (owner dial; candidate: final onboarding button
   "Let's get compy").
10. **Mock values:** GPU (RX 9070 XT), CPU (X3D-class, 16 threads, ~5.1 GHz), RAM (29.4 GB),
    driver age (23 days from 2026-05-12) are the real dev rig. Refresh/VRR/NVMe rows, all
    Valorant FPS numbers, and the ±9 noise floor are ILLUSTRATIVE — real probes/benchmark math
    replace them.

---

## Moment 1 — Onboarding (replaces the current 4-step `Onboarding.tsx`)

Three steps, ~70 words total. Keep Skip. Keep `ONBOARDED_KEY` gating. New: takes the cached
startup hardware snapshot as a prop (exists since `ab1c59a`).

**Step 1 · tag `YOUR RIG` · title "Compy just read your machine"**
Mono detect lines animate in (~420ms stagger), each from the real snapshot:
`✓ GPU — <detected>` / `✓ CPU — <detected>` / `✓ RAM — <detected>` / `✓ OS — <detected>`.
Body: *"Every suggestion you'll see was picked for **this exact hardware**. Nothing generic.
Nothing it can't undo."*

**Step 2 · tag `THE SEATBELT` · title "One click to apply. One click to take it back."**
Live-feeling DEMO card (mutates nothing): "Power plan" · "Recommended: High performance ·
Current: Balanced" · [Apply] → flips to Applied state + ledger line
*"Trust Ledger — power plan · Balanced → High performance · just now"* + button becomes [Undo].
Body: *"Try it — the button above is live. Every change lands in the **Trust Ledger** with its
before-state. Undoable today, undoable in six months."*

**Step 3 · tag `HOUSE RULES` · title "What Compy refuses to do"**
Three rows with icons:
*"No kernel driver — stays in user space"* · *"No game injection — anti-cheat safe by design"* ·
*"Nothing leaves your PC — no account, no telemetry"*.
Kicker: *"The sketchy tweaks aren't missing. **They're refused.**"*
Final button: **"Run my first check"** → routes to Moment 2.

**Relocations (content removed from onboarding, not deleted):** CPU-temp/kernel-driver explainer →
tooltip on the dashboard's missing-CPU-temp tile. Evidence taxonomy (Verified / Measured signal /
Expected impact) → tooltips on the chips themselves, in-product. Three-facts taxonomy → taught by
the rec cards.

---

## Moment 2 — First Check landing (first-run only)

**Entrance:** post-onboarding route. Header right: `first check · running` → `first check ·
8 checks · <real elapsed>s`.

**Scan phase:** mono rows stream as checks actually complete (readiness.rs), each resolving
`✓` (teal) / `→ worth fixing` (amber). Example rows per the mock: hardware snapshot, GPU driver
age, game drive speed, monitor refresh, VRR chain, power profile, fast startup, background
services.

**Verdict phase:**
- Tag `VERDICT`, headline pattern: **"Ready to play — N things worth fixing"** ·
  zero-case: **"Ready to play — nothing worth fixing today"**.
- Subtitle: *"Both reversible. Everything else on this rig is already where it should be."*
- **#1 BIGGEST LIMITER spotlight card** (teal-edged): title in plain English, reason referencing
  the detected hardware (mock: *"Balanced plan parks cores between frames. On your 16-thread X3D
  this costs responsiveness, not watts worth keeping."*), honest evidence chip (*"Expected impact ·
  not yet measured on this rig"* — doubles as the future Benchmark hook), [Apply] → real apply
  flow with existing confirmation UX → ledger line on success.
- **#2…N compact cards** with [Details].
- **Green strip (collapsed):** *"N checks already perfect — nothing to sell you here"* →
  expands to mono ✓ lines.
- Footer: *"Nothing else on this PC is worth touching — and Compy won't invent work to look busy.
  Play something tonight; the **session debrief** will tell you how it actually went."*

**Data:** readiness.rs (8 checks) + priorities.rs buckets (biggest limiters / already fine / not
worth touching) + recs mapping. First-run flag (e.g. `compy_first_check_v1`); subsequent launches
land on the posture dashboard with a "Re-run check" affordance.

---

## Moment 3 — Session debrief

**Trigger:** session end with a game actually presented (sessions.rs already gates on this) →
tray toast: *"Session ended — your debrief is ready."* Click → Sessions tab, debrief card. Never
auto-open a window.

**Card:**
- Header mono: `<GAME> · <duration> · <time range>` + [Share] (routes to existing Export).
  *Build note: surface the presenting process/game name from the FPS helper (it already knows the
  presenter) — small add.*
- **Verdict sentence** from 1%low/avg ratio bands (tunable, conservative; mock used ~0.60 →
  *"Mostly smooth — with dips under pressure"*), subtitle translating the number to feel:
  *"High average, but your worst moments ran at 60% of it. That gap is what stutter feels like."*
- **Four metric tiles:** Avg FPS · **1% low · estimate** (label mandatory) · Peak GPU · Peak temp.
- **THE ONE THING WORTH KNOWING box** (amber-edged, max one, may be omitted): generator priority =
  (a) existing conservative GPU-vs-system hint, (b) link to an open limiter from the first check
  (*"prime suspect"* hedge mandatory; mock: GPU loafed at 61% during dips → Balanced power plan,
  the #1 limiter, is the prime suspect), else no box.
- **Context strip (collapsed):** *"During this session: N Compy changes active"* → expands to mono
  list incl. capture honesty line (*"capture · ETW, external — no injection"*).
- **Primary CTA: "Apply the #1 fix — compare next session"** → applies via normal flow + ARMS a
  comparison (tag next session). Armed line: *"Comparison armed — power plan applied & logged.
  Play again and the next debrief reports the delta, honestly."*
- **Zero-case:** clean session, nothing armed, no insight →
  *"Good session, good rig. Nothing worth changing."*

**Credit law:** Compy never attributes a better session to itself without an armed measured
comparison; "0 changes active — you played on stock settings" establishes baselines honestly.

---

## Moment 4 — Comparison verdict, no-measurable-change case

**Where:** replaces the insight box in the next debrief after an armed comparison; also logged to
the ledger as a comparison event.

**Card:**
- Header mono: `COMPARISON · <change> · two <GAME> sessions` + right-aligned `noise floor ±N`.
- Headline: **"No measurable change"** — NEUTRAL styling (frost/gray). Never red; a null result is
  the instrument working.
- Subtitle: *"The difference is smaller than this rig's own session-to-session noise. Claiming a
  win here would be lying."*
- **Receipts:** before/after mini-bars for Avg FPS and 1% low (visually near-identical) + mono
  delta line: *"Δ +6 avg · +3 low — inside the ±9 noise floor"* (real benchmark noise-floor math
  replaces mock numbers).
- **WHAT THIS MEANS box** (teal-edged): *"That's a real answer, not a failure — a lesser tool
  would have called this a win. One suspect cleared: **your dips aren't the power plan.** It
  didn't help this game; it may still help heavier ones. Keep it or take it back — one click
  either way."*
- **Actions:** [Chase suspect #2 — <next limiter>] (continuity with the first check's ranking) ·
  [Revert it — no shame] → rollback via normal flow + ledger line *"power plan rolled back ·
  exact prior state restored"*.
- **Footer tally (owner dial — cut if it reads cute):** mono, muted:
  `honest answers: 1 · fake wins sold: 0`. Scores integrity, not grinding.

## Moment 4b — Comparison verdict, measured-win case

**Symmetry law:** a win uses the IDENTICAL layout and evidence standard as the null. If wins get
prettier framing than nulls, users learn the wins are marketing.

**Card:**
- Header mono: `COMPARISON · <change> · two <GAME> sessions` + `noise floor ±N`.
- Headline: **"This one worked."** (calm declarative; the quiet implication — others didn't — is
  what makes it credible).
- Subtitle: *"1% lows up 15% — clearing the noise floor four times over. Your average didn't
  move, and it wasn't supposed to: this fix was about killing the dips."* — ALWAYS label the
  metric that did not move, inside the win.
- **Receipts:** same before/after mini-bars; only the improved metric's "after" bar renders teal
  (the single celebratory element on the card — no confetti, ever). Mono delta line:
  *"Δ +38 low — 4× the ±9 noise floor · measured, not promised."*
- **WHAT THIS MEANS box:** feel translation (*"worst moments now run at 69% of your average, up
  from 60% — that's the stutter you stopped feeling"*), credit split (*"You applied it; Compy
  measured it."* — render benchmark.rs WinSource as copy), own the wrong guess (*"the #1 suspect
  didn't survive measurement, and #2 did — that's why Compy measures instead of promising"*),
  scope fence (*"Claim is <GAME>-only — other games get their own receipts."*).
- **Actions:** [Keep it — it earned its place] → ledger line *"Logged. It stays — and it stays
  undoable. Nothing else needs you: this rig is in good shape."* (absolution ending) ·
  [Share the receipt] (routes to Export — receipt language, never "share the win").
- **Footer tally accumulates across comparisons:** `honest answers: 2 · measured wins: 1 ·
  fake wins sold: 0`. Wins stay scarce because they are; scarcity is the flex.

---

## Acceptance checklist

- [ ] Onboarding: 3 steps, exact copy above, real snapshot in step 1, demo card mutates nothing,
      Skip works, final CTA routes to first check.
- [ ] First check: rows stream at real completion speed, real elapsed shown, verdict counts
      derive from priorities buckets, green strip expandable, zero-case styled as a win.
- [ ] Debrief: toast on session end, game name shown, 1% low labeled estimate, max one insight,
      comparison arming works end-to-end.
- [ ] Verdict (null): neutral styling, noise floor shown with receipts, revert works inline,
      next-suspect button targets the first check's #2.
- [ ] Verdict (win): identical layout/evidence standard as null, unmoved metric labeled inside the
      win, credit split + scope fence present, teal bar is the only celebratory element.
- [ ] All copy ships VERBATIM from this spec (owner-approved); deviations need owner sign-off.
- [ ] No gate flips anywhere in the pass.
