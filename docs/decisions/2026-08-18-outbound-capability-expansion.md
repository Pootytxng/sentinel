# Decision — usage analytics ON, in-app feedback, and the CPU-temperature route

**Date:** 2026-08-18 · **Decided by:** the product owner, in session · **Status:** ACTIVE

> Supersedes nothing in `2026-08-09-capability-exception-gate.md` except where stated below. The
> Capability Exception Gate, its process, and every boundary marked absolute there still stand.

## Why this decision exists

The owner's read: building *around* the outbound restrictions had become a bigger drag than the
restrictions were worth — consumer feedback, usage truth and update reach were each being solved the
long way. Two of the three turned out not to be blocked by policy at all; they were blocked by
absolutist copy and by gates nobody had been told to open. This record opens them.

## 1. Honesty stance — truthful, not defensive (AMENDS the tone, not the rule)

**Decided:** never claim something the app does not do; **stop volunteering defensive
"we-collect-nothing" copy.** The Receipts Doctrine's honest-measurement law is unchanged. What is
retired is the reflex of advertising restraint as a feature.

`src/outbound-claim-guard.test.ts` continues to fail the build on an absolute offline claim while an
outbound surface is live. That guard enforces truth, not silence, and stays.

## 2. Tier 2 — usage analytics: ARM IT, ON BY DEFAULT (AMENDS the 2026-08-09 tier definition)

**Amended:** Tier 2 was defined as "opt-in, default-OFF". It is now **on by default, disclosed at
first run, and switchable off in Settings.** `receipts.rs` is already built dark
(`receipts_gate()` at `src-tauri/src/receipts.rs:18`); this is a switch plus disclosure, not a build.

**Unchanged and non-negotiable, because they are what makes the disclosure true:**
payload preview · scrubbed allowlist (no raw logs, dumps, paths or serials) · a real off switch ·
the privacy page and EULA describing exactly what is collected, in the same change that arms it.

**Owner-flagged risk, recorded not resolved:** analytics-on-by-default without prior consent is
lawful in the US and normal in this market, but it is *not* clearly lawful under EU/UK rules. If
Compy is ever sold or distributed into the EU/UK, this default needs a region check first. That is a
money/legal call, so it sits on the owner checklist rather than being decided here.

## 3. Tier 3 — in-app feedback and crash reports: APPROVED TO BUILD

**Decided:** a user can send a crash or a comment from inside Compy instead of emailing the owner.
This is the fastest path to real consumer feedback and it is the reason Tier 3 exists.

Tier 3's own gate is unchanged and still applies in full: explicit per-case consent · preview and
redaction before send · named recipient · retention window · deletion receipt · no background queue,
no inherited consent from Tier 1 or Tier 2. It lives in its own module
(`src-tauri/src/case_evidence_upload.rs`); it may not grow inside `support_evidence.rs`, which stays
local-only (`src/support-evidence-outbound-guard.test.ts` enforces the separation).

**Still needs the owner:** somewhere for the reports to land. Free tier is fine; it must be an
account the owner controls, because it becomes the named recipient in the consent screen.

## 4. CPU temperature — the third-party-driver route is closed by Windows, not by us

The owner asked for native CPU temperature via a popular open-source driver, without paying for
signing. **No candidate meets the bar the owner himself set** ("doesn't cause any other commonly
known conflicts... such as getting flagged by anti-cheats"):

- Every mainstream free option — HWiNFO, Libre/Open Hardware Monitor, MSI Afterburner, FanControl,
  ZenTimings, OpenRGB — reads CPU temperature through **WinRing0**, or a driver in its class.
- WinRing0 is on **Microsoft's own vulnerable-driver blocklist** (CVE-2020-14979: arbitrary kernel
  memory read/write → SYSTEM). The blocklist has been **enabled by default since the Windows 11 2022
  Update**, and is hard-enforced under Memory Integrity, Smart App Control and S mode.
- Microsoft Defender flags it as `VulnerableDriver:WinNT/Winring0`. Shipping it would make **Windows
  Security itself raise an alert on our installer** — strictly worse than an anti-cheat problem, and
  fatal for a product whose entire pitch is being the safe tool.
- Borrowing it would also break the absolute BYOVD boundary in `docs/ARCHITECTURE_LOCKS.md` §1.8.

**Decided direction instead — make the existing path feel native, at zero cost:** Compy already
displays CPU temperature when a sensor app publishes it. Close the gap in *experience*, not in
kernel access: auto-detect a running HWiNFO / Libre Hardware Monitor shared-memory source, offer one
click to turn temperatures on, and stop presenting it as a limitation. The user sees temperature in
Compy; no driver ships, nothing is flagged, no money is spent.

**Parked, not refused:** a Compy-signed driver stays policy-possible under §1.8's own record. It
costs real money (EV certificate + hardware-dev account) and carries blue-screen liability, so under
the ZERO-BUDGET LAW it waits for revenue. Revisit when Tier 2 analytics show the demand.

## What this changes in the code

| Surface | Before | After this decision |
|---|---|---|
| `receipts.rs` gate | dark, opt-in, default-OFF | arm, default-ON, disclosed |
| Tier 3 module | not authorized | approved to build, own gate unchanged |
| `docs/PRIVACY.md`, `docs/EULA.md` | no collection described | must describe collection in the arming change |
| `src/capability-exception-policy-guard.test.ts` | asserts Tier 2 default-OFF | amend to disclosure-on-arming, citing this record |
| Absolute-offline copy | already removed 2026-08-18 | unchanged; the guard stays |

Sources for §4: [Microsoft Defender WinRing0 alert](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/microsoft-defender-antivirus-alert-vulnerabledriver-winnt-winring0) ·
[CVE-2020-14979 / blocklist background](https://www.pcworld.com/article/2912435/if-windows-defender-flags-winring0-on-your-gaming-pc-pay-attention.html) ·
[Open Hardware Monitor issue #1665](https://github.com/openhardwaremonitor/openhardwaremonitor/issues/1665)
