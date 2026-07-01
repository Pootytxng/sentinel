# 2026-06-19 — Living Instrument II: the "Cinematic Cockpit"

**Status:** DIRECTION SET (owner, 2026-06-18: *app-first* + *go bolder in-app*). Aesthetic is a
taste-gate pending on the owner's read of the prototype. Build is gated behind a new reversible
flag. This is an **evolution of the existing, blessed `data-living` layer**, not a foreign graft.

**Visual north star:** `docs/superpowers/specs/2026-06-19-cinematic-cockpit-prototype.html`
(open in a browser — the *feel*, the theme switch, and the 🎮 game-session **freeze** toggle are the target).

## Why
The owner saw the "AI animated sites" wave (Nick Saraev's clip: Leon Lin's **taste-skill** +
**Kling** video + **Nano Banana** images) and wants Compy to feel like that new premium standard.
The reusable substance isn't any one page — it's (1) a *taste layer baked into the build* so the
agent stops shipping generic slop, and (2) a generative hero pipeline. The owner chose to point it
at the **app first** and go **bold**. This spec makes "bold" safe on a tool whose whole job is *not*
stealing frames.

## The two-surface doctrine (the part the video omits)
Compy is not a website. We have two surfaces with opposite rules, same design DNA:
- **Site (compy.gg)** = the movie trailer. Explosions welcome. Motion dial ~8. (Out of scope here.)
- **App** = a cockpit, not a trailer. Bold *but disciplined*: heavy looping video/canvas on the very
  rig we're measuring is self-defeating and re-breaks the FPS self-measure fix. Bold ≠ heavy — the
  drama in those $15k sites is almost all compositor-cheap transform/opacity, not 4K video.

## Dials (adopted from taste-skill, set per surface)
| Dial | Site | **App (this spec)** |
|---|---|---|
| Variance (layout experimentation) | 8 | **5** |
| Motion (animation depth) | 8 | **6 "Cinematic" / 3 "Calm"** (user toggle in Settings) |
| Density (info per viewport) | 5 | **6** |

## What "bolder" means here — the technique menu
**ALLOWED** (GPU compositor, near-zero cost): transform/opacity animation; entrance choreography +
stagger; ambient aurora drift (already shipped); posture-ring sweep-to-reading + slow breathe;
dial sweep 0→real-value-then-hold; accent glow on **live** surfaces; hover lift / magnetism; **one**
sanctioned scan/win streak.

**BANNED** (steals frames / feeds the snake-oil narrative): looping `<video>` backgrounds; per-frame
animated heavy `backdrop-filter` stacks; canvas/WebGL particle fields; infinite idle shimmer;
animating layout properties (width/height/top/left); **any** continuous motion during a measured session.

## HARD LINES (must not change)
1. **Reversible flag.** Ship under `:root[data-cinematic="on"]` behind a `compy_cinematic` flag,
   **default OFF**, additive over the living layer, droppable to byte-identical. Mirror the
   `living-instrument.css` / `theme.ts` / `main.tsx` pattern exactly.
2. **THE FREEZE LAW (non-negotiable).** While an FPS/game session is being measured, ALL continuous
   motion (aurora drift, ring breathe, heartbeat, live-dot pulse) → `animation:none`. Hook the same
   fps-status signal `AmbientBackdrop` already reads (it already throttles polling). This is both the
   performance guard **and** the FPS-self-measurement guard — a constantly-repainting webview can
   re-inflate Compy's own present count. Demonstrated by the prototype's 🎮 toggle.
3. **Honesty law** (already in the living layer): glow lights only LIVE instrument surfaces, never a
   plain/static number; motion conveys real state then **holds the truth** (dial sweeps to the real
   reading and stops). No motion may make a metric look better than measured. (Receipts Doctrine in CSS.)
4. **Reduced motion:** every animation off under `prefers-reduced-motion`; depth + glow remain.
   Belt-and-suspenders (global reset in `tokens.css` + a per-layer block).
5. **One shimmer** (`sweep-guard.test.ts`): the scan/win streak is the single sanctioned sweep; no
   competing idle shimmer.
6. **Tokens only:** no bare theme hexes (`theme-literal-guard`), no undefined fallback-less `--ix-*`
   (`border-hygiene-guard`), all 5 themes pass `theme-contrast` incl. ink-on-accent ≥4.5:1.
7. **Cosmetic only:** no logic / data / IPC / capability / CSP / catalog touched; nothing Compy
   *measures* changes. Frozen beta refs (`16069fa`) untouched; no installer cut.

## Phasing (surface by surface, reversible at each step)
- **P1 (first CC task):** create the `data-cinematic` layer + apply to **Home** (posture-ring
  sweep+breathe, hardware-grid entrance stagger, live-only glow, hover lift, the one scan streak) +
  wire **the Freeze Law** to real fps status. Default OFF. All guards green.
- **P2:** Check + **Play** (Play is the gaming surface — it must honor the freeze hardest).
- **P3:** Fix + Learn + Lab.
- **P4:** owner taste pass on intensities → decide whether to flip default ON (its own review, exactly
  like the living layer's promotion).

## Verify (every phase)
`cargo test` (count unchanged — cosmetic) · `npm test` · `clippy -D warnings` · `tsc` · `vite build` ·
`theme-contrast` / `sweep-guard` / `border-hygiene` / `theme-literal` / `doorknob` / `homeRail` guards
all green · `/security` clean (zero new capability/CSP/IPC).
