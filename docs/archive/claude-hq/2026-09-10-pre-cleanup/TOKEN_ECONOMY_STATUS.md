# Token economy — LANDED 2026-08-18. Nothing outstanding.

Law: `claude/TOKEN_ECONOMY_LAW.md` · Evidence: `claude/TOKEN_ECONOMY_DOSSIER_2026-08-18.md`

## Coverage — every surface, verified not assumed

| Surface | Carries the law how | Enforced by |
|---|---|---|
| Claude Code / **VS Code, in the Compy repo** | repo `CLAUDE.md` §TOKEN LAW + `.claude/USAGE_ECONOMICS.md` pointer | **code** — `doc-budget.ps1` byte+line gate, `big-read-guard` DENY, `subagent-model-guard` DENY, `usage-audit.mjs` weekly, all resident in `npm test` |
| Claude Code / **VS Code, any other folder** | global `~/.claude/CLAUDE.md` **§7** + the local **`~/.claude/skills/token-economy/`** skill | `global-laws-assert` hook fails if §7 vanishes; the skill is prose |
| **Cowork / this HQ project** | project instructions → ledger → law | reading |
| **Web · desktop · mobile · Chrome extension** | account **`token-economy` skill** + **Instructions for Claude** in claude.ai settings | reading |

### ⚠️ Finding worth keeping: account skills do NOT reach Claude Code on this machine

Checked directly rather than assumed. `~/.claude/skills/` contained only six old local skills
(`check`, `clone`, `pull`, `push`, `qa-harness`, `security`). **None of the account skills** — not
`orchestrator-economics`, `bug-to-guard`, `state-truth`, `evidence-before-done`, `project-bootstrap`
— are present there, although Cowork sees all of them.

**So the claude.ai skills library and the desk's Claude Code skills are two separate stores.**
Anything that must apply in VS Code has to be written to `~/.claude/skills/` (or the repo) as well as
saved to the account. That was done for `token-economy`; the other account skills remain
Cowork/chat-only, which is worth knowing before assuming any of them binds a Claude Code session.

## What landed

**Repo** — `94db990b` (rebuild, 8 files, 444+/169−) and `db983655` (targets vs ratchet naming).
`main == origin/main`, tree clean. Full pre-push gate green both times: 958 Rust tests · clippy PASS ·
337/337 vitest files · doc-budget ALL PASS.

**Machine** — global `~/.claude/CLAUDE.md` **§7** (4351 → 4429 bytes, paid for by three cuts, 71
bytes headroom, guard silent, marker falsified; cuts filed in `~/.claude/notes/laws-history.md`).
Plus **`~/.claude/skills/token-economy/SKILL.md`**, 5,506 bytes, frontmatter verified.

**Account** (done via browser, each verified after reload):
- **Instructions for Claude** — token-economy paragraph **appended**, existing preferences untouched.
- **`token-economy` skill created.**
- **`orchestrator-economics` corrected.** It carried *"inline evidence-gathering alone was 64% of a
  weekly token budget"* — the origin of the unreproducible 64% figure. A dated CORRECTION section was
  appended rather than adding a silently-contradicting second skill: the routing advice survives, and
  is now right for a stronger reason (delegation is a context saving before a per-token saving).

## Deferred on purpose — two doc ratchets

`docs/BACKLOG.md` (142 KB → target 120 KB) and `docs/RELEASE_STATE.md` (57 KB → target 48 KB) are
budgeted at today's size: growth fails immediately, target not yet met. Bytes are content, so closing
the gap means deciding which Compy status prose is dead — a content call for whoever writes them.
**Not a parking space:** a guard fails if any budget sits >8 KB above the file's real size. Tracked
in the ledger under HOUSEKEEPING DEBT.

`CLAUDE.md` is deliberately absent from that table — `src/claude-md-laws-guard.test.ts` already
enforces 25,000 bytes on it; two numbers for one file is the `MAX_CONTINUES` drift bomb.

## Considered and NOT built

**The `cd`-prefix hook**, called "the obvious next thing" and then measured: 15 of 41 classifier
denials across 120 sessions are compound commands falling through prefix-match permission rules.
Cost ≈ 60k tokens per 120 sessions = **0.002% of spend.** Building it would violate the law this lane
installed. The remaining denials work as intended (`gh pr merge`, `wrangler pages`, `Stop-Process`,
`--no-verify`, `git checkout --`) or are transient stage-2 errors that clear on one retry.

## Outstanding

**Nothing.** `effortLevel` moved `xhigh` → `high` in the 2026-08-03/04 settings rewrite — informational,
not blocking, and a session-start decision whenever he wants it.

`C:\Users\Kuya\code\token-economy-audit\` is the scratch tree; work landed, safe to delete.
`APPLY.ps1` inside it is neutralised so it cannot re-run over newer work.
