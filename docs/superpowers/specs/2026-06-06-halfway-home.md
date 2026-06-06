# Halfway Home — owner course-correction pass (theme · navigation · icon · hotfixes)

*2026-06-06, Cowork, from the owner's live dev-build sweep. Three verdicts, verbatim spirit:
(1) "it doesn't feel intuitive to navigate… a door to open a box to find another box in another
box — make it intuitive not complex." (2) The neon directions were "a bit overbearing… stick to
using them for reference… dial down the extremities. Bring us half way back home." (3) "I liked
the heartbeat on the inside of the C rather than the outside." Plus two screenshot bugs: the
footer mess and white-on-mint button labels. This spec supersedes the green-tinted Instrument
palette and the route-to-classic-tab navigation; everything else (surfaces, copy locks, flags,
honesty mechanics, single-shimmer law) stands.*

---

## 0. Hotfixes — ship first, independent of everything below

1. **Footer cleanup.** Remove from the global footer: all nine `compy_*_v2` "New … (preview)"
   checkboxes (they already live in Settings → New look (preview) — that is their ONLY home),
   the "Re-run guided setup" / "Re-run check" links (re-home: Settings, plus Check already has
   re-run), and the standing honesty line ("Compy never changes anything…") — re-home that line
   to where approval actually happens (Fix surface header / consent moments), not global chrome.
   Footer carries the version, right-aligned, nothing else (or delete it if empty). Record in
   build-order governance as an owner-directed re-home, not a silent loss.
2. **Ink-on-accent button fix + guard extension.** Button/pill labels on bright accent fills use
   dark ink (near-base, e.g. `#06231c` on teal), never white. Sweep all accent-filled controls
   (Roll back, Apply, CTAs). Extend `theme-contrast.test.ts`: add a label-on-accent check —
   `--ix-accent-ink` (new token) vs `--ix-accent` must clear 4.5:1 per theme. The guard's blind
   spot (it tested text-on-backgrounds only) is what let white-on-mint ship.

## 1. Navigation law — NAVIGATION NEVER TELEPORTS

**The rail is the only thing that changes your location.** Inside a home, every click reveals
detail in place; closing it restores exactly where you were. No control inside a page may switch
the active tab. (Kills the door→box→box feel; Sarah always knows where she is.)

- **Play:** session rows expand IN PLACE (accordion) into the full debrief — embed the existing
  `SessionDebrief`/comparison cluster (the extraction previously deferred is now GREENLIT by
  owner UX verdict; locked copy moves untouched). The live-monitor card and overlay controls
  stay as built. The route-to-Sessions behavior dies.
- **Lab:** Benchmark and Latency render as full inline sections ON Lab (each a collapsible
  section: summary header + expand; deep UI embedded, not linked). The route-to-classic-tabs
  behavior dies.
- **Check:** already fully inline — it is the model; no change.
- **Fix / Learn / Home:** audit against the law. Cross-home jumps (e.g. refuse-pile → Library
  autopsy) are allowed ONLY when content genuinely lives in another home, and must read as
  deliberate travel ("Open in Learn"), never a surprise relocation.
- **Rail:** icon + name ALWAYS visible (no mystery icons). Once Play/Lab embed their content,
  the hidden-but-navigable classic-tab hack dies: when flags are on, absorbed classics cease to
  be destinations; `railTabs`/`visibleTabs` filter simplifies accordingly.

## 2. Theme — "Halfway Home" (replaces the green-tinted palette; architecture unchanged)

Rule: **walls neutral, color on the controls, motion as punctuation.** Keep `data-itheme` +
tokens + contrast guard; replace the default theme's values:

- `--ix-base: #0b0c10` (neutral charcoal — ZERO green tint anywhere in surfaces/glass)
- text: `--ix-text-1: #f2f3f7` · `--ix-text-2: #b8bcc8` · `--ix-text-3: #828896`
- `--ix-accent: #2ee6c0` (brand teal — controls, active states, key numbers ONLY)
- `--ix-accent-ink: #06231c` (labels on accent fills — new token, guard-checked)
- `--ix-accent-2: #7c9cff` (soft cool blue — gradient partner so teal never reads monochrome)
- Headings may carry a slow subtle gradient (near-white → soft teal → soft blue, ~9s ease).
- Ambient: at most ONE whisper aurora pair (teal+blue radials ≤8% alpha, blur ~70px, slow
  drift) on Home; other surfaces Calm/static. Hyperspeed streaks are RESERVED: scan running,
  scan finale, measured-win moment. Single-shimmer law extends to a single-glow law (max one
  glowing element per view).
- Comfort dials: body text ≥13px, looser paddings, borders ≤ rgba(255,255,255,.08–.10).
- **The radar is RETIRED** (owner: "wtf is the submarine radar"). The scan visual in the shared
  FirstCheck/Check component becomes a **light sweep**: a soft beam passes across the streaming
  rows, findings tick in as it passes, one streak burst as the verdict lands. Locked arc copy
  unchanged — only the visual metaphor swaps. Blips/rows stay real data.
- Old Velocity/Nova/Ember values are superseded. Keep the theme picker; slots become:
  **Halfway (default) · Midnight (blue-leaning variant) · Hearth (the warm-cozy variant the
  owner asked to keep — same neutral walls, amber/soft-orange accents — port later, not this
  pass).** Contrast guard (incl. new ink check) validates every slot; owner live-tunes hexes in
  Settings and final values get locked here.

## 3. Icon — heartbeat inside the C

Master SVG updated in repo (this commit): pulse now `352,512 420,512 458,430 514,598 558,468
604,512 668,512` (stroke 40) — fully contained in the C's bowl, ending at the mouth; tile
gradient neutralized (`#101216→#0a0c10`, green tint removed). Regenerate the icon set via the
existing pipeline + ICO encoder. **Owner override (2026-06-06): the C-only small sizes are
RETIRED — "the plain C is so plain." 16/24px now use the dedicated small-size cut at
`assets/pulse-c-icon-small.svg`:** one bold beat instead of three (`376,512 448,512 512,392
568,632 616,512 680,512`, stroke 108, brightened `#b9ffe8`), C stroke thickened to 136, no
under-glow, no tile border — simplify-and-thicken so the heartbeat survives the taskbar.
32px+ carry the full three-beat master. `pulse-c-icon-c-only.svg` is retired from the
pipeline (keep the file for reference). In-app logo usages pick up the master mark.

## 4. Sequencing + acceptance

Order: §0 hotfixes → §1 navigation (theme-independent, biggest UX win) → §2 theme tokens →
§3 icon regen. Each its own revertable commit-train; existing flags cover all of it; zero new
IPC; copy locks untouched throughout.

- [ ] Footer = version only; toggles/links/honesty line re-homed; governance line recorded.
- [ ] No white-on-accent labels anywhere; guard fails on label-on-accent < 4.5:1.
- [ ] Play row → debrief expands in place (locked copy intact); Lab sections inline; no
      in-page control switches tabs; rail labels always visible; classic-tab hack removed.
- [ ] Theme: zero green-tinted surfaces; tokens per §2; guard green incl. ink check; streaks
      appear ONLY in scan/win moments; reduced-motion clean.
- [ ] Icon: dev-build taskbar/titlebar show the inner-pulse mark; 16/24 layers carry the
      single-beat small cut (pulse visible at taskbar size — owner's eyes are the judge).
- [ ] `npm run tauri dev` — owner drives: nav feels like rooms not hallways; theme reads
      "comfortable, alive, not eerie"; icon thumbnail keeps the heartbeat.
