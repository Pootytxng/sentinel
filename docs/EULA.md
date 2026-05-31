# Sentinel — End-User License Agreement & Disclaimer

**Status: DRAFT v0.1 (2026-05-31).** Starting-point draft reflecting how the software works
today. **Not legal advice.** The owner should review/adapt this (and have it reviewed by a
qualified professional) before distribution. Owner/contact identity is set (Pootytxng; GitHub
issues); still open before public distribution: final license model and governing-law/jurisdiction.

---

By installing or using **Sentinel** ("the Software"), you ("you") agree to the terms below. If
you do not agree, do not install or use the Software.

## 1. What Sentinel is

Sentinel is a Windows optimization and **configuration-safety** tool for everyday users. It
reads your PC's hardware and settings, recommends changes in plain language, and — when you
choose to apply one — records the prior state first so the change can be rolled back. Sentinel
is designed around a **rollback-first** principle: it tries hard to make every change it
applies reversible from a local history that does not depend on the internet.

## 2. License

Subject to these terms, you are granted a personal, non-exclusive, non-transferable license to
install and use the Software on PCs you own or control. You may not resell, sublicense, or
distribute the Software except as permitted by the owner. *(Private beta. The final license
model — e.g. free for personal use, and whether a separate open-source license governs the
source code — is to be confirmed by the owner before public distribution.)*

## 3. Beta software

The Software is **pre-release / beta**. It may contain defects, behave unexpectedly, or change
significantly between versions. Do not rely on it as your only safeguard for important systems.

## 4. System changes, risk, and rollback

- The Software can modify Windows settings (e.g. services, power plans, registry values,
  network adapter properties) **only when you explicitly choose to apply a recommendation.**
- Before applying a change, the Software records the prior state and offers a rollback.
- **Rollback is provided on a best-effort basis and is not guaranteed in every environment.**
  External changes (Windows updates, other tools, hardware/driver changes, deleted power
  plans, manual edits) can alter or remove the state a rollback depends on. Where Sentinel
  cannot safely restore the exact prior state, it is designed to **stop and tell you** rather
  than guess.
- **You are responsible for your system.** Maintain your own backups / restore points. You
  apply changes at your own risk.

## 5. Administrator access; what Sentinel does NOT do

Some operations and the performance-capture helper require Windows Administrator permission and
will prompt you (UAC). The Software does **not** install a kernel driver and does **not** inject
code into games or other applications.

## 6. Games and anti-cheat

The Software is designed to be compatible with anti-cheat systems (no kernel driver, no game
injection; performance capture uses standard Windows event tracing and an on-screen overlay
that does not hook your game). **However, you are solely responsible for complying with the
terms of service and anti-cheat rules of any game or platform you use.** The owner is not
responsible for actions taken against your accounts by third parties.

## 7. Third-party names

Windows is a trademark of Microsoft. AMD, NVIDIA, Intel, and other product names are
trademarks of their respective owners. Sentinel is an independent project and is **not
affiliated with, endorsed by, or sponsored by** Microsoft, AMD, NVIDIA, Intel, or any game
publisher.

## 8. No warranty

THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE, AND NON-INFRINGEMENT. THE OWNER DOES NOT WARRANT THAT THE SOFTWARE WILL BE
ERROR-FREE, UNINTERRUPTED, OR THAT ANY CHANGE OR ROLLBACK WILL ACHIEVE A PARTICULAR RESULT.

## 9. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE OWNER AND CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA,
PERFORMANCE, PROFITS, OR SYSTEM AVAILABILITY, ARISING FROM OR RELATED TO YOUR USE OF (OR
INABILITY TO USE) THE SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. [Some
jurisdictions do not allow certain exclusions; some rights may not apply to you.]

## 10. Privacy

The Software runs locally and collects no personal data. See `PRIVACY.md`.

## 11. Changes to these terms

These terms may be updated for future versions; the version shipped with a given build governs
your use of that build.

## 12. Governing law / contact

Governing law / jurisdiction: *to be confirmed by the owner before public distribution.*
Contact: **Pootytxng** (Sentinel) — via the project's GitHub issues page:
https://github.com/Pootytxng/sentinel/issues
Project: https://github.com/Pootytxng/sentinel
