# Sentinel — Packaging & Signing Plan

**Planning / config-audit only. No public release artifact yet.** This is the path to a
**private-beta** installer and, later, a properly-signed public release. The product surface
(Readiness, Sessions, Export, Priorities, Monitoring, Trust Ledger, verified apply/rollback) is
already beta-worthy; packaging is now the safer critical path. Gaming Mode (F1) stays gated.

---

## 1. Current packaging state (audited 2026-05-31)

- `productName`: **Sentinel** ✓
- bundle identifier: **`io.github.pootytxng.sentinel`** ✓
- publisher / copyright: **Pootytxng** ✓ · category **Utility**, homepage, short/long description ✓
- icons: `icon.ico`, `icon.icns`, 32/128/128@2x present ✓ (Windows build won't fail on icons)
- capabilities: **tight** — `core:default` + `opener:default` only; no fs/shell/http exposed to
  the webview (windows: `main`, `overlay`) ✓
- updater: **not configured** ✓ (no `tauri-plugin-updater`, no `createUpdaterArtifacts`)
- **code signing: NOT configured** — needs a cert + owner decision.
- **CSP: `null`** — works, but should be tightened before public release (needs a build+test cycle).
- legal: `PRIVACY.md` / `EULA.md` drafts exist; **license model + jurisdiction still pending**.

## 2. Distribution target

**Private beta path:**
- Build locally with `npm run tauri build` → Windows installers in
  `src-tauri/target/release/bundle/` (`msi/` via WiX, `nsis/` via NSIS; `targets: "all"`).
- **Unsigned / dev-signed limitations:** Windows **SmartScreen** will warn ("Windows protected
  your PC — unknown publisher"); users must click **More info → Run anyway**. This is expected and
  acceptable for an invite/trusted private beta. MSI/NSIS still install fine.
- **Final public release requires proper code signing** (§3) to avoid SmartScreen friction and to
  establish publisher reputation.

## 3. Code signing options

| Option | SmartScreen | Cost / friction | CI-friendly | Use |
|---|---|---|---|---|
| **No signing** | Warns (unknown publisher) | Free | n/a | private beta only |
| **Standard OV cert** | Signed, but reputation builds slowly (may still warn at first) | ~$100–300/yr | Yes (cert in secret) | small public release |
| **EV cert** | Best reputation (often instant) | Higher $ + **hardware token** | Hard (token ≠ CI) | serious public release |
| **Azure Trusted Signing** | Good reputation, MS-managed | Low monthly + identity validation | **Yes** (cloud signing) | recommended public path |
| **GitHub Actions signing** | depends on cert above | — | only if key/cert handled safely | automation later |

**Recommendation:** private beta = **no signing** (accept SmartScreen) to move now; public release =
**Azure Trusted Signing** (good reputation, CI-friendly, no hardware token) or an EV cert. **Never
put a private signing key/cert in the repo, `.env`, or unprotected CI** — same rule as the Ed25519
rules key.

## 4. Required owner decisions

**DECIDED (owner, 2026-05-31):**
- **Code-signing route:** **none for the private beta** (unsigned → expected SmartScreen warning).
  Public-release signing route still TBD (recommend Azure Trusted Signing).
- **Distribution:** **private invite link / direct download.**
- **Beta access:** **invite-only.**
- **Crash/log collection:** **fully local-only / manual** — no telemetry, no auto-collection; the
  Export report is the manual share mechanism. (No new code; zero-telemetry promise intact.)

⇒ The private beta is **unblocked**: no cert, no hosting setup, no new code. Remaining packaging
work is the §6 build/pre-package checks + §7 beta QA. CSP stays `null` for the trusted invite-only
beta (local app, no remote content); tighten + test it before any public release.

**Still pending — LEGAL track, gates PUBLIC release only (not the private beta):**
- **License model** (fills `EULA.md` §2).
- **Governing law / jurisdiction** for the EULA.
- Public-release **code-signing route** (Trusted Signing / EV / OV).

## 5. Tauri config audit (status)

| Item | Status |
|---|---|
| identifier | `io.github.pootytxng.sentinel` ✓ |
| product name | Sentinel ✓ |
| bundle metadata (publisher/copyright/category/homepage/descriptions) | ✓ |
| Windows installer target | MSI + NSIS (via `targets: "all"`) — could narrow to `["msi","nsis"]` later |
| icon assets | ✓ present |
| updater | disabled ✓ (keep off — see §8) |
| code-signing fields (`bundle.windows.certificateThumbprint` / `digestAlgorithm` / `timestampUrl`, or Trusted Signing) | **absent — add when a cert exists** |
| CSP (`app.security.csp`) | **`null` — tighten + test** (candidate below) |
| capabilities / permissions | tight (`core:default`, `opener:default`) ✓ |
| installer output path | `src-tauri/target/release/bundle/{msi,nsis}/` |
| versioning | `0.1.0` (SemVer); bump `0.1.x` per beta build |

**Candidate CSP to test** (must verify it doesn't break the webview or Tauri IPC before committing):
`default-src 'self'; img-src 'self' data: asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost`

## 6. Pre-package checks (before any beta installer)

> **✅ INSTALLED-BUILD QA COMPLETE & PASSING (2026-05-31).** The private-beta NSIS installer is
> functionally verified — **no private-beta functional blockers remain.** §6 + §7 below all pass.
> Public release remains gated on **code signing + legal finalization**; **Gaming Mode (F1) remains
> gated** and is NOT covered by the lifted manual-mutation QA sign-off.

- [x] `cargo test` green (68/68) · `cargo build` zero warnings · `npm run build` clean
- [x] `npm run tauri build` produces MSI + NSIS without error — **VERIFIED 2026-05-31**:
  `Sentinel_0.1.0_x64_en-US.msi` (3.5 MB) + `Sentinel_0.1.0_x64-setup.exe` (2.3 MB) in
  `src-tauri/target/release/bundle/`. Identity baked into the binary (ProductName Sentinel, Company
  Pootytxng, v0.1.0, © 2026 Pootytxng); signature **NotSigned** (expected); no updater artifacts.
  WiX + NSIS auto-fetched on first build.
- [x] **Install / uninstall / reinstall** — PASS (silent NSIS `/S`; per-user `%LOCALAPPDATA%\Sentinel`;
      registry Sentinel/0.1.0/Pootytxng; uninstall removes exe + registry; reinstall restores).
- [x] **AppData persistence** — PASS: `%APPDATA%\Sentinel\history.json` (Roaming) **survived uninstall +
      reinstall** intact + sessions. (Ledger lives in Roaming, separate from the install dir.)
- [x] **Trust Ledger survives** — PASS: entries + rollback contracts intact across restart and uninstall/reinstall.
- [x] **No remote fetch / unsigned rules / telemetry / kernel / injection** — PASS: **zero outbound TCP**
      from the running installed app (verified live); `rules_source: embedded`; no updater; no driver.

## 7. Beta package QA (on the installed build)

- [x] Onboarding / hardware / **Readiness · Sessions · Priorities** — PASS (owner visual-confirmed; the
      export JSON shows real hardware + readiness + a session, i.e. the data rendered).
- [x] **Export** report writes Markdown + JSON + Open folder — PASS (valid UTF-8; content cross-checked).
- [x] **FPS helper under UAC** — PASS: helper spawns **headless** (no window) at **elevated** IL; main
      stays the only visible window; heartbeat live; ETW capture working.
- [x] **Apply + rollback one safe rec** — PASS: `pcie-aspm-off` applied (AC→0, elevated, typed ledger
      entry) then rolled back with **`070c3c9` stored-plan fidelity verified live** (stored Balanced
      restored 0→1; active Ultimate untouched; no forced switch; ledger → `rolled_back`).
- [x] **SmartScreen** — documented: locally-built installer has no Mark-of-the-Web → no prompt locally;
      **download users see the unsigned "unknown publisher" warning** (expected).

## 7a. Pre-public polish backlog — ✅ CLEARED (2026-05-31)

All five resolved during the polish pass — read-only / safety fixes only; no app behavior, signing,
legal, remote-fetch, updater, recommendation-catalog, or Gaming-Mode changes. `cargo test` 72/72.

1. ✅ Export `.md` **UTF-8 BOM** prepended so non-UTF-8 Windows viewers don't render mojibake (`ac9c70d`).
2. ✅ Storage **logical-disk fallback** when `MSFT_PhysicalDisk` is empty — Export + readiness report the
   logical volumes (e.g. `C:` NTFS) instead of "—" / "no disks" (`514ca0e`).
3. ✅ **AMD GPU driver-age** — **VERIFIED NOT A BUG**; the premise was stale. Live `detect_gpus()` on the
   AMD Radeon RX 9070 XT reads `driver_date 2026-05-12`, `driver_age_days Some(20)` (value at check; `2026-05-12` is the stable fact) via the existing
   DXGI↔WMI name-matched merge (the DXGI and WMI names are byte-identical, so the date attaches). No code
   change; no registry fallback added.
4. ✅ **Install dir vs runtime dir** separated — FPS runtime IPC (`fps.json` / `fps.alive`) moved to
   `%APPDATA%\Sentinel\runtime`, out of the `%LOCALAPPDATA%\Sentinel` install dir (`e87ecdd` + test `512dd11`).
5. ✅ **Single-instance lock** added (`tauri-plugin-single-instance`) — a 2nd launch focuses the existing
   window, so only one main process ever mutates `history.json` (`75e4681`).

## 8. Explicit non-goals

- Do **not** enable remote fetch. Do **not** enable the updater.
- Do **not** build Gaming Mode (F1). Do **not** add recommendations.
- Do **not** relax the privacy / no-telemetry stance.
- Do **not** ship a public release without code signing + legal review.

## Next steps

1. Make only **safe, obvious** metadata/config fixes (audit found none outstanding — identity,
   icons, capabilities, updater are all already correct).
2. Owner decides §4 (signing route, distribution, license, jurisdiction, beta access).
3. Then: tighten + **test** the CSP, run §6 pre-package checks, build a private-beta installer,
   run §7 QA. Public release follows signing + legal finalization.
