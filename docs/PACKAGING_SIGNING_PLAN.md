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

- **Distribution method:** GitHub Releases vs. direct download vs. private invite link.
- **Code-signing route:** none-for-beta now, and which cert for public (Trusted Signing / EV / OV).
- **License model:** (fills `EULA.md` §2 — e.g. free-for-personal-use; is the source separately licensed?).
- **Governing law / jurisdiction** for the EULA.
- **Beta access:** invite-only vs. open link.
- **Crash/log collection:** confirm it stays **fully manual + local-only** (current stance — no
  telemetry; the Export report is the manual share mechanism).

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

- [ ] `cargo test` green · `cargo build` zero warnings · `npm run build` clean
- [ ] `npm run tauri build` produces MSI + NSIS without error
- [ ] **Fresh install** test (clean machine/VM)
- [ ] **Uninstall** test (removes app; note whether it leaves `%APPDATA%\Sentinel`)
- [ ] **Upgrade / install-over-existing** test
- [ ] **AppData persistence:** `%APPDATA%\Sentinel\history.json` (+ sessions/exports) survive upgrade
- [ ] **Trust Ledger survives upgrade** (rollback contracts intact)
- [ ] no remote fetch enabled · no unsigned remote rules · no telemetry/network surprise (confirm
      zero outbound traffic with a network monitor) · no kernel driver / no injection

## 7. Beta package QA (on the installed build)

- [ ] First-launch onboarding shows + "no CPU temp" explanation
- [ ] Hardware detection populates
- [ ] Readiness tab · Sessions tab · Priorities tab render
- [ ] Export report writes Markdown+JSON + "Open folder" works
- [ ] Monitoring / FPS helper under UAC (accept + cancel) — headless helper, no second window
- [ ] Apply + rollback one safe rec end-to-end (exact restore)
- [ ] Uninstall behavior; Reinstall behavior
- [ ] Windows Defender / SmartScreen behavior documented (expected warning for unsigned)

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
