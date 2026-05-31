# Sentinel — NVIDIA GPU Sensor Validation Plan

**Goal:** graduate NVIDIA GPU sensor support from *"implemented, not yet hardware-verified"* →
*"verified."* The NVML code path is written but has **never run on real NVIDIA hardware** — the
dev machine is AMD (RX 9070 XT). This plan is the checklist to verify it on an actual NVIDIA
GPU and the exact criteria/locations to flip the honesty label afterward.

> **Who can run this:** requires a machine with an NVIDIA GPU + current driver. The owner's dev
> box is AMD, so this needs an external NVIDIA tester/machine. Until then the label stays
> "implemented, not yet hardware-verified" — do **not** flip it on faith.

## What's implemented (the thing under test)

- Crate: `nvml-wrapper = "0.10"`, loading `nvml.dll` (ships with the NVIDIA driver).
- Init: `Nvml::init()` once, cached; returns `None` if NVML/driver absent → sensors simply
  don't appear (no crash). `read_nvml_sensors()` in `src-tauri/src/monitoring.rs`.
- Enumerates **all** NVML devices (`device_count` / `device_by_index`) and reads, per device:

| Sentinel field | NVML source | Notes |
|---|---|---|
| `temperature_c` | `temperature(TemperatureSensor::Gpu)` | core temp |
| `hotspot_temperature_c` | — | always `None` (NVML doesn't expose hotspot) |
| `utilization_gpu_pct` / `utilization_memory_pct` | `utilization_rates()` | instantaneous; noisy |
| `vram_used_bytes` / `vram_total_bytes` | `memory_info()` | bytes |
| `graphics_clock_mhz` | `clock_info(Clock::Graphics)` | boost fluctuates |
| `memory_clock_mhz` | `clock_info(Clock::Memory)` | |
| `power_draw_w` | `power_usage()` mW→W (÷1000) | board power |
| `fan_speed_pct` | `fan_speed(0)` | % (passive cards may report 0/none) |
| `fan_speed_rpm` | — | always `None` |

- `get_gpu_sensors()` merges NVML output with the AMD/ADLX poller cache.

## Reference tools (ground truth to compare against)

1. **`nvidia-smi`** (ships with driver) — primary reference:
   ```
   nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,clocks.current.graphics,clocks.current.memory,power.draw,fan.speed,memory.used,memory.total --format=csv -l 1
   ```
2. The in-driver GeForce overlay and/or HWiNFO64 as a secondary cross-check.

## Procedure

Run Sentinel (`npm run tauri dev`) on the NVIDIA machine, open the Monitoring tab, and compare
Sentinel's readings against `nvidia-smi` sampled at the same time. Drive load with a game or a
GPU stress (so values aren't all idle), and check both idle and under-load.

### Per-metric cross-check (tolerances account for sampling skew)

- [ ] **Device name** matches the actual GPU.
- [ ] **Temperature** within ±2 °C of `temperature.gpu`.
- [ ] **GPU utilization** tracks `utilization.gpu` (instantaneous — expect noise; verify it
      moves correctly idle→load, not exact equality).
- [ ] **Memory utilization** tracks `utilization.memory`.
- [ ] **Graphics clock** within ~±50 MHz of `clocks.current.graphics` (boost fluctuates).
- [ ] **Memory clock** matches `clocks.current.memory` (note: NVML may report the real rate;
      confirm it's not half/double due to DDR doubling — record what's shown vs `nvidia-smi`).
- [ ] **Power draw** within ±5 W of `power.draw`.
- [ ] **Fan speed %** within ±2% of `fan.speed` (passive/0-RPM cards may legitimately show 0
      or none — confirm that's handled, not shown as broken).
- [ ] **VRAM used** within ~±100 MB of `memory.used`; **VRAM total** matches `memory.total`.

### Behavior / robustness

- [ ] **Correct GPU on hybrid/Optimus laptops:** the discrete NVIDIA GPU is shown; integrated
      GPU and the "Microsoft Basic Display Adapter" phantom are not misattributed.
- [ ] **Multi-GPU desktop:** all NVIDIA devices enumerate with distinct, correct values.
- [ ] **Driver/NVML absent (e.g., a clean AMD-only box):** NVIDIA sensors are simply absent —
      no crash, no error spam.
- [ ] **FPS / frametime** (ETW, vendor-agnostic) re-confirmed working with a DX11/DX12 game on
      NVIDIA, and the **overlay** shows the NVIDIA sensors.
- [ ] No NVML version-mismatch crash on an older driver (note the oldest driver tested).

## Exit criteria → graduate the label

When every per-metric check passes within tolerance on **at least one modern NVIDIA desktop
GPU** (ideally also one laptop/Optimus), and the absent-driver case is graceful:

1. Update the coverage label at `src/App.tsx` (~lines 833–834):
   `NVIDIA — implemented, not yet hardware-verified` → `NVIDIA — verified`.
2. Remove/adjust the per-card **"unverified"** pill + tooltip at `src/App.tsx` (~lines 1150–1153).
3. Record in `CLAUDE.md` which NVIDIA hardware + driver version it was verified on (so the
   "verified" claim is auditable, mirroring how AMD was verified on the RX 9070 XT).

Do **not** flip the label from code review alone — this label is a trust claim and must be
backed by a real-hardware run, same bar as AMD.
