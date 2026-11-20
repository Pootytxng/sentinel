# CLAUDE.md — Compy bootstrap

Auto-loads into every Claude Code session in this repo. Re-derive state before asserting it; universal behaviour rules live in `~/.claude/CLAUDE.md`.
Renamed Sentinel to Compy (2026-06-04): the legacy literal "Sentinel" in `migrate_legacy_data_once` must stay. Remote `Pootytxng/sentinel`, branch `main`, Windows checkout `C:\Users\Kuya\code\sentinel`.

## What Compy is (PRODUCT_CONSTITUTION §38, owner 2026-11-20)
Compy is a PC paramedic for gamers (Tauri 2: Rust `src-tauri/`, React/TypeScript `src/`). When a PC or a game stops running the way it did, one button says what changed, what is most likely wrong, and fixes it or gives the exact fix, then checks that it worked.
Three layers, built and shipped in order: 1 the Paramedic (ships first, alone); 2 game-specific known issues; 3 the Tuning Bay (opt-in, BIOS and overclock walkthroughs, per-setting Trials).
Honesty rule: Compy shows its evidence, never invents a problem, says "nothing is wrong" only when that is established and "I can't tell" otherwise.

## Documents that matter
- `docs/PRODUCT_CONSTITUTION.md` — product identity and direction; §38 wins over earlier sections.
- `docs/ARCHITECTURE_LOCKS.md` — safety, rollback, privilege, privacy, network. Crossing a lock needs the owner.
- `docs/RELEASE_STATE.md` — what is built, installed and released; update it in the commit that changes the state.
- `docs/QUEUE.md` — the one work list (NOW / NEXT / LATER, waiting on the owner, done, session log).
- `CLAUDE.md` — this file. `src-tauri/CLAUDE.md` is the Rust module map (read-only half).
`docs/WORK_CONTROL.md`, `docs/WORK_TRAIN.md` (paused) and `docs/OWNER_DIRECTIVE_2026-10-23.md` are still in the repo but no longer drive work (§38). Older docs are history, not instruction.

## How work runs
- One writer per scope. Other workers build in `.claude/worktrees/m1-*` on their own branches; do not touch those.
- Privilege, rollback and measurement code goes on a branch and gets an independent review before it lands.
- Gate: `scripts/verify-local.ps1` runs on push (user safety and correctness, about 2 minutes). `npm run test:gate` is its test stage; `npm run test:audit` runs the parked checks weekly and before a release.
- Never `--no-verify`. Never loosen a guard to get green. Never route around a refused permission; stop and ask.
- A caught defect gets a test in the same commit.

## Game rule
No builds, tests or pushes while a game runs on this PC. Check first: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Kuya\code\_train\preflight.ps1` (prints "games running:"), or `Get-Process` for `ROB RUN|PBZ|LANESPLIT|WardogsClient|Aniimo|EasyAntiCheat|-Win64-Shipping`. If a game is up, commit locally, do not push, report.

## Running commands on this PC
Desktop Commander tools return within about 75 s: run anything long detached (a `.ps1` under `C:\Users\Kuya\code\_train\` started with `Start-Process powershell.exe -WindowStyle Hidden`) and poll its log. `*>` logs are UTF-16. Output is cut when a printed line ends in `>`: write to a file and read it. Use `git commit -F <file>`. Write files as UTF-8 without BOM, in chunks of 30 lines or fewer. If the bridge drops, wait 30 s and retry.

## Ship
After any `npm run tauri build`, follow `.claude/skills/ship/SKILL.md` (silent reinstall with `scripts/ship-reinstall.ps1`, verified by the build stamp). Release procedure: `docs/RELEASE_TRANSACTION.md`.

## Stop rules (owner territory)
- Never change Windows settings outside Compy's own apply/rollback path; diagnose with read-only probes.
- Never publish, sign, or touch credentials or signing keys; never move frozen beta refs (`16069fa`). Spending, public sharing and legal text need the owner's explicit yes.
- `~/.claude/settings.json` (and project `.claude/settings.json`) are the owner's; edit only with exact authorization.

## Honesty rules for product text
Show the evidence. "Nothing is wrong" only when established; "I can't tell" otherwise. Never say a change "caused" a problem (say "most likely", "changed around then"). Never use the word "guarantee". Never fabricate or invent hardware specs; unavailable stays unknown.

## Locked safety (full text: docs/ARCHITECTURE_LOCKS.md)
- **Capability Exception Gate (owner decision 2026-08-09).** Default is local, user-mode, least-privilege. A Compy driver is no longer categorically forbidden, but the current build ships no driver; none may be built before its own record. No vulnerable third-party driver, no generic physical-memory/MSR/PCI surface.
- **No third-party game/process injection. This remains absolute:** no DLL injection, game-memory access or runtime hooks. FPS and frametime stay external ETW.
- **One mutation boundary:** Windows is changed from `src-tauri/src/actions.rs` only: snapshot, apply, verify, receipt, rollback. Rollback resolves from `history.json` alone. Never apply a change you cannot roll back.
- Outbound tiers are never merged: **Tier 1 signed advisory download / no machine-data upload** · **Tier 2 scrubbed incident fingerprint** · **Tier 3 explicit per-case evidence upload**. Tier 2 is opt-in, default OFF and it stays OFF after arming, disclosed at first run, with a real off switch.
- **Signed remote rules — triple-gated OFF.** Unsigned remote rules never ship. The Ed25519 private key never lives in the repo.
- NVIDIA sensor monitoring is not yet hardware-verified; CPU temperature stays external-monitor-only. Tweak admission rails: `.claude/rules/tweak-catalog.md`.

## Code
Rust: `cargo test --manifest-path src-tauri/Cargo.toml`. Dev: `npm run tauri dev`. Data: `%APPDATA%\Compy\history.json`. Path-scoped rules in `.claude/rules/*.md` load when matching files are touched.

### Rust module map (`lib.rs` carved into safety-boundary modules)

Complete 2026-08-29 (59 `.rs` files; the count lives only here). **★ = the safety boundary
(mutation, rollback & gates) — scope any mutation-gate change against these first:** `lib.rs`
(command surface) · `actions.rs` · `history.rs` · `gaming_orchestrator.rs` · `gaming_session.rs` ·
`game_mode_persist.rs` · `services.rs` · `gpu_profile.rs` · `remote_rules.rs` · `receipts.rs` ·
`license.rs` · `drift.rs` · `data_root.rs` · `race_seam.rs`. Entries: ★ half in
`.claude/rules/rust-safety-boundary.md`, read-only half in `src-tauri/CLAUDE.md`; both load only for
`src-tauri/` work. **Mechanically verified — run `node scripts/verify-module-map.mjs` before trusting the map.**
