# Compy — End-User License Agreement & Disclaimer

**Status: DRAFT v0.3 (2026-06-13).** Reflects how the software works today, with the owner's
license + jurisdiction decisions applied (v0.3: §2 set to **strict all-rights-reserved** proprietary;
§12 governing law = **United States**). **Not legal advice** — the owner should still have this
reviewed by a qualified professional before public distribution, and must fill the **[STATE]** venue
blank in §12 with the owner's state of residence. Owner/contact identity: Pootytxng (GitHub issues).

---

By installing or using **Compy** ("the Software"), you ("you") agree to the terms below. If
you do not agree, do not install or use the Software.

## 1. What Compy is

Compy is a Windows optimization and **configuration-safety** tool for everyday users. It
reads your PC's hardware and settings, recommends changes in plain language, and — when you
choose to apply one — records the prior state first so the change can be rolled back. Compy
is designed around a **rollback-first** principle: it tries hard to make every change it
applies reversible from a local history that does not depend on the internet.

## 2. License

The Software is proprietary. **All rights reserved.** Subject to these terms, you are granted a
limited, personal, non-exclusive, non-transferable, **revocable** license to install and use the
Software on PCs you own or control, for your own personal use. You may **not** copy (except for a
single backup), resell, rent, lease, sublicense, distribute, publish, modify, translate, adapt,
reverse-engineer, decompile, disassemble, or create derivative works from the Software, except where
such a restriction is expressly prohibited by applicable law. No rights are granted except those
expressly stated here; the owner retains all ownership of and rights in the Software.

## 3. Beta software

The Software is **pre-release / beta**. It may contain defects, behave unexpectedly, or change
significantly between versions. Do not rely on it as your only safeguard for important systems.

## 4. System changes, risk, and rollback

- The Software can modify Windows settings (e.g. services, power plans, registry values,
  network adapter properties) **only when you explicitly choose to apply a recommendation.**
- Before applying a change, the Software records the prior state and offers a rollback.
- **Rollback is provided on a best-effort basis and is not guaranteed in every environment.**
  External changes (Windows updates, other tools, hardware/driver changes, deleted power
  plans, manual edits) can alter or remove the state a rollback depends on. Where Compy
  cannot safely restore the exact prior state, it is designed to **stop and tell you** rather
  than guess.
- **You are responsible for your system.** Maintain your own backups / restore points. You
  apply changes at your own risk.
- **Advisory & educational content (including the "Advanced Black Book").** Compy may present
  *advisory, educational* information about deeper or riskier system, driver, or firmware (BIOS/UEFI)
  tweaks that it **does not perform for you.** Any such tweak you choose to make is carried out
  **manually, by you, outside the Software** — Compy does not apply it, monitor it, or roll it back,
  and these changes fall **entirely outside** the rollback protections described above. Advanced tweaks
  can carry real risks (instability, boot failure, data loss, reduced security, or third-party /
  anti-cheat consequences), and reported benefits are often small or hardware-specific. **You undertake
  any such change entirely at your own risk; the owner and contributors accept no responsibility for the
  outcome of changes you make manually based on this material.**

## 5. Administrator access; what Compy does NOT do

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
trademarks of their respective owners. Compy is an independent project and is **not
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

The Software itself runs locally and collects no personal data. Its one automatic network use is a
**signed update check** (live since 2026-07-22), which carries none of your data and which you can
switch off in Settings; an installer downloads only after you approve it. The Software also contains
an **anonymous results sharing** path that is switched off at the source, so no build you can install
sends anything through it; were it ever enabled in a future signed release, it would remain **off
until you turn it on**, would be disclosed to you on first run, and could be turned off again at any
time. Separately, the Compy
**website** (including the launch-waitlist form) collects your email address — and a one-way hash of
your IP address for spam prevention — only if you choose to submit it. Full detail, including
retention and how to request deletion, is in `PRIVACY.md`.

## 11. Changes to these terms

These terms may be updated for future versions; the version shipped with a given build governs
your use of that build.

## 12. Governing law / contact

Governing law / jurisdiction: these terms are governed by the laws of the **United States** and the
State of **[STATE — owner to insert state of residence]**, without regard to conflict-of-laws rules.
You agree that the state and federal courts located in that state shall have exclusive jurisdiction
over any dispute arising from these terms or your use of the Software.
Contact: **Pootytxng** (Compy) — via the contact channel described in `PRIVACY.md`.
