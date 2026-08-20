# Design

Visual system for Compy — the "Instrument" cockpit. Dark, precise, calm. This captures the
real tokens in `src/App.css` + `src/design/*`; treat the code as source of truth and keep
this in sync. Reskin work is **additive + reversible**: tokens layer on, attributes toggle
skins, dropping a layer returns the app to the prior look byte-for-byte.

## Theme

A **dark instrument cockpit** — graphite/near-black canvas, color reserved for controls and
live status, motion used as punctuation. Two stacked theming systems:

- **Legacy palette (`[data-theme]`):** Graphite (default) · Carbon Ember · Frost · Aurora
  Noir. Each overrides *only* color tokens; structure/motion/glow are shared.
- **Instrument layer (`[data-itheme]` on `<html>`, the current system):** **Midnight**
  (default — teal/blue brand) · **Violet** (neon purple) · **Crimson** (red) · **Emerald**
  (neon green) · **Hearth** "Warm Ember" (warm amber — LOCKED owner palette). Each tints a
  charcoal base toward its hue, sets a vivid accent + a complementary ambient-streak partner,
  and a dark hue-matched `--ix-accent-ink`. Sets the `--ix-*` tokens and re-points `--accent*`
  at the active theme. (Halfway was retired 2026-06-16 — read too close to Midnight.)
- **Cosmetic skins (reversible flags, default ON):** `data-living="on"`
  (living-instrument.css — material depth, glow on *live* surfaces only, entrance motion) and
  `data-dash-v2="on"` (dashboard-skin.css — premium telemetry-card treatment + accent
  hover-glow + tabular metric numerals). `data-committed` (bold Welcome hero) is default OFF.

## Color

OKLCH-adjacent hand-tuned hex. **Restrained strategy:** neutral surfaces, a single accent
for controls/active/key-numbers only — never decoration. Status has its own semantic ramp.

### Core palette (App.css `:root`, Graphite default)
- Canvas: `--bg #07080b`, `--bg-2 #0a0c11`
- Surfaces: `--panel #12151d` (1) · `--panel-2 #181c26` (2, insets/sparklines) · `--panel-3 #1f242f` (3, hover/elevated)
- Lines: `--border #242b39` · `--border-strong #313b4e` · `--hairline rgba(255,255,255,.06)`
- Ink: `--fg #eef1f7` · `--fg-2 #c4ccda` · `--muted #8b95a8` · `--faint #5d6679`
- Status: `--ready #46d98a` · `--attention #f5b740` · `--danger #f3716f`

### Accent
- Legacy default accent is blue `#6aa9ff`; the Instrument layer re-points `--accent` per theme:
  teal `#2ee6c0` (Midnight), violet `#b366ff`, crimson `#fb3b53`, emerald `#27e08a`, amber
  `#f0b878` (Hearth).
- `--ix-accent` = controls, active states, key numbers ONLY (never decoration). Each theme pairs
  it with `--ix-accent-2` (a complementary partner so the accent never reads monochrome), an
  `--ix-accent-text` light shade for label text, and `--ix-accent-ink` — a DARK hue-matched ink
  for labels ON bright accent fills (never white; contrast-guarded ≥4.5:1).
- **Legacy `--ix-*` alias block** (instrument.css `:root`): `--ix-border`/`--ix-line` →
  `--ix-glass-border`, `--ix-surface-2`, `--ix-mono` → `--font-mono`, `--ix-accent-wash` →
  `--accent-soft`, `--ix-bg-1` → `--ix-base`. These names were referenced without fallbacks but
  never defined (borders/fonts/backgrounds silently dropped); the aliases restore them, and the
  border-hygiene guard now fails the build if a fallback-less `var(--ix-…)` is undefined.
- Status soft-fill / line tokens in `tokens.css` (`--status-*-soft` at 12% alpha, `-line` at
  ~32%) — never gray text on a colored fill.

## Typography

- **One UI family:** `--font-ui` = Segoe UI Variable Display/Text → system-ui stack.
  Native, premium, offline-safe (no remote fonts). Mono: `--font-mono` = Cascadia / JetBrains
  / Consolas for telemetry readouts.
- Base size 14px; product register uses a **fixed rem-ish scale**, not fluid headings.
- Telemetry numbers render **tabular-nums** so live values don't jitter (dash_v2).
- `text-wrap: balance` on headings; status/labels are sentence case.

## Geometry & Spacing

- Radii: `--r-sm 7px` · `--r 10px` · `--r-lg 14px` · `--r-pill 999px`. Instrument cards use
  `--ix-radius 14px`.
- Page frame is **elastic**: `.app` pads `clamp(14px,2.4vw,26px) clamp(16px,3vw,36px)`,
  fills to `max-width:1600px` then centers (`margin-inline:auto`). Command Center Home runs
  full-bleed with its own shell.
- Layout law: flex for 1D, grid for 2D; responsive is **structural** (rail collapses:
  vertical column >1080px → horizontal strip 720–1080 → fixed bottom room-bar <720), not
  fluid type.

## Material & Elevation

- Base: `--edge` (inset top highlight), `--shadow-1/-2/-pop`.
- Living layer adds a deeper ladder (`--liv-elev-1/-2`, brighter `--liv-top` hairline,
  `--liv-glow`, accent-tinted `--liv-edge`) and glassy cards (translucent panel +
  `backdrop-filter: blur(7px) saturate(1.3)`) — glass is **purposeful here, not default
  decoration**. dash_v2 adds `--d2-card-*` (top sheen + hairline) and the signature accent
  **hover-glow**.

## Motion

- `--ease cubic-bezier(0.4,0.12,0.18,1)` (ease-out, no bounce/elastic). `--dur 160ms`,
  `--dur-slow 300ms`, `--dur-tap 90ms`. Hover lift `-2px`, press `translateY(1px)`.
- Motion **conveys state**: dial sweeps 0→real value on mount then holds the truth; glow
  lights only *live* instrument surfaces, never plain numbers; gentle card stagger on grids.
- **Reduced motion:** global reset in `tokens.css` kills animation/transition durations;
  living/dash_v2 effects degrade to static depth+glow. Never gate content visibility on a
  transition.

## Components

Shared primitives in `src/design/`: `Card` (`.ds-card`, `.ds-panel`), `Gauge`/dial
(`.ds-dial`, `.ds-dialval`), `Stat`, `StatusPill` (`.ds-pill` + status `.ds-dot`),
`Sparkline` (`.ds-spark`), `Icon`/`NavGlyph`, `Wordmark`, `ConfirmDialog` (themed, replaces
native confirm), `BackButton`, `Walkthrough`, `Term`/`WhatsThis` (inline Learn links),
`TrustSwitch`/`TrustCue`, `EmptyState`, `AmbientBackdrop`.

- Every interactive element carries default/hover/focus/active/disabled states; loading uses
  skeletons over content, not center spinners.
- **Side-stripe borders are banned** and now retired app-wide (2026-06-16 sweep) — status color
  tints the FULL border via `color-mix` (or a background tint for inline callouts), never a
  `border-left: 3px` stripe. Enforced by `border-hygiene-guard.test.ts`.
- Affordance honesty ("doorknob law", `doorknob-guard.test.ts`): if it looks interactive it
  is, and vice-versa.

## Navigation / IA

One rail, app-wide, from `src/design/homeRail.ts` (parity-guarded). The shipped rail (`railFor`,
`compy_lab_ground` DEFAULT ON) is **Health · Live · History · Test** + Settings gear + Export
action — the old **Check** and **Fix/Optimize** rooms fold into the **Test room's Optimize station**
and drop off the rail. The persisted nav **ids** stay `home/check/play/fix/learn/lab` (renaming an id
would orphan stored history), so the **labels** the user reads (Health, Live, History, Test)
deliberately differ from their ids — never speak an id as a room name. The label a user actually
reads comes from `common.rail.<id>` in `src/i18n/locales/`, with `homeRail.ts` as its English source;
`src/design/rail-label-locale-guard.test.ts` fails the build if those two ever disagree. Non-default classic/merged rails stay
reachable via the `compy_lab_ground="0"` failsafe. Never teleports — the rail is the only location
change; detail expands in place. Surfaces live in `src/surfaces/`.

## Guards (keep these green)

`theme-contrast.test.ts` (WCAG incl. ink-on-accent, all 5 themes) · `theme-literal-guard.test.ts`
(no bare theme hexes; use tokens/color-mix) · `border-hygiene-guard.test.ts` (no undefined
fallback-less `--ix-*` tokens; no side-stripe idioms) · `doorknob-guard.test.ts` ·
`homeRail.test.ts` (rail parity) · `sweep-guard.test.ts` (one shimmer). Polish must keep all
green and must not hard-code colors that should be tokens.
