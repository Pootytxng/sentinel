# Archived HQ steering-log cycles — 2026-07-27a … 2026-08-04a

> Point-in-time cycle records moved out of `docs/BACKLOG.md` on 2026-08-18 under the TOKEN LAW
> (docs carry current state; history moves to `docs/archive/*`). Nothing here was deleted.
> Newer cycles, and the live board, stay in `docs/BACKLOG.md` § HQ STEERING LOG.

### Cycle 2026-08-04a — ✅ Q5 COMPLETE (backend + UI, self-review PASSed) · Q6 · BRANCH DISPOSITIONS · TWO GUARDS THAT WERE MISSING: `a4d13bd` · `28ebcc5` · `9bf3bde` · `1a513cb` · `6882819` · `7c8a03f` · `270a622` · `2d33db2` · `9827728` · GATE-RESIDENCY SWEEP `c7c5a8d` · `ba609ea`

- **The session's own supervision hook was the first defect (`a4d13bd`).** `compy-entry` reported the
  project harness "not loaded" from the absence of a launch token alone — a claim about state it
  cannot read. Disproven directly: CLAUDE.md *was* loaded, all 8 hooks present, and this worktree's
  `.claude/settings.json` is content-identical to `main`'s. The hook now reports only what it knows
  (no launch token ⇒ folder/branch/claim unverified) and no longer asserts the consequence. A hook
  that fabricates a finding about its own supervision poisons every session that reads it.
- **Q5 backend + policy (`7c8a03f`)** and **Q6 (`9bf3bde` · `1a513cb`)** — detail in the program
  cutline above.
- **Q5's in-app surface shipped and is now SIGNED OFF (`08ad3b1` → `00d06b0`).** `src/surfaces/SupportEvidence.tsx` +
  33 keys at en/zh-CN parity give §12 its missing half: the save control does not exist until a
  preview has come back (presence, not a disabled button, expresses the backend's ordering gate),
  one preview call carries all three projections of one bundle, retention renders from
  `bundle.retention` so the copy cannot drift from the caps, and clearing is a two-step that names
  what it costs. Disarm-checked. **The visual self-review FAILed first, on a real user-facing
  defect (`00d06b0`):** the always-visible meta line read `2 records · <path>` — the backend put the
  storage location through the same aggressive `redact_paths()` it uses for free-text detail, so the
  panel named the redaction mask as if it were somewhere the user could go. `display_location` now
  emits `%APPDATA%\Compy\support`, pinned by a Rust guard *and* by a 9th UI test, because the old
  fixture encoded a path shape no Rust code produces — which is exactly why 8 green tests never saw
  it. Re-review on the installed `5ff6963` release build: **PASS, 9/9 rubric items**, live captures
  at the owner's real resolution. One noted non-defect: **clear** is not preview-gated the way
  **export** is; it substitutes a stated consequence plus a two-step confirm (pre-existing design,
  unchanged here). Citations re-anchored in `5ff6963`, gate matrix flipped in `docs/RELEASE_STATE.md`.
- **Branch dispositions (`6882819`)** — 20 origin refs, every one with a row, re-proven by
  `scripts/branch-disposition-audit.mjs`; see the branch-integration note below for the split.
- **`owner_installed_stamp` enforced instead of asserted (`270a622`).** The 2026-07-31 Q7 baseline
  caught the anchor naming one build while the owner's desk ran another, and named the fix itself:
  *"an unenforced anchor that looks enforced is worse than an absent one."* Only half of it was done
  then — the anchor was corrected, the check was not — so the class **recurred**: the 2026-08-03
  local ship left `a1be896` anchored while `c7c60d3` was installed, and again nothing failed.
  `verify-release-state.mjs` check (7) now **reads** the stamp out of
  `%LOCALAPPDATA%\Compy\compy.exe` rather than testing the claimed one, so a mismatch names the
  correct commit instead of merely rejecting the wrong one. It **SKIPs — never fails** — with no
  installed exe, no/shallow git history, an unreadable binary, or an empty/ambiguous scan, so a CI
  clone cannot manufacture a phantom gate failure. Proven behaviourally, not asserted: exit 1
  naming `c7c60d3` with the stale value still in the file, exit 0 after the correction. Three
  pre-existing gate failures fixed in the same pass — `resolve_rollback` cited in the wrong file and
  69 lines off, `save_history_to` near-drift, and `source_main_commit` 14 commits behind a max of 10.
- **The module map split, and the verifier learned the split (`2d33db2`).** 19 read-only modules moved
  to `src-tauri/CLAUDE.md`, which auto-loads only for Rust work; the 12 ★ mutation/rollback/gate
  modules stay in the always-loaded root, because scoping against the safety boundary is a safety
  step and not a lookup. This **re-authors** `origin/docs/claude-md-split` rather than merging it —
  `353967f` predates `verify-module-map.mjs` by a day, so landing it verbatim would have turned all
  19 moved modules into `MISSING` and reddened the map's own gate on arrival. The verifier now reads
  both halves as one map, and the root's prose naming the submap is what **arms** the check: delete
  the half that no longer auto-loads — the half nobody would notice going missing — and you get
  `SUBMAP-MISSING`, not a green run over 19 invisible modules (proven by moving the file aside, not
  asserted). `DUPLICATE` keeps the halves disjoint; star disagreements resolve root-first so an
  unstarred mutator still trips `UNSTARRED-MUTATOR`; the `.rs` count stays in the root alone.
  `doc-budget` tightens the root 400 → 380 — banked, not refilled, or the split buys nothing.
- **The notable finding: `verify-module-map.mjs` had been RED on `origin/main` since `7c8a03f`.**
  That commit added `support_evidence.rs` without touching the map (declared 44, tree had 45), so the
  gate created on 2026-08-02 was already failing two days later — the exact drift class it exists to
  prevent, reintroduced by the next feature commit. Fixed in the same train; the module is mapped and
  correctly unstarred (zero mutation markers).
- **…and the root cause was that nothing ran it (`9827728`).** `3adb589` logged the finding and left
  it there. The script had **zero automatic callers** — not `package.json`, not `ci.yml`, not
  `audit.yml`, not `verify-release.ps1`; its only importer was its own guard test, which exercises the
  detector against synthetic input and never points it at the repo. The detector was right the whole
  time and simply aimed at nothing. Residency is **vitest, not a new CI job**: under the zero-budget
  law and the 2026-08-01 minutes exhaustion, the right home is the run already paid for — `npm test`
  executes on every local verify pass and in CI's `frontend` job for zero extra minutes, and
  `paths-ignore` skips only doc-only commits while map drift is always caused by `.rs` changes. The
  check is now `verifyRepo(repo)`, a pure function of a repo path, so the CLI and the test cannot
  drift apart; the two absent-section early exits became named returned failures (`NO-MAP`,
  `SUBMAP-MISSING`) a test can assert. Proven behaviourally per `c7c60d3`: an unmapped `.rs` file in
  `src-tauri/src` turns `npm test` red with `MISSING: drift_probe.rs` + `COUNT: … 45 … 46`, green on
  removal. Failures only, never warnings — `STALE-LOC` drifts constantly and a suite that reddens on a
  rounded line count gets muted rather than fixed.
- **The same defect in its sibling, swept and closed (`c7c5a8d`).** `verify-release-state.mjs` had the
  identical shape — every check inside `if (IS_MAIN)`, reachable only through `verify-release.ps1`, the
  full release gate nobody runs between releases — and it rots FASTER, because RELEASE_STATE.md's 24
  `file:line` citations break on any commit that shifts a line. Same fix: `verifyRepo(root, { machine })`,
  a pure function of a repo path, CLI reduced to a printer with its exit contract unchanged. Two checks
  stay CLI-only behind `machine: true` — `source_main_commit` (asks about `origin/main`) and
  `owner_installed_stamp` (reads a binary on one desk); both would redden `npm test` for reasons no
  commit in the tree caused, so their VALUES are deferred while their ANCHORS stay required in both
  modes. 4 → 20 tests: fixture repos on disk for the resolution/anchoring half no synthetic string
  reaches, extraction pins for the four citation shapes the doc actually uses, `DOC-MISSING` instead of
  a throw, and the live check against this tree with `citations.length > 10` so a silently empty walk
  cannot pass forever. Disarm-proven, not merely green: renaming a cited symbol turns `npm test` red
  with `GONE lib.rs:4 symbol 'no_such_symbol_xyz' absent`.
- **Second defect, found in passing: the guard test was a BINARY file.** Four raw NUL bytes (and one
  SOH) sat in the stamp-extraction assertions, so git refused to diff it and ripgrep skipped it — the
  file was invisible to every grep-based audit in this repo, including the sweep that found it. Now
  written `\0`; encoding-guard's tracked-text-file count rose to 1188.
- **The sweep's negatives, worth keeping.** Every other gate script IS wired, checked one by one:
  `branch-disposition-audit` · `markdown-link-guard` · `release-powershell-static-guard` ·
  `encoding-guard` · `supply-chain-gate` · `verify-updater-signature` · `doc-budget.ps1` ·
  `stage-dist-site` · `ci-budget-guard` · `e2e-updater-probe` · the five `*-harness.ps1`. The rest are
  tools, not gates (`usage-audit`, `repo-hygiene`, `build-icon-ico`, `license-tool`, `lane-*`,
  `dev-relaunch`, `ship-reinstall`, `run-vitest`, `export-library`, the `release-*.ps1` family). Two
  gates of fourteen had no runner, and both were the two written most recently — a gate is at its most
  useless the week it is authored, which is the pattern to watch on the next one.
- **So residency stopped being a thing I remember (`ba609ea`).** Finding the two unrun gates by hand
  only fixes the two; `scripts/gate-residency-guard.test.mjs` classifies **all 32** non-test scripts
  in `scripts/` by residency kind — `npm-test` · `npm-script` · `release` (runner-invoked) ·
  `release-entry` (human-typed, pinned by a static guard) · `scheduled` · `manual` — so adding a
  script without answering "what runs this?" turns `npm test` red at the moment someone is thinking
  about the answer, and demoting a drift detector to release-only takes a deliberate diff.
  **Anti-vacuous by construction:** a name-mention scan would have gone GREEN on both defects it
  exists to prevent, so the checks are structural — an `npm-test` subject must export a callable
  surface **and** its paired test must `from "./<subject>"` (that pair is exactly the `IS_MAIN` trap:
  a check body wholly inside `if (IS_MAIN)` has no callable surface, so no test *can* exercise it);
  a `release` subject's call site must survive comment-stripping (a command named only in prose is
  not a runner); every non-`npm-test` entry must carry a written `why` of ≥40 chars; every declared
  drift detector must be `npm-test`. **Proven by mutation, not asserted:** five probes, five catches
  — wrong runner · unclassified script · drift detector demoted to `manual` · a release runner that
  does not invoke its subject · `why: "TODO"` — file restored byte-identical after each. (The fifth
  first read MISSED; the probe was wrong, not the guard — it *lengthened* the `why` string.)
  Corrected against the code while writing it: `release.ps1` only `Write-Host`s the next stage's
  command, so the three release stages are human-typed entries, not runner-invoked — each
  irreversible step keeps its own decision point, and the table now says so rather than assuming.
- **Third instance of the same rot, closed in that commit: `doc-budget.ps1`.** A repo-drift detector
  whose answer changes on any commit that adds lines to a hot doc, whose only automatic runner was
  the release gate nobody runs between releases — so an overage could sit on `main` for weeks and
  surface at ship time. `scripts/doc-budget-guard.test.mjs` makes it resident in `npm test`,
  re-implementing the CHECK in JS but **parsing the BUDGETS out of the `.ps1`**, so the gate and the
  test cannot disagree about a number and no third source of truth exists. Cross-checked against a
  real `doc-budget.ps1` run: identical counts and budgets for all nine files.
- **One negative re-verified rather than trusted:** the `supply-chain-gate` entry in the sweep's
  "everything else IS wired" list is correct — real invocation at `verify-release.ps1:142`, pinned by
  `release-powershell-static-guard.mjs:277` and `verify-release-gate.test.mjs:73`. No correction owed.
- **Baseline:** vitest 280 files / 3084 · tsc clean · verify-module-map --strict OK (45 `.rs`, 12
  starred) · verify-release-state 24/24 zero drift · doc-budget ALL PASS · branch-disposition-audit
  OK. `main` = `ba609ea`; tree clean.

### Cycle 2026-08-03a — ✅ STANDING AUTONOMY GRANT + Q2b TRIPWIRE · ⚠️ #60 part 2 REFUTED TWICE: `bb390cf` · `7013602`

- **Owner grant (`bb390cf`).** Kuya: he green-lights ~99% of what agents stop to ask about, so the
  stopping is itself the defect. `docs/RELEASE_AUTONOMY.md` now carries the standing grant (binds
  every lane) and `.claude/hooks/stop-continue.mjs` `MAX_CONTINUES` rises 2→8. Still stops: secrets/
  signing keys · authenticating as him · anything reaching another person's machine · spending ·
  destructive Git + frozen beta refs. **Rigor untouched** — the grant removes check-ins, not
  verification.
- **Q2b tripwire (`7013602`)** — `src/q2b-deferral-tripwire.test.ts`. #64's deferral of the
  in-command `require_main()` still holds (all four triggers unmet), so this mechanizes the
  *premises* instead of implementing the check: no window may load a remote origin, and the
  production CSP may not widen. Proven both directions. Trigger 3 already lives in
  `command-authority-guard.test.ts`; trigger 4 is not statically detectable.
- **Baseline re-verified after a disk sweep cleared `node_modules` + `target`:** cargo 891/891 ·
  clippy clean · vitest 272 files / 2991 · tsc 0 · encoding-guard 1176 · verify-release-state 24/24
  zero drift · module-map 44 · doc-budget ALL PASS.
- **Real defect caught by the staleness guard:** `dist-site/` (gitignored deploy staging tree) still
  carried BOTH errors `ad4f150` fixed in `site/privacy.html` — the wrong FPS path
  (`%LOCALAPPDATA%\Compy\` vs `%APPDATA%\Compy\runtime\`) and the blanket "Compy will recreate what
  it needs" that hides `history.json` deletion erasing the Trust Ledger. That commit fixed the
  source and never re-staged. Re-staged; guard 4/4. **Deploying it is a publication act — NOT done.**
- **✅ issue [#60](https://github.com/Pootytxng/sentinel/issues/60) BOTH PARTS RESOLVED
  (`c7c60d3` fix · `9e48bbf` ship record · `97e00fd` behavioural guard).** Part 2 WAS real — my
  earlier "not reproducible" call was wrong and is retracted on the issue. Reproduced live:
  ship-reinstall completed all its work and the wrapper had to be killed at 600s; under the fix the
  same command returned in **4s, exit 0**. Cause: a CreateProcess launch hands the child our
  stdout/stderr (`bInheritHandles=TRUE`) and the installed app is meant to outlive the script, so it
  held the *outermost* caller's pipe — bounding one middle link never fixed the chain. Fix:
  `Start-NativeProcess -Detached` (ShellExecute; `Start-Process` is correctly banned by the
  process-bypass rule, so the capability went INTO the abstraction). The debug-port guarantee was
  **strengthened** — ShellExecute cannot carry a child-only env, so the silent
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` clear became a LOUD assertion that it is absent, with
  `-Detached`/`-Environment` mutually exclusive by contract. 🔻 **Self-caught:** the `linger` fixture
  added in `df8e48a` was never registered in FAKE_GH's known-mode list, so that guard passed
  VACUOUSLY; found only because the new inherited-case assertion demands the opposite outcome.
  A guard whose fixture cannot fail reads as coverage and is worse than none.
- **(superseded) issue #60 part 1 was DONE and stale on the issue** (bounded retry in `release-transaction.ps1` + guard `release-transaction-e2e.test.mjs:90`,
  both already on `main`). **Part 2 (phantom prove/publish hang) remains OPEN with two hypotheses
  measured and REFUTED** — `-NoInheritStreams`, and bounding the parameterless `WaitForExit()`.
  Decisive: an inner script run with **no wrapper pipe at all** still took 9106 ms. Stream
  inheritance is not the mechanism; the launching PowerShell does not terminate until the launched
  app exits. A 223 ms reading that looked like a fix was an artifact of an unknown-parameter error —
  flagged on the issue so it is not re-derived as evidence. Nothing kept; tree clean.

### Cycle 2026-07-28a — ✅ RELEASE AUTONOMY + RESUMABILITY REPAIR → **v0.9.11 PUBLISHED**

- Live verification superseded the 2026-07-27a release snapshot below: source `main` and source tag
  v0.9.10 already resolved to `92c7608`; the owner machine already ran 0.9.10; and
  `compy-releases` already held a tag plus byte-correct **private draft**. Public latest and the
  updater manifest remained v0.9.7.
- The immutable v0.9.10 candidate is preserved at
  `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`.
  The release-engineering repair must land after its tag, so the next publishable candidate was
  v0.9.11. v0.9.10 was never published; the publish train left it untouched, and its abandoned
  release debris was cleaned up afterwards (below).
- **Publish outcome (owner GO, 2026-07-28):** **v0.9.11 / `7ba5fb6` is PUBLIC** — release id
  `361056355`, `draft:false`, `prerelease:false`, published `14:44:17Z`; installer SHA-256
  `bb2b85a4…5438384f` and manifest SHA-256 `6bcd6cea…b76b007` both byte-match the signed receipt;
  updater signature verifies; public manifest now serves `0.9.11`; owner box runs `0.9.11` /
  `7ba5fb6 · release · shell 0.9.11`. Resumable transaction **complete 9/9**, closing on
  `public_assets_verified`. Three tooling repairs landed with it (`03c41e8` list-not-tag release
  lookup · `b6a50fa` PS 5.1 nested-JSON prerelease misparse · `c0fed45` latest-alias propagation
  wait).
- **A0 canary: PASS.** A tester completed it through Compy's normal public updater and runs
  **v0.9.11**; no updater failure was reported. Nothing else about that run was recorded (no prior
  version, timestamp, or per-step detail) — do not infer any. The canary is closed; widening to the
  remaining invitees stays an owner distribution call.
- **v0.9.10 release debris removed (owner-authorized, 2026-07-28).** The abandoned private draft
  `360948018` and the releases-repo tag `v0.9.10` were deleted (HTTP 204 each) after confirming no
  release depended on the tag — every `compy-releases` tag points at the same content commit
  `a628c9b`. Post-cleanup: no v0.9.10 release or tag in `compy-releases` (404), public latest still
  `v0.9.11`, manifest still `0.9.11`, installer hash + updater signature still verify, source tag
  `v0.9.11` still bound to `7ba5fb6`. **Preserved untouched:** source tag `v0.9.10` → `92c7608`,
  recovery branches, and the local evidence directory.
- **Release train closed.** v0.9.11 transaction complete 9/9 · A0 canary PASS · debris removed ·
  provenance preserved · **no active release blocker remains — normal product development resumes.**
- Durable authority lives in `docs/RELEASE_AUTONOMY.md`: failed reversible gates trigger
  preserve → diagnose → guard → repair → commit/push → resume. Only fleet-visible publication,
  distribution, secrets/key rotation, security settings, destructive Git, spending, and
  irreversible out-of-scope choices stop for the owner.

### Cycle 2026-07-27a — ✅ FORENSIC RECONCILIATION + SILENT-CORRUPTION REPAIR (CC): `15efc54` + `27c5f4b` on `chore/ci-encoding-and-state-truth` — **unpushed, unmerged**

- **Two silent defects, both now guarded.** (1) **Mojibake:** `scripts/release.ps1` read-modify-writes
  5 files per version bump; under **Windows PowerShell 5.1** `Get-Content -Raw` decodes BOM-less files
  as CP1252, so the UTF-8 writer double-encoded them. Reproduced on this host (em-dash → `c3 a2 e2 82
  ac e2 80 9d`). Fixed at the source with `Read-Utf8`; repaired 690 lines across
  `RELEASE_STATE_HISTORY.md`, `.claude/skills/INDEX.md`, `Cargo.toml`. `333b725` ("demojibake") had
  fixed 2 of 44 lines and closed the item — a human eyeball already failed on this class.
  Guard `scripts/encoding-guard.mjs` + 10 tests (runs in CI via `npm test`); 1020 tracked files clean.
  (2) **Unverified state anchor:** `source_main_commit=cff77ab` while `origin/main` was 16 commits on
  at `20306bc`, and `verify-release-state.mjs` passed — it checks where a citation LIVES, never
  whether the value is true. 3 anchors re-stamped; new check (6) resolves the commit, requires
  mainline ancestry, fails past `MAX_ANCHOR_LAG=10` (16 commits accrued in ONE day, so a loose bound
  would have missed this), and skips-not-fails on shallow clones.
- **🔴 Unpushed release, owner-gated.** Local `main` = `d9ced24` "release: v0.9.8" + annotated tag
  `v0.9.8`, **neither on origin**. The owner's live app IS that build (embedded stamp `d9ced24`,
  exe 0.9.8) — **his running app is reproducible only from this clone**, and corresponds to no
  published release. Registry `DisplayVersion` still reads 0.9.7 (stale vs the binary; the embedded
  stamp is truth). Push/publish/tag = owner territory, deliberately NOT done.
- **zh-CN reconciled.** Base cut (`100ace3`,`e22be5e`,`719408b`,`c51f3bb`) **is** on `origin/main`;
  the checklist there reads stale only because its correction sits in **`2461106`
  ("finish zh-CN verdict vocabulary"), the one commit still unmerged on `i18n/zh-CN`** (real delta —
  merge-tree ≠ main tree). ⚠️ **Merge-time correction required:** that commit's checklist adds
  "⏳ Restore hosted CI" — which is the **$0-Actions-budget item the OWNER DECREE above permanently
  declined.** Drop or re-word it to "CI stays red by owner decision" when merging; do not re-ask.
- **Gates (local, all green):** doc-budget PASS · encoding-guard 1020 clean · verify-release-state
  24/24, 0 drift · hooks-selftest 38/0 · cargo test 870 pass/0 fail · clippy `-D warnings` clean ·
  vitest 196 files/1855 tests · `npm run build` ✓ · `release.ps1` parses. **Hosted CI cannot confirm
  any of it — Actions blocked since Jul 9 by the owner's $0 budget (decree above). Local IS the gate.**
- **Next:** owner call — push `chore/ci-encoding-and-state-truth`, and decide the `d9ced24`/`v0.9.8`
  publish. Nothing here was pushed, tagged, merged, installed, or distributed.
