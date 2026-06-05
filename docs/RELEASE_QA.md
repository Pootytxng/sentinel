# Compy — Release-Gate QA Checklist

> ✅ **MANUAL-MUTATION QA — LIFTED 2026-05-31 (owner sign-off APPROVED).**
> This blocker is closed. Verified live on a UAC-on machine:
> - **§1** elevation PASS (accept + cancel).
> - **§2** apply-accept mutates correctly (real applies left USB/PCIe AC=0, HiberbootEnabled=0;
>   typed contracts present).
> - **§4** rollback restores exact prior state.
> - **§2a** power-plan fidelity **PASSED** — rollback of a Balanced-stored `pcie-aspm-off` while
>   Ultimate was active restored Balanced (0→1) and left Ultimate untouched (no SCHEME_CURRENT
>   fallback, no forced switch). Decisive live proof of `070c3c9`.
> - **§3** apply-cancel: structurally guaranteed (apply returns on the elevation error via `?`
>   before any history write) + runas-cancel verified live in §1; live UX check optional.
> - Restart-persistence demonstrated (ledger survived reboot + restarts); no orphan helpers;
>   Compy correctly withholds already-satisfied / hardware-inappropriate recs.
>
> **Non-blocking follow-ups (optional):** live elevated-apply UAC cancel-message UX check;
> external-revert "no longer active" UI observation.
> **Still gates beta/public release (separate from mutation QA):** code-signing config, legal
> finalization (license model + jurisdiction in PRIVACY/EULA), and per-feature QA for any new
> mutating feature (e.g. F1 Gaming Mode). Remote fetch stays disabled. F5/F4 (read-only) unblocked.

Manual, interactive QA pass. The structural refactor + automated checks are done
(`cargo test` 44/44, `cargo build` zero warnings, `npm run build` clean). This
covers what only a human at the machine can verify: real Windows mutation,
elevation prompts, restart, external changes, and live-game monitoring.

Run the dev app with `npm run tauri dev` from the repo root. History lives at
`%APPDATA%\Compy\history.json`.

Legend: ☐ todo · ✅ pass · ❌ fail (note what happened)

---

## 0. Re-enable UAC (prerequisite for §1)

This dev box shipped with UAC **off** (`EnableLUA=0`), so the `runas` elevation
path has **never executed here**. `EnableLUA` is now set to `1`; it activates on
reboot.

- ☐ **Reboot** the machine.
- ☐ After reboot, confirm UAC is on: open an elevated app and confirm a consent
  prompt appears.

Revert when QA is done (optional, restores the old dev convenience):

```powershell
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name EnableLUA -Value 0 -Type DWord
# reboot to apply
```

---

## 1. Elevation / UAC path (the never-tested path)

- ☐ **FPS helper elevation** — click *Enable FPS monitoring* → a UAC prompt
  appears → accept → helper launches, FPS panel starts working.
  - The screen dims and input is blocked while the prompt is up. **This is the
    UAC prompt, not a freeze** — confirm it clears the moment you answer.
- ☐ **Cancel the UAC prompt** for FPS monitoring → clean error message, app
  stays responsive, no half-started helper (check Task Manager: no orphan
  `compy.exe --fps-capture`).
- ☐ **Elevated apply** — apply any elevated rec (e.g. `sysmain-disable`) → UAC
  prompt → accept → applies, ledger entry written.
- ☐ **Cancel an elevated apply** → clean error (e.g. "Did you cancel the UAC
  prompt?") → **no ledger entry written**, Current state unchanged.

---

## 2. Apply / rollback smoke — per recommendation

For each rec: **Apply** → *Current* row updates → *Applied by Compy* = yes →
Trust Ledger entry correct (title, time, status) → **Rollback** → exact prior
state restored → *Applied by Compy* reverts → ledger status = rolled_back.

**No elevation (HKCU) — safest, start here:**
- ☐ `game-mode`
- ☐ `visual-effects`
- ☐ `mouse-accel-off`
- ☐ `game-bar-disable`

**Elevation required (will prompt UAC):**
- ☐ `hags-enable`  *(needs reboot to truly take effect; the registry flip + rollback is what we're verifying)*
- ☐ `sysmain-disable`
- ☐ `diagtrack-disable`
- ☐ `windows-search-disable`  *(only if you don't rely on Windows Search)*
- ☐ `nvidia-telemetry`  *(only present/relevant on NVIDIA systems — this box is AMD; skip)*
- ☐ `power-ultimate`
- ☐ `nagle-disable`
- ☐ `fast-startup-off`
- ☐ `reserved-storage-off`  *(DISM; slow)*
- ☐ `usb-selective-suspend-off`
- ☐ `pcie-aspm-off`
- ☐ `eee-disable`  *(only if a wired NIC with an EEE property is up)*

### 2a. Power-plan rollback fidelity (the bug just fixed — verify directly)

- ☐ Note your active plan: `powercfg /getactivescheme` (call it **PLAN-A**).
- ☐ Apply `usb-selective-suspend-off` (writes to PLAN-A).
- ☐ Switch active plan: apply `power-ultimate` **or** switch plans manually in
  Windows. Active plan is now **PLAN-B**.
- ☐ Rollback `usb-selective-suspend-off`.
- ☐ Confirm the USB selective-suspend value was restored on **PLAN-A**, not
  PLAN-B: `powercfg /query <PLAN-A-GUID> 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226`
  → AC index back to its pre-apply value. PLAN-B untouched.
- ☐ **Missing-plan fail-safe:** apply a power setting on a *custom* plan, delete
  that plan (`powercfg /delete <GUID>`), then rollback → expect a **clear error**
  ("the power plan it was applied to … no longer exists"), **not** a silent
  restore onto the current plan.

---

## 3. History persistence across restart

- ☐ Apply a change (e.g. `game-mode`).
- ☐ Fully close the app (not just the window — confirm process exits).
- ☐ Reopen → Trust Ledger still shows the change with correct status.
- ☐ Rollback the change → it still works after the restart.

---

## 4. External-revert honesty

- ☐ Apply `game-mode`.
- ☐ Outside Compy, toggle Game Mode **off** in Windows Settings.
- ☐ Refresh / reopen Compy → the ledger entry shows **not currently active**
  (honest: Compy doesn't claim a change it no longer controls is live).
- ☐ Rollback is still offered (we never hide a rollback just because state drifted).

---

## 5. Monitoring with a live game

Use a **DX11/DX12 game in borderless or windowed** mode (overlay can't draw over
exclusive fullscreen — by design, no injection).

- ☐ **GPU sensors (AMD)** — temp, usage, clock, fan, power, hotspot all populate.
- ☐ **CPU / RAM poller** — usage + RAM populate and update.
- ☐ **FPS / frametime** — with the game running and FPS monitoring enabled,
  in-app FPS + frametime populate.
- ☐ **Overlay** — *Show overlay* → HUD appears over the borderless game with
  live values → *Hide overlay* removes it.
- ☐ **Helper exit lifecycle** — disable monitoring → `compy.exe --fps-capture`
  exits (Task Manager shows no orphan).
- ☐ **App-crash → helper self-exit** — with monitoring on, kill the **main**
  `compy.exe` in Task Manager → the capture helper exits on its own within
  ~4 s (heartbeat goes stale).
- ☐ **Stale-ETW recovery** — enable → disable → enable again: no
  "AlreadyExist"/session failure (the `logman stop` on start cleans up).

---

## 6. Failure paths

- ☐ **Corrupt history** — close app, replace `%APPDATA%\Compy\history.json`
  with garbage, reopen → ledger loads **empty**, no crash. *(also unit-tested)*
- ☐ **Missing history** — delete `history.json`, reopen → empty ledger, no crash.
- ☐ **Cancelled apply** — (covered in §1) no success entry on UAC cancel.
- ☐ **Helper crash** — kill `compy.exe --fps-capture` mid-capture → app
  reflects FPS stopped; re-enabling works (no stale session).

---

## 7. UI truth surfaces

- ☐ **Onboarding** (first run, or "Replay intro") — 4 steps; explains
  Recommended vs Applied-by-Compy; explains **why there's no CPU temp**
  (no kernel driver).
- ☐ **Three-row strip** on rec cards — *Recommended / Current / Applied by
  Compy* all present and correct.
- ☐ **Provenance pills** — *Verified* / *Measured signal* / *Expected impact*
  render with the right visual weight.
- ☐ **Rules-source pill** — shows the embedded/baseline source (remote fetch is
  intentionally disabled).
- ☐ **NVIDIA labeling** — monitoring shows "AMD — verified · NVIDIA —
  implemented, not yet hardware-verified · Intel — planned."
- ☐ **Advisory recs** — `gpu-driver-update`, `ssd-upgrade-advisory`,
  `monitor-max-refresh`, `amd-uxp`, `nvidia-low-latency`, `gpu-prefer-discrete`,
  `storage-c-low` show as advisory (no one-click Apply), not as appliable.

---

## 8. Gate to packaging

Do **not** start packaging/signing until §1 (normal-UAC elevation) and §2a
(power-plan rollback fidelity) pass. Packaging-prep findings already logged:
generic bundle identifier (`com.compy.app`), lowercase `productName`, no
publisher/copyright/license, no code-signing config, `csp: null`, and no
license/privacy/EULA content yet.
