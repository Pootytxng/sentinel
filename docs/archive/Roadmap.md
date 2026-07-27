# Roadmap — Compy · Road to Public 1.0

Companion to [PRD.md](../PRD.md) + [PRODUCT_DIRECTION.md](../PRODUCT_DIRECTION.md). **Live state → [`RELEASE_STATE.md`](../RELEASE_STATE.md); what's-next → [`BACKLOG.md`](../BACKLOG.md); money/direction → [`RECEIPTS_DOCTRINE.md`](../RECEIPTS_DOCTRINE.md)** (which supersedes the monetization framing here). This file is the **aging (2026-06-02) forward sketch** — what's shipped vs what stands between us and "a stranger can buy it, install it, optimize their PC, and recommend it."

**Legend:** ☑ done · ◐ in progress / built-but-gated · ☐ not started · 🔒 owner-gated (decision/outward) · 🤖 Claude can drive solo

**Last refreshed 2026-06-02.** Private beta `private-beta-001` is **FROZEN + shippable** @ `16069fa`
(do not move). `main` has since added the de-gamified Experience Pass + F1 Gaming Mode (dark).

---

## ☑ Shipped baseline (the private beta + post-beta `main`)
- ☑ Tauri 2 app; hardware detection (CPU/RAM/GPU/disk/monitor) end-to-end.
- ☑ **Rollback-first mutation engine** — typed Snapshot/RollbackAction, apply→verify→rollback, Trust Ledger, power-plan exact-GUID restore. **Manual-mutation QA signed off (2026-05-31).**
- ☑ Recommendation catalog (~29 recs, **frozen**), provenance pills, signed-manifest verify wired (remote fetch hard-off).
- ☑ Read-only upward features: **F2 Readiness · F3 Sessions · F5 Export · F4 Priorities.**
- ☑ Monitoring (NVML/ADLX/PDH/ETW FPS) + overlay; onboarding flow.
- ☑ **Experience Pass** — de-gamified honest command-center UI (merged to `main`).
- ◐ **F1 Gaming Mode** — built + merged **DARK** behind `gaming_mode_gate()`; awaiting its own mutation QA + sign-off.

---

## 🔒 The road to 1.0 — OWNER-GATED (the real bottleneck; needs your decision / $ / hands)
These are what actually stand between "beta" and "a stranger buys it." Most are *not* code.
- 🔒 **F1 Gaming Mode QA → flip the gate.** Run spec §7 (normal / crash / reboot / UAC-cancel / missing-plan) on your UAC-on rig → sign off → I flip `gaming_mode_gate()`. *(I can't crash/reboot your PC for you.)*
- 🔒 **Code signing.** Acquire an **EV (or OV) code-signing cert** (your $ + identity) → integrate into the build pipeline. Unsigned = SmartScreen scares every new user. Plan in `PACKAGING_SIGNING_PLAN.md`. *(🤖 I can wire the pipeline; you buy/own the cert + key — and the key NEVER enters the repo.)*
- 🔒 **Legal.** EULA · Privacy Policy · liability disclaimers (incl. the Black Book one). *(🤖 I can draft all three — Compy's local-only / no-telemetry / rollback-first story is a strong one — you/a lawyer own final sign-off + jurisdiction.)*
- 🔒 **Monetization.** Model (one-time / sub / freemium?) → license-key validation + payment processor. *(Your business call; I build once decided.)*
- 🔒 **Distribution.** Direct download vs Microsoft Store vs Steam (each changes signing/packaging/revenue cut). *(Your call.)*
- 🔒 **Landing page + buy button.** *(🤖 I can draft copy/structure; you own brand + payment hookup.)*
- 🔒 **Closed beta with ~10–20 real gamers** → gather feedback → iterate. The single highest-signal step before charging money.

## 🔒 Feature direction — needs YOUR call
- 🔒 **F6 Benchmark / cosmetic-reward** — lane PAUSED; awaiting your full direction (reopened cosmetic-reward angle).
- 🔒 **Advanced Black Book** — researched + designed (`ADVANCED_PERFORMANCE_BLACK_BOOK.md`); promote to a gated advisory feature, or leave as reference?
- 🔒 **Dashboard surface** — built + tested, currently unwired (you kept the Overview hardware grid); wire it in or leave parked?

## 🤖 Polish / tech-debt / hardening — I CAN DRIVE SOLO (no decision needed)
- ☑ **Clippy / tech-debt sweep — DONE (2026-06-02, `ff0ceda`).** True zero clippy warnings.
- 🤖 **Legal drafts** — first-pass EULA / Privacy / Disclaimer for your review (see ship gates above).
- ☑ **CSP hardening — DONE (2026-06-02, `a9619ec`).** Strict production `csp` + relaxed `devCsp` (Vite HMR); runtime-verified on a production build (UI renders + IPC works under the policy). One public-release security gate cleared.
- 🤖 **Test-coverage expansion** — more pure-function + contract tests where thin.
- 🤖 **Expand appliable-rec coverage** — wire more advisory recs to real apply/rollback (each needs its own mutation QA → semi-gated, but I can build + self-test the reversible ones).
- ☐🔒 **NVIDIA GPU-sensor hardware verification** — AMD verified; NVIDIA implemented-but-not-hardware-verified. *(Needs an NVIDIA rig — your hardware or a tester's.)*
- ☐ **Overlay transparency** — deferred (WebView2 transparent-window quirk; needs live visual verify).
- ☐🔒 **Remote-rules arming** — post-beta; needs a CDN + a production Ed25519 keypair (key offline, never in repo). Stays hard-off until then.

---

## Honest summary
Compy **works** and has a frozen, shippable private beta. The gap to **public 1.0** is mostly
**business + legal + your QA + a closed beta** — decisions and outward steps, not more core code. The
engineering that *remains* is polish, hardening (CSP), drafts, and gated features awaiting your direction.
**Claude can independently drive the 🤖 items now;** the 🔒 items need you.
