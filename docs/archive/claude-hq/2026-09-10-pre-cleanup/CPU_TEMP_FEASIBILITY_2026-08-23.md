# #140 CPU TEMP — FEASIBILITY COMPLETE · **DECISION: NO-GO** (2026-08-23)

> **OWNER DECISION, 2026-08-23: Compy will NOT bundle, install, download, recommend, update or
> remove PawnIO.** #140 is CLOSED as completed — the question was answered. The deferred
> passive-detection option is **#202**, and it is **not authorized for implementation**.
>
> **This document SUPERSEDES the mechanism half of `claude/CPU_TEMP_SOURCING_DOSSIER.md`.** That
> dossier's *rejections* all still stand. **Its recommendation — "bundle PawnIO, read the MSRs from
> Rust" — is retired, and was also technically wrong.**

The answer was never "it cannot be done." It can. The price is wrong.

---

## THE DECISION AND ITS SEVEN REASONS

1. **FACEIT officially lists `PawnIO.sys` as a forbidden driver** — its signing certificate is also
   used by cheat software — and in the field **the anti-cheat refuses to launch**. The user cannot
   play the match. Compy's audience is gamers. **A CPU temperature is not worth taking someone's game
   away.** Signer-level; nothing Compy does changes it.
2. **Compy cannot ship self-built production modules.** The retail driver enforces upstream RSA
   signatures; the "unrestricted" installer stays signature-restricted absent Windows Test Mode and a
   custom source build (`PawnIO.Setup#11`).
3. **The proposed mechanism was wrong.** AMD package temperature is an **SMN** read —
   `F17H_M01H_THM_TCON_CUR_TMP = 0x00059800` via `ioctl_read_smn`, then `(temp >> 21) * 125` mdeg
   with `TEMP_RANGE_SEL`/`TJ_SEL` handling. **Not an MSR read, and not `RyzenSMU`.**
4. **Future CPU coverage would depend permanently on upstream signed-module cadence**, unpatchable by
   Compy.
5. **Redistributing the driver or installer carries GPL and source-offer obligations.** The IOCTL
   exception protects Compy's proprietary Rust; it does not cover the redistribution itself.
6. **No verified paid closed-source precedent** offsets the product, licensing, support and
   anti-cheat risk. The closest paid analogue, **OCCT, built its own signed driver instead**.
7. **A persistent kernel driver contradicts Compy's rollback-first safety contract** and its
   ordinary-gamer positioning.

**The native call-time elevation experiment is CANCELLED** for this path — not deferred quietly. It
returns only if #202 is ever pursued.

## WHAT STILL STANDS FROM THE OLD DOSSIER

Every **rejection** was re-confirmed and none is reopened: HWiNFO (licensing + the self-regenerating
12-hour SHM expiry), LHM/WinRing0, AMD Ryzen Master SDK, ADLX, Intel Power Gadget, Compy owning a
signed driver. **Do not re-propose any of these without naming this rejection.**

Live blocklist re-check, policy **v10.0.29545.0** (enforced XML 2026-04-09, 1,713 Deny rules):
**PawnIO.sys absent** · WinRing0 **blocked, 29 hash rules** + signer cap ≤ 2.0.0.0 · Ryzen Master
blocked ≤ **1.5.0.0** · uProf blocked ≤ **6.1.0.0**. The AMD rules are version-capped rather than
blanket, so a *current* driver is technically unblocked — they stay rejected on redistribution
grounds.

## WHAT THE DECISION DOES NOT TOUCH

`src-tauri/src/cpu_temp.rs` and `src/surfaces/CpuTempOffer.tsx` are unaffected. A user already
running HWiNFO or LHM still gets a reading. **Compy reads no CPU temperature on the owner's own desk,
and after this decision it still will not. That is the accepted outcome, not an open defect.**

## TECHNICAL FACTS ESTABLISHED — do not re-derive (carried into #202)

- The module is **`AMDFamily17`**, gate `if (family < 0x17 || family > 0x1A) return
  STATUS_NOT_SUPPORTED;` — so it covers Zen 5. **There is no `AMDFamily1Ah` module**, and
  **`RyzenSMU` is PM-table/SMU only, not temperature.** The old dossier named the wrong module twice.
- The owner's **9850X3D is family `0x1A`, model `0x44`, Granite Ridge** — LHM routes it to
  `Amd17Cpu` → `case 0x44: //Zen 5`, package **and** per-CCD temps.
  **Unverified:** no published 9850X3D-specific PawnIO readout exists; coverage is inferred from
  identical CPUID to the 9800X3D/9950X3D. Solid inference, still an inference.
- **`PawnIOLib.dll` is LGPL-2.1-or-later**; the driver is **GPL-2.0-or-later** with an exception for
  *"independent modules that communicate with PawnIO solely through the device IO control
  interface"* — explicitly **not** covering Pawn-interface code. Compy's Rust stays proprietary while
  it talks only via `DeviceIoControl`.
- **Passive detection never redistributes the driver**, so the GPL obligations that helped kill the
  bundled path do not attach to #202 — the only reason that option survives at all.

## THE LESSON THIS LANE ADDS

**A dossier's recommendation ages worse than its research.** The rejections here survived four days
of scrutiny intact; the *plan* built on them was wrong in two load-bearing ways — wrong module, wrong
register class — and neither error was visible until someone read the module sources rather than the
summary. **When an artifact carries both findings and a plan, date and mark them separately: the
findings may still be true long after the plan is dead.**

And the second: **the blocker that killed this was not technical.** Licensing was clean, the CPU was
covered, the blocklist was clear. It died on what the feature would do to a user's *other* software.
**Feasibility that only asks "can we build it" will miss that every time.**
