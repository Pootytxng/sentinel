# Beta Feedback Train #3 — clean exit · exact links · flatten Play · apply-all · Learn de-overload · wordmark straggler

*2026-06-06, Cowork, from the owner's full first-beta feedback list. Triage: two reported items
are ALREADY SHIPPED in wave-2 (ineligible-option dismissal = eligibility train; back button =
wayfinding train) — resolution is distribution, not code. The six below are real. Sequencing:
this train runs after the reopened elastic fix is owner-re-blessed; ONE rebuild then carries
elastic + doorknobs + eggs + this train together.*

---

## §1 Clean exit — trust-class, leads the train

**Report: closing the app leaves background processes in Task Manager.** For a product whose
README invites process/firewall scrutiny, ghosts after close contradict the core pitch.

- Closing the main window = FULL process-tree exit: main process, overlay window, and — prime
  suspect — the **elevated FPS helper** (`--fps-capture`): stop capture cleanly on app exit;
  the helper must terminate when its parent session ends (no orphans, including when capture
  is mid-run at close). WebView2 child processes follow the parent automatically — verify.
- No hidden-to-tray behavior exists; close means exit, period.
- Acceptance: with capture running + overlay shown, close the app → within ~2s Task Manager
  shows ZERO compy-related processes. Repeat from a UAC-elevated-helper session. Add a
  regression test for helper lifetime where feasible (orphan-detection logic exists from
  Gaming Mode work — reuse the pattern).

**§1 EVIDENCE UPGRADE (live repro on the owner's machine, 2026-06-06):** a ghost was caught
red-handed — NO visible window, yet TWO compy processes alive: one hidden window titled
`gg.compy.app-siw` (a single-instance-plugin artifact) + one fully windowless. **Elevated
hypothesis:** close doesn't fully exit → the ghost keeps holding the single-instance lock → the
next launch *defers to the dead instance* (which has no window to focus) → nothing appears →
**"Compy won't open."** This is likely the FULL shape of the beta "won't launch" report, not merely
a Task-Manager-tidiness nit. So §1 has TWO halves, BOTH required:

1. **Close = full process-tree exit** (above) — so no ghost is ever created in the first place.
2. **Single-instance hardening (defense in depth)** — if a lock holder exists but has **no live
   window**, a new launch must **reclaim the lock and surface a window**, NEVER silently defer to a
   dead instance. (Audit the `tauri-plugin-single-instance` callback: focus the existing window IFF
   one is alive; otherwise take over + start fresh. Confirm what the `-siw` hidden window is and
   whether it, not the main window, is the lock holder that lingers.)

- Added acceptance: **leave/force a ghost (or force-kill a running instance) → relaunch → a window
  appears normally** — no silent no-op launch, ever.

## §2 Exact-article links (named-place law, Check straggler)

**Report: Check → "not worth touching" → "why we refuse these" dumps into ALL of Learn.**
Route it to the EXACT entry via the existing quick-look-by-id mechanism (WhatsThis pattern,
already shipped on Fix rows). Sweep for any other remaining generic-Learn links — the law is
"if it names a place it takes you there," and a specific refusal must link its specific
article.

## §3 Play — flatten "Full monitoring & charts"

**Report: kill the dropdown; just show everything — no point in the extra click.** The
doorknob made it perceptible; the tester is right that it shouldn't be a door at all on its
own home turf. Render the deep monitoring inline on Play, always (charts poll only while Play
is the active room — existing visibility-gating keeps the cost honest). Remove the collapsible;
the .cmp-door grammar elsewhere is unaffected.

## §4 Fix — "Apply all" (philosophy-preserving design)

**Report: a toggle/button to apply all suggested items at once.** Accepted with guardrails so
this never becomes optimizer-rot bulk-flipping:

- Button: **"Apply all safe fixes (N)"** — SAFE-tier appliable recs only (matches the
  first-run arc's "Fix both" precedent). Moderate stays individual; advisory can't apply by
  definition; dismissed/not-for-this-rig excluded.
- ONE consent sheet first: lists every item with its one-line what-it-changes. Approve →
  sequential application, **one ledger receipt PER item** (rollback granularity unchanged —
  each individually undoable, exactly as if applied one-by-one).
- Elevation batched where items share it (one UAC prompt, not N) via the existing elevated
  path; per-item failure isolation — one failure skips, doesn't abort; honest summary after
  ("Applied 5 · 1 skipped: <reason>").
- Copy law: "Apply all" never implies a performance promise — it's convenience, not a boost
  button.

**§4 STATUS + ONE-ELEVATION DESIGN (recorded 2026-06-08 for clean execution).** Shipped v1 (`d280679`):
the consent sheet + per-item receipts + failure isolation + safe-tier-only + copy law, via FRONTEND
orchestration of the existing `apply_recommendation` (zero new IPC, zero new mutation primitive) — but
it elevates per-item → **N UAC prompts**. The one-elevation batching is the deferred follow-up (owner
GO 2026-06-07; rides its OWN elevation QA; readies, does not ship — do NOT rebuild the kit for it).
Design (audited mutation/elevation boundary — care):
- **Scope/de-risk (verified):** the safe-tier batch's ELEVATED set (reserved-storage-off, fast-startup-off,
  nvidia-telemetry, hags-enable, + verify eee/nagle) is pure-PS — each does non-mutating *reads* then
  one `run_elevated_powershell`. The non-elevated safe recs (game-mode, game-bar, visual-effects,
  mouse-accel) are HKCU winreg (no UAC) → run their existing path unchanged, no batching. CRUCIALLY the
  only `exit`-using elevated cmd, `apply_power_ultimate`, is **moderate-tier → excluded** → inline
  PS composition is clean (no `exit` to abort the batch).
- **Seam = a thread-local deferral sink in `run_elevated_powershell`:** in batch mode it pushes the
  command to the sink + returns Ok (deferred) instead of running. The `apply_*` stay UNCHANGED (safe
  because the elevated ones do only reads + the PS — no winreg writes — so deferring causes NO partial
  mutation). Batch: enable sink → call each `apply_X` (non-elevated applies immediately + ledgers;
  elevated defer their cmd, grouped per-rec by sink-length delta) → ONE inline elevated `-Command`
  (`$ErrorActionPreference='Stop'`; per rec `try { <cmds>; 'id:ok'|Add-Content $rf } catch {
  'id:fail'|Add-Content $rf }` to a temp RESULT file) → `run_elevated_powershell` once (one UAC) → parse
  the result file → write a ledger receipt per OK item (the typed snapshot/rollback `apply_X` already
  returned). Result FILE is data (no TOCTOU; reading ≠ executing) and the inline `-Command` keeps the
  current elevation security model (no elevated script file). New orchestrator command only (reuses the
  audited primitives — not a new mutation primitive). Regression test: one rec's cmd fails → skipped +
  reported, the rest apply + ledger. /check + /security required.

**✅ §4 ONE-ELEVATION BATCHING BUILT on `main` (owner GO 2026-06-09; commits `60ae751` backend,
`a7920bf` frontend, `b4d2564` /check hardening).** Built exactly to the recorded design: thread-local
RAII deferral sink in `run_elevated_powershell` (capture-instead-of-elevate, disarms on drop/panic,
refuses nesting) → ONE inline elevated `-Command` (`$ErrorActionPreference='Stop'`, per-rec try/catch,
`id:ok`/`id:fail` receipts to a result FILE in the data dir, parsed after exit-0) → a ledger receipt
per CONFIRMED item only (fail + missing receipt both resolve to skipped — nothing is recorded that
didn't verifiably happen). `power-ultimate` is HARD-rejected at validation (the only exit-using
elevated cmd); phase-1 non-elevated receipts are saved BEFORE elevation so a UAC cancel never costs
them; UAC decline skips all deferred items honestly. `apply_recommendation` now shares
`dispatch_apply` + `build_applied_change` with the batch (one match, one receipt builder). Frontend:
`applyBatch` = one `apply_recommendations_batch` invoke; consent sheet + summary contract unchanged.
Tests: cargo 242 (+10: sink capture/disarm/nesting, compose structure + no-exit + unsafe-id rejection,
receipt parsing, validation hard lines, fail-safe resolution, full-contract receipt shape, camelCase
arg pin, and the failure-isolation regression against REAL non-elevated powershell.exe); npm 226;
clippy + tsc clean; /check + /security clean. **NOT shipped: rides its own elevation QA on a UAC-on
machine (one prompt → per-item receipts → per-item rollback → UAC-cancel honesty) + Cowork
elevation/mutation-boundary audit before any tester build. Acceptance "one elevation" stays unchecked
until that QA passes.**

## §5 Learn — de-overload pass (structure only; voice/content untouched)

**Report: information overload in Learn.** 116 entries need progressive disclosure:

- Categories collapsed by default (tweaks / terms / tricks / guides — count chips on each).
- A short **"Start here"** strip: 3–5 curated entries (the guides + the biggest myths).
- Verdict filter chips (real / placebo / risky) alongside the existing search.
- Entry rows compress to title + one-liner until expanded (everything else behind the
  expand-in-place the autopsy already uses).
- Search stays primary and prominent. Zero copy changes — this is shelving, not rewriting.

## §6 Settings wordmark straggler

**Report: the logo in Settings differs from the rest of the app.** Wordmark-law violation —
swap to the shared `Wordmark` component; grep-sweep for ANY remaining non-component logo
usages so the law holds everywhere (the guard for this is the component being the only
sanctioned source).

## §7 Autopsy URL pastes — honest local handling (no network, ever)

**Report: pasting a link (YouTube / wikiHow article) into the autopsy "doesn't register."**
Fetching URLs is OFF the table — "nothing leaves your PC" is a shipped promise, not a
limitation (and the build-order already bans network egress in the local-only beta). But
silent non-registration is a doorknob violation. Fix locally:

- **Detect URL pastes** (input is/contains a URL with little other text) and respond with an
  honest, in-voice explainer card — never silence: *"That's a link — and Compy never fetches
  the internet (nothing leaves your PC; that's the deal). Bring me the words instead:"*
- **Per-source coaching** on the same card:
  - Webpage: "Open the page → Ctrl+A, Ctrl+C → paste here. I'll grade every claim."
  - YouTube: "Open the video's transcript (⋯ menu → Show transcript) → copy → paste here."
- The card reinforces the privacy promise at the exact moment it costs the user something —
  that's the trust product behaving in character.
- **NO domain/title grading of unread pages** (we never grade what we haven't read — honesty
  law; and naming "snake-oil domains" is the Process Lasso lesson in defamation-adjacent
  form). Out of scope, recorded: a future explicit opt-in fetch would be its own gated
  arming plan (remote-rules precedent), owner decision, not this train.
- Mixed paste (URL + substantial text): grade the text normally; ignore the URL.

## Acceptance

- [ ] §1: zero compy processes in Task Manager ~2s after close, including mid-capture +
      elevated-helper scenarios; regression coverage added. AND: a ghost/force-killed instance →
      relaunch → a window appears (single-instance never defers to a dead/windowless holder).
- [ ] §2: refusal links open the exact entry (quick-look); no generic-Learn dumps remain.
- [ ] §3: Play shows full monitoring inline; no dropdown; polling stays visibility-gated.
- [ ] §4: consent sheet lists all; per-item receipts; one elevation; failure isolation;
      safe-tier only; copy promise-free.
- [ ] §5: Learn opens calm (collapsed categories + start-here + filters); content unchanged.
- [ ] §6: one Wordmark source everywhere, grep-verified.
- [ ] §7: URL paste → the honest coaching card (never silent); YouTube + webpage variants;
      mixed paste grades the text; zero network calls (grep/audit confirms no fetch).
- [ ] Tests/guards green per section; copy locks untouched; zero new IPC beyond §4's
      orchestration of EXISTING apply commands; catalog unchanged.
