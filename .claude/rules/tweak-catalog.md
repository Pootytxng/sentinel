---
paths:
  - "src-tauri/src/actions.rs"
  - "src-tauri/src/history.rs"
  - "src-tauri/src/recommendations.rs"
  - "src-tauri/src/services.rs"
  - "src-tauri/src/experiment.rs"
  - "src-tauri/src/gpu_profile.rs"
  - "docs/product/OPTIMIZATION_ENGINE.md"
  - "docs/product/TRIAL_PROTOCOL.md"
  - "docs/product/RISK_MODEL.md"
---
# LOCKED safety rule 6 — the tweak catalog, in full

> **Path-scoped rule: loads when work touches the mutation boundary, the recommendation catalog or
> the Trial/Optimization docs.** The root `CLAUDE.md` keeps rule 6's headline and the whole
> permanent blocklist, so no session can plan a barred tweak without seeing it. This file carries the
> admission rails behind it. Crossing any of this needs an explicit product-owner decision.

**Tweak catalog — OPEN under measurable-benefit-under-rails.** Measurement is an ADD criterion on
top of permanent safety/stability/security/anti-cheat/rollback rails. Every new automated candidate
must fit the constitutional Trial/Optimization Engine and the existing mutation gate. The old rule
that individually-negligible tweaks may accumulate into a stack does not authorize keeping a change
when a per-rig Trial says it has no measurable value for that user/workload.

Permanent blocklist: **timer/HPET** hacks · **bcdedit** boot params · **MMCSS** abuse ·
**core-parking writes** · **Defender disable** · **MPO disable** · **fixed pagefile** forcing ·
**ungated kernel-level capability** · anything that trips **EAC/BattlEye**. These remain barred for
safety/stability/security/anti-cheat reasons; **measurement does NOT make these safe**.

**GPU-profile apply** remains structurally impossible while prior AMD profile state is not reliably
readable enough to satisfy rollback-first.
