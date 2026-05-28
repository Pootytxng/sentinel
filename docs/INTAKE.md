# Content Intake — Sentinel

Filled in 2026-05-27 from initial scoping conversation. Some sections still have open questions — those are called out explicitly rather than left as `____`.

---

## 1. The basics

- Project name: **Sentinel**
- One-sentence description: An all-in-one Windows PC optimization & configuration dashboard that reads the user's actual hardware and recommends settings tailored to *that specific rig* — not generic "best settings" advice.
- Who is this for: **Everyday gamers and average PC users.** Non-technical people who want better game performance and a snappier system but don't know what a registry key is, don't want to learn, and don't trust random YouTube tweak guides.
- Why does this need to exist: Today, non-technical users have two bad options — leave their PC at stock and miss real performance, or blindly apply universal "tweaks" from forums that cause conflicts and breakage they can't debug. Sentinel sits in the gap: hardware-aware, safe-by-default, plain-English, reversible.
- How will we know it's working: A non-technical gamer installs Sentinel, sees clear recommendations specific to their PC, approves changes one at a time with confidence, and notices a real improvement (smoother FPS, faster startup, less stutter) — without ever feeling like they broke something or risked breaking something.

## 2. Scope

### Must-have features for v1
- **Hardware detection** — CPU, GPU, RAM, storage, motherboard, monitor (refresh rate), installed drivers + versions
- **Windows debloat** — remove preinstalled bloatware, disable unnecessary telemetry, prune unused services (safe defaults only)
- **GPU driver optimization** — vendor-specific settings (NVIDIA / AMD / Intel) tuned to the user's hardware and chosen profile
- **Game-specific profiles** — per-game settings with three primary intents:
  - **Latency-focused** (competitive shooters — input lag minimized)
  - **Max FPS** (highest framerate, visual quality sacrificed)
  - **Visual fidelity & smoothness** (cinematic / single-player — quality + frame pacing over raw FPS)
- **Common app debloat** — for popular installed apps (Discord, Chrome, Steam, etc.), turn off the background bloat they ship with
- **Per-change approval flow** — every tweak shown with a plain-English description ("This turns off the Windows tip notifications that run in the background") and requires explicit user approval before it's applied
- **Rollback / undo** — every applied change is snapshotted so the user can revert any individual change or roll back to a known-good state

### Nice-to-have (post-v1)
- Real-time telemetry overlay while gaming
- Cloud sync of profiles across the user's PCs
- Community-shared / vetted profiles ("here's what other people with your GPU use for Cyberpunk")
- Built-in benchmark hooks for before/after comparison
- Overclocking presets (guarded — opt-in "advanced" mode)

### Explicit non-goals
- **Not for power users / IT admins.** They already have NTLite, Process Lasso, ChrisTitusTech WinUtil, etc.
- **Not a "one-click tune everything" tool.** Every change is approved individually. The product is *trust*, not *speed*.
- **Not a malware scanner / antivirus.** Stays in its lane.
- **Not risky overclocking in v1.** Maybe later, behind an advanced toggle.

## 3. Constraints

- Budget / cost ceiling: TBD
- Timeline / deadlines: TBD
- Hardware / platform: **Windows 10 and Windows 11** consumer gaming rigs (no Mac, no Linux)
- Privacy / data-handling: **Local-first.** Hardware data and settings stay on the user's machine. Any telemetry or community-profile sharing is strictly opt-in and clearly disclosed. Required because (a) it's the right thing for a "trust me to tweak your PC" product, and (b) a commercial product needs a defensible privacy posture.
- Must be true for it to be safe to use:
  - Every applied change is reversible (snapshot + restore)
  - No change is ever applied without explicit user approval
  - Plain-English descriptions of every change, including the downside (e.g. "this also disables X")

## 4. Inputs & data

- What data does this consume: installed hardware specs, installed games + apps, Windows settings, GPU driver configuration, real-time perf counters (CPU/GPU/RAM/temp), monitor capabilities
- Where does that data come from: WMI, Windows Registry, GPU vendor APIs (NVAPI / ADL / Intel Graphics), launcher APIs (Steam, Epic, etc.), Windows performance counters
- Who owns / has access to it: the user only. Local-only unless they opt in to share.

## 5. Outputs

- What does this produce: a hardware/system report, a ranked list of recommended changes (each with description, expected impact, and downside), an applied-changes log, and rollback snapshots
- Who consumes the output: the end-user via the desktop dashboard

## 6. Anything else

- **Monetization:** planned. Public commercial product. Model (one-time purchase / subscription / freemium with a paid pro tier) is an open decision.
- **References / things to study:** ChrisTitusTech WinUtil, NTLite, Razer Cortex, MSI Afterburner, NVIDIA GeForce Experience, AMD Adrenalin, Process Lasso — all overlap parts of what Sentinel does, none nail the "tailored + safe + non-technical" combination.
- **Worries / things to figure out:** TBD — would be useful to know what specifically worries you about building this.
- **Open questions:**
  - **Platform/stack** — current scaffold is WSL/FastAPI which is wrong for the target audience. Native Windows shell (Tauri/Electron/.NET) needed. Decision pending.
  - **Distribution** — direct download from a website? Microsoft Store? Steam?
  - **Monetization model** — one-time / subscription / freemium?
  - **Source of the "intelligence"** — curated DB of game-by-game settings, LLM-augmented analysis, or both?
  - **Code signing** — for a paid Windows app we'll eventually need an EV cert (~$300-700/year) to avoid SmartScreen warnings.
