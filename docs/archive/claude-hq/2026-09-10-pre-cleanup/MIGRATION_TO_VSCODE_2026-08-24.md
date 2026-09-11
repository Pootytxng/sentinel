# MIGRATION — Cowork lane CLOSED, work moved to Claude Code in VS Code, 2026-08-24

**This Cowork lane is finished. Nothing is left in flight.** The full handoff lives on the owner's
machine at **`C:\Users\Kuya\code\compy-handoff-2026-08-24\HANDOFF.md`** (403 lines) — that is the
document the VS Code session reads. This note exists so the project record knows where the work went
and why.

## Why it moved

The owner's ChatGPT mockups are in the VS Code session, and **visual craft is now the gating concern
for Compy.** That work lives in `src/design/` and `src/surfaces/`, which are held by #49's live
writer on `feat/four-room-visual-direction` — surfaces this lane was correctly locked out of all day.
Running design across two sessions was costing more than it bought.

## The motive the handoff leads with, restated here so it cannot be lost

1. **Compy exists to make the owner money.** `CLAUDE.md` states it. His finances are volatile and
   **cannot carry recurring costs** — which is why the domain is parked, signing is deferred, and the
   price shape was re-opened.
2. **The product must look mastercrafted, and today it does not.** His words: *"looks terrible…
   stale and lifeless."* **He is right** — five concrete rendering defects were found and filed
   (#213), including a logo lockup that renders as `©ompy` on every screen.

**The link between them:** the pricing work concluded Compy has to sell on **trustworthiness and
craft**, because with no telemetry it can never advertise measured outcomes. **A product whose logo
is broken cannot sell trustworthiness.** The visual layer *is* the revenue path.

## Closed out here

- **PR #209** — publisher name, five Optimize strings off Microsoft's unwanted-software line, the
  **#207 ruling** (receipts sharing opt-in / default OFF / stays OFF after arming), and
  **`PRIVACY.md` → v0.5** disclosing four real data flows the code had and the policy did not.
- **PR #212** — the owner's **personal Gmail removed from the shipping product** (now
  `compysupport@gmail.com`), a contact address added to the privacy policy, and #196's step-6 header
  correction.
- **#196 CLOSED** — the Codex config-rewrite loop is dead at the cause
  (`external-agent-import-sync-enabled = false`, both stray `CLAUDE_CODE_*` keys removed after
  verifying `~/.claude/settings.json` already carries them), and the fix **survived a real relaunch**.
- **#207 CLOSED.** **#213 OPENED.** #204 / #205 / #206 carry new decision comments and stay open
  pending the owner.
- **`Pootytxng/compy-releases` is now a real public front door** — 65 bytes → 4,346, with the
  SmartScreen warning addressed head-on and the SHA-256 published.

## Decisions recorded, not to be re-litigated

- **#205 — MSIX/Microsoft Store: NO-GO.** The Store rejects apps requiring elevation for any part of
  their functionality; Compy elevates. Free signing is MSIX-only. **10.2.8 was the wrong risk.**
- **Signing: buy at 1.0, not now** ($119.88/yr). A certificate does not switch SmartScreen off;
  reputation needs traffic. Winaero's precedent is the counter-argument and it is honest.
- **#204 — $29 one-time, kill the subscription.** Decided on evidence; **still pending his confirm
  because it is his money.** Must be resolved together with **#195** (the free/Pro split).
- **#206 — free channels held to 1.0** by his instruction. **Defender scan on the shipped installer
  came back CLEAN** (signatures 1.457.306.0); VirusTotal still owed.

## The finding worth carrying forward above all others

**Compy's refusal to touch security is machine-checked** — `actions.rs:5500-5522` asserts by name
that Defender, the firewall, Security Health, Windows Update, BFE and the LSA **can never reach the
suspend primitive**, and it falsifies itself in the same test. **And `leftovers.rs:397-425` detects
Defender disabled by someone else's tweak guide and reports it.** In a category defined by scareware,
that is a real competitive advantage and it had never been written down. The releases README now
leads with it.

## The process lesson

The LOOK law split review so that correctness was the assistant's and design judgment was the
owner's. **That left a gap and this lane sat in it** — screenshots were reviewed for *"does this
honestly represent the product"* and passed, never for *"is this beautiful."* The handoff proposes
the amendment: **a rendering defect — a clipped element, an overlapping glyph, an unstyled native
control — is a correctness failure, not a matter of taste.**

## Still the owner's

A lawyer eventually (**not urgent — zero customers, nothing sold**) for the EULA §9 direct-damages
cap; a drafted clause is waiting on his word. The `[STATE]` blank, the DRAFT labels, the missing
refund policy. Confirming $29. Approving the screenshots. And the unresolved
**INSTALLED-STAMP-DRIFT**, which **only a session on the real machine can settle** — a container-side
read of the installed binary is an overlay view and proves nothing.
