# Work-control receipts

One JSON file per **proof-dependent GitHub state transition** — `merge-pr`, `close-issue`,
`mark-done`, `mark-pr-ready`, `close-superseded-pr`. `docs/WORK_CONTROL.md` is the law; this is where
its evidence lands.

Write the receipt, then authorize it:

```bash
node scripts/work-control-gate.mjs .claude/work-control/<name>.json
```

The gate resolves the repository's ACTUAL head itself and refuses a receipt bound to any other one —
`currentHead` in the file is never trusted on its own, because the actor asking for authorization is
the same actor that wrote it. `currentHead` must be the full 40-character sha; an abbreviated or
invented head cannot be matched against the repository.

Required inspection fields: `repository`, `remoteState`, `worktree`, `branch`, `dirtyState`.

```json
{
  "transition": "merge-pr",
  "actor": "claude-code",
  "currentHead": "<40-char sha>",
  "issue": 155,
  "pr": 157,
  "inspection": {
    "repository": "...",
    "remoteState": "...",
    "worktree": "...",
    "branch": "...",
    "dirtyState": "..."
  }
}
```

**Why this directory exists at all:** on 2026-08-20 PR #157 was merged and #155 closed with no
receipt — on a run that was genuinely verified end to end, which is exactly why the miss matters. A
gate that only gets run when someone remembers is not a gate.
`.claude/hooks/work-control-receipt-guard.mjs` mechanizes it; it ships UNWIRED because the owner's
settings reserve authority-gating hooks to his own hand, and the settings block to paste sits at the
bottom of that file.

Receipts are evidence, not scratch: keep them, don't prune them.
