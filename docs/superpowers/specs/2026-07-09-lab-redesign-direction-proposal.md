# Lab redesign — DIRECTION PROPOSAL (research + council, approval-gate BEFORE build)

> **⚠️ NOT THE CURRENT LAB DIRECTION (updated 2026-07-09).** The "Instrument Bench" bento below was
> built (Phase 1, `403be45`) and the owner rejected it **as the Lab** ("same old generic slop … wide
> horizontal boxes … bento templates at the bottom"). The Lab's live direction is now the Ops Console
> HUD — `2026-07-09-compy-console-hud-direction.md`. **Bento is NOT retired, though** (owner, 2026-07-09):
> a tidy tile grid stays a LIVE option for OTHER surfaces where it genuinely fits — this doc is kept as
> a reference for that, not deleted. Just don't rebuild the *Lab* from it.
>
> **Status: PROPOSAL awaiting owner go/no-go. NO code until the owner passes on the direction.**
> This is the deliverable the course-correction brief (`2026-07-09-lab-redesign-COURSE-CORRECTION.md`)
> asked for: real research into the animation/design *language* the owner keeps describing (JARVIS /
> high-tech / living instrument), a cited proposal with examples he can click and look at, the council's
> read, and a short plain-English question set. Produced by a fresh session, 2026-07-09.

---

## 0. What the owner rejected, and what this fixes

The blended-Lab marathon (`f16d158`, flag `compy_lab_ground` **DEFAULT OFF** — his live app was never
touched) went the wrong way on three counts: (1) it **cloned** the sister-site scroll/drag gallery he had
explicitly said NOT to clone; (2) it **removed the bento** he liked and reverted to the linear "spine" we
had already binned; (3) **nothing read as JARVIS / Tony-Stark / high-tech** — the animated, reactive
"living instrument" feel he has described repeatedly was absent. This proposal is a direction, not a build:
it brings the **bento back as the basis**, redirects the "explore-a-3D-space" feel he loved onto the parts
where it's honest, and defines the **restrained-but-alive motion language** that actually reads high-tech.

---

## 1. The one big finding from the research

I studied the current (2025–2026) trending/awarded design landscape the owner pointed me at — Awwwards
Sites of the Day, the studios behind them (Lusion, Rogue, HOLOGRAPHIK), the reference product UIs (Vercel,
Linear, Raycast, Teenage Engineering), real mission-control systems (NASA Open MCT, Bloomberg), and the
motion-tech behind all of it.

**The through-line, on every tasteful reference: the "high-tech living instrument" feel comes from
RESTRAINT, not ornament.** One or two accent colors on a near-black base; monospace for *data* labels;
glass/hairline depth; and — the crucial part — **motion that is tied to real state** (a gauge that sweeps
because a real number changed), never decorative animation for its own sake. The line into gaudy/gamer is
crossed by exactly the things Compy's locked rails already ban: multi-color neon glow, gamer-HUD overlays,
unmotivated scanline/glitch.

**Why this matters:** it means the owner's JARVIS goal and Compy's honest-measurement law are the *same
discipline*. We don't have to choose between "looks high-tech" and "never fabricates." The most high-tech
thing the Lab can do is animate *real* measured data. That's the spine of this proposal.

---

## 2. Cited references (the owner can click these and look)

### A. The tasteful high-tech / instrument look (the "north stars")
- **Vercel / Geist** — https://vercel.com/geist/introduction · subtle background grid, pure black/white,
  Geist Mono for data, sharp radii, "functional only" motion. The reference case for *instrument-feel via
  restraint*.
- **Linear** — https://linear.app/now/how-we-redesigned-the-linear-ui · dark-mode-first, deliberate 2026
  pullback toward monochrome. The poster child for restrained dark-SaaS.
- **Raycast** — https://getdesign.md/raycast/design-md · proves HUD-feel needs no monospace/glow — dark
  chrome + hairline borders + one accent is enough.
- **Teenage Engineering (OP-1)** — https://teenage.engineering/designs · the canonical *tasteful sci-fi
  instrument*: five colors total, monospace system, orange accent = "engineered/important." Constraint as
  the aesthetic.
- **NRG "Build Your Data Center"** (Awwwards SOTD) — https://business.nrg.com/campaigns/build-your-data-center/
  · a single electric-yellow-on-near-black palette turning a page into a navigable live dashboard.
- **iCOMAT** (Awwwards SOTD) — https://www.icomat.co.uk/ · proof a genuinely industrial subject reads
  high-tech through minimalism, zero neon.
- **Apple "Liquid Glass"** (iOS/macOS 26) — the mainstream-legitimized frosted-glass depth we'd borrow for
  panel chrome (caution: low-contrast-text-over-blur is the trap).
- **HUDS+GUIS** — https://www.hudsandguis.com/ · browsable archive of real film HUDs (Andor, Silo — the
  *industrial* end, tasteful; skip the cyberpunk-neon end).

### B. The motion/reactivity feel (Lusion-tier)
- **Lusion — EverSwap** (Awwwards SOTD) — https://everswap.com/ + case study https://lusion.co/ · fluid
  WebGL motion on a *technical dashboard* framing — the "cinematic but not gamer" reactivity level.

### C. Bento done right (the layout basis the owner wants back)
- **reactbits MagicBento** — https://reactbits.dev/components/magic-bento · the cursor-following spotlight +
  border-glow primitive **already vendored in this repo** (`src/design/vendor/MagicBento/`). Retinted to
  Compy's accent.
- **Apple bento** — https://senorit.de/en/blog/bento-grid-design-trend-2025 · size encodes importance, one
  hero cell, never a symmetric grid.
- **Awwwards animated-bento cluster** — https://www.awwwards.com/inspiration/animated-bento-grids-assemble ·
  staggered entrance + hover motion so the grid *assembles itself*.
- **Datadog / Linear / Payhawk dashboards** (via https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide)
  · live-data tiles; state via color+size, not always a chart; one metric + one trend per tile.

---

## 3. The proposed direction — "The Instrument Bench"

**The Lab becomes a living cockpit built from bento bays.** Not a list, not a scroll gallery — a grid of
station bays that behaves like mission control: each bay is alive with its own real reading, the grid reacts
to the cursor, and every bit of motion is driven by measured telemetry.

Six design principles (each maps to a cited reference and to an existing Compy rail):

1. **Bento is the face.** Station bays as tiles; **size encodes importance** (one hero bay — the "Optimize /
   enable-the-safe-stack" fast path — dominates; measure/prove bays are medium; utility bays compact). Cell
   count = station count, no filler tiles. *(Apple bento; owner's confirmed ask.)*
2. **Restraint palette — keep what Compy already has.** Near-black surface + the single active theme accent
   (the Instrument-HUD reskin already ships this). This is the #1 lever separating tasteful from gamer.
   Never gamer-RGB — already a locked rail. *(Vercel/Linear/Teenage Engineering.)*
3. **Alive at rest.** Each bay shows its live reading and **assembles with a staggered reveal** on room
   entry; gauges/count-ups animate **from the measured number** (GSAP driving the value). Motion serves real
   data — the honesty win. *(Awwwards animated-bento; Datadog live tiles; Compy's honest-measurement law.)*
4. **Cursor-reactive, but one interaction per tile.** Retint the vendored MagicBento **spotlight + border-
   glow** to the accent (dim the siblings, light the hovered bay) + a **subtle** hover-lift and small
   magnetic tilt. The current bento deliberately runs tilt/magnetism OFF under a stricter rail — this
   proposal dials a *small* amount back ON, because that reactivity IS the JARVIS feel he found missing.
   *(MagicBento; Framer Bento-Card; Contrarian's cap: never stack five effects on one tile.)*
5. **HUD chrome, industrial end.** Hairline corner brackets, monospace **micro-labels** (data only, not body
   copy), glass/frosted panel depth with hairline borders, and a **decode/scramble reveal on the single room
   verdict headline only** (mount-guarded — this repo already caught scramble-on-remount as a bug,
   `[[visual-anomaly-is-a-defect-signal]]`). *(Raycast chrome; Apple glass; film-HUD industrial end.)*
6. **The "explore-a-3D-space" feel goes where it's honest.** The inertia/drag feel the owner loved from his
   sister's site is **redirected onto the real rig hologram** (drei `OrbitControls` damping — already in the
   app) and optionally a gentle inertia on the bento canvas itself — **NOT** a separate panoramic drag
   gallery (explicitly rejected). *(drei OrbitControls; owner's rejection of the clone.)*

### What happens to the existing/rejected pieces
- **Drag telemetry gallery** (`330cd5c`, §3): the standalone panoramic drag-gallery **form is retired** from
  the Lab face. Its *honest data plumbing* (`buildGalleryPieces`, `FlyCamera`) is salvageable inside a
  static "Results / collection" bay if the owner wants a trophy space — owner call (Q3).
- **Linear "spine":** gone. Bento is the face.
- **§2a aggregate-stack A/B backend** (`6d49f10`, DARK, `stack_trial_gate` OFF) + all mutation-safety work:
  **KEEP** — orthogonal to the UI direction, already reviewed.
- **Optimize-as-station-1 merge:** keep the concept, re-present it as the **hero bay** in the bento.

---

## 4. Tech feasibility (short version)

- **Zero new dependencies.** `gsap ^3.15` (now 100% free incl. all plugins as of the Apr-2025 Webflow
  release — https://gsap.com/pricing/), `motion` (framer) `^12.42`, `@react-three/{fiber,drei,postprocessing}`,
  `three`, `ogl` are **all already installed.** MagicBento is already vendored.
- **GSAP is the single motion engine** for data-reactivity + inertia; drei `OrbitControls` damping for the
  3D hologram; hand-rolled magnetic tilt (a pointer listener on 1–2 elements). **Skip Lenis** — it solves a
  long-scroll problem this app doesn't have.
- **Perf caveat (must respect):** WebView2 has documented cases of full-panel `backdrop-filter: blur()` /
  shader post-process silently falling onto a **software render path** (tauri #4891/#5037). So glass/scanline
  = **CSS fakes for 2D panels**, GLSL reserved for the 3D scene only, and any heavy effect gets **verified on
  the real installed release build**, not the dev build (`[[dev-build-not-a-perf-test]]`).
- **All motion gated on reduced-motion** via the app's existing motion-override pattern + `gsap.matchMedia()`
  ([[motion-on-by-default-override-os]]).

---

## 5. Build posture (once approved — for reference, not now)

Flag-gated (reuse/rename the existing `compy_lab_ground` room), **DEFAULT OFF the whole way**, phased with an
owner eyeball per phase, no ship until he approves each look. Honesty rails hold: every animated number
traces to a measured struct (existing law, test-pinned). Rough phase order: **P1** bento bench shell + hero
bay + retinted spotlight (no heavy motion) → **P2** alive-at-rest data-reactive gauges/count-ups → **P3**
cursor reactivity (tilt/magnetic) + decode headline → **P4** hologram inertia + optional results bay. Each
phase = its own small spec + self-review + flag-off byte-identity pin.

---

## 6. Council read (full strip in the session log)
Direction is **sound and rail-compatible** — the honesty law and the JARVIS feel are one discipline.
Contrarian's binding cap: **one primary interaction per tile, scramble only on the verdict headline,
every animation bound to real telemetry** — or it becomes gimmick, the opposite of the goal. Expansionist:
build the bays share-card-shaped (Receipts Phase 1 reuse). Not a 🔴 (flag OFF, no funnel/trust risk).

---

## 7. Owner decisions — ANSWERED 2026-07-09 (go/no-go passed)
- **Q1 direction → "Yes, spec it."** "The Instrument Bench" (bento of living bays) is APPROVED. Proceed to
  a Phase-1 plan; eyeball before anything visible ships.
- **Q2 motion intensity → "Bolder / more alive."** Push the wow, especially on the hero bay + rig hologram.
  The Contrarian's cap is REFRAMED, not dropped: bolder is fine, but the binding rail stays **every
  animation bound to a real measured number** — that is both the honesty law and the thing that makes bold
  motion read as *instrument* rather than *screensaver*. Not "less motion," but "no unmotivated motion."
- **Q3 rejected gallery → "Delete it entirely."** No salvage, no static results bay. The panoramic drag
  gallery (`330cd5c` §3: `TelemetryGallery.*`, `gallery-pieces.*`, `fly-camera.tsx`) is removed as the bento
  bench replaces the `compy_lab_ground` room (folded into the P1 room-rebuild so the wiring is touched once,
  not twice). The `docs/ui-sweep/shots/lab-gallery-*.png` captures get cleared in the docs pass.
- **Q4 look north-star → deferred into the phase eyeballs** (owner chose motion level, not a single look
  brand; I'll pilot the restraint-palette + industrial-HUD chrome he already ships and let him react on P1).
- **Q5 docs cleanup → "Yes, do it now."** Running in parallel per §8.

---

## 8. PARALLEL ask — docs/ + directory maintenance (scope)
Root cause the owner named: a stale spec (`2026-07-08-lab-proving-ground.md`) actively steered the work the
wrong way — doc drift corrupts execution, it's not cosmetic. Proposed scope for a controlled cleanup pass
(reversible, small commits, my lane):
- **Reconcile the Lab specs:** `2026-07-08-lab-proving-ground.md` (its UI direction is dead) vs this proposal
  vs the course-correction brief — mark the dead UI direction SUPERSEDED in-file (keep the catalog/§2a/safety
  parts), so no future session executes the wrong layout again.
- **Contradiction sweep of `docs/`:** find any two docs that disagree about current state; RELEASE_STATE.md
  wins (run `scripts/verify-release-state.mjs` + the `gate-drift-audit` skill).
- **Stale/superseded flagging:** specs whose direction was reversed (editorial, the linear spine, the drag
  gallery) get a one-line SUPERSEDED banner pointing at the live truth — not deleted (git history matters),
  just un-misleading.
- **De-dup the UI backlog vs BACKLOG vs RELEASE_STATE** so the "what's next" picture is single-sourced.
- Deliverable: a short cleanup report + the banner/consolidation commits. **NOT** a mass deletion — nothing
  irreversible without a heads-up.
