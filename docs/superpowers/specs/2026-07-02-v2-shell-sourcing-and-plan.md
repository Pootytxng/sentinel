# V2 shell — originality sourcing + build plan (2026-07-02)

> Owner approved the V2 mockup direction (`docs/mockups/ui-v2-product-shell.html`) with a
> standing amendment: **no default-AI-template look** ("AI slop") — source distinctive assets
> from outside (he named React Bits + Awwwards-realm). Memory: `anti-ai-slop-originality-mandate`.
> Governing vision: `2026-07-02-owner-vision-directive.md`.

## Sourcing rules (laws applied)

- **React Bits** (reactbits.dev, MIT + Commons Clause): free for commercial use in a product;
  the clause only bars reselling the components themselves — we ship an app, compliant. Use
  the **TS-CSS variants** (no Tailwind in our stack). Vendor code into `src/design/vendor/`
  with license header retained + `THIRD_PARTY.md` credit line. Its Texture Lab (noise/dither)
  may generate texture assets — exports are ours to use.
- **Awwwards-realm sites: principles + inspiration ONLY** — all-original law: never clone
  proprietary visuals; extract technique, redraw ours.
- **Fonts (the fastest slop-killer):** bundle **Geist Sans + Geist Mono** (OFL 1.1, free to
  embed) — the literal type system of the owner's cited Vercel reference, and instantly
  distinct from default system/Inter builds. Mono-only-for-machine-values law unchanged.
- Zero-budget: everything above is $0. Any paid asset (e.g. a display face) = owner gate.

## Curated pick list (from the actual React Bits catalog, ~110 scanned)

**Adopt (serious, restrained, matches trust identity):**

| Component | Where it lands in Compy |
|---|---|
| `DecryptedText` | Verdict lines resolve character-by-character when a scan completes — the "measurement arriving" moment. Sparingly: verdicts only. |
| `CountUp` / `Counter` | Stat values (fps avg, ledger count, wins) land with weight. Replaces AnimatedNumber where better. |
| `GridScan` / `Radar` | Scan-in-progress backdrop — literally our semantics (checks sweeping the system). One place: active-scan state. |
| `DotGrid` / `DotField` | Quiet technical backdrop for the shell (replaces flat panels behind the hologram stage). Barely-there opacity, §8b motion caps. |
| `Dither` / `Noise` / `Grainient` | Texture pass — the handcrafted feel; kills the flat-gradient AI look. Static or near-static. |
| `ElectricBorder` or `BorderGlow` | ONE sanctioned use: the hologram hero stage frame. Nowhere else. |
| `SpotlightCard` / `GlareHover` | Hover treatment for priority/finding cards — tactile, not flashy. |
| `MagicBento` | Home stats layout treatment (bento rhythm for the Stat column). |
| `GooeyNav` or `PillNav` | Rail active-state treatment — evaluate both on the dev build, pick one, delete the other. |

**Rejected (gaming-RGB / novelty — violates the brief):** Ballpit, Balatro, Hyperspeed,
Galaxy, Lightning, LiquidChrome/LiquidEther, Plasma, PrismaticBurst, LetterGlitch,
GlitchText, EvilEye, Crosshair, BlobCursor/GhostCursor/ImageTrail (custom cursors), Lanyard,
FlyingPosters, MetallicPaint, Iridescence, FaultyTerminal.

**Not needed:** ModelViewer (our hologram is custom WebGL and stays ours — it's the one
asset the owner singled out as best-in-app; improve per the vision directive, never replace
with a stock viewer).

Deps note: preferred picks are CSS/canvas-light; anything pulling gsap (free) or three
(already bundled) is fine; no new paid or heavyweight deps without flagging.

## Stage tracker (one stage = one session = its own commit; tick when live-verified)

- [x] **V2-1 Foundation** — 2026-07-02: Geist bundled (variable woff2 + OFL) · tokens-v2.css
      (mockup palette, faint nudged #5c6478→#626a80 for the 3.0 floor) · 12 components vendored
      (Radar over GridScan — face-api.js dep; DotField over DotGrid; Noise+Grainient over Dither;
      ElectricBorder; both nav candidates) · deps gsap/ogl/motion · compy_v2 flag default-OFF +
      Settings preview toggle · 22 guards (scoping=byte-identity, contrast, Geist-via-tokens-only,
      vendor license hygiene).
- [x] **V2-2 Shell** — 2026-07-02: rail (5 rooms · WORKING 1–5 digit hints · wordmark+version ·
      zero-outbound + "reversible · ledger N" footer) + 46px topbar (room title · plain-English
      crumb · real `get_build_stamp`) + RoomShell/ForwardDoor primitives with the v2 skin (slot
      order verdict→action→body→quiet→door + DOOR_MAP pinned literally in room-shell.test.tsx;
      rooms adopt from V2-3). Classic and V2 paths render the SAME shared room elements (no drift).
      Mockup's Ctrl-K box deliberately ABSENT (CommandPalette parked — no fake affordances).
      shell-v2.css fully [data-v2]-scoped + color/font-literal guards. GooeyNav/PillNav rail eval
      still open — the restrained mockup treatment shipped; both stay vendored, decide by V2-9.
- [x] **V2-3 Home** — 2026-07-02: HomeV2 on RoomShell (verdict=postureLine via DecryptedText,
      measured checks line, Re-run check action, door from DOOR_MAP) · hologram hero stage
      (REAL RigHologram, ElectricBorder frame — its ONE sanctioned use, measured part-tags
      GPU/CPU/RAM/Storage off existing read-only probes, scan sweep renders ONLY while checks
      run, reduced-motion = static frame/no sweep/plain numbers) · stat column (SpotlightCard +
      CountUp on measured values: last session + spark, active changes, ledger) · priorities
      card (top-3 limiters, honest clean/skeleton states, rows route to Optimize) · Cards
      toggle + Setup&Tour kept (parity). home-v2.css added to the scoping/no-literal guards
      (@keyframes allowed only with v2- prefix — inert flag-off). MagicBento/GlareHover passed
      over for the restrained stat treatment; still vendored, revisit by V2-9. Manual-parts
      form + fan nudge deliberately not in the hero (detail-inspector candidates, V2-9 call).
- [x] **V2-4 Optimize** — 2026-07-02: OptimizeV2 on RoomShell — verdict = pure
      optimizeVerdict (safe/one-click/eligible/not-applied count, honest loading state,
      branch-proper copy pinned "(s)"-free) via DecryptedText · measured line = real check
      counts + evaluated-catalog size · primaryAction = the "N active · undo" chip
      (navigation-only, lands on Applied — the council rollback-one-glance rule, v2 skin) ·
      segments (Fixes / Gaming Mode when gated-on / Applied) with land-on-Applied preserved ·
      side-pile expander moved into RoomShell's quiet slot (Fixes only) · door from DOOR_MAP
      (fix → Monitor). Check/Fix/GamingMode compose VERBATIM (same props, same audited
      handlers, zero new mutation paths); their re-skin is a --ix-*→--v2-* token re-point
      scoped to the room element — the exact mechanism the five themes use, classic CSS/DOM
      untouched. Non-merged escape hatch (compy_optimize="0") falls through to classic panels.
      Keepalive split per path so classic Optimize never mounts hidden under v2.
      optimize-v2.css added to scoping/no-literal/token-font guards; +15 tests.
- [x] **V2-4b Optimize IA fix** — 2026-07-03, per `2026-07-03-owner-optimize-feedback.md`.
      Mechanism: `v2Ia` props on Check/Fix (absent = classic byte-identical, test-pinned) + the
      regrouped body. One-mention law: Check drops the pending-safe-recs + applied-changes
      aggregate limiters under v2Ia; a drifted rec renders ONCE in "Applied — turned off outside
      Compy" (state + won't-stick note ON the row, same audited onToggleRec), never again under
      "Ready — one click, reversible"; guided recs elevate to the open "Needs your call" group
      (live-probed: Game Mode rows = 1). Setup summary → Applied segment (record with the
      records — primary placement per the ruling; reads right on the dev build, no Home
      fallback needed). Driver freshness renders ONLY when something stale was measured (pass
      state returns with the hologram part-tap inspector when that layer lands). Upgrade path
      suppressed in Check and re-rendered by OptimizeV2 BELOW the groups as the labeled-early
      card ("early — being developed", copy-only links, truthful no-affiliate line). Check's
      settled subtitle + Fix's subtitle suppressed under v2Ia (RoomShell verdict is the ONE
      summary — clears V2-9 punch (d) for this room). Exactly ONE quiet expander (live-probed).
      +14 guards in optimize-v2-ia.test.tsx incl. classic-render pins. Zero src-tauri diff.
- [x] **V2-5 Monitor** — 2026-07-03: MonitorV2 on RoomShell — verdict = pure monitorVerdict
      (last-session answer graded by the SAME shortVerdict the debrief uses; honest empty state;
      "(s)"-free pinned) via DecryptedText · sub = real duration/samples + the F3 "live estimate,
      not a benchmark" honesty framing · measured = sessions-on-record count + the literal 1 Hz
      demand-gated poll cadence · deliberately NO primaryAction (capture/overlay live with their
      tiles — one-mention law outranks filling the optional slot) · Basic/Advanced + Live-first
      semantics identical to classic (Play/MonitorBasic/TuningPresets compose VERBATIM, same
      audited read-only commands, zero new IPC) · quiet slot = advisory Tuning-presets expander
      (Advanced only; TuningPresets exported with additive `bare` prop — classic byte-identical,
      test-pinned) · door from DOOR_MAP (play → learn). One-mention: sessions-hero top row yields
      to the room verdict under v2; MonitorBasic's last-session DOOR keeps its label
      (live-reviewed — hiding it read as an empty bar). Token re-point CSS scoped to
      [data-room="play"], added to scoping/no-literal/token-font guards; +17 tests. Zero
      src-tauri diff. V2-9 punch candidate: measured line "N sessions on record" vs History &
      trends "N sessions kept" state the same count twice.
- [ ] **V2-6 Blackbook**
- [ ] **V2-7 Lab**
- [ ] **V2-8 Journey doors + tour alignment**
- [ ] **V2-9 Consistency pass** — punch list (Cowork visual audit of v2-3 shot):
      (a) hologram stage hint text still marginal over the ring glow at bottom-left — needs a
      stronger backdrop or move above the stage floor; (b) Trust-ledger card: long mono task ids
      wrap with a tilde artifact ("compatibility~appraiser") — truncate w/ ellipsis + title attr;
      (c) "1 safe one-click tweak(s) not applied" — "(s)" pluralization violates plain-language
      bar; branch the copy properly. [CLEARED by V2-4b — copy pinned "(s)"-free]
      (d) [from V2-4b shot, Cowork audit] Optimize: dead vertical band around the floating
      Re-run button + residual gap under the segmented control (CC self-noted) — one header
      rhythm; (e) chip grammar "1 need attention" → "1 needs attention"; (f) "ready" means two
      things on one screen (verdict counts fixes, chips count checks) — rename one; (g) verdict
      says "ready to apply" when the only action is a drifted re-enable — verdict must describe
      the state the body actually shows. (d, from V2-4: the Optimize room now stacks THREE summary
      lines — the RoomShell verdict + Check's embedded scan verdict ("N things worth a look")
      + Fix's own "N thing worth a look" header; consolidate so the room verdict is the ONE
      answer line and the embedded surfaces demote to detail.)
- [ ] **V2-10 Dedup (after owner default-ON verdict):** delete the classic shell/room paths +
      the losing nav candidate (GooeyNav vs PillNav) + retire `compy_v2` — same ritual as P4.
      Known debt, deliberately carried during the flag-gated rollout (Cowork audit note, V2-2).
- [ ] **FUTURE (own spec, post-V2): Upgrade-path engine** — owner 07-03: current Amazon/Newegg
      links are a placeholder, not the feature. Design properly: per-rig evidence-gated upgrade
      verdicts (what limits YOUR rig, measured), honest copy, copy-only links until Receipts
      Phase-C affiliate work arms. Cowork specs before any build.

## Build plan (re-scopes P6; P4 dedup still lands FIRST)

Flag: `compy_v2` — DEFAULT OFF, Settings preview toggle, flag-off byte-identical, the proven
P1–P5 pattern. Owner sees every commit live via `npm run tauri dev`.

1. **V2-1 Foundation:** bundle Geist fonts · tokens-v2 (mockup palette: bg #0a0c10, panel
   #10131a, hairlines, accent #a78bfa family) · vendor kit (`src/design/vendor/` with the
   adopt-list, license headers, THIRD_PARTY.md) · guards (contrast, literal, mono-usage
   extended to v2 tokens).
2. **V2-2 Shell:** rail + topbar per mockup (kbd hints, zero-outbound footer, stamp) +
   RoomShell primitive carrying the v2 skin (verdict → primary action → body → quiet →
   forward door).
3. **V2-3 Home:** hologram hero stage (bigger, ElectricBorder frame, measured part-tags,
   scan sweep tied to real check activity) + bento stats + priorities card + door.
4. **V2-4 Optimize** · **V2-5 Monitor** · **V2-6 Blackbook** · **V2-7 Lab** — one room per
   commit, mockup as contract.
5. **V2-8 Journey doors + tour alignment** (absorbs old P6 §2/§4) · **V2-9 consistency pass**
   (old P7).

Hard lines every commit: zero src-tauri diff · TrustSwitch + audited handlers untouched ·
honesty law (DecryptedText/CountUp render measured values only, never invented) · §8b motion
caps + reduced-motion freezes · hologram retained and improved, never demoted.

## Hologram improvement track (the owner's favorite thing — first-class, not a footnote)

Owner: "the coolest single thing in the app, and even that could probably be improved."
V2-3 carries: bigger dedicated stage · measured statuses projected onto parts · scan sweep
during live checks · part-tap → detail inspector. Further ideas (V2-10 candidates, owner
taste): subtle parallax on mouse, thermal-tint mode from real sensor bands, session-replay
"ghost" overlay from Monitor data. All honesty-gated: the model never displays a value that
wasn't measured.
