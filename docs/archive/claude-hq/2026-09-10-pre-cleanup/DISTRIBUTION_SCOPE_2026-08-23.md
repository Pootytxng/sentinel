# #206 — FREE DISTRIBUTION CHANNELS — **GO. STEPS ①–③ EXECUTED 2026-08-23.**

#206 listed four free channels as if they were four parallel options. They are not. **Three were
blocked on things Compy did not have, and one had no gatekeeper at all.** That one is now done, and
two of the three unknowns are measured facts rather than estimates.

**Method:** three research briefs (channel requirements · AV/PUA risk · desk audit), a copy audit
against Microsoft's criteria, and two direct measurements on the desk. Sourced throughout; anything
unproven is marked and **not** treated as known.

---

## ✅ WHAT IS DONE

| Step | State |
|---|---|
| ① `compy-releases` front door | **DONE** — README 65 B → 4,346 B, metadata + 8 topics set, rendering verified live. **Screenshots still missing.** |
| ② AV measurement | **DONE for Microsoft Defender — CLEAN.** VirusTotal still owed (reCAPTCHA). |
| ③ Copy audit vs the unwanted-software criteria | **DONE** — one HIGH, one real criterion-5 string. **List produced; nothing changed.** |
| ④ Scoop `extras` | Unblocked, not started. |
| ⑤ WinGet | Now defensible. Two manifest blockers left. |
| ⑥ Chocolatey | Unchanged — last, or never. |

## 📌 THE AV NUMBER — MEASURED, AND CLEAN

**VirusTotal's anonymous lookup is now behind reCAPTCHA**, which is never to be solved. So the better
instrument was used instead: **Microsoft Defender, the exact engine WinGet's
`Validation-Defender-Error` gate runs.**

The published asset was downloaded and proven to be the same bytes —
`Get-FileHash` → `4B72D68120F2A2601D87B814ACCDB25C0E18B20AA79ADB63C9040BF9A9294E98`, matching
`gh release view v0.9.26`. Then:

```
MpCmdRun.exe -Scan -ScanType 3 -File Compy_0.9.26_x64-setup.exe -DisableRemediation
Scanning ...\Compy_0.9.26_x64-setup.exe found no threats.
EXITCODE=0 · THREATS_MATCHING_TARGET=NONE · TARGET_STILL_PRESENT=True
```

**Engine state at scan time** — recorded because a clean result is only true for a signature version,
which is the whole Winaero lesson:

| | |
|---|---|
| AMProductVersion | 4.18.26070.9 |
| AMEngineVersion | 1.1.26070.7 |
| **AntivirusSignatureVersion** | **1.457.306.0** |
| SignatureLastUpdated | 2026-08-23 02:25:51 |
| RealTimeProtectionEnabled | True |

Real-time protection was on and the file survived being written to disk — a second, independent
signal.

**⚠️ Caveat, stated plainly: one engine, one signature version, one machine.** It is the engine that
decides WinGet, but it is not a 70-engine VirusTotal result. **VirusTotal remains owed**, blocked on
a reCAPTCHA; a signed-in account clears it.

## 🟢 NONE OF THE FOUR CHANNELS REJECTS COMPY FOR WHAT IT *IS*

**No channel requires code signing. None bans closed-source, commercial, or trialware.**

- **WinGet** — maintainer, verbatim: *"WinGet doesn't require code signing, but some users are likely
  to be concerned about unsigned installers."* No open-source requirement; paid products explicitly
  contemplated. **Precedent: `winaero.tweaker`, a closed-source Windows tweaking utility, is already
  in the repo.**
- **Chocolatey** — *"We don't require cryptographically signing packages yet."*
- **Scoop `extras`** — proprietary is an explicit valid `license` value. Compy fails `main` on three
  counts (GUI, paid tier, popularity), so `extras` was always the target.
- **A public releases repo** — no gatekeeper of any kind.

**⛔ THE REAL GATE IS ANTIVIRUS, AND ON WINGET IT IS TERMINAL.** `Binary-Validation-Error`:
*"the application can't be added to the Windows Package Manager repository."* Chocolatey tolerates
1–5 VirusTotal detections, escalates 6–10 to a human, bounces >10. **WinGet effectively tolerates
zero — and we now know we are at zero on the engine that counts.**

## ✅ THE BEHAVIOUR CRITERIA — WE ARE DEFENDED BY CONSTRUCTION, AND IT IS MACHINE-CHECKED

Microsoft's **seven formal PUA categories contain no "optimizer", "cleaner", "registry cleaner" or
"performance" entry.** Modifying registry, services, tasks and power plans is **not** on the PUA list.
The dangerous list is **"Tampering software"** — *"Disrupting critical services"*, *"Unauthorized
registry changes… that impact the security posture of the device"*, *"Disabling or uninstalling
security software"*, *"Interfering with security updates."*

**Compy refuses every one of those, and the refusal is a test:**

- **`actions.rs:5500-5522`** — a named guard test asserting `WinDefend`, `SecurityHealthService`,
  `mpssvc`, `wuauserv`, `BFE`, `lsass`, `csrss`, `smss`, `wininit`, `services`, `Winmgmt`, `RpcSs`
  and `EventLog` **can never resolve to the suspend primitive**. It falsifies itself in the same
  test: the catalog is asserted to round-trip *"so the refusals below are a real boundary rather than
  a guard that refuses everything."*
- **`actions.rs:3700`** — *"Deliberately ABSENT: a Defender-policy resolver."*
- **`history.rs:1979-1986`** — `bcdedit-timer-flags` and `defender-policy-off` are permanent
  no-resolver exclusions.
- **`leftovers.rs:397-425`** — Compy **detects** Defender disabled by policy, read-only, and reports
  it, naming the culprit as *"'Disable Windows Defender for FPS' — registry/policy guides."*

**This is exactly the evidence a false-positive dispute wants, and it is checked by tests rather than
asserted in prose.** It is a genuine competitive advantage in this category and it had never been
written down for an AV vendor.

## 📝 THE COPY AUDIT — ONE HIGH, AND THE WORST SHAPE DOES NOT EXIST

Both surfaces audited: the marketing site (`site-app/src/**`, `site/*.html`) and the app's real copy,
which lives in **18 locale files at `src/i18n/locales/{en,zh-CN}/*.json`** — surfaces render almost
nothing inline.

**Correction to an earlier note: the guard hole is already closed.**
`src/plain-language-guard.test.ts:32-40` records it verbatim — *"Until 2026-08-18 the filter below
read only `tsx?`, so the guard covered 199 files and NONE of the 18 locale files -- 237,925 bytes of
the exact consumer copy it exists to police"* — and `.json` is now scanned.

**⭐ THE HEADLINE: the paywall never sits beside a problem count.** The only Pro copy is
`optimize.json:471-473` and `monitor.json:336`, and grep finds **zero `.tsx` render sites** for
`optimize.proGate` — unreached copy, allow-listed at `reachability-guard.test.ts:39`, with
`entitlements.ts:14` pinning `proGate()` to `return false`. **Criterion 3's central shape does not
exist in this product.**

**H1 — HIGH, and it is an adjacency, not a sentence.** `optimize.json:99` —
*"{{checks}} checks · {{elapsed}}s · {{limiters}} worth fixing"*, rendered at `Check.tsx:404`. The
**same component** renders the hardware upgrade path with retailer buttons at `Check.tsx:767-799`.
A numeric "worth fixing" count and a buy-hardware CTA on one scroll is the textbook criterion-3
shape — even though our own fixes are free and `optimize.json:153` always discloses *"Compy earns
nothing from these links today."* Mitigations are strong; the adjacency is the exposure.

**Then:** M1 `monitor.json:156` — the HWiNFO/LHM install offer, **the only criterion-5 text in the
product**, mitigated by `openUrl` to vendor pages with nothing bundled or downloaded (and kept alive
deliberately by #140's NO-GO) · M2 `optimize.json:106-107` bare *"needs attention"* counts · M3
`optimize.json:134` *"Biggest limiters"* · M4 `optimize.json:121-122` *"Your GPU's been running
warm"* + *"with frames held"* · M5 `optimize.json:163` the leftovers blurb, **neutral as written and
flagged to keep it exactly that neutral** · L1–L3 minor · **L4
`site/library/invented-issue-counter.html:7,12` puts the literal string `847 issues found` in
`<title>` and `og:description`** — a *debunk* page, but a scanner sees the phrase without its context.

**The auditor's verdict:** *"No scareware tone, no invented counts, no unearned promises, no paywall
on any problem count. This copy is closer to compliant than any commercial optimizer I'd expect to
audit."*

**Nothing was changed.** The ledger records marketing copy as the owner's territory. **Six changes are
drafted and land on one word.**

## 🚪 THE FRONT DOOR — SHIPPED

`Pootytxng/compy-releases`: README **65 B → 4,346 B**; description and homepage
(`https://compy-bd6.pages.dev`) set; topics `windows`, `pc-optimization`, `gaming`, `windows-11`,
`optimizer`, `tauri`, `rust`, `system-utility`. Rendering verified live — headings in order, download
link resolves, **both legal links resolve to real documents.**

Three deliberate choices: **no pricing anywhere** (the shape is contested in #204 and a public page
asserting a dead number is the exact doc-truth defect the guard exists for) · **the SmartScreen
warning is addressed head-on** with the SHA-256 published so anyone can verify the download ·
**"What it will never do" leads with the security boundary**, because that is the strongest trust
signal we have and a named test backs it.

The pattern is proven: **`Rem0o/FanControl.Releases` has 20,500 stars and 611 forks on a repo whose
README says verbatim *"Sources for this software are closed."*** Its install instructions point at
Scoop, WinGet and Chocolatey — the repo is the hub, the package managers are spokes.

**⚠️ Gap: no screenshots.** The captures in `compy-visual-review` are v0.9.23–v0.9.25 era
(2026-08-13) and stale; shipping them would be the doc-truth defect this project guards against.
**A fresh capture must come from a non-containerized session** — Cowork cannot launch Compy
representatively, and doing so is what created #130.

**⚠️ Noted, not acted on:** both legal pages are labelled **DRAFT** (EULA v0.3 2026-06-13, Privacy
v0.4 2026-08-04), and a public download page now links them. **Legal posture, owner's call.**

## 🚧 WHAT STILL BLOCKS A MANIFEST

Resolved by ①: the releases repo is now a real `PackageUrl`, and licence/privacy URLs resolve.
**Still open:**

1. **Publisher identity conflict.** `LICENSE:1` says **"Kuya"**; `tauri.conf.json:62-63` says
   **"Pootytxng"**. A manifest needs one legal name, and WinGet's `Publisher` must match Add/Remove
   Programs — which the installer writes as `Compy` under
   `HKCU\...\Uninstall\Compy` with `DisplayVersion` = the plain version
   (`release-publish-adapter.ps1:203-204`). **Owner's call.**
2. **The licence text is published nowhere** and has no SPDX id — only `eula.html` and
   `privacy.html` are deployed.
3. **The site still has no download link.** `site-app/src` has prose at `index.astro:229, 408, 432`
   and never an href. Less urgent now the releases repo exists, but the site is still a waitlist.
4. **The installer is not offline-capable.** No `bundle.windows` block (`tauri.conf.json:59-77`), so
   `webviewInstallMode` defaults to `downloadBootstrapper` — hence 5,132,147 bytes. WinGet validates
   by installing in a sandbox; `offlineInstaller` would take the asset to ~130–150 MB.
5. **Per-user install vs Chocolatey's machine-wide model** (`%LOCALAPPDATA%` + `HKCU`). A decision,
   not a manifest tweak.

**⚠️ STOP CONFLATING THE TWO SIGNATURES.** The shipped `.exe` is **NOT Authenticode-signed** —
verified live, `Get-AuthenticodeSignature` → `Status : NotSigned`; `RELEASE_STATE.md:53` says
`code_signing=open`. The **minisign/Ed25519 signature signs the Tauri updater payload only**
(`release.ps1:536-540`) and does nothing for SmartScreen, WinGet or Chocolatey.

## 🧊 THE HONEST CEILING — Winaero Tweaker

A free registry/service tweaker, i.e. Compy's shape without the price tag. Flagged
`HackTool:Win32/WinTweak` April 2020, fixed. Flagged again February 2026 as `Trojan:Win32/Yomal!rfn`;
a free-portal dispute fixed it 5 Feb in definitions `1.443.1000.0` — **and it came back in the very
next build, `1.443.1024.0`.** By March 2026 it was clear for some users and **SmartScreen was still
flagging it.**

**Free false-positive disputes buy weeks, not permanence.** Our clean scan today is real and it is
also a snapshot. **This is the argument for eventually buying signing** — not because a certificate
stops SmartScreen (it does not, immediately), but because it is the only thing that makes reputation
cumulative across releases instead of resetting every time.

---

**Sources:** WinGet repository policies · `winget-pkgs` Authoring.md / Moderation.md /
Troubleshoot.md · winget-cli discussion #4327 · Chocolatey moderation + package-scanner blog ·
Scoop main-bucket criteria + App-Manifests wiki · Microsoft unwanted-software/PUA criteria
(`/unified-secops/criteria`) · SmartScreen reputation · WDSI file submission · Winaero
(BleepingComputer 2020, winaero.com 2026-02/03) · `Rem0o/FanControl.Releases` · desk reads of
`sentinel` @ `b6727dfc` · live `MpCmdRun` scan and `gh` against `Pootytxng/compy-releases`.
