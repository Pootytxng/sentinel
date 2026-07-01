---
name: compy-coverage-sweep
description: >-
  Use whenever the user wants to expand, add, improve, or "sweep" automated test coverage in
  the Compy (sentinel) repo — especially adding unit tests for untested PURE-LOGIC modules
  (TypeScript helpers under src/data and src/surfaces, and pure Rust parsers under
  src-tauri/src). Trigger on phrases like "add tests", "improve/expand coverage", "test the
  untested modules", "coverage sweep", "what isn't tested?", or when the user points at a
  specific helper module and asks for tests. Runs a parallel-subagent authoring workflow with
  a three-ring verification gate. Do NOT use it to test hardware IO / FFI surfaces
  (monitoring, sensors, tray) or to change production code — it writes tests only.
version: 0.1.0
user-invocable: true
argument-hint: "[scan | sweep <area>] — e.g. 'sweep src/surfaces' or 'scan'"
license: Apache 2.0
allowed-tools:
  - Task
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

Expand Compy's test coverage the safe way: find the untested pure-logic modules, fan the work to
parallel sub-agents, and never claim green without proving it. This skill is **test-only** — it adds
`*.test.ts(x)` files and Rust `#[cfg(test)]` blocks. It never edits production code, and it never
ships a number it didn't measure. That mirrors Compy's own doctrine (small blast radius, everything
reversible, verification never skipped) applied to Compy's own test suite.

## When this fits (and when it doesn't)

Good targets are **pure functions**: deterministic, synthetic-input-testable, no hardware/IO. The
sweet spot is the small utility modules that get added last and slip through uncovered.

Refuse (or defer) these, and say why:
- **IO / FFI surfaces** — `monitoring.rs`, `amd_freesync.rs`, `tray.rs`, anything calling NVML/ADLX/PDH/ETW or Windows APIs. The honest gap there is "needs a real rig," not "needs a unit test."
- **Production fixes.** If a new test exposes a real bug, **report it as a finding — do not fix it here.** That keeps the owner in the loop and the blast radius at zero.
- **NVIDIA sensor confidence.** Never add a test that asserts NVML sensor data as "verified." Per `CLAUDE.md` it stays "implemented, not hardware-verified" until a monitored session proves it.

## The loop

### 1. Recon the gap
Map tests against sources and find what's uncovered.

```bash
cd <repo>            # the sentinel checkout
# TS: which source modules have no sibling *.test.*
find src -name '*.test.ts*' | sort                       # existing tests
find src -name '*.ts' -o -name '*.tsx' | grep -v test    # sources -> diff to find gaps
# Rust: tests-per-module, smallest ratios are the thin spots
cd src-tauri/src && for f in *.rs; do printf "%3s  %s\n" "$(grep -c '#\[test\]\|#\[tokio::test\]' "$f")" "$f"; done | sort -n
```
Shortlist only the **pure-logic** untested modules. Read each candidate's exports so the work-packages name real functions, not guesses.

### 2. Partition into disjoint-file work-packages
The cardinal rule of parallel sub-agents: **no two crews touch the same file.** Give each crew its
own new test file(s). Group tiny related modules under one crew. Tier each package by stakes:
- **High-stakes** (encodes a user-facing promise — rollback table, security allowlist, anything safety-relevant) -> flag for an owner nod before it's canon.
- **Low-stakes** (pure formatters, parser tests) -> the green suite is sufficient.

If you ever split one file's work across two crews, they will collide — keep the partition disjoint or serialize them.

### 3. Launch the crews (in ONE message, parallel)
Spawn the sub-agents together so they run concurrently. Hand each crew the brief template in
`reference/subagent-brief.md`. Every brief MUST carry: the exact target functions, the assertions,
the house conventions, the gotchas below, where to write, and how to self-verify.

### 4. Three-ring verification ("verify before you build")
1. **Ring 1 — crew self-verify.** Each crew runs only its own target until green; reports the pass count. A crew that can't get green reports the blocker, not success.
2. **Ring 2 — full-suite gate (you, the integrator).** Run the WHOLE suite with all new files present. This is where doctrine-guard trips surface (the guards scan `src/`, including the new test files). Commands:
   ```bash
   npm test                                                   # full vitest suite
   npx tsc --noEmit                                           # types clean
   cargo test --manifest-path src-tauri/Cargo.toml            # full Rust suite
   cargo build --manifest-path src-tauri/Cargo.toml           # zero warnings (house bar)
   ```
   See `reference/verification.md` for running this inside a Linux sandbox (Cowork), where the repo's Windows `node_modules` won't execute and you must build a native mirror first.
3. **Ring 3 — human-validation zones.** Hand the high-stakes packages to the owner before they're considered canon. Low-stakes pure tests proceed on the green suite alone.

### 5. Report
Give the pass-count delta (`npm +N`, `cargo +N`), list any findings (bugs/edge-cases discovered,
reported not fixed), and name which packages await the owner nod. Nothing lands in the repo until the
owner moves it there.

## House test conventions (match exactly)
- First line: `import { describe, it, expect } from "vitest";` (add `vi` when mocking). Explicit imports even though `globals: true` — it's the house style. (`beforeEach`/`afterEach` resolve globally.)
- Tests are siblings: `foo.ts` -> `foo.test.ts`. Append-only — never edit or renumber an existing test to make room.
- Copy the fixture style in `src/surfaces/system-posture.test.ts` (typed fixtures, small helpers, `describe`/`it`).
- Mock Tauri at the module boundary: `vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }))`; if a module pulls `@tauri-apps/api/core` at import, stub `invoke` similarly so jsdom doesn't choke.

## Gotchas (learned the hard way — read before writing a line)

1. **The doctrine guards scan your test files too.** `voice-guard`, `jargon-guard`, `theme-literal-guard`, `doorknob-guard`, `sweep-guard`, `border-hygiene-guard` walk all of `src/**/*.{ts,tsx,css,json}`. A test that embeds a banned literal (e.g. "probably fine", "nothing to sell you here", "already where it should be", "nothing worth fixing today") as a fixture string will trip the guard sitting next to it. Don't hardcode banned phrases; assemble strings so the literal never appears verbatim.
2. **Windows `node_modules` can't run in a Linux sandbox.** The repo is developed on Windows, so its installed native binaries (rollup, esbuild) are Windows builds. In a Linux sandbox they fail with `MODULE_NOT_FOUND` / `Cannot find module @rollup/rollup-linux-*`. Do NOT symlink the repo's `node_modules` into a Linux mirror — do a fresh Linux `npm ci` from the lockfile. Full mechanics in `reference/verification.md`. (On the user's own Windows machine this is a non-issue — just run `npm test` natively.)
3. **No Rust toolchain in the sandbox.** Cowork's sandbox has Node but no `cargo`/`rustc`. You can author and statically review Rust tests there, but **runtime verification is pending the in-repo `cargo test`** — say so plainly rather than implying you ran it.
4. **Test the parser, never the probe (Rust).** Use synthetic inputs only. Mirror the `block()` byte-buffer builder pattern in `cpu_temp.rs`. Respect `#[cfg(windows)]`/platform gates so tests compile cross-platform. Reach for `hardware.rs`'s pure parsers (`parse_cpu_arch`, `intel_arch_for_gen`, `intel_family_label`, `nic_vendor`, `parse_smbios_*`) — not the IO modules.
5. **Test reality, then flag intent.** If a module's actual shape contradicts the brief (e.g. a value named like a list that is really a joined string), assert what the code truly does so the suite is honestly green, and report the mismatch as a finding. Don't bend the test into a lie, and don't "fix" production to match the brief.
6. **A null result is the instrument working.** A test that proves a guard rejects bad input (an off-allowlist URI, a malformed buffer that must not panic) is as valuable as one proving the happy path. Write both.

## Reference files
- `reference/subagent-brief.md` — the per-crew brief template (fill in target, assertions, paths).
- `reference/verification.md` — running the suite in a Linux sandbox (the native-mirror procedure) vs. natively on the Windows dev box.

## Field notes (from the first live run, 2026-06-18)
- **Recon against `git ls-files`, not just the working tree.** A test file can be tracked in HEAD yet deleted from the working tree (an uncommitted deletion). A working-tree-only scan reports it as "missing/untested" and you'll author a redundant — possibly inferior — duplicate that clobbers the committed one. Before treating a module as untested, check `git ls-files 'src/**/<name>.test.*'`; if a tracked test exists, diff against it and keep the richer one.
- **Don't run `git` writes from a restricted sandbox mount.** The Cowork repo mount can forbid unlinking files, so `git add`/`commit`/`checkout` leave an un-removable `.git/index.lock` that wedges the repo (even natively, until the user deletes the lock). Place files via plain writes and hand the user native `git` commands to branch + commit. Reads (`git show`, `git ls-files`, `git status`) are fine.
