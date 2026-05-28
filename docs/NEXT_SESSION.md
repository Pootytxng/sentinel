# Next Session — Pick Up Here

**Last touched:** 2026-05-28
**Last commit:** `c684aef` feat: Reserved Storage off
**Remote:** `git@github.com:Pootytxng/sentinel.git` (private) — `main` tracks `origin/main`
**Status:** v1 catalog at 13 appliable recs; AV-resilient detection; tabbed UI; CPU arch parsing; GitHub backup live.

---

## Catalog inventory (13 appliable, sorted by category)

**Windows tab**
- `game-mode` — HKCU registry
- `visual-effects` — HKCU multi-key (incl. REG_BINARY UserPreferencesMask)
- `mouse-accel-off` — HKCU REG_SZ ×3
- `game-bar-disable` — HKCU ×2
- `sysmain-disable` — service (UAC)
- `nvidia-telemetry` — service (UAC), NVIDIA only
- `diagtrack-disable` — service (UAC)
- `windows-search-disable` — service (UAC)

**Power tab**
- `power-ultimate` — powercfg (UAC)
- `fast-startup-off` — HKLM (UAC)

**GPU tab**
- `hags-enable` — HKLM (UAC), modern discrete GPU only

**Storage tab**
- `reserved-storage-off` — `Set-WindowsReservedStorageState` (UAC), state from `HKLM\Software\Microsoft\ReserveManager\BaseHardReserveSize`

**Network tab**
- `nagle-disable` — HKLM multi-NIC (UAC)

**Display tab — advisory only**
- `monitor-max-refresh` — would need ChangeDisplaySettingsEx (complex; informational)

**Advisory / not-appliable everywhere else**
- `amd-uxp` — HKCU but needs an AMD machine to verify path
- `gpu-driver-update` — vendor-side download, informational
- `ssd-upgrade-advisory` — hardware purchase
- `storage-c-low` — points user at Disk Cleanup
- `nvidia-low-latency`, `gpu-prefer-discrete` — per-game NVIDIA settings, not externally settable

## What was tested vs. shipped this session

User confirmed (during session): Memory card shows DDR type + speed + manufacturer (when motherboard populates SMBIOS strings); CPU card shows correct CPU model + Zen 5 / 9000-series for the Ryzen 7 9850X3D.

Shipped, **not yet user-verified**:
- Tabbed top-level navigation (Overview / Windows / Power / GPU / Display / Storage / Network / Startup / History)
- Windows version detail in System card ("Windows 11 Pro 23H2" / "22631.3007")
- HAGS apply, mouse-accel-off apply, game-bar-disable apply, diagtrack-disable apply
- windows-search-disable apply, fast-startup-off apply, reserved-storage-off apply

When user picks back up, they may have ~7 new apply flows to verify.

## Hard rules from the user (do not violate)

- **No fabricated examples**: when illustrating CPU / RAM / GPU / drive specifics, either use the user's actual data from a refresh OR use explicit placeholders (`<your CPU>`, etc.). Never invent specific real-sounding hardware names — they get confused for real data.
- **No artificial "let me stop so you can test" pauses**: user has been Refresh-and-verifying in real time. Only stop when something genuinely requires user input (a directional fork, a credential, a public/private choice).
- **Apply UX**: "visible with explicit per-rec confirm" — current architecture, user already chose this over manual-only-by-default.

## Next batch — when user is ready (in priority order)

### 1. Step B: Remote JSON rules infrastructure

User explicitly chose the graduated path: A (static rules) → B (remote JSON) → D (hybrid AI). The catalog has grown to 13 recs purely in code; the next time we want to add or modify a rec without an app release, the architecture has to change.

Concrete first chunk for the next session:
- Serialize the current `build_recommendations` output into a `docs/baseline-rules.json` file in the repo. Hand-roll for v1 (keeps git-diffable history). Schema: `id`, `title`, `description`, `category`, `severity`, `impact`, `downside`, `conditions` (hardware predicates as a small DSL), `apply_kind` (string matching an existing Rust apply fn, e.g. `"game-mode"`, `"service-disable"`), `apply_params` (e.g. `{"service":"SysMain"}`).
- Add a Rust loader that reads the JSON at startup, validates, and produces `Vec<Recommendation>`. Initially load from `include_bytes!` (embedded baseline).
- Once that works end-to-end, switch the loader to: fetch from `https://<cdn>/sentinel/rules-v1.json` with 5 s timeout, fall back to embedded. Cloudflare R2 recommended (free at this scale).
- SHA-256 checksum check before applying remote rules.

This is the architectural step that unblocks all future rec velocity. Probably 3-4 commits across two sessions if done carefully.

### 2. AMD UXP apply (HKCU)

Needs verification of the exact AMD Adrenalin registry key on an actual AMD machine. Same shape as `game-mode`. Defer until user has access to AMD hardware OR we get someone to share their setup.

### 3. CPU-architecture-aware recs

Now that `cpu_arch` is detected, candidate recs:
- E-core handling on Intel 12th+ (Process Lasso recommendation — but it's third-party)
- BIOS-level PBO on Ryzen 5000+ (can't apply from Sentinel, would have to be an advisory)
- Most CPU-specific tweaks are BIOS-level. May not unlock many in-app applies; mostly drives advisory text.

### 4. Synthetic benchmarking prototype (v1.1 territory)

Per user direction: real before/after numbers per tweak. Cheapest viable v1.1:
- CPU memory-latency probe (~5 s) — Rust microbenchmark of cached-memory access patterns
- Network jitter probe — UDP/ICMP burst to a stable target (e.g. cloudflare 1.1.1.1)
- Show delta in the rec card after apply

GPU frame-time hooks need code signing to avoid SmartScreen alarms; that's v1.5+. Crowdsourced per-hardware deltas need the remote-rules infra (Step B) as a prerequisite.

### 5. Drive brand via IOCTL_STORAGE_QUERY_PROPERTY

User flagged drive brand could be cleaner. `DeviceIoControl` with `StorageDeviceProperty` gives VendorId / ProductId separately. ~80 lines of unsafe Win32. User said "fine for now" if not possible — only do this if it's clean to implement, not a forced priority.

## Quick verification on resume

```powershell
cd C:\Users\Kuya\code\sentinel
git log --oneline | head -8
git status      # should be clean, main on origin/main
git fetch       # confirm no upstream changes
# Dev server may still be running from the last session:
Get-Process sentinel -ErrorAction SilentlyContinue
# If not:
npm run tauri dev   # incremental ~10s, cold ~3-5 min
```

## Memory references

- [[project-sentinel]] — what Sentinel is, the trust-first positioning
- [[project-sentinel-structure]] — repo layout, toolchain, no more WSL
- [[user-role]] — user pattern: casual tone, gamer-product-focused, wants forward momentum without artificial stops, wants exact-data examples (no fabrications)
