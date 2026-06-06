# Compy Design System — "Instrument" (brand + UI kernel)

*2026-06-05, Cowork session. The canonical design kernel every Compy surface inherits from.
Status: **DRAFT for owner review** — drafted while the owner was out; nothing here is committed or
built yet. Mockups for command-center, Trust Ledger, Check/radar, the integrated wordmark, the
ambient-background field, the trust-switch, and the logo divergence board were presented live in
chat 2026-06-05 and are the visual companions to this doc. Provisional decisions are marked
**(provisional)** — owner has final say on every aesthetic call.*

---

## 0. The one law (non-negotiable)

**Decorate freely — never lie.** Compy is the honest instrument in a category full of scams, so
its visuals may be alive, neon, and beautiful, but nothing on screen may:
- impersonate data (no fake gauges, fake progress, invented scores),
- fabricate achievement (no celebration of a result that wasn't measured), or
- manufacture fear (no scareware red, no "847 issues!" energy).

Ambient beauty that delights without claiming anything (a drifting background, a satisfying
toggle, the launch pulse) is welcome and encouraged. The test for any effect: *does it testify, or
does it lie?* If it neither testifies nor lies, it's allowed to simply be pretty.

(This replaces the earlier, too-strict "never move for vibes" rule — corrected at owner's push
2026-06-05. Austerity is not honesty; it's just one taste.)

---

## 1. Brand mark

- **WORDMARK LAW (owner, 2026-06-06 — repeat offense, now hard law):** wherever the brand renders
  as identity (app header, onboarding hero, splash, About, site header/footer, marketing, docs
  headers), **the pulse-C IS the letter C: bare glyph (NO tile) at cap height, tight-kerned
  directly into "ompy" — one word, one mark.** Never icon-next-to-"Compy", never a separated
  logo + full word. The **tiled** pulse-C exists ONLY in icon contexts (desktop/taskbar/favicon/
  thumbnail). In running prose, type "Compy" normally. Implement once as a shared `Wordmark`
  component and reuse it everywhere.
  **Wordmark cut (the kerning that makes it ONE WORD):** crop the glyph viewBox to the stroke
  bounds — `viewBox="218 218 510 588"` on the master geometry (no dead padding); trim the pulse
  to end at `648,512` so the "o" can tuck toward the C's mouth; C-to-"o" gap = normal letter
  spacing (≈ −1px at 19px / ≤0.05em — match the o-to-m rhythm). If it reads as logo-then-word,
  the kerning is wrong.
- **Wordmark: "Compy"** — the leading **C is the pulse-C** (heartbeat inside the C's bowl per the
  2026-06-06 icon revision). The C carries the accent; "ompy" wears theme off-white and yields
  the spotlight.
- **App icon:** the pulse-C in a rounded-square neutral tile; 16/24px use the single-beat small
  cut (`pulse-c-icon-small.svg`) — owner override: the pulse survives ALL sizes, C-only retired.
- **Launch reveal:** the pulse draws itself on cold start (flatline → spike → curl into C). The app
  introduces itself with its own heartbeat. Honors `prefers-reduced-motion`.
- **Outstanding task:** replace stock `src-tauri/icons/*` (still the Tauri default) with the real
  pulse-C `icon.ico` + PNG set once the mark is locked. This is the "first impression of the first
  impression" — highest-priority brand asset.

## 2. The "Instrument" aesthetic

A precision glass cockpit, not a flat settings page. Departure from the old flat-graphite look:
- **Depth returns:** layered glass panels with real elevation — semi-opaque dark fills, a lighter
  top-edge highlight border (`border-top-color` brighter than the rest), generous radii (13–16px).
- **Base:** deep **obsidian** with a faint theme tint, not neutral graphite.
- **Numbers are royalty:** all metrics in precision mono (`--font-mono`), large and confident. The
  data is the hero of every screen.
- **Signature data shape — the signal ring:** a circular gauge (the existing `Gauge` primitive,
  elevated) for posture/scores. NOTE: the ring is a *data viz element*, distinct from the pulse-C
  *logo*. Ring = chart; pulse-C = brand.
- **Motion is physical:** values count up to their true number on first paint, the ring fills to its
  real value, panels settle. All motion is data-bearing or ambient — never faked. Everything
  respects `prefers-reduced-motion` (static end-state).

## 3. Ambient background system

Inspired by the reactbits catalog, tuned to the honesty law. Speed/scanning is the literal subject
of a performance tool, so motion here testifies rather than decorates.

- **Default ambiance: Hyperspeed** — light-streak warp tunnel (frames flying at speed). Vanishing
  point **(provisional: top-right)**; streaks live in negative space, glass panels occlude them so
  text stays crisp.
- **Scan/Check surfaces: Radar** — a sweep with findings as blips (green = fine, amber = worth
  fixing). The sweep IS the honest scan; the blips ARE the findings. Best on-brand background found.
- **Calm surfaces (dense reading — Library, Sessions tables): Dark Veil or Dot Grid** — subtle,
  premium, low-motion so they never fight content.
- **THE COURTESY RULE (load-bearing, also a feature):** ambiance runs full only when idle/browsing.
  It **automatically calms or freezes** when (a) a game is running/presenting, (b) on battery, or
  (c) a low-end GPU is detected. "Compy gets out of the way when you play." A performance tool must
  never spend the user's GPU on its own chrome — this turns a vanity risk into a brag, and it's
  honesty-aligned. Implementation: the real reactbits backgrounds are Three.js (bundled locally, no
  remote/CSP issue); ship a lightweight canvas fallback for the calm/low-power path.

## 4. Themes (swappable temperature, one engine)

Default is the competitive/cool theme; all themes recolor the same streaks + accent + tint. **Names
provisional** (NOT "Caleb/Sarah" — those were personas, never ship). Each is a genuinely distinct
world, not shades of one hue (the earlier "warm = orange-on-orange" attempt was rejected; Ember
fixes it with TWO warm hues on a plum base for depth).

| Theme | Mood | Accent | Accent text | Streaks | Base |
|---|---|---|---|---|---|
| **Velocity** (default) | competitive, cool | `#2ee6c0` | `#9bf6e4` | `#22d3ee #2ee6c0 #5eead4` | `#07090e` |
| **Nova** | electric, vivid | `#c084fc` | `#ecd5ff` | `#a855f7 #ec4899 #818cf8` | `#0a0710` |
| **Ember** | warm, cinematic | `#fb9d4b` | `#ffdcb0` | `#fb923c #f43f5e #fbbf24` | `#0d0810` |

Theme switch is a first-class, easy toggle (lives in Settings + quick-switch). Persists locally.

## 5. Core tokens (provisional starting values)

- **Text:** primary `#eaf2f1` (warm `#f6ece6` on Ember) · secondary `#8fa0a0` · tertiary `#5a6a6a`.
- **Semantic (constant across themes):** attention/amber `#fbbf3c` · regressed/danger `#f0726f` ·
  verified = the theme accent.
- **Glass panel:** fill `rgba(11,16,21,0.72)` over the ambient layer · border `rgba(255,255,255,0.10)`
  · top-edge `rgba(255,255,255,0.18)` · radius 13–16px.
- **Type:** sans = Anthropic-Sans-equivalent system stack for UI; **mono for ALL numerals/metrics**.
  Two weights only (400/500). Sentence case everywhere. No font under 11px.
- **Glow:** reserved for the accent on live/interactive elements (ring, primary button, active nav,
  the trust-switch when on). Never on static text.

## 6. Signature components

- **Trust-switch (the most important control):** the apply/rollback toggle. Unlike a normal switch,
  flipping it ON *captures and reveals the before-state it will restore* ("snapshot captured —
  restores Balanced · logged to Trust Ledger"). The thumb wears the pulse tick only when live. The
  same control is the apply AND the undo. Keyboard-accessible (role=switch).
- **Signal ring:** posture/score gauge; fills to the real measured value on paint.
- **Verdict cards:** null (neutral/frost, never red — "no measurable change" is the instrument
  working) and win (identical layout + evidence standard, ONE celebratory shimmer — the only
  earned flourish, on the improved metric's bar). Both show the noise floor + receipts.
- **Trust Ledger timeline:** vertical glass timeline; each entry shows before→after; rollbacks
  render as genuine reversals. The brand-defining screen — should be the prettiest.
- **Glass nav rail:** Home / Check / Play / Fix / Learn (/ Lab) with the pulse-C wordmark at top.

## 7. Surface propagation order (the whole app)

Designed in the new language so far (mocked in chat): **command center, Trust Ledger, Check/radar.**
Remaining to reskin (rough priority):
1. **Fix / Recommendations** — most-used; home of the trust-switch; group outstanding → applied
   (collapsed) → not-worth-touching.
2. **Library + Guide Autopsy** — knowledge layer (calm ambiance).
3. **First-experience arc reskin** — onboarding, first-check, debrief, verdict cards (already built
   in the OLD flat style — re-dress, copy stays per the approved arc spec).
4. **Sessions** (debrief list) · **Priorities** · **Readiness** · **Latency** · **Benchmark**.
5. **Settings / themes / ambiance controls** · **overlay** (minimal, in-game — must be ultra-light).
6. **Gaming Mode** (stays gated; design but don't unhide).

## 8. Foundation + build approach (for HQ)

- **Adopt shadcn/ui primitives** as the component base (React + Tailwind, MIT, fits the stack, no
  CSP issue) — replaces the hand-rolled `src/design/` primitives over time, or wraps them.
- **Parallelization:** HQ builds the *foundation* (design tokens/CSS vars, theme engine, the
  ambient-background component with the courtesy rule, the trust-switch, shadcn base) while Cowork
  keeps mocking individual surfaces; each surface drops into the built system.
- **Constraints unchanged:** no gates flip · remote fetch off · updater off · catalog frozen · no
  new capabilities/network · all assets bundled (CSP stays strict) · verification never skipped ·
  reduced-motion honored on every animation · the courtesy rule is mandatory, not optional.
- This is a large but fully reversible **frontend reskin** behind unchanged logic. No mutation
  surface, no backend behavior change.

## 9. Open aesthetic questions for the owner (on return)

1. Lock the pulse-C, or try the Pulse × Power cross-breed first?
2. Hyperspeed intensity — current is mid; push harder or keep?
3. Vanishing point — top-right (current), center (full tunnel), or behind the ring (frames fly out
   of your posture gauge)?
4. Theme names — Velocity/Nova/Ember, or rename?
5. Default ambiance per surface — confirm Hyperspeed (home) / Radar (check) / Dark Veil (calm)?
6. Pin this kernel now so HQ starts the foundation in parallel?
