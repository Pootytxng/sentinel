# "Optimization Cleanup" — research + spec (stage 1 of research → spec → scope-gate)

**Provenance:** persona 2 + recommendation #3, `docs/reviews/2026-07-15-consumer-panel-review.md`;
brief item 4.1, `docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`; BACKLOG entry
`docs/BACKLOG.md:901`. Owner-locked naming: publicly **"Optimization Cleanup"**, never "Paramedic
Mode" in user-facing copy (owner decision 2026-07-15).

**What this document is:** the research + spec stage only, per the BACKLOG entry's own rule —
"own spec'd train: research → spec → scope-gate — never a same-session build." This is
mutation-adjacent (it can restore third-party settings Compy never applied), so it must clear
`mutation-gate` + an owner welfare-check before any apply path ships, per CLAUDE.md LOCKED rule 3
(rollback-first) and rule 6 (reversible / no-kernel / non-security-weakening rails apply even to
"cleanup" framing). **No Rust or TS code should be written from this document without that gate.**

---

## The headline finding: most of this already exists, built dark

Before scoping this as new work, I had it researched against the current codebase
(`leftovers.rs`, `actions.rs`, `history.rs`, `drift.rs`). The result changes the shape of this spec
significantly: **"Optimization Cleanup" is not a green-field feature. It is largely a productization
of `leftovers.rs` (Leftovers v1, live-shipped, read-only) plus the already-built-but-dark Leftovers
v2 restore resolvers** (`docs/superpowers/specs/2026-06-11-leftovers-v2-dark-wave2.md` and its R2-5
predecessor).

**What's already live (read-only detection, shipped today):**
`leftovers.rs` detects 9 known tweak-pack artifacts — `pagefile-fixed`, `memory-compression-off`,
`bcdedit-timer-flags`, `mmcss-tampering`, `core-parking-forced`, `defender-policy-off`,
`mpo-disabled`, `tcp-autotuning-off`, `win32-priority-separation` — and each finding already carries
almost exactly the shape this feature needs: `current_value`, `stock_default`, `matched_tweak`
(which guide-era tweak it matches), `mechanism_cost` (plain-English cost), a hardware-aware
`verdict`, `uncertain_source` (rule: if a deviation is independently endorsed, e.g. by a
manufacturer, it's never flagged as rot), and `restore_note`. The module's own charter (its header
comment) is already the anti-snake-oil discipline this spec would otherwise have to invent: closed
catalog only, no heuristics, "nothing found" is a first-class result, unreadable probes are reported
as such rather than silently treated as clean.

**What's already built but dark (restore, unshipped):** 7 of the 9 detectors above already have
typed rollback resolvers in `actions.rs` (`memory-compression-off`, `mmcss-tampering`,
`win32-priority-separation`, `pagefile-fixed`, `mpo-disabled`, `core-parking-forced`,
`tcp-autotuning-off`) — fixture-tested, with an owner-present `#[ignore]` live-UAC QA harness
(`history.rs:1132-1405`), gated by `leftovers::restore_gate()` hardcoded to `false` AND
`history::restore_leftover()` not being a registered Tauri command (double-dark: gate + zero webview
reachability). These are one gate-flip + one owner-present QA pass away from shippable, not a build
from zero.

**Permanently excluded from restore, correctly, and this spec does not reopen it:**
`defender-policy-off` (writing `HKLM\...\Policies` is the absolute security rail — guided-only,
"open Windows Security yourself," never autonomous code) and `bcdedit-timer-flags` (boot-store
writes are the highest blast radius in the app, held for an owner-present wave even dark). Both
exclusions are load-bearing safety decisions already made; nothing below touches them.

## What's genuinely new (the actual scope of this feature)

1. **Broader detection surface.** The BACKLOG entry describes "residue OTHER tools/guides left
   behind (registry keys, services, scheduled tasks, orphaned tweak-pack artifacts)" — this is
   wider than the 9 curated settings `leftovers.rs` covers today. No detector exists yet for
   orphaned scheduled tasks, orphaned services, or generic registry-key residue from third-party
   optimizer/cleaner tools. This is real, uncovered work, and it's the part most likely to
   accumulate false positives if built carelessly — it should stay closed-catalog (named, known
   artifacts only) rather than heuristic scanning, matching `leftovers.rs`'s own charter.
2. **A formal useful/placebo/risky/outdated/unknown taxonomy.** `leftovers.rs` has a `verdict`
   string today, not a fixed enum with these five buckets. Recommendation #3 asks for this
   specific taxonomy; it doesn't exist as a type yet and would need to be threaded through the
   existing `Leftover` struct (or a superset of it) without breaking the shipped read-only surface.
3. **The Trust-Ledger-vs-separate-mechanism decision — a real architectural fork, not a detail.**
   The BACKLOG entry (2026-07-16) explicitly says restores should ride "a SEPARATE recovery-snapshot
   mechanism... not entangled with the main Trust Ledger." But the already-built Leftovers v2 dark
   path does the opposite: it reuses `AppliedChange`/the Trust Ledger directly, distinguished only
   by a `provenance: Some("leftover_adopted")` tag (`history.rs:448`). **These are not the same
   architecture, and this spec does not resolve that conflict — it flags it as the first decision
   the next stage needs**, because it determines whether shipping this feature is "flip the gate on
   already-built code" (small) or "build a second rollback path" (large, and arguably violates the
   spirit of rule 3, which wants ONE place rollback resolves from, not two). My read: reusing the
   Trust Ledger with a distinct provenance tag is the safer, less-blast-radius option and is already
   built — but this is an owner/CC call, not mine to make unilaterally.
4. **Generalizing the refusal pattern.** The exact "Compy has no rollback record for this, go
   change it in Windows yourself" copy already exists (`App.tsx:932-942`) but only for one narrow
   case: a Compy recommendation toggle that reads as on but has no ledger entry. Recommendation #3's
   "only offer automatic restoration where the correct prior/default state is unambiguous" needs
   this same posture generalized to arbitrary cleanup findings, most of which will land in the
   "advisory only, here's the real Windows location" bucket rather than the "safe to auto-restore"
   bucket — that ratio should be set by evidence, not by a target percentage.
5. **A separate recovery snapshot for genuinely new detection surface** (item 1 above) — the 7
   already-resolver-covered settings can keep riding the existing pattern; anything genuinely new
   (registry/service/task residue Compy never touched before) needs its own capture-before-remediate
   step, auditable independently of the Trust Ledger, per the BACKLOG entry's caution. This is scoped
   narrower than "rebuild the whole rollback path" — it only applies to the net-new surface.

## Proposed phased build (for the scope-gate stage to accept, adjust, or reject)

**Phase 0 (near-zero cost, mostly already done):** ship the `leftovers.rs` read-only audit as the
literal "Optimization Cleanup" front door — it already exists, is live, and already IS most of the
"find + classify" ask. This alone may satisfy a meaningful share of persona 2's want ("tell me which
advice was real, tell me what can be safely undone") without touching the restore/mutation surface
at all. Worth scope-gating as its own tiny release before anything else here.

**Phase 1:** flip `restore_gate()` for the 7 already-built resolvers, run the owner-present live-UAC
QA pass that's already written (`history.rs:1132-1405`, currently `#[ignore]`), register
`restore_leftover` as a Tauri command. This is "ship what's dark," not new construction — full
mutation-gate applies regardless of how little new code this touches.

**Phase 2:** design + build the useful/placebo/risky/outdated/unknown taxonomy on top of the
existing `Leftover` shape, informed by real classifications of the 9 (soon more) detectors.

**Phase 3:** extend detection to orphaned scheduled tasks / services / registry residue —
closed-catalog, named artifacts only, each new detector reviewed individually the way the original 9
were (per `leftovers.rs`'s own charter). This is the part with the least existing infrastructure and
should be sized last, once Phases 0-2 show whether the feature earns its keep.

**Not in scope for any phase, per standing LOCKED rules:** Defender policy writes, bcdedit/boot-store
writes, anything that would touch security/system settings autonomously (CLAUDE.md's
SECURITY/SYSTEM-SETTINGS owner-gated rule applies in full here — a "cleanup" framing does not create
an exception).

## Open questions for the scope-gate stage (not answered here)

1. Trust Ledger reuse vs. a genuinely separate recovery mechanism (section 3 above) — recommend
   reuse-with-provenance-tag (already built), but this is the owner's/CC's call.
2. Whether Phase 0 (ship the existing read-only audit under the new name) is worth doing as its own
   small release ahead of any restore work, given it's nearly free and already tests the naming/UX
   with real users before the mutation-adjacent phases are built.
3. Whether the taxonomy (Phase 2) needs user-facing exposure of the underlying detector names, or
   should stay abstracted the way `leftovers.rs` already presents plain-English findings.

*This document does not authorize building any of the above. Next step per the BACKLOG entry is the
scope-gate conversation, then mutation-gate before Phase 1 specifically (Phase 0 is read-only and
carries no mutation risk, but should still get a self-review pass per the project's standing
discipline).*
