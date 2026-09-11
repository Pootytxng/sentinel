# Fix — surface build spec (second live Instrument surface)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This pre-rebirth surface specification does
> not authorize current UI or product work. Current direction comes from
> `docs/PRODUCT_CONSTITUTION.md`; useful honesty, rollback, and implementation evidence remains
> bounded by current architecture and release truth.

*2026-06-05, Cowork. Translates the approved Fix mock from the design tour into a buildable spec.
Companion to the kernel (`2026-06-05-compy-design-system.md`) and the Command Center spec pattern.
Data/flow reference: the existing Optimize tab (incl. its wave-2 grouping: outstanding leads,
already-applied collapsed).*

---

## 0. Honesty rules for this surface

- **Named priors — never fabricated.** The trust-switch snapshot line names the exact prior
  ("restores **Balanced**") ONLY when the backend exposes a label derived from the actually
  captured typed snapshot (§5). When no clean label is derivable, fall back to the truthful
  generic: "restores your previous setting." The frontend never synthesizes a value.
- **The refuse-pile educates, never shames.** "Not worth touching" entries state what we refuse
  and why in one calm line each — no fear-tone — and link into the Library entry for the full
  autopsy.
- Counts in the header are real counts. Evidence chips (verified/measured/expected) are never
  upgraded.

## 1. Placement + reversibility

New `src/surfaces/Fix.tsx` (+ css + tests), mounted as the Fix tab behind localStorage flag
`compy_fix_v2` (default ON in dev) — same pattern as `compy_home_v2`. The existing Optimize tab
stays in the tree behind the flag. Additive, small revertable commits.

## 2. Layout (matches the approved mock)

- **Header:** "Fix" + honest subtitle: "N worth your attention · N already applied · N we'd leave
  alone. Every change is one click to undo."
- **WORTH FIXING (section, accent label):** one glass row per outstanding appliable rec:
  title + evidence chip + one-line plain-English reason + the **trust-switch** (right-aligned).
  Flipping ON → existing audited apply flow → ledger entry → the row expands a mono snapshot
  line: "snapshot captured — restores <label|your previous setting> · in Trust Ledger". Flipping
  OFF → rollback via the same flow. Only render switches where `APPLIABLE_REC_IDS.has(id)`
  (backend enforces independently — unchanged).
- **Already applied (N) — collapsed group** (calm green tint): expands to mono rows, each with its
  named prior where available and an Undo affordance (same flow).
- **Not worth touching (N) — the refuse-pile, collapsed** (neutral with a quiet danger icon):
  expands to curated entries — v1 trio: Force HPET, Disable pagefile, Disable Defender — each one
  calm line of why we refuse + a chip linking to its Library entry (`useplatformclock`,
  `pagefile-disable`, `disable-defender`). Content sourced/consistent with tweaks.json verdicts.
- **Non-appliable advisory recs** (exist in catalog but Compy won't auto-apply): render without a
  switch, with their advisory affordance as the existing Optimize tab does.

## 3. Shared component extraction

The trust-switch is now used by Command Center + Fix: extract it into one shared component
(`src/design/TrustSwitch.tsx` or similar) with the snapshot-reveal built in. One source of truth;
both surfaces consume it. Keyboard accessible (role=switch, space/enter).

## 4. Ambient + motion

Fix is a dense list → **Calm** ambiance per the kernel (low-alpha backdrop or static), never Full.
Collapse/expand animates; switch thumb slides; all reduced-motion guarded. No glow except the
accent on a live/ON switch.

## 5. Named priors — the one small BACKEND addition (Rust touched this phase, deliberately)

Expose a human-readable prior on the applied-changes view: `restores_label: Option<String>`
(additive, `#[serde(default)]`, old persisted entries unaffected).
- Derive ONLY from data already captured in the typed `AppliedAction`/`RollbackAction`/snapshot at
  read time (or apply time): e.g. service toggles → "Running"/"Disabled"; boolean registry values →
  "On"/"Off"; power plan → the stored plan's name if (and only if) the snapshot/typed action holds
  it — a bare GUID does NOT become a name; in that case return None.
- `None` → frontend renders the generic fallback. Never guess, never look up live system state to
  reconstruct a prior (the ledger alone is the source, per the rollback-resolution law).
- Unit tests per action type incl. the None/legacy-entry fallback. No new commands, no new
  mutation, read-only enrichment of an existing view. cargo tests green; clippy -D warnings clean.

## 6. Constraints

Additive + flagged + git-revertable · tokens only (no hardcoded hex) · no new
capabilities/network · CSP untouched · gates unchanged (gaming mode dark, remote off, updater off,
catalog frozen) · npm + tsc + vite + cargo green per commit · reduced-motion honored.

## 7. Acceptance

- [ ] Fix renders behind `compy_fix_v2`; old Optimize reachable by toggling off.
- [ ] Counts in header are real; sections group correctly (outstanding / applied / refuse-pile /
      advisory-no-switch).
- [ ] Trust-switch applies + rolls back through the existing flow; ledger entries written; the
      snapshot line shows a NAMED prior where the backend exposes one, generic otherwise.
- [ ] Refuse-pile links open the correct Library entries.
- [ ] `restores_label` derivation unit-tested per action type; legacy entries fall back to None.
- [ ] Calm ambiance; reduced-motion static; tokens-only verified (no hex in the surface).
- [ ] `npm run tauri dev` shows it live for owner sign-off.
