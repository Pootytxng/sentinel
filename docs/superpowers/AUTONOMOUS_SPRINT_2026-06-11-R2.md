# Extended unattended marathon (Round 2) — owner napping — 2026-06-11

**Owner directive:** "way longer marathon while I nap — as much done as possible, double/triple
checks, take the liberty of self-reliant suggestive actions, a crazy workload, a big review pile
when I'm back." Builds on R1 (`AUTONOMOUS_SPRINT_2026-06-11.md`, items 1–5 landed @ HEAD `9fd644a`).

## ⚠️ CONTEXT CHANGE — OWNER IS ASLEEP / FULLY UNATTENDED
This **tightens** the rails, it does not loosen them: there is no one to welfare-check in real time.
So the standing rule changes shape:

> **Anything that would normally trigger a STOP + welfare-check → do NOT proceed on that item.
> Write it to the Review Queue (below) and continue the marathon on the next safe item.**
> Never cross a rail. Never stall the whole run waiting for an answer that can't come.

Everything that LANDS must be reversible — git-revertable, behind a default-OFF flag, or purely
additive — so "we hash it out when I'm back" is always literally possible. Worst case the owner wakes
to a few commits he reverts; never to something shipped, flipped, or irreversible.

## Rails (UNCHANGED + absolute — re-read before every item)
- **NEVER, asleep or not:** security/system settings (UAC/EnableLUA/CPBA, Defender, firewall,
  `HKLM\...\Policies`) — not even to diagnose; signing keys / secrets in repo; frozen refs
  (`16069fa` / `beta/private-beta-001`), force-push, history rewrite; kernel driver / game injection;
  rollback-first integrity.
- **BUILD-DARK ONLY, never ship/flip:** mutation features (Leftovers v2 restore, Gaming Mode,
  per-game profiles) — code behind a default-off gate, NOT wired live, NOT flipped; rides its own
  UAC QA + owner sign-off before any ship.
- **Outward-facing = owner only:** do NOT rebuild/re-host the beta kit, do NOT contact testers, no
  money, no sends. (Local `npm run tauri build`/`dev` for verification is fine.)
- Push to `origin/main` is fine (reversible). No force-push.

## "Self-reliant suggestive actions" (what taking the liberty means here)
- **Fix freely:** any reversible/in-lane issue Fable discovers (lint, test gaps, doc drift, non-shipped
  dead code, a11y, perf, copy) — build → verify → commit → log, same discipline. Don't wait for permission.
- **Propose, don't execute:** anything bigger or owner-territory (taste/naming, money, mutation-ship,
  irreversible, rail-adjacent) → write a crisp proposal/spec into the **Review Queue**, do NOT act on it.
- Goal: the owner wakes to (a) a stack of landed reversible work **and** (b) a Review Queue of decisions.

## Triple-check discipline (he asked for it by name)
Per item: build → `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy --all-targets -- -D warnings`
+ `npx tsc --noEmit` + `npx vite build` + `/security` → **self-audit the diff against this spec's hard
lines, record the one-line result in the log** → ONE reversible commit → log line. For the dark
mutation item (#5): an EXTRA adversarial pass against rollback-first / write-before-mutate / fail-loud,
recorded. **End of marathon:** one consolidated `/check` + `/security` sweep over the whole run.

## Backlog (priority order — all reversible / dark / additive)
1. **Leftovers Learn entries** — all-original advisory content for the 9 detectors + the empty state;
   wire `WhatsThis` (R1 flagged the memory-compression gap where it auto-hides). Knowledge-layer, no mutation.
2. **Leftovers law-guard tests** — CI guards locking the anti-snake-oil charter in code: empty-state-is-
   first-class, no-boost/no-score copy, every finding carries a receipt (value→default→cost). Additive tests.
3. **Driver win-source v1** — *(item-6 fork RESOLVED, Cowork call):* lazy **NET-class** probe via
   `Win32_PnPSignedDriver` behind the EXISTING driver-freshness card, its **own** read-only IPC (off the
   `get_hardware_info` hot path). Honest "newer exists" maybe + copyable vendor link. Read-only.
4. **Deeper test coverage (M1/M2 round 2)** — Benchmark orchestration, SessionDebrief, the FirstCheck
   arc; property/edge tests for the pure modules (readiness/priorities/leftovers/export/sessions). Additive only.
5. **Leftovers v2 restore — BUILT DARK** — per-item "restore Windows default" resolvers through the
   existing typed `AppliedAction`/`RollbackAction` + snapshot contract; provenance `leftover_adopted`;
   **default-OFF gate, NOT wired to UI, NOT flipped**; full unit tests + the adversarial rollback audit.
   The flagship advance — reversible *because* it's dark. Ships only after its own live UAC QA (owner-gated).
6. **Accessibility pass** — WCAG AA sweep across Check/Fix/Play/Lab/Learn + the new Leftovers surface;
   additive fixes (dialog semantics, focus order, labels, target sizes; contrast already guarded).
7. **Perf / bundle** — route-level code-splitting to cut the 495 kB chunk (NO classic-surface deletion);
   optional poller consolidation (audit L2). Additive.
8. **M3 — PREP ONLY** — produce a dead-code inventory + a precise classic-surface retirement spec for a
   FUTURE fresh session. **Do NOT execute the ~3,000-line deletion unattended** — R1's instinct was right
   (high blast radius through the SHIPPED default surfaces while testers are installing). Spec it, don't cut it.
9. **Docs sync** — refresh `COMPY_OVERVIEW.md` status, the `COWORK_HANDOFF.md` board, mark audit M/L items
   treated, keep this log current.
- **+ discovered work** (suggestive actions): fix reversible finds inline; queue the rest.

## Review Queue (Fable writes proposals / decisions here — owner reviews on wake)
- **Leftovers v2 — remaining 6 resolvers (decision + sequencing):** built dark are
  memory-compression / MMCSS / W32PS (the single-primitive cleanest). Still unbuilt, with the
  honest reason each: **Defender-policy → RAIL** (writing `HKLM\...\Policies` is the absolute
  security-settings line, even to restore stock — owner decides if/how this EVER ships, e.g. a
  "open Windows Security yourself" guided path instead of a write); **pagefile** (multi-key dance:
  PagingFiles + AutomaticManagedPagefile via WMI/registry, reboot semantics — wants its own spec);
  **bcdedit flags** (boot store writes — highest blast radius of the set); **core-parking**
  (powercfg override removal needs plan-default reconstruction); **TCP autotuning** (netsh set —
  easy, but locale-honest verification of the result is not); **MPO** (easy delete — bundled with
  the next wave). Proposal: Cowork specs the 6 in two waves after the v1 detectors get tester
  field-time; every resolver rides the same live-UAC QA as the first three before ANY gate flip.
- **Leftovers v2 gate-flip QA plan (owner-present):** per resolver — apply on a rotted fixture rig
  → receipt w/ provenance + exact snapshot → reboot persistence → rollback restores the rotted
  value exactly → UAC-cancel honest skip. Mirrors the §4 elevation QA harness; can reuse its
  `#[ignore]` pattern. Only after that: register the IPC + flip restore_gate() (owner sign-off).
- **Forward-compat note (informational):** a ledger entry written by a future v2-enabled build
  would not parse in OLDER binaries (deny_unknown_fields on the new RollbackAction variants) —
  same property every past variant addition had; impossible in the field while the gate is off.
- **R2-7 bundle split — recommend SKIP as its own item (decision):** in a Tauri desktop app the
  bundle loads from local disk, so route-level lazy-loading buys near-zero user-felt value while
  adding regression risk (Suspense flashes, HMR quirks, the overlay window's separate route) to
  the SHIPPED shell mid-beta. The real chunk shrink comes free from M3's deletion (spec step 7).
  Poller consolidation (audit L2) likewise: working, leak-free, low value to churn. Owner can
  overrule; nothing was built.
- **M3 retirement spec is READY** — `docs/superpowers/specs/2026-06-11-classic-retirement-M3-spec.md`
  (inventory verified by grep, 8-step plan, shared-CSS hazard flagged, revert tag, fresh attended
  session required). Owner schedules it.

## Running log (Fable appends — what · commit · verify · hard-line self-audit)
- R2-1 Leftovers Learn entries — memory-compression-off tweak entry (pin 46→47, curation NOT
  catalog) + "leftovers" term (empty-state philosophy) + all-9 LEFTOVER_LEARN_ID map + section
  What's-this + no-dead-links guard test · `5e8fb98` · cargo 288 · npm 254 (+1) · clippy -D
  warnings · tsc+vite clean · /security clean (data+frontend only) · hard-lines: APPLIABLE_REC_IDS
  untouched, all-original prose (lint-enforced), additive/reversible ✓.
- R2-2 law-guard tests — fully-rotted fixture (every detector fires), full-receipt guard, no
  promise/alarm language, origin-uncertainty on all, score-free report shape; FIRST RUN CAUGHT
  real copy (W32PS "foreground boost" → "preference", guard kept strong) · `9a163f5` · cargo 292
  (+4) · npm 254 · clippy -D warnings · tsc+vite clean · /security N/A (tests+copy) · hard-lines:
  additive, zero behavior change beyond the reworded string ✓.
- R2-3 NIC driver win-source v1 — own read-only IPC (lazy, off the hot path), pure row mapper
  (Microsoft virtual NET dropped, vendor classified, unparseable date = unknown), stale→honest
  maybe + copyable Intel/Realtek root, quiet pass only when ALL dates readable · `7dc1478` ·
  cargo 295 (+3) · npm 256 (+2) · clippy -D warnings · tsc+vite clean · /security clean (arg-less
  read-only command, fixed WQL, no writes/launcher) · hard-lines: hot path untouched ✓.
- R2-4 edge coverage — sessions zero-sample honesty + single-sample exactness, priorities
  null/garbage degrade, export unicode+BOM+feedback round-trip; readiness skipped (already
  14 fixture tests) · `5f737b6` · cargo 299 (+4) · npm 256 · clippy -D warnings · tsc+vite
  clean · /security N/A (tests only) · hard-lines: additive ✓.
- R2-5 Leftovers v2 BUILT DARK — 3 resolvers (memcompress/MMCSS/W32PS) through the existing typed
  contract; double-dark (gate false + zero IPC); provenance additive; pure script builders ·
  `9cfec24` · cargo 304 (+5) · npm 256 · clippy -D warnings · tsc+vite clean · /security: zero new
  reachable surface (no command registered) · ADVERSARIAL AUDIT: gate-refusal-no-receipt,
  refuse-unreadable-prior-before-elevation, blind-rollback-fails-loud, pair-mismatch=contract-
  violation — ALL test-pinned; Defender resolver deliberately absent (rail → Review Queue);
  catalog/dispatch_apply untouched ✓.
- R2-6 a11y — aria-expanded on the 3 unlabeled collapsibles (Check fine-strip, FirstCheck
  green-strip, SessionDebrief context), aria-label+pressed on both glyph-only corner pickers,
  named Leftovers findings list · `d00ae34` · npm 256 · tsc+vite clean · cargo untouched ·
  /security N/A (markup) · hard-lines: additive, zero visual change ✓.
- R2-7 bundle split — SKIPPED with analysis (see Review Queue): desktop-disk loading makes it
  near-zero value vs real shipped-shell risk; the shrink rides M3 step 7 for free.
- R2-8 M3 prep — retirement spec written (inventory grep-verified, 8 steps, hazards, revert
  tag); execution explicitly deferred to a fresh attended session.
