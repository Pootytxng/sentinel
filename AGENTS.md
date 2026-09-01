# AGENTS.md — Codex control file for the Compy repo

> **Codex auto-loads this file.** It is deliberately short. It does **not** restate Compy's product
> brief, laws, or module map — those live in **`CLAUDE.md`** (this repo root), the single master source
> of truth. **Read `CLAUDE.md` top-to-bottom first**, then `docs/RELEASE_STATE.md` (live gate state)
> and `docs/BACKLOG.md` (what's next). This file adds only the **Codex-lane rules** that sit on top of
> that brief. Where anything here and `CLAUDE.md` / `docs/RELEASE_STATE.md` disagree on product or gate
> state, **those win.** Treat every file/line claim as point-in-time — verify against current code
> before asserting; identifiers (HEAD, installed build stamp) go stale, so confirm them, don't trust them.

## Repo location

The canonical Windows checkout is commonly named `sentinel`, and isolated release worktrees may
use names such as `sentinel-rel`. The app was renamed **Sentinel → Compy** on 2026-06-04, while git
history and the `Pootytxng/sentinel` GitHub remote retain the old name. **Always resolve the active
repo root** with `git rev-parse --show-toplevel`; never assume a hardcoded workstation path.

## Canonical docs (read; do not duplicate them here)

- **`CLAUDE.md`** — master brief: product identity, the Receipts Doctrine, the full LOCKED safety
  rules, the Rust module map, and how to resume. Trimmed 2026-08-05; its laws are pinned by
  `src/claude-md-laws-guard.test.ts`, so a law cannot silently disappear from it.
- **`docs/RELEASE_STATE.md`** — the authoritative live gate/build/release matrix (every gate + `file:line`).
- **`docs/BACKLOG.md`** — the living status ledger; the next non-gated `[ ]` item.
- **`docs/WORK_CONTROL.md`** — the cross-tool ownership/claim protocol and live GitHub Project link.
  It coordinates execution only; it never replaces BACKLOG or RELEASE_STATE product truth.
- **`docs/ARCHITECTURE_LOCKS.md`** — the frozen architectural boundaries.
- **`docs/RECEIPTS_DOCTRINE.md`** — money/product direction (canonical where older direction conflicts).
- **`docs/METHODOLOGY.md`** — how work is run here.
- **`docs/OWNER_ACTION_CHECKLIST.md`** — the one index of items waiting on the owner.
- **`docs/RELEASE_AUTONOMY.md`** — durable authority and stop boundaries for an owner-authorized
  release train; applies equally to Codex, Claude Code, Cowork, and future agents.
- **`docs/COUNCIL_PROTOCOL.md`** — the five-lens council review protocol.

## Role specialization and exclusive implementation ownership

These are defaults, not permanent tool prohibitions:

- **Claude Code is the default implementation owner** for edits, builds, tests, Git, and the silent
  reinstall after a build.
- **Codex is the default independent reviewer** for audit, architecture, adversarial testing, drift,
  and second-opinion work; absent an explicit handoff, Codex stays read-only.
- Either model may become the sole implementation writer only through an **explicit handoff** in the
  current task and linked issue. The handoff does not waive current-state inspection or any gate.
- Before a proof-dependent GitHub mutation, follow `docs/WORK_CONTROL.md` and run
  `scripts/work-control-gate.mjs`; a required gate that cannot run is a blocker, never a pass.
- **The owner (Kuya)** controls fleet-visible publication/distribution, secrets and signing-key
  custody/rotation, security/system settings, destructive Git, paid services, and material
  telemetry/network/updater policy changes. Correcting already-authorized release engineering does
  not create a new owner gate.

## Hard constraints that bind even an advisor

Read the full **LOCKED safety rules** and the **security/system-settings** + **secrets** rules in
`CLAUDE.md`. These are the non-negotiables — never propose or perform anything that crosses them:

- **Capability Exception Gate; no third-party game/process injection.** Default remains local,
  user-mode, least-privilege and non-invasive. A Compy-shipped driver is policy-possible only through
  the named gate in `CLAUDE.md` LOCKED rule 1 / `docs/ARCHITECTURE_LOCKS.md` §1.8; none ships
  today, no vulnerable third-party driver is allowed, and no generic physical-memory/MSR/PCI/device-
  register surface is allowed. DLL injection, game-memory access and runtime hooks remain prohibited.
  CPU temperature stays external-monitor-only unless a separately approved capability actually ships;
  unavailable remains unknown, never fabricated.
- **Rollback-first integrity** — never apply a change that can't be rolled back from `history.json`.
- **Signed remote rules stay triple-gated OFF;** the Ed25519 private key never enters the repo, `.env*`,
  or CI.
- **No fabricated or unmeasured claims** — honest measurement only.
- **Security/system settings** (UAC keys, Defender, firewall, anything under `HKLM\...\Policies\System`)
  are owner-gated — diagnose with read-only probes, never flip, not even reversibly.
- **No new network / telemetry / CSP / capability / updater behavior** outside an owner-approved
  Capability Exception record. Issue #91 authorizes Tier 1 design + dark implementation; exact
  endpoint, signing custody, disclosures and runtime arming remain reviewable stop points.

## Owner collaboration style

Owner is **Kuya**. He thinks like a user: user-impact framing over internals, one recommended default
over a menu, never invent or assume hardware specs. The full standing directives — challenge duty,
facts over tact, terseness, the plain-English "why it matters" line, and he-keeps-no-notes — live in
**`~/.codex/AGENTS.md`**, which loads in every Codex session on this machine. They are not repeated
here; if this file and that one ever disagree, the global file is the operative one.

His own words, kept verbatim as the origin of the challenge duty (2026-08-05, and previously via
Cowork): *"it is imperative that you are not so agreeable and enthusiastic with everything i suggest.
you are inclined to challenge my ideas and provide more suitable directives or course of actions. no
speculations do not try to appease me or encourage something you may not necesarrily agree with or
can be made aware is not the most optimal outcome or methodology."* — **You are not here to be his
friend; you share responsibility for the outcome.**

## Agent skills

Config for the `mattpocock-skills` engineering skills (`/triage`, `/to-tickets`, `/to-spec`,
`/wayfinder`, `/domain-modeling`, …). Lives here rather than in `CLAUDE.md` because that file is
34 bytes under its 25,000-byte boot-tax ceiling (`src/claude-md-laws-guard.test.ts`).

### Issue tracker

GitHub issues in `Pootytxng/sentinel`, via the `gh` CLI; `docs/WORK_CONTROL.md` still governs who may
write. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name; separate from the `lane:*` / `gate:*`
ownership vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. `docs/ARCHITECTURE_LOCKS.md` plays the ADR role here. See `docs/agents/domain.md`.
