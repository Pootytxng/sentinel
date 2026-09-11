# DATA-ROOT INTEGRITY — evidence pack for issue #130

**Filed 2026-08-18.** Appendix to `claude/HQ_DECISION_LEDGER.md`. Read this if you are working #130.
Full evidence and the resolver design live on the issue; this file carries the parts a future
session cannot recover from GitHub.

---

## ⚠️ THE VANTAGE WARNING — read this before trusting ANY reading you take from Cowork

**Every Cowork / packaged-Claude session on this desk runs inside an MSIX container.** Proven
2026-08-18: the shell's process ancestry is
`powershell.exe → powershell.exe → claude.exe (C:\Program Files\WindowsApps\Claude_1.32352.0.0_x64__pzs8sxrjxfjjc\app\claude.exe) → sihost.exe`.

Consequences, all verified, all non-obvious:

- **`%APPDATA%` paths lie.** `C:\Users\Kuya\AppData\Roaming\Compy` resolves to
  `C:\Users\Kuya\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Compy`. Same
  SHA-256, same length, same mtime, **same NTFS file id** at both paths — while
  `AppData\Roaming` and the package `LocalCache\Roaming` report the *same directory file id* and
  enumerate **43 entries vs 4**. Same id + different contents = an overlay presenting the source
  id, not a junction. `fsutil reparsepoint query` says "not a reparse point"; `Get-Item` shows no
  `LinkType`. The overlay is invisible to every ordinary check.
- **`$env:APPDATA` is NOT rewritten.** It reads `C:\Users\Kuya\AppData\Roaming`, correctly. Anything
  that validates the *string* passes. This is why #129 named the wrong mechanism.
- **`HKCU` and `HKLM\Software` are virtualized too.** The package hive
  `...\Claude_pzs8sxrjxfjjc\SystemAppData\Helium\User.dat` is live (written 2026-08-18). Any
  `HKCU` reading taken from Cowork is a merged view and cannot be attributed to the machine.
- **NOT virtualized, so these readings ARE trustworthy from Cowork:** the SCM (`Get-Service`),
  the power subsystem (`powercfg`), Task Scheduler (`Get-ScheduledTask`), and `HKLM\SYSTEM`.
  The repo checkout under `C:\Users\Kuya\code\` is also unaffected — git work is fine.
- **There is no escape from inside.** Tried and failed: `\\localhost\C$\...` and `\\127.0.0.1\C$\...`
  (admin share; the token is not elevated), and `\\?\GLOBALROOT\Device\HarddiskVolume3\...` (still
  filtered). To read the machine's real `%APPDATA%`, a human or a non-packaged agent must run it.

**Operating rule:** before asserting anything about `%APPDATA%`, `%LOCALAPPDATA%` or `HKCU` from a
Cowork session, say which vantage it came from. Match the instrument to the layer — and this is a
layer the subject can hide from.

---

## What the incident actually is

Compy has been launched at least once as a child of packaged Claude (the sibling `gg.compy.app`
WebView2 profile in the same overlay is dated 2026-07-23). It therefore wrote its Trust Ledger,
`sessions.json` (1.1 MB), `drift.json`, `experiments.json`, `intelligence.json`, `runtime\` FPS IPC
and exports into the package overlay instead of the machine.

**The mutations still reached the real machine.** MSIX does not virtualize services, power, Task
Scheduler or `HKLM\SYSTEM` — and **12 of the redirected ledger's 38 applied receipts are confirmed
live on the real desk**. So the redirected ledger is the *only* record of real, still-live Windows
changes, and a normally-launched Compy cannot see it, therefore cannot roll them back.
**LOCKED rule 3 (rollback-first integrity) is broken on this desk right now.**

`scripts/release.ps1:100` and `scripts/ship-reinstall.ps1:118` share the defect and **fail open**:
run from a packaged host, their Gaming Mode preflight inspects the sandbox root, finds no
`gaming-session*` contract, and would permit a release over a real pending session.

## Numbers that matter

- Redirected ledger: **61 receipts / 38 applied / 23 rolled back**, SHA-256 `ABB928FE…57EA`,
  44967 bytes, mtime `2026-08-13T23:00:54.368Z`.
- **"38 applied" is 13 distinct changes, not 38.** `game-mode` alone is 23 of them — repeated
  re-applies that never rolled back their predecessor. Sizing recovery off 38 overstates blast
  radius ~2.9×.
- Inventory verdicts: **12 `matches` · 2 `drifted` · 24 `cannot safely determine`** (24 = the 23
  `game-mode` + `visual-effects`, all `HKCU`, all vantage-blocked).
- The 2 `drifted`: Windows renamed `Microsoft Compatibility Appraiser` →
  `Microsoft Compatibility Appraiser Exp`. Intent still holds (the renamed task is Disabled) but
  `resolve_rollback` cannot resolve the named target. Independent of the data-root bug.

## Two #129 claims this lane could NOT re-prove

1. Canonical `%APPDATA%\Compy\history.json` = 3 receipts / 1 applied / 2 rolled back. Unreadable
   from any packaged session. Inherited, not verified.
2. "Zero receipt IDs overlap." The overlay folder appeared ~2026-07-23 and its newest receipt is
   2026-07-22 — the signature of **copy-on-write**, which would imply heavy ID overlap. One of the
   two readings is wrong.

**The one command that settles both** — run from a normal terminal, NOT Cowork, read-only:

```powershell
$p = "$env:APPDATA\Compy\history.json"
(Get-FileHash -Algorithm SHA256 $p).Hash
(Get-Item $p).Length
$j = Get-Content $p -Raw | ConvertFrom-Json
$j.Count
($j | Group-Object status | ForEach-Object { $_.Name + '=' + $_.Count }) -join ' '
($j | Select-Object -First 3 -ExpandProperty id) -join ' '
($j | Select-Object -Last 3 -ExpandProperty id) -join ' '
```

If the hash is `ABB928FE…57EA` there is no split and #129's canonical figures came from a redirected
vantage. If it differs, the split is real and the id lists settle the ancestry question.

## Also found, not previously recorded

`compy_data_dir()` falls back to **`C:\Temp`** when `APPDATA` is unset — a third silent Trust Ledger
root on a shared path. Removed by the design.

## Lane state

- Issue **#130**, Work Control **Active / Cowork**, worktree
  `C:\Users\Kuya\code\sentinel-data-root-integrity`, branch `agent/data-root-integrity` at `8c547ce7`.
- Design committed **`6aa5c8c9`** — `docs/decisions/2026-08-18-canonical-data-root.md`. Resolver
  contract, three detection predicates, `MutationRoot` as a type, six guards.
- **Branch deliberately NOT pushed.** The pre-push hook is the full gate, whose `launch-focus-guard`
  runtime tier fails on an input-idle desk (#121). The documented workaround is having Compy open
  during the push — and launching Compy from this packaged host is the exact act that caused the
  incident. Push it from a normal session.
- Next: implement `DataRootDecision` + `MutationRoot` behind the six guards, on that branch.
- **Frozen, untouched:** both data roots byte-for-byte; `.codex/config.toml`; every pre-existing
  worktree; #128 and its `707572f1`; #126 not executed; local-only `63e74591`; no prune/gc/reset;
  no UAC/Defender/firewall/policy change; `release.ps1` and `ship-reinstall.ps1` not run.
