# DESK CONFLICT AUDIT — 2026-09-04 (Cowork HQ, read-only, Desktop Commander vantage)

**Scope:** the permission-prompt annoyance in Claude Code, the Codex `.codex/config.toml` rewrite
(#196), and the constitutional migration (#369) — and whether the "fixes" already landed conflict
with each other. Everything below is desk-verified unless marked INFERENCE. Nothing was modified
during the audit. **Sections 1–5 are the 09-04 findings as found; §6 is what landed on 09-05.**

**Resume point at audit time:** local `main` = `0b5896f0`, **`origin/main` = `089b036c` (PR #374,
#373)** — local main is behind 1. Main checkout dirty in exactly one file: `.codex/config.toml`.

---

## 1. PERMISSION PROMPTS — root cause proven

| | |
|---|---|
| **Cause** | `.claude/hooks/shell-ownership-assert.mjs` L918-932 returns `permissionDecision: "ask"` for any recognized shell mutation whose operand is a shell variable or glob (`$S/…`, `$TEMP/…`, `$R/…`). |
| **When it started** | Landed on `main` in `ce13a209` **2026-09-02 23:34** ("harvest(#356): PR #279/#320 shell-ownership hooks"). That is the "recent lanes alteration". |
| **Measured** | #373: 38 of 40 non-allow decisions were `ask`; 33 were `$var` writes; the owner pressed Allow on each. Empirical re-run of `decideShell` today reproduces it: `mkdir -p "$S/notes"`, `cat > "$TEMP/x.md"` → **ask** whether the session is verified or not. |
| **Why nothing fixed it** | Claude Code docs: hook decisions override permission rules, and **auto mode still shows hook-forced `ask` prompts** (permission-modes doc). So the 9/4 expansions of `permissions.allow` (global `~/.claude/settings.json`, and PR #370's project allow-list) **cannot suppress these prompts** — they were aimed at the classifier, not the hook. |
| **The false premise** | The hook's own comments (L33, L884-889) and spec `2026-08-31-target-ownership-across-tools.md:123` claim "`ask` under an auto-approving mode degrades to allow." **False per the docs and per the owner's own measurement.** Both #368's ruling and #373 were designed on it. |
| **The "fix" that isn't** | PR #374 (merged 20:14Z) **does not touch the hook** — hook is byte-identical on main / origin/main / the lane branch. It ships `docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch` + a test that passes while the patch is unapplied (`75 passed, 11 skipped`) and runs 11 behavioural cases only once `expandKnownVars` exists. Reason: `~/.claude/settings.json` `autoMode.hard_deny` — "Editing … any hook that gates the assistant's own authority — the owner applies those by hand." **#373 is CLOSED on GitHub with the defect still live on every checkout.** |
| **A fix that would make it WORSE** | #368's §8 ruling (spec `2026-08-21-unverified-session-write-refusal.md:225-256`, "owner's hand"): flip FOLDER_UNCLAIMED / BOARD_UNREACHABLE from `deny` to `ask` in `project-write-assert.mjs` and the shell hook. Under the real semantics that converts every silent refusal in an unclaimed worktree into a **user prompt**. Not yet applied. **Do not apply as written.** |

Secondary, not prompts: `project-write-assert.mjs` L179-224 and the shell hook L863-880 **deny** all
writes in an unclaimed folder (the #368 complaint); PR #370 fixed the board-read limit (100 rows on a
136-row board made every newer claim read as unclaimed) — that half is real and landed. Stale
`.claude/settings.local.json` in two old worktrees double-register the impeccable hook; `sentinel-feedback`
registers a SessionStart hook at a path that does not exist (`C:\Users\Kuya\code\compy-control\…`).

## 2. CODEX CONFIG REWRITE (#196) — the causal fix is NOT in force

- `~/.codex/config.toml` **L188 `external-agent-import-sync-enabled = true`**, L192 `item-types = "all"`.
  The 08-24 fix (`false`) and the 08-31 security hardening (`sandbox_mode = "workspace-write"`,
  `network_access = false`, sync `false`) are **all reverted**: today L1-2 read
  `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, L377 `network_access = true`,
  with `c:\users\kuya` itself `trust_level = "trusted"` (L255). File mtime 13:00:37, 46 s after
  ChatGPT.exe launched. **Who flipped it is UNVERIFIED** (app update 26.825→26.901, or a settings
  toggle; comments survived, so not a serializer round-trip).
- **The writer is the Codex desktop app's external-agent import sync** (INFERENCE, near-certain):
  import batches in `~/.codex/external_agent_session_imports.json` match the rewritten files' mtimes
  to the second — 09-02 12:48:20/22, 09-03 17:44:48, 09-04 10:27:07/08. **Nine checkouts** carry the
  rewritten file; eight are byte-identical (SHA `C323C685…`, 292 B) — the output is deterministic:
  it re-serializes the existing TOML (comments dropped), then adds `[shell_environment_policy.set]`
  copied from the repo `.claude/settings.json` `env` (250000, not the global 300000) and
  `[mcp_servers.shadcn]` copied from `.mcp.json` (pin `shadcn@4.19.0`, enabled in
  `settings.local.json` since 08-30).
- `scripts/codex-config-guard.test.mjs` is **RED on main: 2 failed / 7 passed** ("no MCP servers",
  "no CLAUDE_CODE_* keys"). Its header still says the file "is not loaded unless CODEX_HOME points
  at this directory" — retracted by the config's own header on 08-24.
- **#196 is CLOSED on GitHub (08-24) and `MIGRATION_TO_VSCODE` says it "survived a real relaunch."
  Both are now false.** Ledger trap entry corrected.
- Four stashes already hold prior recurrences (08-20, 08-21, 08-22, `fix/site-pricing-language`).
- Codex config layering (openai/codex loader docs, verified 09-04): repo `.codex/config.toml`
  **overrides** the user config in a trusted repo; runtime flags / the app's UI selector override both.

## 3. CONSTITUTIONAL MIGRATION (#369) — topology and conflicts

```
main 0b5896f0 ─ 5f86d944 ─ 8d5c9e2e ─ d13de5d6 ─┬─ 7491bd0f ─┬─ 029ae348 ─ 8816e085 ─ 8c3c1dfe = hq/product-constitution-rebirth (PR #371, 34 ahead)
                                                 │            └─ e4c38081 = codex/369-banner-sweep-wip (patch-id identical to C:\Users\Kuya\code\codex-369-banner-sweep-wip.patch)
                                                 └─ 15ff038a ─ 556895f1 = claude/constitutional-migration-lane-3fe169 (never pushed; SUPERSEDED — hq carries both MUST-FIX items)
8816e085 ─ 13 HQ commits ─ 514f2960 = hq/dynamic-mutation-lease (PR #375, base hq, CONFLICTING)
```

- `origin/main` moved to `089b036c` after every "reconciled with main" claim → hq is stale vs main again.
- **PR #375 conflicts with hq in ONE file:** `docs/product/CONSTITUTIONAL_MIGRATION.md` (§6 L106-114
  path list; §16 L310-432 — rebirth's historical execution record vs the lease branch's 4-line
  tombstone). `CLAUDE.md` overlaps but auto-merges.
- **Runbook §4 at hq head still says** "Claude owns the write scope; HQ read-only reviewer; Codex
  optional read-only" (L41-42) while **§17 of the same file** is a Codex writer record and HQ
  authored `029ae348`/`8816e085`. A document carrying its own refutation.
- **Codex's in-progress lease left `sentinel-constitution-369` dirty:** `src/product-constitution-guard.test.ts`
  +34 lines (L439-464) calling two helpers **defined nowhere** — red if committed.
- Git author of every local #369 commit is `t <t@t>`; Claude and Codex are indistinguishable in
  `git log`.
- **PR #375 never ran a local gate** (HQ-authored through the GitHub API): 18 tests on its own head
  still pinned the retired fixed-role law and failed — found only when the reconciled branch ran
  `npm test` on the desk.

## 4. CROSS-AGENT CONTRACT — where Claude Code and Codex actually disagreed

1. **Every lane document said Codex is read-only** — `AGENTS.md`, `CLAUDE.md` L81-83, the HEAD
   `.codex/config.toml` header, the guard's message, runbook §4, `.codex/agents/*.toml` — while the
   owner granted Codex takeover authority, ratified dynamic leases, and Codex committed and held the
   lease. `~/.codex/AGENTS.md` carries no lane rule at all.
2. **Three wrong cross-reads in one day**, each from inferring the other agent's state from processes
   or worktree status (Codex→Claude "clean"; HQ→Codex "unavailable"; Claude→Codex "absent").
   **There was no machine-readable lease either agent read before writing.**
3. **Codex's real sandbox contradicts every document:** `danger-full-access` + `never` over the whole
   home directory, network on.
4. `.claude/settings.json` `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` = 250000 (repo) vs 300000 (global) —
   harmless to Codex; a drift to settle.

## 5. FIX SET (as proposed on 09-04)

F1 apply the #373 patch + correct the premise · F2 replace #368 §8 with a no-prompt cure · F3 make
`.codex/config.toml` sync-immune and re-pin the guard · F4 Codex sandbox posture (owner's) · F5 land
#369: main→hq, #375→hq, runbook §4, Codex's dirty file, #371→main, retire superseded refs · F6 every
lane doc states the lease model; executor identity in `git log`.

## 6. STATUS — 2026-09-05, everything landed (owner: "resolve every single task yourself")

| # | Landed as | Evidence |
|---|---|---|
| F1 | PR #377 `1aae437a` | `expandKnownVars` in the hook; 11 skipped → 90/90 running; prefix-assignment form (`S=x cmd $S/y`) fixed on review; live probe on `main`: `$S`/`$TEMP`/`$LOCALAPPDATA` writes → no decision, unknowable `$VAR` → ask, `~/.claude/settings.json` write → deny. |
| F2 | PR #377 | `FOLDER_UNCLAIMED`/`BOARD_UNREACHABLE` → **no decision + `additionalContext`** after every stricter check; spec §9. Review round 1 caught two real blockers (advisory short-circuited stricter checks; hook `allow` skipped the classifier) — fixed, guarded, round 2 APPROVE at `ef33b802`. |
| F3 | PR #377 | Tracked file == sync output (blob `230f54ec`); `.codex/README.md`; guard 13→14 tests, each falsified; **14/14 green on `main`**. Global toggle left `true` — irrelevant now. |
| F4 | **left as is, deliberately** | Unattended write lanes need it; the repo floor stays `read-only`/`never` for review runs. Flips on the owner's word. |
| F5 | PR #375 (merged by reachability, `f7152c78`) → PR #371 `71b0ed5b` | Takeover record + Handoff on #369; Codex's dirty edit preserved as a patch; one conflicted file resolved keeping both sides; 18 old-law tests re-pinned to the lease law (each falsified); gate PASS at `3e73e615`; review APPROVE; #369 CLOSED. `hq/product-constitution-rebirth`, `hq/dynamic-mutation-lease` deleted (merge-tree == main); 3fe169 retired (patches saved); `codex/369-banner-sweep-wip` **kept** (merge-tree ≠ main, +138 lines — Codex's to disposition). |
| F6 | PR #378 `14c5fa1c` | `.codex/README.md` + four `.codex/agents/*.toml` + `docs/COWORK_HANDOFF.md` on the lease model; lease guard scans `.codex/`; `docs/WORK_CONTROL.md` "Executor identity"; `session-root-assert.mjs` sets `claude-code` at worktree scope for linked worktrees (guarded, reviewed); global `~/.codex/config.toml` `[shell_environment_policy.set]` `GIT_*` = `codex`; HQ worktree = `cowork-hq`. |

**Three full local gates PASSED** (`ef33b802`, `3e73e615`, `51c81047`): frontend 428 files / 6440
passed, Rust 1254 passed, clippy clean. `branch-disposition-audit` OK. `verify-release-state --strict`
red only on the pre-existing INSTALLED-STAMP-DRIFT. Issues #369 and #376 closed; #196, #368, #373
commented so their closed state is accurate.
