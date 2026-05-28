# Next Session — Pick Up Here

**Last touched:** 2026-05-28
**Last commit:** `67b8cad` feat: Startup apps section
**Status:** v1 recommendation catalog is functionally complete. User is testing this session's batch before deciding direction.

---

## Where we are

Sentinel at `C:\Users\Kuya\code\sentinel\` — native Tauri app, ~36 MB RAM, fully Windows-side (no WSL needed).

**Six appliable recommendations end-to-end:**
| Rec | Scope | Elevation |
|---|---|---|
| game-mode | HKCU registry | user |
| visual-effects | HKCU multi-key (incl. REG_BINARY) | user |
| sysmain-disable | Win32 service | UAC |
| nvidia-telemetry | Win32 service | UAC |
| power-ultimate | powercfg | UAC |
| nagle-disable | HKLM multi-NIC registry | UAC |

**Startup apps section:** dedicated list UI for HKCU\…\Run entries with per-entry enable/disable toggles. Uses Task Manager's StartupApproved binary blob (0x02 = enabled, 0x03 = disabled).

**Hardware detection coverage:** CPU (brand, cores, freq), RAM (total/used/swap), OS (name/version/kernel/host), logical disks, physical disks (HDD/SSD/SCM, NVMe/SATA/ATA/USB), GPUs (name, VRAM, driver version + age in days), display (current resolution + current Hz + max Hz at that resolution).

**Recs with state detection (current_applied honestly checked against system):** power-ultimate, game-mode, nvidia-telemetry, sysmain-disable, visual-effects, nagle-disable. Plus the SSD-upgrade-advisory which is gated on `only_hdd`.

**History `is_still_active` check:** uses the same state detectors so "No longer active" appears correctly when an applied change has been reverted outside Sentinel.

## Open loop

User is testing this session's work. Expecting feedback on:
- power-ultimate apply/rollback (UAC + powercfg pattern)
- nagle-disable apply/rollback (multi-NIC HKLM writes)
- nvidia-telemetry apply/rollback (if user has NVIDIA GPU)
- Startup apps section showing and toggles working
- New hardware-tailoring info displayed correctly

## Next batch — when the user is ready

In order of priority per the user's product direction:

### 1. Step B of graduated rec source: remote JSON rules (next big step)

User explicitly chose the "graduated path: A now, B before launch, D later" approach. Static rules in code (A) are now thorough. The next big architectural step is moving rules to a remote JSON file so they can be updated without an app release.

Plan:
- Define a rules schema (JSON Schema or just hand-rolled TS interface). Each rule has id, title, description, impact, downside, severity, category, conditions (hardware predicates), apply (action descriptor), rollback (action descriptor).
- Decision: where to host? Options — Cloudflare R2 (cheap, fast, ~$0/mo at this scale), GitHub Pages (free, slower CDN, public-only), S3 (more expensive). Recommend R2.
- Sentinel fetches `https://<cdn>/sentinel/rules-v1.json` on launch with a 5s timeout; falls back to an embedded baseline (current static rules serialized) if the fetch fails.
- Add a checksum (SHA-256 of the JSON, signed eventually) to detect tampering.
- Migrate the current static rules into the JSON format; keep the same in-Rust execution model for now.

### 2. Expand Startup apps to HKLM + Startup Folder

- HKLM\...\Run entries (system-wide bloat: Realtek, NVIDIA, OEM, etc.). Read is no-admin; disable needs UAC. UI shows them with a "Machine" tag.
- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` shortcut files.
- HKLM\...\StartupApproved\StartupFolder approval blob handles the folder.

### 3. More granular hardware detection

- CPU vendor/family/generation parsing from brand string (Zen 4, Raptor Lake, etc.) → drives smarter CPU-aware recs.
- Windows version detail: parse `DisplayVersion` and `UBR` from registry → "Windows 11 23H2 (22631.3007)".
- RAM speed (MHz) via WMI Win32_PhysicalMemory → DDR4 vs DDR5, channel config.
- Motherboard/BIOS from Win32_BaseBoard / Win32_BIOS.

### 4. Apply for the remaining recs

- `amd-uxp`: HKCU registry. Verify path on a real AMD machine before shipping. Pattern: same as game-mode.
- `monitor-max-refresh`: would need `ChangeDisplaySettingsEx` API. Complex; might stay informational.
- `gpu-driver-update`: cannot auto-apply (driver download from vendor). Could open the relevant vendor site or NVIDIA App. Probably stays informational.

### 5. Eventually: GitHub push for offsite backup

Local repo only at 11 commits. Push when the user has GitHub configured.

## Quick verification on session resume

```powershell
cd C:\Users\Kuya\code\sentinel
git log --oneline
# Confirm dev server still running, or restart:
npm run tauri dev    # incremental ~10s, full ~3min from clean
```

## Hard rule from the user (still in effect)

*"establish a baseline and get everything functioning and accurate then work out aesthetics or additional widgets after."*

The Startup apps section was an exception (closed a major catalog gap that needed a list shape, not a toggle). No further new widgets until step B + state detection coverage is solid. Apply with confirm-each-time pattern stays — user explicitly chose that over manual-only-by-default.
