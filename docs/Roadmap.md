# Roadmap — Sentinel

Companion to [PRD.md](PRD.md). Phased plan from zero to launched.

**Legend:** ☐ not started · ◐ in progress · ☑ done

---

## Phase 0 — Discovery & Definition

**Goal:** Finish PRD and INTAKE so we know what we're building.

- ☑ Write the one-sentence description in `INTAKE.md` §1.
- ☑ Fill in PRD §1 Overview and §2 Problem & Opportunity.
- ☑ Decide on the stack — **Tauri (Rust + React/TypeScript)** chosen 2026-05-27.

**Exit criteria:** PRD §1–§6 are real (no `____` placeholders). ✅ Met.

---

## Phase 1 — Foundation

**Goal:** Native Windows app scaffolded with Tauri, hardware detection working end-to-end, dev loop running.

- ☑ Install Windows toolchain (Rust, Node, Git, VS Build Tools, WebView2 already present).
- ☑ Scaffold Tauri 2 React+TS project at `C:\Users\Kuya\code\sentinel\`.
- ☑ Wire `sysinfo` crate for CPU / RAM / disk / OS detection.
- ☑ Build minimal dashboard UI showing live hardware on first launch.
- ◐ First successful `tauri dev` run with the window opening and showing real hardware.
- ☐ First commit to git on `main`.

**Exit criteria:** `npm run tauri dev` from `C:\Users\Kuya\code\sentinel\` opens a window displaying the user's actual CPU, RAM, OS, and disks — no placeholder data.

---

## Phase 2 — Hardware coverage expansion

**Goal:** Detect everything we'll need to make recommendations.

- ☐ GPU detection: vendor (NVIDIA/AMD/Intel), model, VRAM, driver version. Likely needs WMI queries + vendor SDKs (NVAPI, ADL).
- ☐ Monitor detection: refresh rate, resolution, HDR capability.
- ☐ Motherboard + BIOS version (for compatibility-aware recommendations).
- ☐ Installed games detection: scan Steam/Epic/Xbox/EA libraries.
- ☐ Installed apps detection: registry uninstall keys + AppX.

**Exit criteria:** A "Hardware Report" view that gives the user a complete picture of what Sentinel sees about their rig.

---

## Phase 3 — Recommendation engine (read-only)

**Goal:** Generate ranked recommendations based on detected hardware, but do not apply anything yet.

- ☐ Define recommendation data model (name, category, description, impact, downside, prerequisites, snapshot strategy).
- ☐ Seed v1 rule set:
  - Windows debloat (preinstalled apps, telemetry services)
  - GPU driver settings (vendor-specific)
  - Game-specific profiles (latency / max FPS / fidelity) for top ~20 titles
  - Common-app debloat (Discord, Chrome, Steam, OBS)
- ☐ Recommendation UI: ranked list, plain-English descriptions, category filters.

**Exit criteria:** Run Sentinel on a real gaming PC, see a list of meaningful, hardware-aware recommendations. Nothing applied yet.

---

## Phase 4 — Apply + Rollback

**Goal:** Per-change approval flow, snapshotting, and one-click rollback.

- ◐ Snapshot system: registry-value snapshots wired for HKCU changes (prior value captured, including "didn't exist"). Service-state and file-backup snapshots still to do.
- ◐ Apply flow: per-recommendation confirm dialog with description + tradeoff before action. Batch approval with per-item toggles still to do.
- ☑ Audit log: changes persisted to `%APPDATA%\Sentinel\history.json` with id, rec_id, rec_title, applied_at (ISO 8601), snapshot blob, status.
- ◐ Rollback: per-change rollback wired for `game-mode`; named/group snapshots still to do.
- ◐ Wire more recommendations end-to-end: only `game-mode` is appliable today. Next batch (HKCU-scope, no admin): `visual-effects`, `amd-uxp`, `startup-debloat`.
- ☐ Admin elevation pattern for HKLM / service / power-plan changes.

**Exit criteria:** Apply a debloat, verify the change took effect, roll it back, verify it's restored. Cycle works without manual cleanup. ✅ Met for `game-mode`; expand coverage.

---

## Phase 5 — Launch readiness

**Goal:** Ship-quality polish and distribution.

- ☐ EV code-signing cert acquired and integrated into build pipeline.
- ☐ Installer (MSI) tested on clean Windows 10 + Windows 11 VMs.
- ☐ Privacy policy + EULA + disclaimers drafted.
- ☐ Monetization wired (license key validation, payment processor).
- ☐ Distribution decided: direct download / Microsoft Store / Steam.
- ☐ Landing page + buy button.
- ☐ Closed beta with ~10-20 real gamers, gather feedback, iterate.

**Exit criteria:** A stranger can buy Sentinel from the website, install it, optimize their PC, and recommend it to a friend.
