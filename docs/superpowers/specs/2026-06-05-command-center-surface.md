# Command Center — hero surface build spec (first live Instrument surface)

*2026-06-05, Cowork. The first surface of the Instrument reskin to land in the live app, so the
owner can try it first-hand. Build VERBATIM against this + the kernel
(`2026-06-05-compy-design-system.md`). Reversible by construction (see §6).*

---

## 0. Honesty correction (read first)

The signal ring must NOT show an invented 0–100 "score" (that's the de-gamified Tune Level we
removed — a fake metric is the scammer's move). The ring encodes a **real readiness ratio**: of the
readiness checks evaluated, how many are already ideal. Center label is honest and literal:
- all ideal → ring full, label **"Dialed"**
- some open → ring = ideal/total, label **"Ready · N to fix"**
Big text = the honest state, never a magic number. If we ever show a numeral in the ring, it's the
real count (e.g. checks passing), never a synthesized score.

## 1. Placement + reversibility

- Build as a NEW surface component (e.g. `src/surfaces/CommandCenter.tsx`), mounted as the **Home**
  tab. Keep the existing dashboard/home component in the tree, swapped behind a flag
  `compy_home_v2` (localStorage, default ON in dev) + a Settings toggle "New home (preview)". So
  the owner can flip old↔new live and A/B it; reverting = flag off or `git revert`. Additive only.

## 2. Layout (matches the approved mock)

Glass nav rail (left) + main area.
- **Nav rail:** pulse-C wordmark top; items Home (active) / Check / Play / Fix / Learn; rig chip at
  bottom (GPU name + a small accent status dot). Icons: Tabler outline (ti-gauge, ti-circle-check,
  ti-device-gamepad-2, ti-adjustments, ti-book-2).
- **Header:** time-of-day greeting + rig line (CPU · threads · RAM · OS) from the cached hardware
  snapshot. Right: "Re-run check" affordance.
- **Posture hero panel (glass):** the signal ring (readiness ratio per §0) + the posture sentence
  from priorities/readiness ("Ready to play — N worth fixing" / "Ready to play — nothing worth
  fixing today" when zero) + a one-line reassurance.
- **#1 limiter card (glass):** the top item from `priorities` (biggest limiter). Title + plain
  reason + evidence chip (verified/measured/expected — never upgraded). Primary action = the
  **trust-switch** (apply via the existing audited apply flow; on apply, reveal the captured
  snapshot line + write to the Trust Ledger; the same switch rolls back). If nothing worth fixing,
  show the win/empty state instead.
- **Live strip (glass):** last session avg FPS · 1% low (labeled "est") · peak temp, from
  `sessions`. **Honest empty state when no sessions yet:** "Play a session to see this — Compy
  captures it from outside the game." (never fake numbers.)

## 3. Tokens + theme

All colors via the Instrument token layer (kernel §5), Velocity default. No hardcoded hex in the
component — only `var(--…)`. Picks up theme switches for free.

## 4. Ambient backdrop

Mount the dependency-free canvas hyperspeed behind the surface (vignette so panels stay readable),
colors from theme streak tokens. **Step-aside guard mandatory:** freeze/clear when an FPS capture /
game session is active (reuse existing monitoring state), `prefers-reduced-motion` is set, or the
document is hidden. (If the backdrop component isn't built yet, build the minimal version here; it's
shared with the rest of the reskin later.)

## 5. Motion (all reduced-motion guarded; static end-state if reduced)

- Ring animates from 0 to its real ratio on mount (ease-out ~0.9s).
- Any numerals count up to their real value.
- The trust-switch thumb slides; snapshot line expands on apply.
- No motion that implies data which isn't there.

## 6. Data bindings (real, not mock)

- Hardware snapshot: cached startup snapshot (the `ab1c59a` cache) as a prop.
- Posture ring + sentence: `readiness` checks + `priorities` buckets (existing commands).
- #1 limiter: top of `priorities`; apply state from the Trust Ledger/applied-changes.
- Live strip: latest `sessions` summary (or the honest empty state).
- Shimmer/skeleton any panel whose data hasn't resolved; NEVER render placeholder specs.

## 7. Constraints

Frontend only · no gates flip (Gaming Mode stays dark) · catalog frozen · no new
capabilities/network · CSP unchanged (canvas backdrop, no remote, no Three.js this pass) ·
cargo/Rust untouched · npm + tsc + vite green per commit · additive + git-revertable · the existing
home stays intact behind the flag.

## 8. Acceptance

- [ ] New home renders behind `compy_home_v2` (default on in dev), old home reachable by toggling off.
- [ ] Ring shows the REAL readiness ratio + honest label — no invented score anywhere.
- [ ] #1 limiter applies + rolls back through the existing flow; ledger entry written; snapshot shown.
- [ ] Live strip shows real last-session data OR the honest empty state.
- [ ] Backdrop runs idle, freezes on game-session/reduced-motion/hidden.
- [ ] Theme switch recolors everything via tokens; reduced-motion gives static end-state.
- [ ] `npm run tauri dev` shows it live for owner sign-off.
