# Decision: Capability Exception Gate + outbound case intelligence

> **POLICY AND PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The Care-primary product framing
> below is retired by `docs/PRODUCT_CONSTITUTION.md`. The capability, consent, rollback, injection,
> kill-switch, and origin-control rules remain technical safety authority only where they conform to
> current `docs/ARCHITECTURE_LOCKS.md`; this record cannot independently authorize runtime changes.

- **Date:** 2026-08-09
- **Owner:** Kuya
- **Work Control:** [issue #91](https://github.com/Pootytxng/sentinel/issues/91)
- **Status:** approved product/policy direction; runtime unchanged
- **Supersedes:** the blanket "Compy can never ship a driver" rule and any zero-outbound absolute
- **Does not supersede:** rollback-first, measurement honesty, security/system owner gate, signed
  remote-rules gate, or the third-party game/process injection prohibition

## Decision

> **Product framing superseded 2026-09-04 (#369):** the Care-primary / optimization-second hierarchy
> in the next paragraph is retired by `docs/PRODUCT_CONSTITUTION.md` (two equal flagship journeys
> through one machine model). The Capability Exception Gate decision itself, and every tier,
> kill-switch and origin rule in this record, remain in force.

Compy's primary identity is **Compy Care: the PC doctor users open after any crash, freeze, slowdown,
or unexplained hiccup.** Measured optimization remains its second specialty. Care owns the continuing
loop—intake, triage, local case chart, bounded differential, one next plan, follow-up and prevention.
Coverage expands in evidence-earned trains: crash/hang/restart first, then performance regression,
thermals/noise, storage/startup/update, and network/peripheral/device trouble.

New capabilities remain local, user-mode, least-privilege and non-invasive by default. A stronger
boundary is allowed only through a named, capability-specific exception record that proves the user
outcome cannot be achieved through a lower-risk route and defines the exact security, privacy,
consent, rollback, signing, kill-switch, rollout and abort contract.

Outbound case intelligence is approved as three non-inheriting tiers:

1. **Tier 1 — signed case knowledge:** download public advisory knowledge; match it locally; upload no
   machine-derived incident data.
2. **Tier 2 — scrubbed incident fingerprint:** separate opt-in/default-OFF proposal with a visible,
   allowlisted payload and retention/deletion contract.
3. **Tier 3 — explicit per-case evidence upload:** separate one-incident consent after preview and
   redaction; named recipient; retention/deletion receipt; no background queue.

Tier 1 is approved for dark implementation. It is not permission to arm an unspecified endpoint, to
build Tier 2/3, to widen CSP, to add frontend transport, or to reuse consent.

A Compy-shipped driver is no longer categorically forbidden, but no driver is approved or needed for
Tier 1. Any driver requires its own exception record. Borrowed vulnerable drivers, generic kernel
read/write surfaces and third-party game/process injection remain prohibited.

## Current runtime truth

At this decision point:

- Compy ships no driver.
- Game/process injection does not occur.
- Case intelligence has no module, endpoint, cache or runtime traffic.
- The signed updater remains the app's only outbound surface.
- Receipts and privileged remote-rules fetch remain dark.
- Support evidence remains local preview/export; the user is its transport.

## Required implementation shape

Tier 1 must be a new Rust-side advisory module with a separate signing key, manifest schema, endpoint
allowlist, cache namespace and monotonic catalog version from privileged remote rules. The catalog
may provide plain-text evidence requirements, public source links and safe/research-only next steps.
It cannot name mutation variants, scripts, registry paths or remote HTML. The initial kill switch is
local and deny-only. Public source links must match compiled `CASE_SOURCE_ORIGINS` in
`case_intelligence.rs`; the catalog cannot add an origin. Any remote disable signal is separately
exception-gated and signed, may disable only, and cannot ride inside the catalog.

The existing local crash incident remains the source of machine truth. Downloaded knowledge is
matched on-device and can only add an advisory result such as "This incident matches the recorded
shape of a known issue." It cannot claim causation.

## Queue placement

1. PR #90 @ `c2868bc` records exact current-head gates; finish its missing independent review and
   merge/disposition first, rerunning the gates if that head moves.
2. Rebase #91 because PR #90 overlaps `AGENTS.md`, `CLAUDE.md` and
   `docs/RELEASE_STATE.md`, then land policy/spec/guard preparation.
3. Implement Tier 1 domain + verification + cache behind a hard-false gate.
4. Add an always-visible Home Care entry and Crash & Freeze Rescue deep-link in coordination with
   issue #49; keep the broad `compy_home_intake` band default-OFF.
5. Add the bounded local incident observer/persisted Home card; notification is a secondary nudge and
   no direct click payload is assumed.
6. Review exact endpoint/signing/privacy/canary evidence before runtime arming.
7. Specify later Care trains, Tier 2 and Tier 3 separately, if justified.

Draft PR #50 is not revived. Issue #55's stale Project Doctor claim is not adopted. A Rust-side fetch
keeps production CSP unchanged and therefore does not trigger issue #64 Q2b; webview fetch or CSP
widening would trigger it.

## Why this decision

The tester failure was discovery plus closure: a crash happened, Compy's existing analysis was hard
to find, and Event Viewer exposed an event without producing an understandable cause or next step.
The fix is to make diagnosis the front door and connect local evidence to current, signed public
knowledge. Removing all boundaries would create a silent uploader and kernel-risk surface; keeping
the old blanket prohibition would block capabilities before their benefit could be judged. The
exception gate makes both mistakes reviewable.

## Canonical technical detail

The two pre-rebirth spec/plan records below have superseded product framing; their conforming
capability, consent, rollback, injection, and origin-control details remain bounded technical
provenance under current `docs/ARCHITECTURE_LOCKS.md`.

- `docs/ARCHITECTURE_LOCKS.md` §1.8
- `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md` — historical product
  framing; bounded technical safety provenance only
- `docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md` — historical execution
  direction; bounded technical safety provenance only
- `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`
