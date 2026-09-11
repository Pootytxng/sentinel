# HQ Decision Ledger — the stable tail

**Purpose:** Cowork sessions share no memory. This file carries decisions between them.

**⚡ ALL VOLATILE STATE LIVES IN `claude/HQ_RESUME.md` — READ THAT FIRST.** It carries the resume
point, current desk/fleet identity, open issues, PRs, worktrees, owner-gated decisions and the
next-lane paste block. **If the two disagree about current state, HQ_RESUME wins and the line here is
the defect.** This file is for what does not change weekly: standing directives, the vantage warning,
the lessons, the traps, the ship procedure, and every reversible decision each lane made.

**Read protocol:** ledger wins over your defaults; cite it, don't silently override.

**Lane appendices, with their status:**
- **`claude/ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md` — CURRENT.** The owner's 09-07 operating
  model (Claude Code sole implementation writer; Astra/chatgpt-hq independent reviewer; Cowork only
  for local computer-use; no parallel writers), the #385/#387 lease posture, and the four sequences.
- **`claude/DESK_CONFLICT_AUDIT_2026-09-04.md` — CURRENT.** The defect map for the permission
  prompts, the #196 recurrence, #369's topology and the Claude↔Codex contract gap; **§6 records that
  all six fixes LANDED on 2026-09-05** (PRs #377, #371 (+#375), #378).
- **`claude/CPU_TEMP_FEASIBILITY_2026-08-23.md` — CURRENT.** #140's NO-GO decision and the technical
  facts that survive it.
- **`claude/CPU_TEMP_SOURCING_DOSSIER.md` — its RECOMMENDATION IS RETIRED AND WAS TECHNICALLY WRONG.**
  Its *rejections* still stand. See the #140 section below before quoting any of it.
- **`claude/RIG_IDLE_DOSSIER.md` — HISTORICAL AND PARTLY FALSIFIED.** #127 is closed and its
  rAF/`OrbitControls` mechanism was disproved by later measurement.
- **`claude/DATA_ROOT_INTEGRITY_DOSSIER.md` — HISTORICAL**, but **its vantage warning is not
  historical and binds every Cowork session on this desk regardless of what you are working on.**
- **`claude/MIGRATION_TO_VSCODE_2026-08-24.md` — HISTORICAL; its "#196 CLOSED … survived a real
  relaunch" line was FALSE (recurred 09-02; fixed causally by PR #377 on 09-05).**

**Plus one standing law, which is not a lane and binds every session on every surface:**
**`claude/TOKEN_ECONOMY_LAW.md`** (2026-08-18) — it REPLACES `.claude/USAGE_ECONOMICS.md` §§1–6,
`CLAUDE.md` TOKEN LAW 1–5, and the memory `usage-economics-subagent-session-rules`; where they
disagree it wins. **LANDED as `94db990b`.** The one thing to carry even if you read nothing else:
**carried context is 85% of measured spend and output is 15%**, so a subagent is a context firewall
(fresh window, only the summary returns) and delegating verbose work is a saving, not a cost.

---

## 🚦 STANDING DIRECTIVE — DO NOT GATE ON HIS REVIEW FOR VERIFICATION-GRADE WORK (owner, 2026-08-19)

His words, after being asked to look at `2f79febb`:

> *"honestly just from looking at it i dont see anything really spectacular or large enough of a
> change to review. i thought alot more work was completed so dont ask me or gate things waiting for
> my review if its minimal changes like that you should be able to double check that work and those
> corrections yourself that doesnt seem to actually require my eyes"*

**The LOOK law splits in two. It is not weakened — it is aimed.**

- **The assistant's own eyes** cover: correctness, regressions, "did the thing I changed do what I
  said", guard behaviour, layout and type after a refactor, anything where the question is *is this
  right*. **Do the CDP look yourself, judge it, and report the verdict with the capture attached.**
  A green suite is still not a look; three of six builds proved that.
- **His eyes** cover: coherence across the app, design judgment, naming, whether a thing feels like
  the product he wants, anything he will *feel* — and the publish GO, which is unchanged.

**Practical test before asking him for anything:** could I settle this by looking harder? If yes,
look harder. **Never hand him a build with "please review" and no list.**

**And the observation underneath his complaint, which is the more important half.** Three lanes
landed on 2026-08-18 and from his seat produced almost nothing visible. **That is marathon law 1
(product-first) drifting into governance, and he felt it before anyone measured it.** Weight the next
lanes toward things he can see and feel.

## 🚦 STANDING DIRECTIVE — ALWAYS END WITH THE NEXT ACTION (owner, 2026-08-19)

> *"stop responding without advising the next course of action"*

**Every reply ends by naming what happens next** — what the assistant is about to do, or the one
thing that is genuinely his. Not a menu, not a summary, not "let me know how you'd like to proceed."
A finished answer that leaves the next move unstated is an unfinished answer.

This sharpens the older *"advise what's ready and just proceed"*: that one bans menus, this one bans
**trailing off**. If the next action is the assistant's, state it and take it. If it is genuinely his
— the publish GO, a design word, a purchase, a human — say plainly that it is his and why nobody else
can take it.

## 🚦 STANDING DIRECTIVE — EVERY REPLY ENDS WITH A PASTE-READY HANDOFF THAT NAMES ITS LANE (owner, 2026-09-07)

> *"you need to always provide a clearly stated handoff with the instructions and the correct lane
> to paste it"*

**This sharpens "ALWAYS END WITH THE NEXT ACTION."** Naming the next move is no longer enough. The
reply ends with a **paste block the owner drops into a lane unchanged**, and it **names the lane** —
Claude Code (sole implementation writer), Astra / chatgpt-hq (independent exact-head reviewer and
consolidation owner), Codex (off the critical path), Cowork (only where local computer-use is
required) — and says in one line why that lane and not another. **One handoff, one lane** (one
default over a menu). If the next move is genuinely his — a GO, a purchase, a lease decision — the
paste block still exists: it carries the decision he must make and where it gets recorded. **A paste
block is self-contained**: a Claude Code lane cannot `project_read`, so its facts travel inline —
heads, issue numbers, lease state, write scope, stop condition. A reply without the block is
unfinished.

## 🚦 STANDING DIRECTIVE — RESOLVE IT YOURSELF (owner, 2026-09-04)

> *"im demanding you to resolve every single task yourself you do not need to have me manually do
> anything you have permissions to resolve all of this yourself and do it correctly and double check
> everything is good"*

**This supersedes the gating half of his 08-31 hard_deny for Cowork sessions:** hook edits, settings
edits and the Codex/Claude config surfaces are applied by the assistant **on the desk**, with the
same discipline the owner would use — independent review bound to the exact head, the full local
gate, falsified guards, and a written record. **What stays his:** publish GO, deploy GO, purchases,
humans, and his Codex sandbox posture (asked once; left as is).

**Narrowed 2026-09-07 for implementation work** (see `ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md`
§1): Claude Code is the sole implementation writer and Cowork does not take the pen on code. The
directive still binds everything genuinely Cowork's — re-derivation, review, findings, governance,
docs, board hygiene. Where the two appear to conflict, the dated, lane-specific instruction wins.

---

## ⚠️ THE VANTAGE WARNING — PERMANENT, AND IT BINDS EVERY COWORK SESSION

**Every Cowork session on this desk runs inside the packaged-Claude MSIX container.** `%APPDATA%`,
`%LOCALAPPDATA%` and `HKCU` reads from here are **overlay views** and **look completely normal** —
same path, same hash, same NTFS file id, no reparse point.

- **Trustworthy from Cowork:** the SCM (`Win32_SystemDriver`, `Win32_DeviceGuard`), `powercfg`, Task
  Scheduler, `HKLM\SYSTEM`, anything under `C:\Users\Kuya\code\`, `C:\Users\Kuya\.claude\`,
  `C:\Users\Kuya\.codex\`, `C:\Program Files\`, and **git/`gh`/`wrangler` run against the repo or a
  cloud account.**
- **NOT trustworthy:** anything under `AppData` or `HKCU` — including **any attempt to read the
  installed `compy.exe` stamp or the Windows uninstall registry key.** Fresh native stamp or registry
  proof must come from a **non-containerized** session.
- **A Compy launched from a packaged host resolves to `Sandbox` BY DESIGN** and cannot construct a
  `MutationRoot`, so applies, rollbacks and receipts behave differently. **A Cowork-launched look is
  not representative and never will be.**
- **Opening Compy *from Cowork* is what created #130.** The workaround is "push while it happens to
  be open", never "open it to push".
- **The same limit applies to driver/IOCTL probing.** A failure from inside the container is
  indistinguishable from a container restriction — see the cancelled elevation experiment in #140.

**NOT re-verified:** `scripts/release.ps1:100` and `scripts/ship-reinstall.ps1:118` build their
Gaming-Mode preflight from `$env:APPDATA` and **fail OPEN** under a packaged host. **Treat the freeze
as still in force.**

## 🖥️ OWNER'S DESK — measured hardware/driver facts (2026-08-19, from the SCM)

| | |
|---|---|
| CPU | **AMD Ryzen 7 9850X3D**, 8 cores — family `0x1A`, model `0x44`, Granite Ridge (Zen 5 X3D) |
| **Memory Integrity (HVCI)** | **ON and ENFORCED** — `SecurityServicesRunning: 2`, `CodeIntegrityPolicyEnforcementStatus: 2` |
| **PawnIO** | installed + running, v2.2.0, Microsoft-attestation-signed, `Status: Valid`. **Ships NO modules** — only `PawnIOLib.dll`, `PawnIOLib.h`, `PawnIOUtil.exe`, `uninstall.exe` |
| Ryzen Master driver | `AMDRyzenMasterDriverV32` running — this is how Adrenalin shows him a temperature |
| HWiNFO / LHM / OHM | **not installed or not running** |

**Consequence: Compy reads NO CPU temperature on the owner's own machine, and after #140's NO-GO it
still will not. That is the accepted outcome, not an open defect.**

## 🌡️ #140 CPU TEMPERATURE — **CLOSED 2026-08-23 with a NO-GO.** Current doc: `claude/CPU_TEMP_FEASIBILITY_2026-08-23.md`

> **⚠️ THE OLD DOSSIER'S PLAN IS DEAD AND WAS ALSO TECHNICALLY WRONG.**
> `claude/CPU_TEMP_SOURCING_DOSSIER.md` recommended *"bundle PawnIO, read the MSRs from Rust"* and
> named `RyzenSMU` / `AMDFamily1Ah`. **Do not build from it.** Its *rejections* survive; its
> *recommendation* does not.

**OWNER DECISION, 2026-08-23: Compy will NOT bundle, install, download, recommend, update or remove
PawnIO.** Seven reasons:

1. **FACEIT officially lists `PawnIO.sys` as a forbidden driver** — its signing certificate is also
   used by cheat software — and the anti-cheat **refuses to launch**, so the user cannot play the
   match. **Signer-level; nothing Compy does changes it.** Compy's audience is gamers, and a CPU
   temperature is not worth taking someone's game away.
2. **Compy cannot ship self-built production modules** — the retail driver enforces upstream RSA
   signatures, and the "unrestricted" installer stays restricted absent Windows Test Mode.
3. **The proposed mechanism was wrong.** AMD package temperature is an **SMN** read
   (`0x00059800` via `ioctl_read_smn`), **not an MSR read**. The module is **`AMDFamily17`** (gate
   `0x17 ≤ family ≤ 0x1A`, so it does cover Zen 5). **There is no `AMDFamily1Ah`**, and **`RyzenSMU`
   is PM-table/SMU only.**
4. Permanent dependency on upstream signed-module cadence, unpatchable by Compy.
5. GPL and source-offer obligations on redistributing the driver/installer. (The IOCTL exception does
   protect Compy's proprietary Rust — verified verbatim — but not the redistribution itself.)
6. **No verified paid closed-source precedent.** The closest paid analogue, **OCCT, built its own
   signed driver instead.**
7. A persistent kernel driver contradicts Compy's rollback-first safety contract.

**The native call-time elevation experiment is CANCELLED**, not deferred.

**Deferred and NOT authorized — issue #202:** passive detection of an *independently installed*
PawnIO. Never install/download/recommend/update/remove; explicit opt-in; FACEIT incompatibility
disclosed by name; honest unavailable fallback. **Native elevation proof becomes required again only
there.** Passive detection never redistributes the driver, which is the only reason it survives.

**Standing rejections, re-confirmed, that nothing above reopens:** HWiNFO as a dependency (licensing
+ the self-regenerating 12-hour SHM expiry — see lesson sixteen), LHM/WinRing0 (**29 hash rules** in
enforced policy v10.0.29545.0), AMD Ryzen Master SDK (blocked ≤ 1.5.0.0, CVE'd, non-redistributable,
AMD-only), ADLX (no CPU package temperature), Intel Power Gadget (discontinued), **Compy owning a
signed kernel driver** (Azure Trusted Signing supports neither EV nor drivers, confirmed 2026-04-22).
**Do not re-propose any of these without naming this rejection.**

**Untouched by the decision:** `src-tauri/src/cpu_temp.rs` and `src/surfaces/CpuTempOffer.tsx`. A user
already running HWiNFO or LHM still gets a reading, and the honest "no reading available" state
remains correct.

## ✅ #130 DATA-ROOT INTEGRITY — CLOSED 2026-08-18

**Resolver merged as `795d8ff5`.** `src-tauri/src/data_root.rs` carries `DataRootDecision`,
`MutationRoot` and the `GetCurrentPackageFamilyName` predicate; `actions.rs` consumes it. Design doc
`docs/decisions/2026-08-18-canonical-data-root.md` (`6aa5c8c9`).

**`compy_data_dir()` is no longer a plain `%APPDATA%` join.** At `lib.rs:436` it calls
`data_root::decision()` and returns `decision.effective_root()`, and **GUARD 1 gates the legacy
`Sentinel→Compy` migration on `Canonical`** — that migration is a recursive COPY that would otherwise
duplicate the whole Trust Ledger into somebody else's sandbox. **The `C:\Temp` fallback is gone and
pinned gone by test:** `data_root.rs:917`.

**Recovery RAN, under owner GO.** 3 canonical + 61 overlay receipts unioned into **64** (39 applied /
25 rolled back), zero id collisions, read-back 64/64 unique. Both inputs backed up to
**`C:\Users\Kuya\code\compy-data-root-recovery\`**; the overlay folder was **moved, not deleted**.
**Only `history.json` was unioned**; six other files were archived intact.

## 📨 TESTER FEEDBACK — Jaikaran Kang

**Intake:** `C:\Users\Kuya\Documents\Codex\2026-08-12\use-the-new-email-from-jaikaran\outputs\claude-next-train-jaikaran-v0.9.12-intake.md`
**Owner corrections 2026-08-13:** **"bichnege" is a typo.** **The reply hold is LIFTED.**

**A change counts as fixed only after the original scenario is rerun on the exact installed candidate
AND a permanent guard covers the failed boundary.** Overlap is overlap, not proof.

| Item | Disposition |
|---|---|
| **P0 — feedback draft data loss** | **FIXED + GUARD PROVEN + LOOKED AT**, shipped v0.9.25. **J has not received it if he has not updated — and his build is still unconfirmed.** |
| **P0 — intermittent freeze on scroll / room change** | **OPEN and now unexplained.** #127 was its leading explanation; #127 closed with a different cause and the freeze was never retested. **Re-test on v0.9.26 before treating it as anything.** |
| **P1 — session appears only after restart** | **OPEN.** The mounted list has no completion signal that reloads summaries. `e5a5179` is adjacent, not a fix. |
| **P1 — rig zoom scrolls the page** | **OPEN.** Two owners of one wheel stream. |
| **P2 — Lab diagram = Home diagram** | **Product decision.** PR #90 may already satisfy part of it. |
| **P2 — auto-attach diagnostics to feedback email** | **Product/privacy decision. The current refusal is intentional safety behaviour.** If ever approved: visible, previewable, explicit opt-in. Never a silent attach. |

**Second loss channel, NOT fixed:** `App.tsx:373-375`'s export-modal fields are plain `useState` too.
**Still no issue filed for the intake** — file one when that lane starts, evidence first.
*(09-07 consolidation: these are pre-Constitution tasks — evidence, not priority; the Lab surfaces
they cite were deleted in `1ab831fb` (#78). They re-enter only through BACKLOG's pull rule.)*

## 🧟 "ROUGH FRANKENSTEIN STATE"

A **coherence** complaint, not a bug list. ③ gives the front-door button somewhere real to go
(partly delivered by C-05); ④ makes the app speak one language (C-06/C-08/C-09); ⑤ puts the
instruments behind a door. **Do not patch surface by surface.**

**Step ③ (the interview)** remains a design lane: one question per screen, four spoken-English
answers, "I'm not sure" a first-class option that must not dead-end, ending in a finding card. Per
`docs/decisions/2026-08-11-design-foundation.md`. *(Pre-Constitution; not executable as written —
BACKLOG Phase 4/5 is where a guided journey re-enters.)*

## ⚠️ DEFERRED FROM UX-1 — the four counters

*"The four counters demote to one quiet footer line — ranked, not deleted."* **Not moved,
deliberately:** the verdict and the one action now sit ABOVE the stage, and relocating them must also
rewrite `home-console-standard-readout-guard.test.tsx` (owner 2026-08-06 — **the *data* being ungated
is the contract, not the corner**) plus the corner selectors in `home-console.test.tsx`. `RoomShell`'s
`quiet` slot is where the ranked line belongs.

## ⚠️ VERSION MINT RULE

**`release-prepare.ps1` mints `configured version + 1` every run and commits `release: vX.Y.Z` BEFORE
the gates run.** A prepare that FAILS still burns its number (v0.9.20, v0.9.21). **On any re-prepare,
pre-declare the NEXT number.** **A look-failure costs a number too** (v0.9.23 → v0.9.24) — the price
of the look, and it is cheap. Two prepare refusals: **"branch is not main"** and **"local main is not
synchronized with origin/main"** (push the doc-sync BEFORE prepare).

## ✍️ RELEASE-NOTES CONVENTION

`522799e3` renders the manifest's notes as a **What's new** list. **Write `-Notes` for TESTERS**:
short plain-English clauses separated by semicolons, each a thing a user can notice. v0.9.25's are
the model — *"Compy feels quicker again - the update badge was redrawing the window on every frame,
on every screen; a bug report you start in Settings now survives leaving the page…"*. v0.9.18's
("popout modal contract gains its 17-case guard") is the counter-example.

## Proven ship procedure (walked clean many times)

pre-declare in RELEASE_STATE (`candidate_version`→**latest_release_version + 1**,
`candidate_installed`→`no-pending-prove`, `candidate_published`→`no-unsigned-local-only`, first owner
decision must NAME the version **on one unwrapped bold line**) → `verify-release-state.mjs --strict`
to 0 drift → **push** → `release-prepare.ps1 -Notes` → `release-prove.ps1` → **LOOK AT IT** →
doc-sync `owner_installed_*` → push → `release-publish.ps1` → doc-sync `published_*` (+ manifest row,
bottom line, decision, blocker row) → push.

- **The release repo is `Pootytxng/compy-releases`. The source repo is `Pootytxng/sentinel`.**
  `gh release list` in the source checkout returns EMPTY and `releases/latest` 404s — correct, not a
  fault. Pass `-R Pootytxng/compy-releases`.
- **`source_main_commit` must be an ancestor of `origin/main`** — never the local release commit
  (SOURCE-COMMIT-ORPHAN), ≤10 behind (SOURCE-COMMIT-STALE).
- **`STATE:desk_fleet_relation` must match git ancestry** — check (8), added 2026-08-23. Never claim
  same bytes from a matching version number, and never claim divergence from an installer hash.
- **You can pre-declare BEFORE merging your lane branch** and push once. Saves a 4-minute gate run.
- **Releases run from `main` only** — fast-forward your lane branch before prepare.
- **`release-prove.ps1` pipes its child to `Out-Null` and prints NOTHING.** Exit 0 with an empty log
  is normal — **but do not take the exit code as evidence.** **The install happens during PREPARE.**
- **⚠️ THE TRANSACTION JOURNAL IS NOT COMMITTED AND DOES NOT SURVIVE.** `src-tauri/target/` is
  gitignored and `bundle/nsis/` was **absent from disk on 2026-08-23**, so every "9 of 9 stages"
  claim rests on prose alone and its cited proof path resolves to nothing (**issue #199**). **Copy
  the journal out of `target/` at publish time or the proof evaporates with the next clean.**
- **ONE PUBLISH PEN.** Check `$env:TEMP\publish-*.log` for a fresh run before ANY publish.
- **The pipeline does NOT commit the `published_*` doc-sync.** Hand-sync it.
- **Run long commands DETACHED**, log from INSIDE a wrapper `.ps1` outside the repo (**the 09-04/05
  lanes used `C:\Users\Kuya\code\hq-desk-fix-2026-09-04\`**, which is also trustworthy from Cowork
  where `$env:TEMP` is an overlay view). Poll the log with `Select-String` on your own markers; **keep
  every Desktop Commander call under ~55 s** — the device drops a >60 s call.
- **`scripts/verify-local.ps1` writes `logs/verify-local-*.log` INSIDE the repo** on every push gate
  (gitignored). Clean before prepare or publish.
- Timings: pre-push gate ~4–8 min (a fresh worktree pays a full cargo build) · prepare ~4–5 min ·
  prove ~25s · publish ~3 min.
- **`gh pr merge` refuses a DRAFT** — `gh pr ready N` first. **Merging a PR whose head is already
  reachable from its base (e.g. after a hand-merge into the base branch) is done by GitHub itself** —
  #375 flipped to MERGED on the push, no click needed.

## 🌐 SITE / DEPLOY FACTS (established 2026-08-23, issue #201)

- **Hosting is Cloudflare Pages**, project **`compy`**, config `wrangler.toml`
  (`pages_build_output_dir = dist-site`, D1 binding `compy_waitlist`
  `74810997-9c7e-4fba-8d11-2eacbd6ba685`). **Vercel is explicitly disabled** — `vercel.json` sets
  `git.deploymentEnabled: false`.
- **Our URL is `compy-bd6.pages.dev`. Bare `compy.pages.dev` IS A STRANGER'S SITE** — the `-bd6`
  suffix is Cloudflare's collision marker. Never link the bare form.
- **`compy.gg` is NOT REGISTERED** — authoritative `.gg` WHOIS port 43 returns `NOT FOUND` (control
  `nic.gg` → Active). **Registering it is the owner's, and it is the only mitigation for builds
  already shipped with it baked in.**
- **⚠️ DO NOT USE RDAP FOR `.gg`.** IANA lists **no RDAP service** for the TLD; `rdap.org` 404s for
  every `.gg` domain including registered ones. That 404 carries zero information. **Port-43 WHOIS is
  the only usable registry vantage.**
- **A merge is not a deploy.** Production ran two weeks behind `main` and PR #193's pricing fix was
  never live. **Check the deployed artifact's source commit, not the merge.**

## Known flakes / traps (do not re-diagnose)

- **⚠️ COWORK RUNS INSIDE THE PACKAGED-CLAUDE CONTAINER** — see the vantage warning above.
- **⚠️ THE CODEX DESKTOP APP'S EXTERNAL-AGENT IMPORT SYNC REWRITES `<root>/.codex/config.toml` IN
  EVERY CHECKOUT IT IMPORTS A SESSION FOR (issue #196; recurred 09-02/03/04 after the 08-24 toggle
  "fix"; CAUSALLY FIXED by PR #377 on 2026-09-05).** Governed by `~/.codex/config.toml` `[desktop]
  external-agent-import-sync-enabled` (left `true`). The rewrite is deterministic: it re-serializes
  the tracked TOML (comments dropped) and adds `[shell_environment_policy.set]` from the repo
  `.claude/settings.json` `env` and `[mcp_servers.shadcn]` from `.mcp.json`. **The tracked file is
  now byte-identical to that output (blob `230f54ec`) and `scripts/codex-config-guard.test.mjs` pins
  the shape, so the rewrite is a no-op on `main`.** Consequences: **never add a comment to
  `.codex/config.toml`** (prose goes in `.codex/README.md`); the shadcn pin in `.mcp.json` and the
  `env` block in `.claude/settings.json` are the file's inputs — change them and the guard tells you
  to regenerate. Still true: **never `git add -A` in this repo.** Older lane worktrees carry the
  rewritten working copy until they take `main`.
- **⚠️ THE PERMISSION PROMPTS CAME FROM A HOOK, NOT THE CLASSIFIER (2026-09-04; FIXED 09-05, PR #377).**
  `.claude/hooks/shell-ownership-assert.mjs` returned `ask` for every `$var`/glob write operand
  (`ce13a209`, 2026-09-02). **Claude Code shows hook-forced `ask` prompts even in auto mode, and hook
  decisions override `permissions.allow`** — so allow-list expansions in either `settings.json`
  cannot suppress them. **Now:** same-line `NAME=value` and `TEMP/TMP/LOCALAPPDATA/APPDATA/USERPROFILE/HOME`
  resolve; a prefix assignment (`S=x cmd $S/y`) is NOT learned (POSIX prior-value semantics); only a
  truly unknowable `$VAR` asks. `FOLDER_UNCLAIMED` / `BOARD_UNREACHABLE` emit **no decision +
  `additionalContext`** after every stricter check — never a refusal, never a prompt, never a hook
  `allow` (a hook `allow` skips the classifier; "proceed" means no decision).
- **⚠️ THE AUTO-MODE CLASSIFIER BLOCKS REAL WORK, several times per lane.** 34 denials across 80
  sessions. **Retry once before rerouting** on "Stage 2 classifier error … usually transient". The
  real fix is allow-list entries in `~/.claude/settings.json` — and that fix addresses classifier
  denials only, never hook prompts (above).
- **CDP probe crash** (`-1073740791`, libuv `UV_HANDLE_CLOSING`) — **retry once first.**
- **`/releases/latest/download/latest.json` can serve a STALE body for minutes after publish.**
- **The desk is SHARED, and so is the main CHECKOUT.** **A WRITER NEEDS ITS OWN WORKTREE AND A
  LEASE** (`docs/WORK_CONTROL.md`). **Re-run `git branch --show-current` + `git status --short` in the
  SAME command as any commit.** On 2026-08-23 a Cowork audit watched another writer commit `848f6bf8`
  mid-read.
- **A CLAIM HAS NO AUTOMATIC TAKEOVER.** An expired clock is not a licence. **Takeover is legal only
  via a `### Verified takeover` record** (previous lease, evidence, preserved work, new executor,
  expiry) — never reset/stash/discard/kill first. **On 2026-09-04 three cross-agent reads of "the
  other one is idle/clean/absent" were all wrong** (Codex→Claude, HQ→Codex, Claude→Codex); process
  lists and worktree status are not a presence signal.
- **A BRANCH AUTHORED THROUGH THE GITHUB API HAS NEVER RUN THE LOCAL GATE.** PR #375 carried 18
  tests that still pinned the law it retired; they surfaced only when the reconciled branch ran
  `npm test` on the desk. **Treat "no local Windows gate is claimed at this head" as "unverified",
  and run the gate before reasoning about the branch.**
- **THE COWORK↔DESK BRIDGE DROPS MID-LANE.** The whole `mcp__remote-devices__*` set vanishes and
  returns one `RefreshMcpTools`/`ToolSearch` later. Detached jobs keep running. **A subagent resumed
  across a rate-limit reset loses its turn but keeps its uncommitted edits on disk** — read
  `git diff` before deciding to keep or discard them (09-05: kept, they were coherent).
- **⚠️ THE BRANCH-DISPOSITION DEADLOCK is largely retired (#355):** an unrecorded ref that still
  diverges is measured `UNLANDED` and **reported, not failed**; a landed ref with no record, or a
  record naming a gone ref, still fails. **Drop the record the minute the branch is deleted.**
- **Windows PowerShell text round-trips corrupt this repo's UTF-8 docs.** Use `git checkout <commit>
  -- <file>` + `edit_block`, never whole-file rewrites through PS 5.1. A here-string containing `·`
  or `→` breaks the PARSE. Keep generated fixtures ASCII. **(09-06: a `.ps1` written UTF-8 without
  BOM and containing any non-ASCII byte fails to PARSE under PS 5.1 — keep wrapper scripts pure
  ASCII and spell non-ASCII as `\uXXXX` in regexes.)**
- **PowerShell 5.1 argv traps:** inside a `-Command "…"` string you lose `$env:X`, `$_`, `$false`,
  **`$LASTEXITCODE`**, and **any nested double quote fails to parse** — this also eats a `--jq`
  expression's quotes (even inside a `.ps1`, a jq program with spaces must be single-quoted as one
  argument) and silently truncates a multi-line `gh issue comment --body`. **Use `--body-file` /
  `-F`, or a wrapper `.ps1` run with `-File`.** *(09-07: a `--jq` program containing a double-quoted
  string literal splits into extra args even when single-quoted — build jq programs without `"`;
  emit separators with a second `Write-Output` instead.)*
- **`Select-String -Pattern 'error:'` is case-INSENSITIVE by default.** Grep your own explicit
  markers. **A pattern containing `"` breaks the regex.**
- **`vitest --reporter=basic` no longer exists** — use the default reporter and grep the log.
- **Desktop Commander's `write_file` REFUSES to overwrite without an explicit `mode: "rewrite"`.**
- **`npm test` alone fails 3 site suites** in a fresh worktree (`ensureSiteAppBuilt` — `site-app/node_modules`
  absent). **The push gate installs and builds the site itself.** Not a defect; do not chase.
- **A fresh worktree needs its own `npm ci`** before vitest will run — and its first gate pays a full
  cargo build. **The warm HQ worktree `C:\Users\Kuya\code\sentinel-hq-desk-fix` is GONE (pruned
  09-07)** — an HQ lane creates its own worktree and pays the first build.
- **`q7-probe.mjs` overwrites `docs/perf/raw/idle-attribution.json` IN PLACE.** It **can** now measure
  an exe that is not the installed one (`cb717687`).
- Pre-push hook = full gate; flakes under load, retry once. *(09-07: #390 / PR #391 — the
  launch-focus-guard's minimized assertion fires on the runner's own console windows; three
  verify-local runs went FAIL/PASS/FAIL on a Rust-only diff. Until #391 lands, a red gate on a diff
  that touched no focus code is that flake first.)*

## How to LOOK at the app

```powershell
# Write this to a WRAPPER .ps1 and run with -File. It CANNOT ride a -Command "..." string.
if (Get-Process compy -EA SilentlyContinue) { Stop-Process -Name compy -Force; Start-Sleep 3 }
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
Start-Process (Join-Path $env:LOCALAPPDATA "Compy\compy.exe")
Start-Sleep -Seconds 24
Invoke-WebRequest http://127.0.0.1:9333/json/version -UseBasicParsing   # prove the port is live
```
**⚠️ RUN THIS FROM A NORMAL SESSION, NOT FROM COWORK** — a Compy launched from a packaged host
resolves to `Sandbox` by design and cannot construct a `MutationRoot`.

Then `node docs\ui-sweep\cdp-shot.mjs 9333 out.png` and
`node docs\ui-sweep\cdp-eval-file.mjs 9333 <file.js>`. Copy PNGs to
`C:\Users\Kuya\code\compy-visual-review\`, `device_stage_files`, then `Read` the image.
**The folder grant does NOT survive into a new Cowork session.**

**⚠️ THE CDP TARGET PICKER FOLLOWS THE RAIL, AND SETTINGS HAS NO RAIL.** Open Settings and every
subsequent `cdp-eval-file` silently attaches to the in-game overlay window — you get
`textareaCount: 0` and conclude the component does not exist. Tell-tale:
`document.body.textContent.length` ≈ 46. **Fix: do everything that must run inside Settings from ONE
eval issued while the rail is still present.**

Other CDP notes: **reading `aria-expanded` right after a `.click()` in the same expression returns
the PRE-render value.** React-controlled inputs need the **native value setter + an `input` event**.
**`src-tauri\target\release\compy.exe` serves its own BUNDLED assets** — it cannot preview
uncommitted frontend. **Probe scripts in `docs\ui-sweep\` are UNTRACKED — delete them before prepare
or publish.**

---

## THE LESSON — look at it, measure it, and know what your tests cannot see

Look-failures worth carrying:
- **v0.9.16**: 326 green files; Care entry had no card treatment, because-line stranded ~130px.
- **v0.9.19**: 330 green; the 13px floor overflowed the arc-gauge ring. **The type scale's own guard
  passed — it enforces sizes, and the defect was a size that no longer FIT.**
- **v0.9.23**: green; the verdict rendered a step small on a cross-file CSS specificity collision.
  **jsdom loads no stylesheets, so the suite was structurally blind to it.**
- **v0.9.24**: green; an always-on `box-shadow` animation shipped into the topbar. **There WAS a
  guard for this exact class** — its inventory was a two-row hand-kept list.

**A kind no LOOKING would catch (RIG-IDLE):** the app renders correctly, it just burns a fifth of a
core doing it. **Eyes catch layout and type; only instruments catch cost.**

**A kind where the INSTRUMENT ITSELF was inside the thing being measured (#130).** **When two
readings agree that should not, suspect the vantage before believing the agreement.**

**A constant fitted to ONE data point survived a change to the thing it was fitted against.** **When
you change the input a measured constant was fitted to, the constant is unmeasured again.**

**Measure the leak before you build the guard.** Bash averages 1,145 B/result while Read — already
guarded — is 50.6% of inflow. The guard was not built.

**A guard's mutation test must run the guard's REAL code path.** `no-raw-select-guard` could not see
a `<select` that ENDED a line, because the scan splits on newlines and the lookahead had no character
left. **Its own mutation test passed, because it fed the matcher a string that still carried its
newline: a path the real sweep never runs.** **Feeding the matcher a hand-built string proves the
matcher, not the guard.**

**A lead smaller than your sampling interval is not a measurement.**

**A documented enforcement that does not exist.** `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF` was
documented as enforced by "the release gate". **No release gate exists and nothing sets it.** Grep
for the enforcer before writing that a thing is enforced.

**A worktree path that does not exist still runs.** Every git command silently resolved to the main
checkout. **Relaunch rooted at the real path.** *(Recurred 09-07, harmlessly: `git -C` on the empty
leftover directory `.claude/worktrees/priority-order-parallel-productivity-ae19bb` answered for
`main`. An empty directory is not a worktree.)*

**A guard's FILE FILTER can be narrower than its name.** `plain-language-guard` scanned 199 `.tsx?`
files and **none of the 18 locale files holding the copy it exists to police.** **Check what the
guard READS before arguing about what it CHECKS.** *(Recurred 09-05: the lease guard scanned four
bootstrap docs and none of `.codex/`, where the retired role sentences lived on; widened in #378.)*

**Every existing test picked forward, so nothing noticed the pick could not be cleared.** **The
regression test goes backwards.**

**Better copy cannot fix a self-regenerating failure.** HWiNFO's free build disables its shared-memory
toggle **every 12 hours by design**. **When a state keeps coming back, check whether the dependency
regenerates it before writing better words for it.**

**⭐ A DOCUMENT CAN CARRY ITS OWN REFUTATION AND STILL PASS EVERY GATE (2026-08-23).**
`RELEASE_STATE.md` held `published_release_commit=5e64074c` and `owner_installed_stamp=d5a6a630`
**twelve lines apart** while asserting the desk ran *"those same bytes"* and that divergence was
*"closed"*. It survived four days. Root cause: **`published_release_commit` was read by nothing** —
the anchor existed only to define itself — and **no check read a prose claim at all**. **An anchor
nothing consumes is decoration. When you add a STATE anchor, add the check that reads it in the same
change, or it is a comment.** Fixed by check (8). **Recurred 2026-09-04:** `CONSTITUTIONAL_MIGRATION.md`
§4 said "Codex read-only" while §17 of the same file was a Codex writer record (fixed 09-05).
**Recurred 2026-09-07 in THIS project's own docs:** HQ_RESUME carried `origin/main = 5cecc3c6`, a
warm HQ worktree, "#385 is a proposal", "#225 owns the release-state files" and five closed issues as
open — one day after being "brought current". **A resume doc is re-derived from `gh`/`git` at the
start of every session, never trusted because it is dated yesterday.**

**⭐ A MECHANISM DERIVED FROM SOURCE AND NEVER RUNTIME-CONFIRMED WILL BE QUOTED AS MEASURED.**
#127's rAF/`OrbitControls` diagnosis was read out of library source, written into a dossier, and
carried forward as fact until measurement falsified it and named `aurora` + `stl-pulse` instead.
**Mark unconfirmed mechanisms as unconfirmed IN the artifact that carries them.**

**⭐ CODE PRESENCE IS NOT EXECUTION, AND A STATIC TEXT MATCHER IS NOT A TEST OF BEHAVIOUR.** #156's
guard reads `ship-reinstall.ps1` **as a string** and asserts substrings and byte offsets — it never
runs an installer. #128's mutex has been held once by a real ship, **uncontended** — which proves
acquire/release, not exclusion. **Name which of the two you have before closing anything.**

**⭐ A MERGE IS NOT A DEPLOY, AND A SOURCE FIX IS NOT A SHIPPED FIX (2026-08-23).** PR #193 fixed the
site's pricing copy, merged, and was called done. Production ran two weeks behind for another day and
the wrong copy stayed live. **Check the deployed artifact's source commit, not the merge.**

**⭐ A PATCH FILE FOR SOMEONE ELSE'S HAND IS NOT A FIX, AND CLOSING THE ISSUE ON IT IS A FALSE CLOSE
(2026-09-04, #373).** PR #374 merged, #373 closed, the hook byte-identical on every ref, the prompts
continuing. **An issue closes when the defect stops, not when the cure is written down.**

**⭐ A HOOK'S COMMENT ABOUT THE PLATFORM IS NOT THE PLATFORM (2026-09-04).** Two hooks and a spec
asserted that `ask` degrades to allow under auto mode. The docs say the opposite and the owner
pressed Allow 33 times. Two fixes were designed on the comment. **Check the platform doc before
building policy on a claimed platform behaviour — and falsify it with one real prompt.**

**⭐ "PROCEED" IS NOT "ALLOW" (2026-09-05, review round 1 of PR #377).** The first fix for the
unclaimed-folder refusal emitted a hook `allow`, which **skips the prompt and the auto-mode
classifier for that call**, and returned early — before the protected-global, unknown-zone and
unresolved-operand checks. From an unclaimed session, `cp ./x.json ~/.claude/settings.json` would
have been allowed. **A hook that wants the normal flow emits NO decision (context only), and an
advisory never short-circuits a stricter check.** Caught by the independent review with real probes,
fixed with regression tests.

**⭐ A TOGGLE IN ANOTHER PROGRAM'S CONFIG IS NOT A CAUSAL FIX (2026-09-04, #196).** The 08-24 fix
flipped a setting the other program owns; the program flipped it back within a week and nine
checkouts were rewritten again. **A causal fix is one the other writer cannot undo — make the
artifact immune to the writer, or make the writer's output the tracked truth.** *(Done 09-05: the
tracked file IS the writer's output.)*

**⭐ A DOSSIER'S RECOMMENDATION AGES WORSE THAN ITS RESEARCH (2026-08-23, #140).** The CPU-temp
rejections survived four days of scrutiny intact; the *plan* built on them was wrong in two
load-bearing ways — wrong module, wrong register class — and neither error was visible until someone
read the module sources instead of the summary. **When an artifact carries both findings and a plan,
date and mark them separately: the findings may still be true long after the plan is dead.**

**⭐ FEASIBILITY THAT ONLY ASKS "CAN WE BUILD IT" MISSES THE REAL BLOCKER (2026-08-23, #140).**
Licensing was clean, the CPU was covered, the blocklist was clear. The proposal died on what the
feature would do to the user's **other software** — an anti-cheat that refuses to launch. **Ask what
the feature does to everything else on the machine.**

**⭐ SEARCH THE ISSUE TRACKER BEFORE FILING (2026-08-23).** HQ filed #197 eleven minutes after #196
had already proven strictly more, then asserted in a comment that the cause was unknown when it was
known. **Retracted and closed as a duplicate.** **A claim of "unknown" is a claim, and it needs the
same search a claim of "known" does.** *(Recurred 09-07: #388 and #389 — two consolidation inboxes,
same title, twelve minutes apart, different templates.)*

**⭐ A REVIEWER LABEL IS A GATE INPUT, NOT A COURTESY (2026-09-06).** The #383 brief told Cowork to
review "as `claude-code`"; the very next PR was authored by `claude-code`, and the same label would
have made `work-control-gate` count the reviewer as the author. **Name the executor that actually
reviewed — Cowork is `cowork-hq` — every time, because the token is what the gate reasons on.**

**⭐ A STRANDED RECEIPT REDDENS EVERY CHECKOUT, NOT JUST ITS OWN (2026-09-05/06, #384).** The #383
merge receipt lived only on the HQ desk for two hours and the receipt-preservation guard went red
fleet-wide until #386 committed it. **The receipt is carried onto `main` in the very next commit
(`chore(carrier)`), through the full gate — not left for "the next lane that does real work".**

**⭐ AN ISSUE NUMBER IS A POINTER, NOT A NAME (2026-09-07).** Lanes called the release-state repair
"#225 work" for a week because the lane that touched those files was also fixing #225; native #225 is
the Health-room parity issue and the repair commits never left the desk (`3ab9b010`, upstream gone).
Two Cowork sessions on the same morning carried the mapping forward. **Before writing "#N owns X",
`gh issue view N --json title` — the title is the contract, the folklore is not.**

**A verification step that has only ever passed has not been shown to be able to fail.** Falsify
every new guard on purpose — reinstate the defect, watch it go red, put it back. Ninety seconds.
**Standard, not a flourish** — and falsify it through the entry point the real run uses.

**The independent review round pays for itself.** Three rounds over PR #139 found three blockers,
**two of them inside guards written hours earlier by the author asking for the review.** *(09-05:
round 1 of PR #377 found two blockers in a change three subagents and the orchestrator had all read.)*

**Match the instrument to the layer, and when two instruments disagree, ask which one the subject can
hide from.**

**Choose the freeze frame before you judge a still.** The first pill capture froze the pulse at its
50% keyframe, where opacity is 0 — a perfect screenshot of nothing.

**A trim is a measurement, not a judgement.** Measure before and after, every time.

**Correct the premise, not just the conclusion.** C-05 and C-19 were both filed on premises wrong in
the direction that would have made the "fix" a regression. **And grep the class yourself before
believing a subagent's "nothing mounts this."**

**Measure the machine before recommending for it.** Three SCM queries on the owner's own desk settled
a load-bearing claim in under a minute — and revealed Compy reads no temperature at all there.

**Re-derive anything volatile before building on it, and say plainly which parts you could not
re-prove.** #129 was taken at face value and its mechanism was wrong. From the other direction: the
token-economy brief named six defects; **three did not survive measurement**, and the two largest real
ones were not on it at all. **Staleness cuts both ways** — on 2026-08-23 an HQ read trusted a
four-day-old ledger over a fresher Codex brief and was wrong twice.

---

## Standing owner directives (Kuya / Pootytang)

Challenge duty; facts over tact; **one default over a menu**; he keeps no notes; evidence before
done. **Standing merge permission** and **standing execute permission** (2026-08-12: "i permit you to
proceed with everything yourself. and yes you can do it all yourself use your eyes"; **2026-09-04:
"resolve every single task yourself"**; **2026-09-07: Claude Code is the sole implementation writer
— Cowork's execute permission covers its own work, not code**). Treat a named blocker as GO unless it
**spends money**, names humans, or is irreversible in a way he has not seen. Never phrase an
observation as a to-do for him; execute instead of handing him click-paths.

**ALWAYS END WITH THE NEXT ACTION — AS A PASTE-READY HANDOFF THAT NAMES ITS LANE (2026-09-07).**

**He decides with his eyes, not with arguments — but only on things that need eyes.** **And when you
do ask him to look, TELL HIM WHAT CHANGED** — *"wait what am i suppose to be looking at in compy?"*
A bare "look at it" is not a request, it is homework.

**"Advise what's ready and just proceed" is a standing pattern.** Give the call in one or two
sentences — including what you are NOT doing and why — then do it.

**Do not hand him a command to run.** **If the assistant can run it, the assistant runs it.** A queued
command is only acceptable when genuinely blocked, and then the message says plainly WHO is blocked
and on WHAT. *(A paste block for another lane is not a command for him — it is the handoff he asked
for.)*

**DO NOT STOP EARLY.** *"why did you stop? there is still 5% weekly left"*. **When budget remains,
take the next item off HQ_RESUME's own list without being asked.** *(Exception, by his own
instruction: a consolidation sweep posts its one comment and STOPS.)*

**But stop CLEAN.** Tree committed, no untracked probe files, resume point and issues current.

**Publishing:** he holds the GO. **So is the deploy GO, and so is any purchase.**

**His `~/.claude/settings.json` hard_deny** still binds Claude Code's own classifier (hook and
settings edits are "the owner's hand" there). **For Cowork the 09-04 directive above governs.**

**Anything that names a human is his** — but he often handles it himself and says so afterwards.

**Report the caveat, not just the win.** **A fix announced as more than it is buys one good minute
and costs the next report.**

**Cost posture:** Opus 5 against a **weekly limit**. Prefer read-only surveys and batched commands.
**Delegate wide file-mapping AND anything verbose to subagents.** The CPU-temp research is the model:
~150k tokens in a subagent, ~4k back — and it overturned two premises. **But a subagent's
source-ranked hypothesis was flatly wrong until an instrument settled it. Cheap measurement beats
expensive reading.** Spend the expensive model on judgement. Full policy:
**`claude/TOKEN_ECONOMY_LAW.md`**. *(09-04/05: the whole desk resolution ran as one orchestrator +
nine subagents — three audits, two implementers, four reviewers — roughly 1.6M subagent tokens
against ~400k orchestrator context; the reviewers found the two blockers. 09-07: the #388 sweep read
16 project docs through one Sonnet subagent — 162k tokens in, ~1.8k back — and re-derived GitHub
and desk state with one GraphQL batch plus three wrapper scripts.)*

## Marathon laws (owner, 2026-08-12)

1 product-first (governance in the last 10%) — **watch this one; it drifts** ·
2 dispositions batch daily · 3 no new guards without a caught defect — **earned exceptions:** an
absent guard on a contract this repo pins elsewhere IS the defect, and a guard whose law the change
supersedes must be re-pinned rather than deleted · 4 fleet moves weekly · 5 one lane at a time.

**Law 3 corollary:** when a caught defect reveals that an EXISTING guard's inventory was too narrow,
widening the inventory is not a new guard — it is repairing the one that failed.
**Law 3 corollary 2 (2026-08-23):** when a guard already catches the defect and it keeps recurring,
the answer is a **causal** fix at the writer, not a second guard.
**Law 3 corollary 3 (2026-09-05):** when the owner retires a law, the tests that pinned it are
**re-pinned to the new law in the same lane** — 18 of them for the lease model — each falsified once;
deleting them or reverting the ratified behaviour are both wrong.

## Cross-lane awareness

`CLAUDE.md` binds Cowork by name, `docs/COWORK_HANDOFF.md` is prescribed reading, and
`docs/WORK_CONTROL.md` + the "Kuya Work Control" GitHub Project are the collision mechanism.

**The execution law is the DYNAMIC MUTATION LEASE model (owner-ratified 2026-09-04; on `main` since
PR #371/#375, 2026-09-05).** No executor — Claude Code, Codex, Cowork HQ, ChatGPT HQ — has permanent
jurisdiction; one writer per folder; one active lease per overlapping scope; non-holders read, review
and post findings but never mutate the holder's scope; takeover only via a `### Verified takeover`
record; proof-dependent transitions need `work-control-gate.mjs` PASS at the exact remote-reachable
head and a reviewer who is not a mutation author. **Every executor commits under its own identity**
(`claude-code` set at worktree scope by the SessionStart hook for linked worktrees; `codex` via the
global Codex shell env; `cowork-hq` per worktree; API commits keep the account name) — without it the
reviewer-not-author rule is vacuous. `src/dynamic-mutation-lease-guard.test.ts` forbids the retired
fixed-role sentences in the bootstrap docs and in `.codex/`. **Leases are `### Ownership claim`
comments on the linked issue** with a literal `- Write scope:` bullet (`scripts/lib/claim-scope.mjs`);
the newest claim supersedes; expiry is an alarm, not a licence.

**The 09-07 operating model layers on top of the lease law, not instead of it:** Claude Code holds
the pen for implementation; Astra/chatgpt-hq reviews at the exact head; Cowork re-derives, reviews,
consolidates and keeps the docs true; Codex is off the critical path. A lane that finds the pen held
by an unexpired claim posts findings and stops — as the Astra-recovery Cowork session did on #387.

**⚠️ HQ_RESUME AND THIS LEDGER LIVE IN THE COWORK PROJECT, NOT ON DISK.** A Claude Code session on
the desk cannot `project_read` either — its repo-side equivalents are `docs/SESSION_HANDOFF.md`,
`docs/RELEASE_STATE.md`, `docs/BACKLOG.md` and `docs/COWORK_HANDOFF.md`. **A Claude Code handoff must
carry its facts INLINE.**

**Codex briefs are INPUTS to a lane, not lanes.** Nothing is authorized until it appears in HQ_RESUME
or in Work Control — and a Codex brief's factual claims get the same re-derivation as any other
inherited handoff. **A Codex session in a browser is not the same thing as a Codex CLI on the desk;
one has no worktree. Confirm which surface a handoff is going to before transferring ownership.**

**Cross-lane consolidation (09-07):** the owner drains every old discussion into one GitHub inbox
issue — one structured comment per lane, prefixed `SOURCE LANE:`, classified DONE / STILL ACTIVE /
STALE-SUPERSEDED / OPTIONAL / UNVERIFIED with exact heads — then HQ deduplicates and reallocates into
fresh bounded lanes. A sweep is read-only and stops after its comment. Cowork's is comment
`5569492174` on #388. **The deduplicated fresh-lane brief is comment `5576970438` on #385 (09-07/08).**

## Housekeeping debt (marathon law 1: last 10%)

Deleting an `origin/*` ref **requires dropping its record in `docs/dispositions/` in the same
change** (if one exists). **#126's freeze is LIFTED** — `707572f1` is reachable from `main` (landed
with PR #191, measured 09-07); the issue's own ref list is August-stale, so re-derive from the live
remote heads or close it through dispositions.
- **NEVER `beta/private-beta-001`** — LOCKED by CLAUDE.md.
- **Git metadata:** `git commit-graph verify` fails on missing `2821ad9`, `89ea2bb`, `d27c7f1`.
  Reachable connectivity PASSES and zero reachable objects are missing — metadata damage, not source
  loss. **Do not prune/gc/reset**; the two failed-v0.9.9 refs are intentional release evidence.
- **Local branch debt (measured 09-07):** 124 local branches in `C:\Users\Kuya\code\sentinel`, 68
  with `[gone]` upstreams, ~10 tracking `origin/main` hundreds of commits behind. Non-blocking;
  deletions go through dispositions.
- **`C:\Users\Kuya\code\compy-data-root-recovery\`** — **KEEP.** Only copy of the pre-union state.
- **`C:\Users\Kuya\code\compy-visual-review\`** — screenshots + scratch scripts, outside the repo.
- **`C:\Users\Kuya\code\hq-desk-fix-2026-09-04\`** — the 09-04/05 lane's wrappers, gate/push logs,
  the generated `.codex/config.toml` sample, Codex's preserved guard WIP patch, the retired 3fe169
  patches and the archived `codex-369-banner-sweep-wip.patch`. **The #369 residue was dispositioned
  09-05 (PR #381), so this is archival now** — SEQUENCE 3 decides what, if anything, in the guard
  WIP patch is still wanted.
- **`C:\Users\Kuya\code\hq-review-383\`** — the 09-05/06 review probes, receipts drafts, gate logs and
  the **CRLF original of the #383 merge receipt** (`stranded-original-2026-09-05-merge-pr-383.crlf.json`).
  KEEP the original; the rest is disposable.
- **`C:\Users\Kuya\code\hq-consolidation-388\`** — the 09-07 sweep's query scripts and raw outputs.
  Disposable once #388 is dedup'd.
- **`C:\Users\Kuya\code\token-economy-audit\`** — 814 files; TOKEN_ECONOMY_STATUS says safe to delete.
- **`.claude/worktrees/merge-prs-tauri-visibility-c5660e`** — gone (removed by 09-07); only the local
  branches `claude/merge-prs-tauri-visibility-c5660e` / `claude/checklist-disk-item-c5660e` remain.
- **`.claude/worktrees/priority-order-parallel-productivity-ae19bb`** — an EMPTY, unregistered
  directory; its branch holds the two local-only #225 / release-state commits (`c82440a1`, `3ab9b010`).
- **Retired 2026-09-05:** `hq/product-constitution-rebirth`, `hq/dynamic-mutation-lease`,
  `hq/desk-conflict-fix`, `hq/desk-closeout` (all merged; refs deleted), `claude/constitutional-migration-lane-3fe169`
  (superseded; patches saved), `claude/constitution-369-proof-lane-aff1da`, `claude/settings-json-permissions-36af09`,
  the `sentinel-constitution-369` worktree. **`origin/codex/369-banner-sweep-wip` was dispositioned
  SUPERSEDED and pruned by PR #381.** Four `.codex/config.toml` regression stashes (08-20/21/22 +
  `fix/site-pricing-language`) are evidence, not work.
- **Retired 2026-09-05/06:** `origin/codex/382-constitutional-followup` (merged #383, pruned by Codex)
  and `origin/claude/post-constitution-reconciliation-d5df83` (merged #386, pruned by `land-pr`).
  The author worktree `.claude/worktrees/post-constitution-reconciliation-d5df83` now holds a second
  checkout of `claude/385-machine-model-v1` (at `a8f92477`); the #385 lane's own cleanup.
- **Retired 2026-09-07 (worktree-prune pass on `main`, `bed20483`..`8d4e90a1`):** the HQ worktree
  `sentinel-hq-desk-fix`, `sentinel-atomic-281`, and the `feat/user-feedback-lab-recovery` /
  `lane/vision-pointer-guard-2026-08-24` worktrees (both refs dispositioned UNLANDED, left intact).

## Decisions the design lane MADE on TYPE-1/COLOR-1 (reversible)

1. **Floor 13px, not the backlog's 11px.** 2. **`--type-data` is its own token at the same 13px.**
3. **`--font-ui` / `--font-mono` point at Geist** — *cleared by measurement as a slowdown.*
4. **The accent PICKER survives COLOR-1** — *his live pick is GREEN.* 5. **A long unit word leaves the
gauge ring rather than shrinking below the floor.**

## Decisions the UX-1 lane MADE (reversible)

1. **The room title is DELETED from Home's header, not demoted.** 2. **The one action OPENS IN PLACE.**
3. **The front-door button renders only when something is behind it.** 4. **`compy_home_intake` kept,
narrowed.** 5. **Tokens only for the button's ink.** 6. **Work landed on a branch in the MAIN
checkout** — since superseded by the mandatory-worktree rule. 7. **The four-counter demotion is a
separate train.**

## Decisions the PERF + P0 lane MADE (reversible)

1. **The pulse keeps its look on a different mechanism.** 2. **The feedback draft NEVER auto-clears.**
3. **No new UI for the draft.** 4. **The second loss channel was left for its own train.** 5. **The
slowdown was NOT declared fixed when the pill shipped** — **that restraint is the reusable decision.**
6. **A stability release ships on its own.** 7. **A named cause with hard numbers beats a rushed
half-fix.** 8. **The failed runtime confirmation was WRITTEN DOWN.** 9. **The issue was filed only
once it had evidence.**

## Decisions the DATA-ROOT lane MADE (reversible) — 2026-08-18

1. **Detection is package identity, not path shape.** 2. **Mutation capability is a TYPE** —
`MutationRoot` constructible only from `Canonical`; **a Compy launched from ANY packaged host is
read-only by design.** 3. **Two nonempty roots HALT.** 4. **Conflict detection lives on the clean
side.** 5. **One sandbox variable.** 6. **The `C:\Temp` fallback is deleted, not fixed.** 7. **The
legacy migration is gated on `Canonical`.** 8. **The design shipped before any resolver code.**
9. **Recovery backed BOTH inputs up and MOVED the overlay.** 10. **Only `history.json` was unioned.**

## Decisions the CONFORMANCE lane MADE (reversible) — 2026-08-18

1. **One dropdown for the whole app** (`src/design/Picker.tsx`) plus a guard banning raw `<select>`.
2. **An empty-valued option is the EMPTY STATE.** 3. **The mono law gets a census with a down-only
ratchet, not a ban.** 4. **The review round is not optional and its findings outrank the author.**
5. **A guard and its mutation test share ONE scanner.** 6. **`unattributable-at-launch` is a
legitimate verdict.**

## Decisions the TOKEN-ECONOMY lane MADE (reversible) — 2026-08-18

1. **The cost model comes before any rule** — cache-read 0.1× / cache-write 2.0× / output 5×.
2. **One authoritative law file, and it names what it retires.** 3. **A measured constant is
unmeasured the moment you change its input.** 4. **A flag must know when its subject began.**
5. **Budget the unit you are charged in.** 6. **Trend, not just threshold.** 7. **A ratchet beats a
red gate.** 8. **One ceiling, one owner.** 9. **Staged outside the repo, landed in one verified
command.** 10. **Three of six brief-supplied defects were REFUTED and the refutations written down.**
11. **`~/.claude/` untouched** — owner's hands *(superseded for Cowork by the 09-04 directive)*.

**Refuted — do NOT re-raise:** a Bash-output guard · hook-injection overhead · "global §6 duplicates
TOKEN LAW 2" · `CLAUDE_CODE_SUBAGENT_MODEL` reaching worktrees (it does) · **lowering the compaction
window** (net ~2 points WORSE) · "self-review is 64% of usage".

## Decisions #140 MADE — **NO-GO, 2026-08-23** (reversible only by the owner, and only by naming this)

1. **Compy will NOT bundle, install, download, recommend, update or remove PawnIO.** Seven reasons in
   the #140 section above; the decisive one is FACEIT.
2. **The native call-time elevation experiment is CANCELLED**, not deferred.
3. **The old dossier's recommendation is retired and was technically wrong**; its rejections stand.
4. **The existing HWiNFO/LHM readers are KEPT** — a user already running one still gets a reading.
5. **The honest "no reading available" state is the correct behaviour**, not a defect to fix.
6. **One narrow future option is preserved as #202 and is NOT authorized:** passive detection of an
   independently installed PawnIO, opt-in, FACEIT disclosed by name, honest fallback, never
   install/download/recommend/update/remove. **Native elevation proof returns only there.**

## Decisions the RECONCILIATION MADE (reversible) — 2026-08-23

1. **The ledger SPLIT** — volatile state to `claude/HQ_RESUME.md`; this file keeps the stable tail.
2. **Installer SHA-256 inequality is NOT divergence evidence.** Identity is embedded commit stamp +
   version.
3. **Desk/fleet divergence is stated honestly as OPEN and intentional**, and now machine-checked.
4. **The contradiction guard belongs in `verify-release-state.mjs`, not `usage-audit.mjs`.**
5. **Cowork does no installed-binary / `%LOCALAPPDATA%` / `%APPDATA%` / `HKCU` verification**, and no
   driver/IOCTL probing. Native proof comes from a non-containerized session.
6. **#127 stays closed and its dossier is marked falsified rather than deleted.**
7. **#127 and the perceived cold-start slowdown are SEPARATE findings** and must not be merged again.
8. **The missing transaction journal is a re-verifiability defect, not proof that a publish failed**
   (#199). **Do not fabricate historical receipts.**

## Decisions the 2026-09-04/05 DESK RESOLUTION MADE (Cowork HQ; reversible)

1. **The permission-prompt cause is named and pinned to a line** (shell hook `ask` on `$var`
   operands) and the allow-list "fixes" are recorded as ineffective against it — not wrong, just
   aimed elsewhere. **Fixed by applying the patch, not by shipping it.**
2. **#368's deny→ask ruling was NOT applied** (prompt-amplifying); its intent landed as **no decision
   + `additionalContext`, after every stricter check** — never a hook `allow`. *(Consequence, measured
   09-07: #372 — the owner-checklist row for the by-hand deny→ask change — is superseded and should be
   closed with a disposition comment; its branch `claude/owner-checklist-368-hand-item` has zero
   commits.)*
3. **#196's durable fix is "the tracked file equals the sync's output"**; the global import toggle is
   the owner's app preference and is irrelevant to repo cleanliness now. **`[mcp_servers.shadcn]`
   (pinned) and the two `CLAUDE_CODE_*` keys live in Codex's project config by design.**
4. **The Codex sandbox posture (`danger-full-access`/`never`, home dir trusted) was left as is** —
   an unattended write lane needs it and the repo floor stays `read-only`/`never` for review runs.
   Flips on the owner's word.
5. **#369's canonical head was `hq/product-constitution-rebirth`**; 3fe169 superseded (both MUST-FIX
   items verified in hq); the Codex sweep ref kept because its merge-tree is not a no-op.
6. **PR #375 was reconciled by hand keeping BOTH sides** of `CONSTITUTIONAL_MIGRATION.md` §6/§16
   (the rebirth's provenance + the lease tombstone), and the 18 old-law tests were re-pinned, not
   deleted.
7. **Executor identity is part of the lease law**, automated where the tool allows (SessionStart hook
   for Claude Code; global Codex shell env; per-worktree config for HQ).
8. **Every landing had an independent review bound to the exact head and a full local gate** —
   three gates, four review rounds, two real blockers caught before merge.

## Decisions the 2026-09-06 #386 LANDING MADE (Cowork HQ; reversible)

1. **Cowork reviews as `cowork-hq` (canonical `cowork`), never under a label the gate would count as
   the author.** The #383 review ran under the `claude-code` label its brief assigned; #386 (authored
   `claude-code`) could only be reviewed by `codex`, `chatgpt-hq` or `cowork` — and was.
2. **Every proof transition gets its own receipt, and all of them PASS before the first transition
   runs** — merge-pr, close-issue, mark-done — bound to the same exact head from a clean detached
   checkout; `land-pr.mjs --dry-run` before `land-pr.mjs`; the PR head and `origin/main` are
   re-derived in the same command that lands.
3. **The receipts are carried onto `main` in the very next commit** (`chore(carrier)`, precedent
   `1c226151`), pushed through the full pre-push gate, so no receipt is ever stranded and the fleet
   never reddens on it. **A stranded receipt's original bytes are preserved outside the repo, never
   deleted.**
4. **`Closes #N` in the PR body is the close-issue mechanism and the board flips to Done on its own;**
   HQ verifies both, then fills the board fields the lane left blank (Lane, Next action, Last
   verified) rather than re-issuing the transition.
5. **The HQ worktree's identity is reset to `cowork-hq` before any HQ commit** — a lane that borrows
   the worktree may leave its own identity behind (#382 left `codex`).
6. **#385 is a PROPOSAL and stays one until the owner speaks** — *the owner spoke on 09-06:
   superseded by the `claude-code` lease on #385 and PR #387 (see HQ_RESUME).*

## Decisions the 2026-09-07 COWORK SESSIONS MADE (reversible)

1. **Cowork does not take the pen on #387 while an unexpired `claude-code` claim covers the scope** —
   findings posted as a plain PR comment (`5569560116`), not a review, so they are not a gate input
   and do not compete with Astra's review.
2. **A consolidation sweep re-derives from `gh`/`git` first and trusts no project doc dated
   yesterday**; contradictions are listed first and native state wins. Cowork's residue is comment
   `5569492174` on #388.
3. **The release-state repair belongs to no live lane and is not "#225 work."** SEQUENCE 2 claims
   the files after #387; the local-only `c82440a1` → `3ab9b010` commits are salvage-or-disposition
   inputs, never a fast-forward.
4. **The 09-06 ledger/resume statements that native state refuted were corrected in place, not
   appended to** — the ledger's own rule: HQ_RESUME wins, the stale line is the defect.
5. **(09-07/08) The fresh-lane brief on #385 (comment `5576970438`) is built from live state, never
   from a stale snapshot** — PR #387's head and the controlling review are re-read at post time, and
   repaired findings are marked repaired rather than re-listed. **#372 is queued for disposition, not
   re-executed** (PR #377 merged the superseding behaviour). **The `### Verified takeover` record is
   pre-drafted but NOT exercised** — it is used only if the live `claude-code` claim is actually
   unusable or expires without a valid handoff; an expired clock alone still is not a licence.

## Decisions on #91 / #133 (reversible)

1. Label **"Crash & Freeze Rescue"** everywhere. 2. One entry, not a four-choice router. 3. Visible
in every `compy_home_intake` state. 4. No `incidentId` plumbing until the dark half exists.
5. Default OFF by owner sight.

## Environment facts

Device `nexusli-usarho3`, Windows, PowerShell 5.1, git 2.55.0.windows.3. Source repo
`C:\Users\Kuya\code\sentinel` (`Pootytxng/sentinel`, private). **Release repo
`Pootytxng/compy-releases`.** **Site: Cloudflare Pages project `compy` at `compy-bd6.pages.dev`** —
see the SITE section.
**Desktop Commander MCP** reaches the desk with no folder grant, and **runs INSIDE the packaged-Claude
MSIX container** (node path `C:\Program Files\WindowsApps\Claude_…\app\claude.exe`). Poll
`read_process_output` ≤55s; keep every call under ~55 s. `gh` is authenticated on the desk
(account `Pootytxng`, scopes `repo`, `project`, `read:org`) — a `gh api graphql` batch with
`issueOrPullRequest` aliases re-derives ~60 issue/PR states in one call (`hq-consolidation-388\q1.graphql`).
Signing key `Desktop\COMPY KEY\`; publish runs unattended.
Project UUID `019ff3cc-ddaf-76b8-9804-733e462f0b07`.
**HQ worktree:** **none since 09-07** — `C:\Users\Kuya\code\sentinel-hq-desk-fix` was pruned. An HQ
lane creates its own worktree (`git worktree add`), sets identity `cowork-hq` at worktree scope
(`extensions.worktreeConfig = true` repo-wide), and pays a full `npm ci` + cargo build on its first
gate. The main checkout's identity is `t <t@t>` — a defect; never commit there.
**Landing tool:** `node scripts/land-pr.mjs --pr N --receipt .claude/work-control/<transition>.json
[--dry-run]` — receipt gate → retarget check → `gh pr merge --merge` → prune → fetch → audit, in one
breath. Never `--delete-branch`, never squash. **Board:** project `PVT_kwHOCbCIUs4BexYj` ("Kuya Work
Control", #1); Status field `PVTSSF_lAHOCbCIUs4BexYjzhZJHzw` (Done = `98236657`); `gh project
item-list 1 --owner Pootytxng --format json --limit 500` (144 items on 09-06).

**Claude Code config surface (measured 2026-09-04):** global `~/.claude/settings.json` — `model
opus[1m]`, `effortLevel: high`, **`permissions.defaultMode: "auto"`** with prose `autoMode`
allow/soft_deny/hard_deny/environment lists, `env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet`,
**`CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` (repo `.claude/settings.json` says 250000 — drift, and
the repo value is the one the Codex sync copies)**, global hooks `global-laws-assert.mjs`
(SessionStart) + `unloaded-project-config.mjs` (PostToolUse). Repo `.claude/settings.json` registers
16 tracked hooks; only `shell-ownership-assert` and `project-write-assert` ever emit `ask`/`deny`;
`session-root-assert` now also sets worktree identity. `settings.local.json` enables `shadcn` from
`.mcp.json` (pin `4.19.0`) — **an input of the tracked `.codex/config.toml` (#196).**

**Codex config surface (measured 2026-09-05):** `~/.codex/config.toml` — `approval_policy = "never"`,
`sandbox_mode = "danger-full-access"`, `network_access = true`, `c:\users\kuya` / `…\code` /
`…\code\sentinel` all `trusted`, `[desktop] external-agent-import-sync-enabled = true`,
`[shell_environment_policy.set]` carries the two `CLAUDE_CODE_*` keys **and `GIT_AUTHOR_NAME` /
`GIT_COMMITTER_NAME` = `codex`** (added 09-05); app build 26.901. **Layering (openai/codex loader,
verified):** repo `.codex/config.toml` overrides the user config in a trusted repo; runtime flags and
the app's UI selector override both — so the tracked `read-only`/`never` floor binds plain CLI runs
here and a write lane is launched with explicit overrides.

**The live Home surface is `HomeConsole.tsx`** — `App.tsx` → `HomeRoom` → `compy_home_console`
(default ON). Shipped flag defaults live in `src/design/theme.ts` and **that file is authoritative** —
comments in `use-hud.ts` and `HomeConsole.tsx` have both drifted from it.

**Runtime data root:** `src-tauri/src/data_root.rs` as of `795d8ff5`; `compy_data_dir()` at
`lib.rs:436` delegates to `data_root::decision()`. Apply/rollback contract: `history.rs:302-312`,
`:359-362`, `:920-946`.

**CPU temperature:** `src-tauri/src/cpu_temp.rs` — HWiNFO SHM first, then LHM/OHM WMI. 900 ms/15 s
hit-miss cache. UI `src/surfaces/CpuTempOffer.tsx`. **Both sources are dead ends on the owner's
machine, and #140's NO-GO means that stays true.**

**Persisted UI state has ONE canonical idiom.** `src/data/safe-storage.ts`'s `lsGet`/`lsSet` — a bare
`localStorage` call in a render body throws on WebView2 profiles with DOM storage blocked and blanks
the app. **Any test touching a persisted surface needs `localStorage.clear()` in `beforeEach`.**

**The feedback surface is `src/surfaces/FeedbackExport.tsx`**, rendered at `Settings.tsx:425`. Draft
key `compy_feedback_draft`. Nothing is ever sent automatically.

**Release/install collision:** `scripts/lib/process-mutex.ps1`; `release.ps1:34` takes
`Local\Compy.ReleasePipeline.v1`, `ship-reinstall.ps1:30` takes `Local\Compy.InstalledBinary.v1`.
**#156's install gates: `ship-reinstall.ps1:170-208` and `:244-276`.**

**Doc budgets:** `scripts/doc-budget.ps1` — byte `:68-72`, line `:6-12`, section `:104-107`; pinned by
`doc-budget-guard.test.mjs`. **All ceilings may only move DOWN.** RELEASE_STATE sits at 41.9/42 KiB
(42,918 bytes on 09-07). Plus `LINEAGE_ROW_CAPS` in `verify-release-state.mjs:41-47`. **Section caps
are keyed on the heading text** — renaming a heading orphans its cap; re-point it in the same change
(#386 did; the cap stayed 1024).

## Knowledge base (resolved)

95%→44%. Never wholesale-add `docs/` (609%), `src/`, `src-tauri/`, `.claude/`, `tools/`,
`package-lock.json`. Five canonical docs added individually. Storage ≠ tokens.

## Tool verdicts

REJECTED, do not re-suggest without naming the rejection: **Sentry** (telemetry lock), **Linear**
(GitHub Issues is work control), **Atlassian Rovo**. Engineering/Qodo rejected earlier, reasoning
lost. Productivity plugin installed (owner reversal). Intercom/Higgsfield: not gaps.
**Also rejected with reasons on the record: HWiNFO as a dependency, AMD Ryzen Master SDK, ADLX for
CPU temp, Intel Power Gadget, owning a signed kernel driver, and (2026-08-23) BUNDLING PawnIO.**

## Other lanes

Train-1-era collision backup of another lane's uncommitted skill edits:
`C:\Users\Kuya\codex-handoff\train1-collision-backup-20260812\` (+ patch, 3 files). Tell that lane —
probably moot by now; disposable once someone who owned it says so.

## Changelog

- 2026-08-12 — Ledger created; KB fixed; rejections recorded; marathon decreed. Trains 1–3 shipped;
  **v0.9.17 PUBLISHED** (first build visually reviewed before shipping).
- 2026-08-13 — **v0.9.18, v0.9.24, v0.9.25 PUBLISHED.** STEP ① (TYPE-1 + COLOR-1) and STEP ② (UX-1)
  shipped; v0.9.19 and v0.9.23 look-FAILED; v0.9.20/21 burned. Update-pill repaint loop + tester J's
  **P0 feedback-draft data loss** fixed, both guards falsified before being trusted. Then, on the
  owner's "don't stop": **RIG-IDLE measured and filed as #127.**
- 2026-08-18 — **DATA-ROOT** (#130 closed, `795d8ff5`) · **TOKEN ECONOMY** (`94db990b`) · **FRONT DOOR
  C-05 + C-19** (#137 — *both filed premises were wrong*) · **CONFORMANCE C-10/C-11/C-17**
  (`2f79febb`) · both doc ratchets paid.
- 2026-08-19 (HQ) — Bring-current audit; nine claims corrected; two standing directives set; **#140
  filed** after the owner's CPU-temperature question was settled on his own desk.
- 2026-08-19..22 (desk) — **v0.9.26 PUBLISHED** from `5e64074c`. **#127 closed** — the rAF diagnosis
  was falsified; the real cost was `aurora` + `stl-pulse`. **#121 closed.** Cold-start regression
  **refuted by measurement.** Session write-refusal armed. C-14's Lab GPU screen shipped. Pricing band
  set. PRs #191 and #193 merged. Desk rebuilt to `d5a6a630`.
- **2026-08-23 (HQ) — RECONCILIATION, THE SPLIT, THE SITE, AND #140's NO-GO.** A Codex brief was
  analysed and two of its framings corrected, then its identity evidence **confirmed live**. An HQ
  read that trusted the four-day-old ledger was **wrong twice**. `RELEASE_STATE.md`'s same-bytes
  contradiction was repaired by a desk writer mid-audit (`848f6bf8`); **the guard that would have
  caught it did not exist** and was built as **check (8)** (#198 → PR #200 → `e64573e5`), falsified
  both ways on the live document. **#199 filed** — no transaction journal is committed, so every
  "9 of 9" claim is unverifiable from its citation. **#201 filed** — `compy.gg` is **not registered**
  (authoritative WHOIS), no custom domain is bound, bare `compy.pages.dev` is a **stranger's site**,
  and production ran two weeks stale so **PR #193 was never deployed**; the reference audit found **no
  update-channel exposure** but real brand/legal exposure already shipped. **#197 filed and retracted**
  as a duplicate of **#196** (the Codex app-server rewrites `.codex/config.toml` on launch). **#49's
  checkpoint was ABORTED** — a live writer holds the claim. **#140 CLOSED with a NO-GO**; #202 records
  the one deferred option. Ledger split into `claude/HQ_RESUME.md` + this stable tail.
- 2026-08-24 (HQ) — PRs #209/#212 landed; #196 "causal fix" applied and later **falsely** recorded as
  surviving a relaunch; lane moved to Claude Code in VS Code (`MIGRATION_TO_VSCODE_2026-08-24.md`).
- 2026-08-24..09-04 (desk, unrecorded here until now) — ~30 lanes; `origin/main` `7eced01d` →
  `089b036c`; #368/#373 permission work; #369 constitutional rebirth (PR #371) and the owner's
  lease ruling (PR #375).
- **2026-09-04 (HQ) — DESK CONFLICT AUDIT.** Read-only, three subagents + direct measurement.
  **Permission prompts proven to be the shell hook's `ask` on `$var` operands**, unsuppressed by any
  allow list; **#373 closed with the defect live** (patch unapplied). **#196 recurred** — import sync
  back on, nine checkouts rewritten, guard red on main, 08-31 hardening reverted. **#369 topology
  mapped**; 3fe169 superseded, **PR #375 conflicting in one file**, runbook §4 self-refuting, Codex's
  lease left an undefined-helper edit dirty. Three lessons added. Fix set F1–F6 written.
- **2026-09-04/05 (HQ) — DESK RESOLUTION, owner-directed ("resolve every single task yourself").**
  **PR #377 `1aae437a`** (hook patch applied; unclaimed folders advisory; sync-immune `.codex/config.toml`;
  review round 1 caught two blockers, round 2 APPROVE) → **PR #371 `71b0ed5b`** (constitution on
  `main`; PR #375 leases reconciled by hand; 18 old-law tests re-pinned; Codex's WIP preserved;
  takeover + handoff on #369) → **PR #378 `14c5fa1c`** (`.codex/` on the lease model; lease guard
  widened; `claude-code` identity at SessionStart; merged refs retired). Three full gates PASS; live
  hook probe on `main` confirms no prompt for `$S`/`$TEMP`/`$LOCALAPPDATA` writes; `codex-config-guard`
  14/14 on `main`. **#369 and #376 CLOSED; #196/#368/#373 commented accurate.** Three lessons and one
  standing directive added. Left deliberately: the Codex sandbox posture; `codex/369-banner-sweep-wip`.
- **2026-09-05 (HQ) — #380 REVIEWED AND LANDED, #381 DISPOSITION.** Codex's #379 repair reviewed as
  non-author (review 5120590858), receipt PASS, merged `67fdf696`; `codex/369-banner-sweep-wip`
  measured SUPERSEDED and pruned with the #380 receipt carried in PR #381 (`690693ea`). **#382 filed**
  from the two non-blocking review findings.
- **2026-09-05/06 (HQ) — #383 REVIEWED; #386/#384 LANDED IN THE CORRECTED SEQUENCE.** Codex's #383
  (#382 fix) given a fresh exact-head review — 20 live gate probes, three falsifications on an
  out-of-repo copy, 132/132 re-run — APPROVE (5123188036) with seven non-blocking findings; Codex
  merged it (`901f090c`) and closed #382. Then claude-code's #386 (#384: stranded #383 receipt
  committed, P0 COMPLETE, P1 re-derived, runbook CLOSED, cap re-pointed) reviewed as **`cowork-hq`**
  (5124829236; the author's four asks each measured), three receipts PASS, `land-pr` dry-run then
  merge `543c0793`, #384 auto-closed and board Done, closeout posted, and the receipts carried onto
  `main` as `5cecc3c6` through the full gate. `origin/main` `690693ea` → `5cecc3c6`. Two lessons
  added (reviewer label; stranded receipts). **#385 (Phase 2 proposal) brought back to the owner for
  approve / cut / redirect — not started.**
- 2026-09-06..07 (desk) — the owner approved #385; a `claude-code` lane cut `claude/385-machine-model-v1`
  from `5cecc3c6`, opened **PR #387**, took two HQ reviews (`5125759253` CHANGES REQUIRED ×4 at
  `a8f92477`; repaired in `6b7be6e7`; `5129939237` CHANGES REQUIRED ×2); a worktree-prune pass on
  `main` (`bed20483`..`8d4e90a1`) rescued two receipts, dispositioned two abandoned lanes and removed
  the HQ worktree; #390 / PR #391 opened on the launch-focus-guard flake; **#388 and #389 opened as
  duplicate consolidation inboxes.**
- **2026-09-07 (HQ, two sessions).** *Astra-recovery lane:* the owner's operating model recorded
  (Claude Code sole writer; Astra reviewer; Cowork computer-use only; Codex off the critical path);
  #387's two open findings verified in source plus a third site and the missing rendering guards,
  posted as PR comment `5569560116`; the pen NOT taken — an unexpired `claude-code` claim covers the
  scope. *Consolidation sweep:* Cowork's residue posted as comment `5569492174` on #388 after
  re-deriving 63 issue/PR states, 24 remote heads, 8 worktrees, 124 local branches and the scratch
  folders; ten doc-vs-native contradictions named; HQ_RESUME corrected in place ("#225 owns
  release-state" struck; five closed issues struck from the open list); one standing directive
  (paste-ready handoff naming its lane), two lessons and one trap added here.
- **2026-09-07/08 (HQ) — #385 FRESH-LANE BRIEF POSTED (comment `5576970438`), read-only.** Consolidated
  from live state, not the stale 10:37Z snapshot: PR #387 head `9fd5698a`; review `5135765472` is the
  controlling CHANGES REQUIRED; the two old diagnostic findings and Cowork's doc-comment/render-guard
  additions are REPAIRED; Claude Code's next scope is the **three currently blocking Machine Model
  defects**. Residue resolved: #225 = Health parity (not release truth); #372 queued for disposition
  (PR #377 merged the superseding behaviour); closed legacy set, #126 freeze removal, #205 NO-GO,
  stranded local tips and #388/#389 dedup separated from executable work. The `claude-code` claim
  at `weekly-usage-marathon-aa44aa` (expires `2026-09-08T03:05Z`) supersedes the old 12:00Z alarm;
  a `### Verified takeover` record is drafted in the brief for use ONLY if that claim is unusable or
  expires without a valid handoff. No merge, close, lease takeover or branch mutation performed.
