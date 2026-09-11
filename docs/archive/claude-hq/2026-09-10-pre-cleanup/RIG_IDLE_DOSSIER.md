# RIG-IDLE dossier — the measured slowdown, and everything known about its cause

**Status 2026-08-13 ~23:30Z:** cause BAND proven; specific TRIGGER diagnosed from library source but
**not yet confirmed at runtime**. No fix attempted. This doc exists so the next lane starts from
evidence instead of re-deriving it. The HQ ledger is still the first-read; this is its appendix.

---

## 1. The measurement (hard evidence, trust this)

`node scripts/q7-probe.mjs attribute --port 9455 --settle 30 --phase 60`, installed **v0.9.25**,
Home, 16 cores. Raw: `docs/perf/raw/idle-attribution-2026-08-13-v0.9.25.json` (committed `8c547ce7`).

| Band | % of one core | share of idle |
|---|---|---|
| **rAF frame loops** | **20.137** | **83.8%** |
| runtime floor (WebView2 compositing, Tauri IPC, Rust core) | 1.681 | 7.0% |
| CSS/WAAPI animations | 1.547 | 6.4% |
| timers (5 intervals) | 0.672 | 2.8% |
| **TOTAL IDLE** | **24.037** | |
| **rAF frozen** | **2.353** | |

Band validity: 0 frames fired while frozen; baseline settled within 1.426 points before phase 1.

**vs the 2026-08-06 baseline** (`docs/perf/raw/idle-attribution.json`, preserved unchanged):
total idle **11.694 → 24.037**, rAF band **1.813 → 20.137** — roughly **11×**.

**Why this evidence is strong:** the probe freezes rAF *through CDP at the engine level*, not by
patching a page global. The 24.0 → 2.35 drop is measured CPU of the whole process group across two
60-second windows. It does not depend on any assumption about the app's code.

## 2. What is ELIMINATED

- **The Geist variable font / 14→15px base bump.** This was the #1 source-ranked hypothesis. It does
  not appear in the attribution at all. **Do not spend a train on it. Leave the font alone.**
- **`compy_hologram_v2` being off.** If that flag were `"0"`, `RigHologram.tsx:338-342` resolves
  `frameloop` to a literal `"always"` and the whole band would be explained by a flag. **Checked on
  the measured install: the key is `null`**, so `readHologramV2()` returns true → `holoV2 = true`,
  `autoRotate = false`, `orbiting = false` → **`frameloop = "demand"`**. The flag branch is closed;
  demand mode really is what is failing to hold.
- **`use-rig-colors.ts` object churn.** The chunk name `use-rig-colors-*.js` in the rAF stacks is a
  **red herring** — it is just Vite's name for the whole three.js/r3f bundle. The hook returns a
  `useState` value, stable except on `data-itheme` / `data-room-identity` mutation plus one
  guaranteed re-render on mount. Not the driver.
- **`nextFanSensors` reference preservation.** Still intact (`fan-sensors.ts:15-25`): a content-equal
  poll returns `prev`, React bails, no re-render. Both `RigHologram` polls (1500ms / 2500ms) are
  gated on `visible`. Not the driver.
- **A rig source change in v0.9.18..v0.9.25.** Only `51956ed0` (font-size tokens inside hover-card
  `<Html>`, 7 lines across `RigFan`/`RigPart`) and `f1766e86` (UX-1; did **not** change `.hc-stage` /
  `.hc-rig` sizing). **Nothing in the frame-loop logic, controls, `FitCamera`, shader or post stack
  moved.** So the 11× growth is NOT explained by rig source in that window — see §5.

## 3. The diagnosed mechanism (library source, not yet runtime-confirmed)

**drei's `OrbitControls` runs `controls.update()` from inside a `useFrame`, and invalidates from the
controls' `change` event:**
```js
// @react-three/drei/core/OrbitControls.js:28-30
useFrame(() => { if (controls.enabled) controls.update(); }, -1);
// :39-41
const callback = e => { invalidate(); … };
controls.addEventListener('change', callback);
```

**react-three-fiber v9 treats an `invalidate()` raised *during* a frame as a standing request:**
```js
// @react-three/fiber  invalidate()
if (useFrameInProgress) {
  // called from within a useFrame, it means the user wants an additional frame
  state.internal.frames = 2;      // <- decrements to 1, which is still > 0
} else { state.internal.frames = 1; }
```
The loop decrements by one per frame and reschedules while `frames > 0`. **Set to 2 from inside a
frame, it decays to 1 and never reaches 0 — the demand loop latches free-running forever.**

**The seed** is `FitCamera` (`RigHologram.tsx:70-76`), the one place that moves the camera behind the
controls' back and then re-syncs them:
```tsx
camera.position.set(tx + dx * k, ty + dy * k, tz + dz * k);
controls?.update?.();
invalidate();
```
`three`'s `OrbitControls.update()` dispatches `_changeEvent` whenever the camera moved past `_EPS` or
the radius was clamped — and `minDistance={5}` / `maxDistance={28}` are set, so clamping is live.

**Consistency with the measurement:** 5.1 fps during the `running` phase (main thread contended by
the CSS animations) rising to **128.4 fps** once those animations were cancelled is exactly the shape
of a free-running loop, not an idle one.

**Cost multiplier (not the trigger):** the bay mounts a `DoubleSide` additive holographic shader
(`RigHologram.tsx:404-417`, `signalSpeed 0.4`) inside `<EffectComposer><Bloom mipmapBlur/><Glitch/>`
(`:509-519`). Neither invalidates, but they are why each runaway frame is expensive enough to reach
20 CPU points.

## 4. ⚠️ The runtime confirmation attempt FAILED — and read why before repeating it

Two page-level probes were run on a freshly launched v0.9.25 sitting on Home:

- Patched `window.requestAnimationFrame` with a counter → **0 calls in 29s**, verdict "genuinely idle".
- Reset the counter, then perturbed `.hc-rig` height by 1px (the real `ResizeObserver` path) →
  **4 calls, then quiet.**

**Do NOT read that as "the loop is fine."** The probe is almost certainly blind: r3f's loop calls
`requestAnimationFrame(loop)` from inside its own bundled module, and if the bundler captured or
aliased that reference at module-init — before a page-level patch could exist — the counter never
sees it. A page-level hook installed *after* app boot cannot be trusted to observe a library's
internal scheduler. **The engine-level q7 measurement and the page-level counter disagree, and the
engine-level one wins.**

**How to confirm properly next time** (in rough order of cost):
1. `controls.addEventListener('change', () => console.count('oc-change'))` on the live controls, then
   read the console over ~10s. A steady per-frame count proves the latch. Getting a handle on the
   controls is the fiddly part — `makeDefault` puts them in the r3f store.
2. CDP `Runtime.evaluate` on r3f's own store rather than the DOM: read `internal.frames` over time.
   If it sits at 1 and never reaches 0, that is the latch, directly observed.
3. Re-run `q7-probe attribute` with the rig flag OFF (`compy_home_rig_3d = "0"`) and diff the rAF
   band. **This is the cheapest decisive test of attribution** even though it does not name the
   trigger — if the band collapses, the rig owns it; if it does not, the whole diagnosis is wrong.

**Also unresolved:** the fresh-launch measurement really did look idle, and the q7 run really did
measure 20 points of rAF. Something differs between the two states. Candidates: window focus /
occlusion (`visible` gates `frameloop`), whether a resize or an orbit interaction happened before the
window began, or the probe's own 60ms sampling keeping the app awake. **Resolve that discrepancy
before writing a fix** — it may mean the latch needs a specific trigger a user hits routinely
(maximise, DPI change, first orbit drag) rather than happening on every launch.

## 5. The 11× growth is still unexplained by source

No rig file changed in the range. The subagent flagged two candidates it could not rule out:
- **A dependency bump.** `@react-three/fiber ^9.6.1`, `@react-three/drei ^10.7.7`, `three ^0.184.0`
  are **caret ranges** — a lockfile refresh could have pulled in the `useFrameInProgress ⇒ frames = 2`
  behaviour or a drei `OrbitControls` change. **Check `git log -p -- package-lock.json` across the
  window for those three packages.** This is a strong lead and cheap to run.
- The 2026-08-06 baseline may not be an apples-to-apples state (different build, possibly different
  flags on screen). Treat the 11× as directional, and the absolute 24.0% as the fact.

## 6. The candidate fix (designed, NOT applied)

**Smallest change:** stop drei's `useFrame` from running when nothing is driving the controls — pass
`enabled={orbiting || interacting}` to `<OrbitControls>` (`RigHologram.tsx:491-501`), driving
`interacting` from the existing `onStart` / `onEnd`. drei's body is literally
`if (controls.enabled) controls.update()`, so a disabled control cannot dispatch `change` and cannot
latch the loop.

**If drag-orbit must stay live at all times:** own the update yourself — render
`useFrame(() => controls.update(), -1)` and call `invalidate()` only via `queueMicrotask`, so r3f's
`useFrameInProgress` branch (`frames = 2`) is never taken and the counter can reach 0.

**Related cleanup, same neighbourhood:** `RigCase.tsx:42-45` lerps opacity asymptotically and never
reaches its target, so the scene is never *provably* at rest. It cannot start the loop, but it will
defeat any future "stop when converged" heuristic. Snap to target below an epsilon.

**Guard this fix, and falsify the guard.** A test that pins `frameloop === "demand"` on Home plus the
controls' `enabled` contract would catch a regression; and per the standing law, reintroduce the
defect once and watch the guard go red before trusting it. Then **re-run the probe and show the rAF
band moved** — that is the acceptance criterion, not "it feels smoother".

## 7. Why this matters beyond the number

`compy_home_rig_3d` defaults ON and Home is the landing screen, so **every user pays this on
arrival**. It is also the leading explanation for tester Jaikaran's P0 "intermittent freeze while
scrolling or changing tabs" on an RTX 3060 Ti / Ryzen 5 5600X — a frame loop eating a fifth of a core
is exactly what makes scroll and room swaps stutter. **Fix RIG-IDLE, then re-test his scenario before
treating it as a separate defect.**

## 8. Method note worth keeping

A careful, well-cited source review ranked the font first and the rig **last**, reasoning from
`frameloop="demand"` and visibility-gated polls. A six-minute instrument run inverted it completely.
**A hypothesis ranked from source is a list of places to measure, never a verdict** — and this repo
already owns the instrument. Then the reverse happened: a quick page-level probe said "genuinely
idle" and was itself untrustworthy against the engine-level measurement. **Match the instrument to
the layer you are measuring, and when two instruments disagree, ask which one the subject can hide
from.**
