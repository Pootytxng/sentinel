# Product Requirements Document — Sentinel

**Project codename:** Sentinel
**Status:** Draft v0.2 (positioning sharpened; technical approach in flight per [ARCHITECTURE_LOCKS](ARCHITECTURE_LOCKS.md))
**Owner:** Kuya
**Last updated:** 2026-05-28

> Sentinel is not an optimizer that happens to have rollback. Sentinel is a rollback-first Windows configuration safety layer that happens to optimize.

---

## 1. Overview

Sentinel is a hardware-aware Windows configuration safety layer for gamers. It reads the user's actual hardware (CPU, GPU, RAM, drivers, monitor, installed games), identifies risky, conflicting, or missed Windows settings *specific to that rig*, explains in plain English why each one matters, applies only reversible changes, and keeps a complete rollback history per applied change.

The product wedge is **trust**, not "boost." The promised differentiator over generic tweak packs is:

- Reversible changes only
- Plain-English explanations of every action with the honest downside
- Per-rig recommendations gated on detected hardware and OS state
- Complete rollback history that survives rule updates, app updates, and removed recommendations
- No fake performance claims — "Verified" (a setting was actually changed), "Measured signal" (a probe was run), and "Expected impact" (theory) are kept strictly separate

What Sentinel is **not**, and will refuse to market itself as:

- An "FPS booster" — that's scam-adjacent positioning
- A magic Windows performance pack — that's the YouTube registry pack space
- A general "Windows tweaker" — that's the power-user space (NTLite, Process Lasso, ChrisTitusTech WinUtil)

## 2. Problem & Opportunity

Non-technical PC gamers today have two unappealing paths to configuration:

1. **Leave the PC at stock.** Tolerate stutter, input lag, slow boots, conflicting OEM bloat — and never learn whether their hardware is actually misconfigured.
2. **Follow generic tweak guides** from YouTube, Reddit, or random forums. These guides assume one-size-fits-all hardware, recommend conflicting changes, give no rollback path, mix safe tweaks with reckless ones (HPET, Defender disable, MMCSS overrides, registry TCP packs), and explain nothing. Users break their systems and don't know how to undo it.

The optimization-tool market is well-populated, but the offerings stratify into:

- **Power-user tools** (NTLite, Process Lasso, ChrisTitusTech WinUtil) — assume the user knows what they're doing
- **Vendor marketing wrappers** (NVIDIA App, AMD Adrenalin, MSI Center, OEM suites) — limited to vendor-specific settings, won't recommend turning their own telemetry off
- **Tweak-pack / "booster" apps** (Hone, TunedPC, ExitLag-class routing) — varying degrees of scam-adjacency, rarely reversible, no audit trail
- **Hypertune-class** — closer to the right space but doesn't lead with rollback-first safety

Nothing in the market combines **hardware-aware**, **safe-by-default**, **plain-English**, **rollback-first**, and **built for non-technical gamers**. That's the gap.

The opportunity: a commercial product that owns the "I want my PC running right but I don't want to risk breaking it" segment, with a credible safety story, a visible Trust Ledger, and a clean UX.

## 2.5 Catalog discipline (the defining product principle)

> The value is not "more tweaks." The value is *fewer recommendations, each defensible, hardware-conditional, reversible, rollback-protected, and plainly explained.*

Sentinel's catalog has a deliberate ceiling: roughly **25–30 safe-baseline recommendations** total. Beyond that ceiling, additions become **advanced mode, diagnostic, problem-specific, or advisory-only** — never default applies.

This is the line between Sentinel and the broader "PC optimizer" category. Most products in that category compete on tweak count and ship registry mega-packs. Sentinel competes on what *isn't* in the catalog.

**Every rec in the safe baseline must clear all five bars:**

1. **Hardware-conditional** — fires only when the user's actual rig benefits. No "universally applicable" tweaks.
2. **Reversible** — a `RollbackAction` + `Snapshot` exists so the change can be undone without manual cleanup.
3. **Snapshot-protected** — prior state is captured at apply time, stored in the audit ledger, and never depends on the live catalog being available at rollback time.
4. **Plain-English** — the description names the actual impact and the actual downside in language a non-technical gamer can act on.
5. **Not registry folklore** — there's a defensible reason it's measurable, not just "Reddit said so."

The catalog's deliberate exclusions are in [ARCHITECTURE_LOCKS §3](ARCHITECTURE_LOCKS.md#3-baseline-exclusions): HPET, BCDEdit timer tweaks, Defender disable, Spectre/Meltdown mitigation disable, MMCSS edits, global fullscreen-optimizations off, fixed-size pagefile, MPO disable, registry TCP mega-packs, generic NIC offload packs. Most of these are in YouTube/Reddit tweak packs. None are in Sentinel's safe baseline.

## 3. Goals & Success Metrics

### Primary goals
1. **Give every user a measurably better-running PC** without requiring them to learn what they changed.
2. **Never break a user's system.** Every change is reversible; rollback is one click and survives Sentinel updates, catalog updates, and CDN outages.
3. **Be the first optimization tool a gamer's non-technical friend recommends** — driven by trust and a small, audited catalog, not by tweak count.

### Success metrics (post-launch)
| Metric | Target (3 mo) | Target (12 mo) |
|---|---|---|
| % of users who apply ≥1 recommended change | 70% | 85% |
| % of applied changes later rolled back | < 5% | < 2% |
| Average measurable FPS / latency improvement in a benchmarked game | +10% | +15% |
| Refund rate (if one-time purchase) / churn (if subscription) | < 5% / < 8% mo | < 3% / < 5% mo |
| NPS | +30 | +50 |

These are placeholders pending real baseline data — sharpen after a private beta.

## 4. Target Audience

### Primary persona — "Casual Competitive Caleb"
Mid-20s gamer. Plays Valorant, Apex, Marvel Rivals. Has a midrange-to-high gaming PC he built once or bought prebuilt. Knows enough to download a game but not enough to safely edit the registry. Has watched optimization YouTube videos, tried a couple of "fixes," and either broke something or got nothing out of it. Will pay $20-40 once, or $5/mo, for a tool that makes his PC noticeably better and doesn't scare him.

### Secondary persona — "Single-player Sarah"
Plays story-driven AAA titles (Baldur's Gate, Cyberpunk, Elden Ring). Wants the prettiest possible experience without stutter. Doesn't care about latency. Wants someone to tell her "for your rig, here's the visual settings that won't drop frames."

## 5. Scope

### In scope (v1)
- Hardware detection and reporting
- Windows debloat (preinstalled apps, telemetry, services) with safe defaults
- GPU driver optimization (NVIDIA + AMD + Intel)
- Game-specific recommendations across three performance profiles: latency / max FPS / visual fidelity
- Common-app debloat (Discord, Chrome, Steam, OBS, etc.)
- Per-change approval flow with plain-English descriptions
- Snapshot + rollback for every applied change
- Polished, gamer-aesthetic desktop UI

### Out of scope (v1)
- Real-time in-game telemetry overlay
- Cloud profile sync
- Community-shared profiles
- Built-in benchmarking
- Overclocking presets

### Explicit non-goals
- Not for IT admins or power users
- Not a "tune everything in one click" tool
- Not a security/antivirus product
- Not cross-platform (Windows only)

## 6. Functional Requirements

### FR-1 — Hardware detection
On first launch (and on demand), Sentinel inventories the host system: CPU model + core/thread count, GPU model + VRAM + driver version, total RAM + speed, storage devices + free space, motherboard + BIOS, attached monitors + refresh rate, installed Windows version + build.

### FR-2 — Recommendation engine
Given the hardware inventory and the user's selected intent profile, Sentinel produces a ranked list of recommended changes. Each recommendation includes: name, plain-English description, expected impact, downside / what it disables, and category (Windows / driver / app / game).

### FR-3 — Per-change approval
No change is applied without an explicit per-change approval action. The user can approve a batch, but each item is visible and individually toggleable inside that batch.

### FR-4 — Snapshot + rollback
Before any change is applied, Sentinel captures the prior state. The user can roll back any individual change at any time, or restore to a named snapshot (e.g. "before Sentinel ran today").

### FR-5 — Game profile system
For supported games, Sentinel exposes the three intent profiles (latency / max FPS / fidelity). Switching profiles re-applies the appropriate per-game and driver-level settings for that game.

### FR-6 — Audit log
Sentinel keeps a human-readable history of every change applied and every rollback performed.

## 7. Non-Functional Requirements

- **Performance:** Sentinel itself uses minimal background resources — ideally < 100 MB RAM idle, near-zero CPU when not actively scanning or applying. (For a "PC optimizer" product, being a resource hog is a brand-killing contradiction.)
- **Reliability:** No change should ever leave the system in an unbootable or unrecoverable state. Catastrophic-risk tweaks are excluded from v1 entirely.
- **Security / privacy:** Local-first. No telemetry without opt-in. Hardware data never leaves the device unless the user explicitly chooses to share. Eventually: signed installer (EV cert) to avoid SmartScreen warnings.
- **Accessibility:** Keyboard navigable. Readable at default Windows zoom. No reliance on hover-only tooltips for critical info.
- **Cost:** Per-user infrastructure cost (if any cloud component exists) under $1/month/user, so a $5-10/mo subscription has comfortable margin.

## 8. Technical Approach

**Open and pending decision.** The current scaffold at `/var/www/sentinel` is a FastAPI service running inside WSL — that's a fine prototyping environment but the wrong shape for the consumer product. Real options under consideration:

1. **Tauri (Rust core + web UI)** — small installer (~10 MB), low memory, native Windows API access via Rust crates. Best brand fit for "anti-bloat optimization tool." Web UI iterates fast.
2. **.NET 9 + WinUI 3** — best Windows API integration (WMI, registry, services are first-class), single language. UI is heavier-lift than web.
3. **Electron + Python child process** — fastest path if we want to reuse the existing Python agent code, but contradicts the "lightweight" brand promise (Electron apps start at ~100MB).

Recommendation pending in the next conversation turn. Once decided, the Roadmap Phase 1 will be rewritten to match.

## 9. Risks & Open Questions

- **Risk: scope creep.** The "everything for your PC" pitch is dangerous. v1 needs to be ruthlessly narrowed to what we can ship polished.
- **Risk: vendor API churn.** NVAPI / ADL / Intel APIs change. Need a clean abstraction layer.
- **Risk: false promises.** If Sentinel claims "+20% FPS" and a user sees +2%, refunds. Need conservative, defensible impact claims.
- **Risk: liability if we brick a system.** Even with snapshots, edge cases exist. EULA + disclaimers + ironclad rollback are mandatory.
- **Open question: monetization model.** One-time ($20-40), subscription ($5-10/mo), or freemium (free scan, paid apply)?
- **Open question: distribution.** Direct from a website (best margin), Microsoft Store (discovery + auto-update for free), or Steam (the audience lives there)?
- **Open question: source of recommendation intelligence.** Curated rules DB (predictable, slow to grow), LLM-augmented (fast, requires safety guardrails), or both layered?
- **Open question: code-signing strategy.** EV cert (~$300-700/yr) needed before public launch to avoid SmartScreen warnings scaring off buyers.
