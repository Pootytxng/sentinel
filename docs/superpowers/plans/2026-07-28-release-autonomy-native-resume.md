# Release Autonomy, Native Process, and Resumable Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Compy's Windows release train autonomous for reversible engineering, safe to retry
at every publish boundary, and completely testable before production GitHub is touched.

**Architecture:** Keep `release.ps1` as the prepare/publish entry engine, but move native execution
and publish-stage sequencing into focused libraries. Production publish operations and the sandbox
adapter both run through one transaction driver; the adapter is the dependency-injection seam, not
a duplicated test-only orchestration. A receipt-bound JSON journal records verified evidence while
every rerun still re-reads real state.

**Tech Stack:** Windows PowerShell 5.1, `System.Diagnostics.Process`, Node.js/Vitest, temporary Git
repositories and stateful fake release services.

## Global Constraints

- Never move, recreate, delete, or force-update an existing tag.
- Never weaken `$ErrorActionPreference = "Stop"` or any receipt, signature, runtime-stamp,
  provenance, public-version, or fail-closed check.
- A GitHub 404 means absence only when the response is a confirmed HTTP 404; all other failures are
  fatal.
- The only fleet-visible transition is draft-to-public and it remains last and owner-gated.
- The public updater remains on v0.9.7 during this train.
- Preserve every already-cut candidate before advancing SemVer.
- Hosted GitHub Actions remain off under the owner's zero-budget decision; local gates are
  authoritative.

---

### Task 1: Durable authority and truthful release state

**Files:**
- Create: `docs/RELEASE_AUTONOMY.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `docs/RELEASE_STATE.md`
- Modify: `docs/OWNER_ACTION_CHECKLIST.md`
- Modify: `docs/archive/RELEASE_STATE_HISTORY.md`

**Interfaces:**
- Consumes: live Git, GitHub release, artifact, and installed-runtime evidence.
- Produces: repository law in `docs/RELEASE_AUTONOMY.md`; current state in
  `docs/RELEASE_STATE.md`.

- [ ] Write the dedicated reversible-release authority, preservation, provenance, verification,
  and owner-stop rules.
- [ ] Link the policy from both agent auto-load files and remove contradictory stop-on-gate prose.
- [ ] Record v0.9.8, both v0.9.9 checkpoints, and the already-existing private v0.9.10 draft
  checkpoint without altering historical strata.
- [ ] Set the next publishable version according to immutable live tags, not the stale prompt
  snapshot.
- [ ] Run strict state, documentation budget, encoding, and hook checks.
- [ ] Commit the policy/state unit.

### Task 2: Complete native-process abstraction

**Files:**
- Modify: `scripts/lib/native-process.ps1`
- Modify: `scripts/lib/runtime-proof.ps1`
- Modify: `scripts/release.ps1`
- Modify: `scripts/release-prepare.ps1`
- Modify: `scripts/release-publish.ps1`
- Modify: `scripts/ship-reinstall.ps1`
- Modify: `scripts/verify-release.ps1`
- Modify: any release-critical signing/updater helper found by the transitive audit
- Test: `scripts/native-process-guard.test.mjs`

**Interfaces:**
- Produces:
  `Invoke-NativeProcess(Command, ArgumentList, WorkingDirectory, Environment, TimeoutMs, ShowOutput)`
  returning `FilePath`, `Arguments`, `ExitCode`, `StdOut`, `StdErr`, `TimedOut`,
  `TerminationAttempted`, and timing data; `Invoke-CheckedProcess` throws on disallowed outcomes.

- [ ] Add failing Windows PowerShell 5.1 tests for empty/present environment overrides, UTF-8
  streams, interleaved high-volume output, timeout tree cleanup, batch quoting, checked diagnostics,
  and optional live output with captured output retained.
- [ ] Run the focused suite and confirm the new tests fail for the missing behavior.
- [ ] Implement environment overrides, async event capture, live mirroring, and practical
  `taskkill /T /F` timeout cleanup without shell command strings.
- [ ] Replace the signing shell shim and all direct release-critical process launches with the
  abstraction.
- [ ] Run the focused suite and complete PowerShell 5.1 parse checks.
- [ ] Commit the abstraction and full migration with the historical defect guard.

### Task 3: Receipt-bound transaction journal and production orchestration

**Files:**
- Create: `scripts/lib/release-transaction.ps1`
- Modify: `scripts/release.ps1`
- Modify: `scripts/release-publish.ps1`
- Test: `scripts/release-transaction.test.mjs`

**Interfaces:**
- Produces: ordered stages
  `receipt_verified`, `runtime_proved`, `source_main_pushed`, `source_tag_pushed`,
  `releases_tag_created`, `draft_created`, `draft_assets_verified`, `release_published`,
  `public_assets_verified`.
- Journal binding: receipt schema, version, commit, source tag, installer SHA-256, updater-signature
  SHA-256, and manifest SHA-256.
- Adapter contract:
  `VerifyStage(stage, context) -> complete|absent|fatal`; `ExecuteStage(stage, context)` is allowed
  only after `absent`, followed by mandatory re-verification.

- [ ] Add failing tests for binding mismatch, journal-not-authority behavior, unsafe stage order,
  incompatible existing state, and resume after each stage.
- [ ] Implement atomic journal writes and fixed stage ordering.
- [ ] Extract production publish operations into the adapter used by the transaction driver.
- [ ] Make existing compatible source refs, release tag, draft, and assets resumable; mismatches
  remain fatal and nothing is overwritten.
- [ ] Keep `release_published` last among mutations and `public_assets_verified` as the terminal
  proof.
- [ ] Run focused transaction tests and commit.

### Task 4: Sandboxed complete publish simulation

**Files:**
- Create: `scripts/release-publish-simulation.ps1`
- Create: `scripts/fixtures/release-sim/fake-native.mjs`
- Test: `scripts/release-publish-simulation.test.mjs`

**Interfaces:**
- Consumes: the production transaction driver and injected sandbox adapter.
- Produces: isolated temporary Git/release-service/install state plus an operation transcript.

- [ ] Add the 20 required scenario tests, including the expected-404 first publish and a successful
  complete transaction.
- [ ] Add table-driven fault injection after every stage and prove a rerun re-verifies then resumes.
- [ ] Cover auth, permission, network, wrong ref/hash/signature, release collision,
  public-version disagreement, and downloaded draft/public byte mismatch failures.
- [ ] Prove no production repository, public manifest, installed Compy, or real signing key is used.
- [ ] Run the full simulation suite and commit with the journal unit if that is the cleaner review
  boundary.

### Task 5: Permanent release-critical static guard

**Files:**
- Create: `scripts/release-critical-files.json`
- Create: `scripts/release-static-guard.mjs`
- Modify: `scripts/release-pipeline-guard.test.mjs`
- Test: `scripts/release-static-guard.test.mjs`
- Modify: `scripts/verify-release.ps1`

**Interfaces:**
- Consumes: an explicit transitive release-critical file manifest.
- Produces: deterministic violations with file, line, rule, and excerpt.

- [ ] Add failing mutation tests for both historical direct-native patterns and every prohibited
  class.
- [ ] Implement the scanner with a minimal documented allowlist for the native-process library's
  own `System.Diagnostics.Process` implementation.
- [ ] Enforce process abstraction use, no stderr-control redirection, strict EAP, no
  `Invoke-Expression`, no shell strings, no verification bypass, absence classification, and safe
  transaction order.
- [ ] Add the guard to the canonical release verifier and run red-to-green proof.
- [ ] Commit the guard.

### Task 6: Full infrastructure verification and landing

**Files:**
- Modify: only defects discovered by the full gate, each with its regression guard.

- [ ] Run native, transaction, simulation, resume, static, parse, encoding, hook, strict-state,
  documentation, TypeScript, full Vitest, production frontend, Cargo, Clippy, and
  `verify-release.ps1` gates.
- [ ] Obtain independent release-script and adversarial test-gap reviews; fix every critical or
  important finding.
- [ ] Confirm clean main, exact commits, and fast-forward push with `--no-follow-tags`.

### Task 7: Prepare and locally prove the next immutable candidate

**Files:**
- Modify: pipeline-managed version files and `docs/RELEASE_STATE.md`.
- Produce: signed installer, signature, manifest, signed receipt, local annotated source tag,
  installed runtime proof.

- [ ] Re-read remote tags immediately before choosing the version; never reuse an already-tagged
  version.
- [ ] Run `release-prepare.ps1` with the owner-supplied notes adapted only when immutable live
  provenance requires the next SemVer.
- [ ] Install the exact receipt-bound artifact through `ship-reinstall.ps1 -VerifyRuntime`.
- [ ] Prove version, exact clean embedded stamp, mounted shell, proof-process closure, normal
  relaunch, and no remaining CDP port.
- [ ] Verify public latest remains v0.9.7 and stop before any releases-repository mutation or public
  distribution.
