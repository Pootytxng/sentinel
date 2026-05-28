# Next Session — Pick Up Here

**Last touched:** 2026-05-28
**Last commit:** `b88379a` feat: proper Windows version display
**Status:** v1 catalog dramatically expanded; AV-resilient hardware detection live; tabbed UI shipped.

---

## What changed this session

Big push driven by user feedback (no GPU detected, no RAM details, want tabs, want more recs).

**Hardware detection — AV-resilient redesign**
- `d8d64f2` — DXGI as the primary GPU enumeration path via the `windows` crate (Win32_Graphics_Dxgi). WMI Win32_VideoController stays as a fallback to enrich with driver version/date when accessible. Removed the "* WMI caps VRAM at 4 GB" footnote — DXGI gives real values. Also added Win32_DiskDrive (CIMV2) fallback for when MSFT_PhysicalDisk (Storage namespace) returns nothing — drives at least show their model name.
- `d7ab14a` — RAM detection via `GetSystemFirmwareTable('RSMB', ...)`. Direct kernel call, no COM/WMI. Parses SMBIOS Type 17 (Memory Device) entries — capacity, speed (prefers ConfiguredMemorySpeed = actual XMP-applied, falls back to peak Speed), DDR2/3/4/5 + LPDDR variants from SMBIOSMemoryType, manufacturer + part number from string section. Win32_PhysicalMemory stays as fallback.
- `b88379a` — System card shows "Windows 11 Pro 23H2" / "Build 22631.3007" instead of bare "Windows 11" / kernel version. Reads HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion for EditionID + DisplayVersion + UBR. Major version synthesized from CurrentBuildNumber (Win11 ProductName lies in registry).

**UI**
- `2bed141` — Tabbed top-level navigation. Overview / Windows / Power / GPU / Display / Storage / Network / Startup / History. Empty tabs auto-hide. Tab badges show counts. Active tab uses accent color.

**Rec catalog expansion (8 → 10 appliable)**
- `b8468a2` — `hags-enable` (HKLM, admin via UAC, gated on modern discrete GPU) + `mouse-accel-off` (HKCU REG_SZ writes, no admin)
- `a3f2d37` — `game-bar-disable` (HKCU, no admin) + `diagtrack-disable` (service, admin via UAC, reuses generic `apply_service_disable`)

## Catalog inventory (10 appliable + advisories)

**Appliable (8 HKCU/HKLM-write + 2 service):**
| ID | Scope | Notes |
|---|---|---|
| game-mode | HKCU | tested by user |
| visual-effects | HKCU multi-key (REG_BINARY) | |
| mouse-accel-off | HKCU REG_SZ ×3 | new |
| game-bar-disable | HKCU ×2 | new |
| power-ultimate | powercfg (UAC) | |
| sysmain-disable | service (UAC) | |
| nvidia-telemetry | service (UAC) | NVIDIA only |
| diagtrack-disable | service (UAC) | new |
| nagle-disable | HKLM multi-NIC (UAC) | |
| hags-enable | HKLM (UAC) | modern GPU only, new |

**Advisory / not-appliable:**
- `amd-uxp` — HKCU but needs an AMD machine to verify exact registry path before wiring
- `monitor-max-refresh` — ChangeDisplaySettingsEx is complex enough we left it informational
- `gpu-driver-update` — vendor download, informational
- `ssd-upgrade-advisory` — hardware purchase
- `storage-c-low` — guides user to Disk Cleanup
- `nvidia-low-latency`, `gpu-prefer-discrete` — per-game NVIDIA settings, not externally settable

## Open loop

User testing this session's batch. Things to verify:
- Memory card shows DDR type + speed + manufacturer ✓ (confirmed by user)
- GPU card shows real VRAM (no asterisk caveat anymore)
- System card shows "Windows 11 Pro 23H2" + "22631.3007"
- Tabs across the top — Overview / category / Startup / History
- Empty tabs hidden (e.g., if no Display recs, no Display tab)
- New appliable recs (HAGS, mouse-accel, game-bar, diagtrack) — each end-to-end Apply + Rollback

## Next batch — when user is ready

In priority order:

### 1. Step B: Remote JSON rules infrastructure

User explicitly chose the graduated path: A (static rules) now → B (remote JSON) before launch → D (hybrid AI) at scale. Static is mature; time for B.

Plan:
- Define a rules JSON schema (id, title, description, category, severity, impact, downside, conditions, apply_action, rollback_action). Keep apply_action / rollback_action as the existing match-arm names for v1, so the JSON just selects which Rust function runs — no dynamic dispatch yet.
- Decision: hosting. **Cloudflare R2** recommended — free at this scale, fast CDN, no public-only constraint. GitHub Pages is the cheapest-of-cheap alternative.
- App fetches `https://cdn.<domain>/sentinel/rules-v1.json` on launch, 5s timeout, falls back to an embedded baseline (serialize current static rules at build time and `include_bytes!` them).
- SHA-256 checksum embedded next to the JSON, signed with a public-key later. v1 just verifies the hash matches a known-good value before applying.
- Migration: serialize current `build_recommendations` output into a JSON file under `docs/baseline-rules.json`. Add a build step or just hand-roll it for v1.

### 2. Drive brand via IOCTL_STORAGE_QUERY_PROPERTY

User noted drive brand sometimes missing. Real fix uses `DeviceIoControl` with `IOCTL_STORAGE_QUERY_PROPERTY` + `StorageDeviceDescriptor` — gives separate VendorId / ProductId / ProductRevision. Unsafe Win32, ~80 lines.

### 3. CPU generation parsing

Parse `cpu_brand` string to detect vendor / family / generation. Intel "13th Gen Intel(R) Core(TM) i7-13700K" → "Raptor Lake"; AMD "Ryzen 7 7800X3D" → "Zen 4". Drives CPU-specific recs (PBO toggling, E-core scheduling, etc.) when we have them.

### 4. amd-uxp apply (HKCU, no admin)

Needs verification on an actual AMD machine — the registry path varies across Adrenalin versions. Cleanest is checking on a fresh AMD driver install. Same shape as `game-mode`.

### 5. Synthetic benchmarking prototype (v1.1)

User explicitly wants per-tweak FPS/latency deltas. Synthetic is the viable v1.1 path (vs. game-side hook which needs code signing).

Sketch:
- 30-second GPU workload via a small offscreen WGPU/DirectX render loop, capture frame times.
- 5-second mouse-input latency probe (round-trip via SetCursorPos / GetCursorPos).
- Optional: network jitter probe via short ICMP/TCP burst.
- Before/after captures around an apply, delta in the rec card or History entry.

Would need: a benchmark crate or hand-rolled DX harness; a dedicated benchmark UI surface; user opt-in (consumes ~1 min of CPU/GPU per benchmark).

## Things explicitly NOT to do until further notice

- No new "configuration category" tabs beyond what already exists (user wants simplicity)
- No aesthetic polish beyond what the dark theme + tab bar already gives us
- No telemetry/crash-reporting infrastructure until paid users exist (privacy first)

## Quick verification on session resume

```powershell
cd C:\Users\Kuya\code\sentinel
git log --oneline | head -20
# Dev server may still be running from the last session — check:
Get-Process sentinel -ErrorAction SilentlyContinue
# If not, restart:
npm run tauri dev    # incremental ~10s, full ~3-5 min from cold
```
