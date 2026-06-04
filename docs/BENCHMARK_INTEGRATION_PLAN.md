# Benchmark — Integration Plan (HQ merge contract)

**Status: MERGED DARK (2026-06-03).** The benchmark engine merged into `main` on 2026-06-03 — compiled
but **unwired** (`mod benchmark;` only, no IPC command, no tab; nothing user-facing changed). This doc is
the contract HQ and the benchmark lane both build against so that, when the benchmark is wired up, it does
so **cleanly and without betraying Sentinel's identity.** No code here — this is the seam + the rules.

> **PURPOSE REALIGNED 2026-06-03 (owner).** The original *"scoring / cosmetic-reward + UserBenchmark-style
> leaderboard"* framing is **dead.** The benchmark's soul is now a **scientific instrument with an undo
> button**: **Measure → Change → Re-measure → honest verdict**, with real per-tweak measured deltas and an
> explicit **"no measurable change"** when a delta doesn't clear the run-to-run noise floor (default 3%).
> **Every mechanic in this doc still holds** (gated tab, own `benchmark.json`, network-only-in-Rust,
> no-mutation, additive own-tab → Decision A preserved) — **only the purpose changes.**

**What the benchmark is (owner-confirmed 2026-06-03):** a **measured-efficacy instrument** in **its own
gated section** — it benchmarks the rig (CPU/RAM/GPU/disk, real runners), then proves whether a change
actually helped by re-measuring and reporting an honest verdict (**Improved / No measurable change /
Regressed**). A quiet **"performing-to-spec / underperforming" health summary** is kept (ranking
stripped). The former leaderboard is reframed to **opt-in, anonymized measured-efficacy data** — "on rigs
like yours, this tweak improved X%" — not a vanity score ranking. **No cosmetic-reward grind.**

---

## TL;DR

- **The merge is the easy part.** "Its own section" is the clean path: the benchmark slots in as a
  **gated tab**, exactly like Gaming Mode did — new files, a default-off gate, and it **never touches the
  honest command-center hero.** Decision A (de-gamified `SystemPosture`) survives untouched because the
  efficacy verdict + health summary live *inside* the Benchmark tab, not in the global hero. That's a
  conflict-free additive merge. *(Engine merged dark 2026-06-03; tab not yet wired.)*
- **Cross-user efficacy sharing is the one real decision.** Pooling anonymized measured-efficacy data
  across users needs three things Sentinel has **never** had — **network egress, an (anonymous) identity,
  and a server someone runs.** That crosses the **local-only / no-account / no-telemetry** line the EULA,
  `PRIVACY.md`, the monetization story, and the `/security` audit are all built on. Not a blocker — a
  deliberate product decision. Done as a **strictly opt-in, anonymous, Rust-isolated** feature, the
  local-only promise stays intact for everyone who never opts in.

---

## 1. What merges cleanly (the additive 90%)

The benchmark **tab** reuses the established gated-section seam — no `App.tsx` restructuring:

- **Tab wiring** (mirror the Gaming Mode precedent):
  - Add `"Benchmark"` to the `Tab` union — `src/App.tsx:167`.
  - Add a `SECTION_META["Benchmark"]` entry (label + an inline stroke icon) — `src/App.tsx:169`.
  - Gate it in `visibleTabs` behind a backend `benchmark_enabled()` command, the same way
    `gamingEnabled` gates the Gaming tab — `src/App.tsx:810-821` / the `invoke("gaming_mode_enabled")`
    effect at `src/App.tsx:656-658`. **Ships dark** (gate returns `false`) until it's ready, just like
    `gaming_mode_gate()`.
  - Render `{activeTab === "Benchmark" && <BenchmarkSurface />}` alongside the others — `src/App.tsx:939`.
- **New files only** for the surface: `src/surfaces/BenchmarkSurface.tsx` + `src/surfaces/benchmark.ts`
  (pure helpers + tests), plus a Rust module `src-tauri/src/benchmark.rs`. New files don't conflict.
- **Do NOT touch** `CommandHero` / `deriveSystemPosture` / `src/surfaces/system-posture.ts` — the honest
  hero stays score-free. This is what keeps Decision A intact while the score lives in its own room.
- **Separate data store.** Benchmark results/rewards persist to their **own** JSON under
  `sentinel_data_dir()` (e.g. `benchmark.json`) — **never** the Trust Ledger (`history.json`) or
  `sessions.json`. Same isolation discipline Gaming Mode used (`gaming-session.json`).
- **No cosmetic-reward grind.** The vanity score / tiers / unlock layer is dropped (purpose realignment).
  The tab surfaces a **measured verdict** + an optional local **health summary**; any cosmetic flourish
  (if ever added) must reuse the existing local theme system (`THEMES` / `applyTheme` / `localStorage`,
  `src/App.tsx:531-564`) and **store locally** — never gate value behind the network being up.

## 2. The one real fork — cross-user efficacy sharing (network + identity + a server)

Plain-language: pooling **measured-efficacy data across users** ("on rigs like yours, this tweak improved
X%") requires the same three firsts a leaderboard would — they're properties of *any* cross-user data,
vanity or not:

1. **Network.** The app uploads your anonymized efficacy delta and downloads the aggregate. Today Sentinel
   makes **0** outbound calls (a hard invariant `/security` checks for). This is the first one ever.
2. **An identity.** Even anonymous aggregation needs at least a **stable anonymous token** (dedupe, abuse
   control). Today: no account, by design — and the design here stays no-handle, no-PII.
3. **A server someone runs.** To store, aggregate, and serve the efficacy data — infra to host, secure,
   pay for, and **moderate.** Open aggregates get **poisoned with spoofed submissions**, so it needs
   submission-integrity or the data is noise.

**This is a product decision, not a bug.** The clean way to add it without betraying the identity:

- **Strictly opt-in.** Default = **fully local, zero network.** The local-only promise holds for everyone
  who never opts in. Only an explicit *"Share efficacy data"* action sends anything.
- **Minimal, anonymous payload.** The measured efficacy delta (e.g. "tweak X: +Y% GPU throughput,
  confidence: clean") + a hardware *class* + an anonymous token. No handle, no PII, no telemetry, no
  system inventory. Documented exactly, in plain language, at the opt-in.
- **Network isolated to Rust, behind one bounded command.** Put the call in `benchmark.rs` (`reqwest`),
  exposed as e.g. `submit_efficacy` / `get_efficacy_aggregate`. The **webview never gets a network
  primitive**, so:
  - `capabilities/default.json` stays tight — **no `http:` / `shell:` / `fs:` permission added.**
  - the production **CSP `connect-src 'self' ipc:` stays as-is** — CSP only governs *webview* fetches; a
    Rust-side call isn't one. (See `src-tauri/tauri.conf.json` — do not widen it.)
  - The single invariant that genuinely changes: **the Rust core gains its first outbound HTTPS call** —
    gated, opt-in, isolated to this module. That's the line to cross deliberately, with eyes open.
- **Submission integrity.** Sign submissions (reuse the repo's existing `ed25519-compact` pattern) and/or
  server-side sanity bounds — otherwise the aggregate fills with fakes.

## 3. Merge mechanics (HQ runs this when the benchmark is done)

- The benchmark lane finishes in its worktree off `main`; **HQ** performs the **ff-only guarded merge**
  (branch-name + clean-tree + origin-sync checks), per `docs/PARALLEL_WORKTREE_OPS.md`. Only HQ merges
  `main`.
- Because it's **additive new files + the gated-tab seam**, the merge should be conflict-free against the
  de-gamified `main` **as long as the lane honors §4.**

## 4. Contracts the benchmark lane must honor (so the merge stays smooth)

A checklist to build against:

- [ ] Benchmark / efficacy-verdict / health-summary UI lives **only** in the Benchmark tab. **Never**
      touch `CommandHero` / `SystemPosture` / the global hero. *(Preserves Decision A.)*
- [ ] Ship behind a **default-off `benchmark_enabled()` gate** (dark until ready) — Gaming Mode precedent.
- [ ] **New files** for the surface + a new Rust module; reuse the `Tab` / `SECTION_META` / `visibleTabs`
      seam — don't restructure `App.tsx`.
- [ ] **Separate data store** (own JSON) — not the Trust Ledger, not `sessions.json`.
- [ ] **No Windows mutation** in the benchmark path. Running a benchmark ≠ changing settings. If a
      benchmark wants "apply best settings, then measure," it must go through the **existing typed
      apply/rollback path** (`APPLIABLE_REC_IDS`) — never a new mutation primitive.
- [ ] **Network (if any) only in Rust, opt-in, behind a bounded command.** Do **not** add `http:` /
      `shell:` / `fs:` to capabilities; do **not** widen the production CSP.
- [ ] **No cosmetic-reward grind** (dropped in the realignment); any optional local flourish reuses the
      existing theme mechanism and stores locally — never gate value behind the network.
- [ ] **If cross-user efficacy sharing ships:** update `PRIVACY.md` + `EULA.md` with an *"optional
      anonymized efficacy sharing"* section, and re-baseline the `/security` "expect 0 network" rule to
      *"0 unless efficacy sharing explicitly opted in,"* documented.

## 5. Owner decisions

**Settled 2026-06-03 (owner):**
- **Soul = measured efficacy**, not a vanity score. Significance threshold = conservative **3%** noise
  floor default (`DEFAULT_NOISE_FLOOR_PCT`; retune later).
- **Health summary = KEEP** as a quiet "performing-to-spec / underperforming" glance (ranking stripped).
- **Leaderboard = opt-in anonymized measured-efficacy data** (confirmed — not a vanity ranking).
- **Local-first.** Default = fully local, zero network; the efficacy-sharing pool is a later opt-in
  bolt-on, never a v1 gate.

**Still open / HQ-gated:**
1. **PresentMon / `ARCHITECTURE_LOCKS §1.7` — ✅ ACTIONED + BUILT** (decision HQ 2026-06-03,
   owner-confirmed `3076f02`; seam shipped 2026-06-04). §1.7's "out of v1" deferral on PresentMon/ETW
   frame-capture is lifted; frame-time before/after deltas are now the **core efficacy Measure**, reusing
   the already-shipping read-only anti-cheat-safe `fps.rs --fps-capture` helper. §1.7's honesty invariant
   (no fake FPS claims; noise-floor "no measurable change") is preserved and reinforced. The
   PresentMon→verdict seam is **built + live**: `benchmark_trial::start_tweak_trial` measures real game
   frametimes (1%/0.1% lows, via `monitoring::latest_frametimes()` ← the ETW helper) before/after applying
   a tweak → Keep/Revert/Inconclusive with 95% CI + a 3% noise floor; the synthetic `compute_efficacy`
   runners stay separate health-signals (per §1.7). Shipped **ungated** alongside the live Benchmark tab —
   the planned `benchmark_enabled()` gate was not used (owner directed un-darking). **Remaining: live
   end-to-end validation on a real game** (run a tweak trial with FPS capture on; confirm a real delta +
   honest verdict + clean rollback). Intel's PresentMon *binary* is **not** required — the home-grown
   DXGI-ETW capture satisfies §1.7; bundling the redistributable is an optional future "more signals" call.
2. **If efficacy-sharing ships:** who hosts it, and how are submissions kept honest (signed via the
   existing `ed25519-compact` pattern / server-side bounds)?
3. **Identity model for sharing:** anonymous token only *(recommended — preserves the no-account ethos)*,
   or anything more?

---

**Bottom line:** the benchmark engine is **merged dark** and wires up later as a clean, low-risk additive
gated tab. Its soul is **measured efficacy** — honest "did this actually help?" verdicts, not a vanity
score. The only thing that needs a deliberate decision is **cross-user efficacy sharing's network +
identity** — and done opt-in / anonymous / Rust-isolated, it can ship **without** breaking the local-only
promise for anyone else.
