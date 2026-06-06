# Eligibility · Dismissal · Detection Accuracy — beta feedback train #2

*2026-06-06, Cowork, from wave-1 beta feedback. Two reports: (1) no way to dismiss recs the
user deliberately declines OR that their hardware can't use (Ethernet-specific tweaks on a
WiFi/BT-only rig) — ineligible items permanently block the "everything handled" state; (2) a
suspected FALSE ETHERNET DETECTION — a WiFi-only user sees Diagnostics report an Ethernet
connection. Owner mandate: "thorough inspection of all tooltips, descriptions, functions,
specified hardware-related elements to guarantee detection accuracy and how it reads."*

*This is catalog DISCIPLINE work (gating + wording + UX on the existing ~29 recs), not catalog
expansion — the freeze is untouched.*

---

## 1. Applicability gating — "not for this rig" (automatic)

- Every rec/check with a hardware/connection precondition declares it explicitly (the gating
  already exists for SysMain/HDD cases — extend the pattern): network-type-specific recs gate
  on PHYSICAL adapter presence (see §4), display recs on display caps, etc.
- Ineligible items move to a quiet **"Not for this rig"** bucket (Check's existing
  not-worth-touching area is the natural home) with the reason in plain English:
  "Needs a wired Ethernet port — this rig is WiFi." They are EXCLUDED from the completion
  denominator everywhere (posture ring, "N to fix", Fix counts, export summary).
- If detection is UNCERTAIN, say so on the card (VRR-check house style: state what Windows
  does/doesn't expose) — never gate silently on a guess.

## 2. User dismissal — "Not for me" (deliberate, reversible)

- Every advisory/applicable rec row gets a quiet dismiss affordance ("Not for me") — ghost,
  not prominent; un-dismiss always available from a collapsed **"Dismissed"** strip (Fix).
- Dismissed items leave active lists + the completion denominator. Persistence: frontend
  localStorage (survives app restarts + the runtime-dir reinstall policy; ledger-grade
  durability NOT required — these are preferences, not receipts). Zero new IPC.
- Dismissal NEVER hides truth: the posture line carries the split honestly —
  e.g. **"Dialed — 6 active · 2 dismissed · 3 not for this rig"** (exact copy per surface may
  compress, but the counts must be one tap away). A 100% reached by dismissing everything must
  be visibly a labeled 100%, not a silent one.
- Applied≠dismissed: a rec that's APPLIED can't be dismissed (it's active — roll it back
  instead); a dismissed rec that becomes satisfied externally just resolves normally.

## 3. Detection accuracy — the false-Ethernet case (fix first, it's live)

Likely root cause: Windows enumerates VIRTUAL adapters (VPN TAP/TUN, Hyper-V vSwitch,
VirtualBox/VMware host-only, USB tethering, Bluetooth PAN, Npcap loopback) as "Ethernet"
class adapters. Any check reading adapter class/type alone will call a WiFi laptop "wired."

- **Discriminate physical from virtual:** require the physical-adapter signal
  (`MSFT_NetAdapter.ConnectorPresent` / WMI `PhysicalAdapter`), use
  `NdisPhysicalMedium` (802.3 vs Native802_11) to classify wired vs WiFi, and exclude
  known-virtual buses (root-enumerated devices; names matching TAP/Hyper-V/VirtualBox/
  loopback patterns as a belt-and-suspenders second signal, never the only signal).
- **Connection state ≠ existence:** "has an Ethernet PORT" (eligibility) is distinct from
  "Ethernet currently CONNECTED" (diagnostics) — never conflate; each surface states which
  one it means.
- **Name the evidence (UI law):** every detection-driven row names WHAT it detected:
  "Detected: Realtek PCIe GbE — cable unplugged" / "Detected: Intel Wi-Fi 6E AX211 —
  connected." Generic "Ethernet detected" is banned. A false positive then self-identifies
  (the user SEES "TAP-Windows Adapter" and knows it's their VPN — and so do we from their
  Export).
- Add the detected-adapter inventory (name · physical? · medium · state) to the Export
  report's hardware section so tester reports diagnose themselves.

## 4. The audit sweep (owner mandate — whole-surface)

Inventory EVERY hardware-conditional element (rec gating, readiness checks, diagnostics
rows, tooltips, Learn entries that reference detection): for each, record detection source →
verify behavior on the dev rig → reword to evidence-stating plain English (state what was
checked, what was found, what's uncertain). Deliver the sweep as a table in the completion
report (element / source / verified / wording before→after). Honesty floor: if we can't
verify a detection path on available hardware, the UI says "implemented, not yet verified" —
the NVIDIA-confidence rule generalized.

## 5. Acceptance

- [ ] WiFi-only repro: a rig with VPN/virtual adapters + no Ethernet port shows NO wired
      detection anywhere; Ethernet-gated recs sit in "Not for this rig" with the reason.
- [ ] Every detection row names its evidence (adapter/device + state); zero generic
      "detected" strings (grep-verified).
- [ ] Dismiss/un-dismiss round-trips; counts honest everywhere (ring, Check, Fix, Export);
      applied items can't be dismissed.
- [ ] Sweep table delivered; catalog count unchanged (~29 — discipline intact).
- [ ] Tester confirmation: the reporting wave-1 tester's rig (via their Export) shows the
      named adapter that previously read as Ethernet, correctly classified.
