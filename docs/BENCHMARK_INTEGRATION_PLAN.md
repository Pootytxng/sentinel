# Benchmark — Integration Plan (HQ merge contract)

**Status: PLAN (2026-06-02).** The benchmark is being built in its own lane/worktree (`benchmark`
branch). This doc is the contract HQ and the benchmark lane both build against so that, when the
benchmark is done, it merges into `main` **cleanly and without betraying Sentinel's identity.** No code
here — this is the seam + the rules.

**What the benchmark is (owner-confirmed):** a **scoring / cosmetic-reward** feature in **its own
section**, with a **leaderboard of other Sentinel users** (UserBenchmark-style, but purely score-vs-
other-users). Cosmetic rewards unlock as you score.

---

## TL;DR

- **The merge is the easy part.** "Its own section" is the clean path: the benchmark slots in as a
  **gated tab**, exactly like Gaming Mode did — new files, a default-off gate, and it **never touches the
  honest command-center hero.** Decision A (de-gamified `SystemPosture`) survives untouched because the
  score/reward lives *inside* the Benchmark tab, not in the global hero. That's a conflict-free additive
  merge.
- **The leaderboard is the one real decision.** A leaderboard vs other users needs three things Sentinel
  has **never** had — **network egress, a user identity, and a server someone runs.** That crosses the
  **local-only / no-account / no-telemetry** line the EULA, `PRIVACY.md`, the monetization story, and the
  `/security` audit are all built on. Not a blocker — a deliberate product decision. Done as a
  **strictly opt-in, anonymous, Rust-isolated** feature, the local-only promise stays intact for everyone
  who never opts in.

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
- **Cosmetic rewards reuse what's already local.** The theme system (`THEMES` / `applyTheme` /
  `localStorage`, `src/App.tsx:531-564`) is already cosmetic, local-only, no-network. A reward that
  unlocks a theme should reuse that mechanism and **store the unlock locally** — no reward should depend
  on the network being up.

## 2. The one real fork — the leaderboard (network + identity + a server)

Plain-language: a leaderboard comparing you to other Sentinel users requires three firsts:

1. **Network.** The app uploads your score and downloads others'. Today Sentinel makes **0** outbound
   calls (a hard invariant `/security` checks for). This is the first one ever.
2. **An identity.** "Ranked vs other users" needs at least a **handle** to show on the board. Today:
   no account, by design.
3. **A server someone runs.** To store, rank, and serve scores — infra to host, secure, pay for, and
   **moderate.** UserBenchmark-style boards get **spammed with spoofed scores**, so it needs
   score-integrity or the board is noise.

**This is a product decision, not a bug.** The clean way to add it without betraying the identity:

- **Strictly opt-in.** Default = **fully local, zero network.** The local-only promise holds for everyone
  who never opts in. Only an explicit *"Submit to leaderboard"* action sends anything.
- **Minimal, anonymous payload.** Score + a hardware *class* + a **user-chosen handle**. No PII, no
  telemetry, no system inventory. Documented exactly, in plain language, at the opt-in.
- **Network isolated to Rust, behind one bounded command.** Put the call in `benchmark.rs` (`reqwest`),
  exposed as e.g. `submit_benchmark_score` / `get_leaderboard`. The **webview never gets a network
  primitive**, so:
  - `capabilities/default.json` stays tight — **no `http:` / `shell:` / `fs:` permission added.**
  - the production **CSP `connect-src 'self' ipc:` stays as-is** — CSP only governs *webview* fetches; a
    Rust-side call isn't one. (See `src-tauri/tauri.conf.json` — do not widen it.)
  - The single invariant that genuinely changes: **the Rust core gains its first outbound HTTPS call** —
    gated, opt-in, isolated to this module. That's the line to cross deliberately, with eyes open.
- **Score integrity.** Sign submissions (reuse the repo's existing `ed25519-compact` pattern) and/or
  server-side sanity bounds — otherwise the board fills with fakes.

## 3. Merge mechanics (HQ runs this when the benchmark is done)

- The benchmark lane finishes in its worktree off `main`; **HQ** performs the **ff-only guarded merge**
  (branch-name + clean-tree + origin-sync checks), per `docs/PARALLEL_WORKTREE_OPS.md`. Only HQ merges
  `main`.
- Because it's **additive new files + the gated-tab seam**, the merge should be conflict-free against the
  de-gamified `main` **as long as the lane honors §4.**

## 4. Contracts the benchmark lane must honor (so the merge stays smooth)

A checklist to build against:

- [ ] Score/reward/leaderboard UI lives **only** in the Benchmark tab. **Never** touch
      `CommandHero` / `SystemPosture` / the global hero. *(Preserves Decision A.)*
- [ ] Ship behind a **default-off `benchmark_enabled()` gate** (dark until ready) — Gaming Mode precedent.
- [ ] **New files** for the surface + a new Rust module; reuse the `Tab` / `SECTION_META` / `visibleTabs`
      seam — don't restructure `App.tsx`.
- [ ] **Separate data store** (own JSON) — not the Trust Ledger, not `sessions.json`.
- [ ] **No Windows mutation** in the benchmark path. Running a benchmark ≠ changing settings. If a
      benchmark wants "apply best settings, then measure," it must go through the **existing typed
      apply/rollback path** (`APPLIABLE_REC_IDS`) — never a new mutation primitive.
- [ ] **Network (if any) only in Rust, opt-in, behind a bounded command.** Do **not** add `http:` /
      `shell:` / `fs:` to capabilities; do **not** widen the production CSP.
- [ ] **Cosmetic unlocks stored locally**; reuse the existing theme mechanism; no reward depends on the
      network.
- [ ] **If the leaderboard ships:** update `PRIVACY.md` + `EULA.md` with an *"optional online
      leaderboard"* section, and re-baseline the `/security` "expect 0 network" rule to *"0 unless
      leaderboard explicitly opted in,"* documented.

## 5. Owner decisions (when you're ready)

1. **Leaderboard in v1, or local-first?** Shipping benchmark + score + cosmetic rewards **fully local
   first** carries **zero** identity/network risk and is a clean additive merge; the leaderboard is a
   later bolt-on. *(Recommended: local-first, leaderboard second.)*
2. **If leaderboard:** who hosts it, and how are scores kept honest (signed submissions / server bounds)?
3. **Identity model:** anonymous chosen handle only, or anything more? *(Anonymous handle preserves the
   no-account ethos best.)*

---

**Bottom line:** the benchmark *tab* is a clean, low-risk additive merge whenever it's done. The only
thing that needs a deliberate decision is the **leaderboard's network + identity** — and done opt-in /
anonymous / Rust-isolated, it can ship **without** breaking the local-only promise for anyone else.
