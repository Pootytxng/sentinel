# 🔬 Honesty audit — the tweak-debunk corpus (`src/data/tweaks.json`, 84 entries)

> **Owner: the `honesty` lane.** The myth-debunk corpus is Compy's core honesty differentiator (the
> snake-oil-buster). Every entry's `what`/`why` text AND its `verdict` (real / placebo / risky) is
> adversarially fact-checked against authoritative web sources (default-skeptical, try to *refute*).
> This file is the **resumable ledger** for the multi-batch pass — each tick appends a batch, so an
> API-halt never loses progress. Method: [[knowledge-corpus-factcheck-audit]]. Discipline: auto-fix
> CLEAR factual errors (esp. fabricated/unmeasured numbers — Compy's cardinal sin); hand
> verdict-calls + voice/nits to `content`/owner (taste = owner territory). Never edit from memory —
> web-verify.

Corpus: **84 entries** — 28 `real` · 17 `risky` · 39 `placebo`.

---

## Batch 1 — the 28 `real` verdicts (audited 2026-06-25, 3 adversarial sub-agents, web-verified)

**Headline: CLEAN for the brand — zero false-`real` verdicts, zero blocking factual errors.** All 28
"this tweak genuinely helps" calls are sound. One fabricated-number honesty violation fixed; the rest
are minor precision / wording handed to `content`/owner.

### Fixed by honesty (factual — fabricated/unmeasured number, Compy's cardinal sin)
- **`sysmain-superfetch`** — the `why` claimed *"Frees 0.5–1.5 GB on SSD/NVMe systems."* That specific
  GB range is **fabricated/unsourced**, and it mischaracterizes SysMain's RAM as recovered capacity —
  it's *reclaimable standby cache* Windows already releases on demand. Rewritten to drop the invented
  number and state the real effect (less background disk activity / steadier RAM use), verdict kept
  `real` (storage-gated, harmless). Fixed this tick.

### Handed to `content` / owner (verdict-calls + voice — NOT honesty's to unilaterally rewrite)
- **`power-plan`** (verdict `debatable`) — *"Real responsiveness win mid-game on many rigs"* overstates
  a narrow benefit: independent benches show High/Ultimate mostly helps **1% lows in CPU-bound titles**,
  ~zero in GPU-bound/balanced ones. Suggest softening "win on many rigs" → "frame-time consistency in
  CPU-bound titles." (src: xda-developers Ultimate-Performance benchmarks)
- **`shader-cache-size`** (verdict `debatable`) — *"real against shader-comp stutter, especially in UE5"*
  is **misattributed**: a bigger driver cache helps *re*-compiles (post-update), not first-run UE5
  stutter, whose real fix is the engine's PSO precaching (which the entry's own next line names). Also
  the numeric "unlimited / 10 GB" knob is **NVIDIA-specific** (AMD cache has no size limit). Suggest
  re-scoping to recompile-stutter + noting the vendor specificity. (src: Unreal Engine tech-blog; AMD)
- **`fullscreen-optimizations`** (minor) — "compositor you turn off" is a loose model; FSO is really the
  **flip-vs-blt presentation path** (DWM always composites on modern Win10/11). Verdict sound.
- **`low-latency-mode`** (minor) — "Ultra only helps above refresh" → should be **"when GPU-bound /
  GPU-saturated"** (the real condition). Verdict sound.
- **`upscaling-quality`** (minor) — "LOWER latency than native" is broadly true but over-generalized;
  weaker in CPU-bound titles. Verdict sound.
- **`render-scale`** (minor) — "more frames, every time, on every GPU" is absolute; only true when
  GPU-limited (the entry immediately qualifies it). Verdict sound.
- **Nits** (wording/taste): `fan-curves` ("safest tweak that exists" superlative + unmentioned
  fan-noise trade-off) · `nvidia-reflex` ("click-to-pixel" vs NVIDIA's "click-to-display") · `fps-cap`
  ("~3 below" is a starting heuristic, not a fixed rule) · `mpo-disable` (Win11 24H2 registry-method
  recency caveat) · `laptop-plugged-in-fps` ("a third or more" undersells the real 30–50% swing).

### Verified CLEAN (no issues)
`game-mode` · `msi-mode` · `xmp-expo` · `rebar-sam` · `vrr-sync-stack` · `frame-generation` ·
`game-dvr-off` · `hags` · `diagtrack` · `startup-cleanup` · `driver-updates` ·
`nvidia-prefer-max-performance` · `dual-channel-ram` · `instant-replay-fps` · `set-refresh-rate` ·
`lower-graphics-settings`.

---

## Batch 2 — the 17 `risky` verdicts — **PENDING** (next tick)
## Batch 3 — the 39 `placebo` verdicts — **PENDING** (next tick)
