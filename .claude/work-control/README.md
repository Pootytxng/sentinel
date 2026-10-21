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

A proof-dependent receipt also records the board read it was written under, as `boardRead` (#445
option 2, owner-accepted 2026-10-21): `status`, `authenticated`, `readAt` (ISO-8601), `via` (the
read command) and `evidence` (where its output is). The gate judges `status`, `authenticated` and
`readAt`; `via` and `evidence` are for the exact-head reviewer, who checks that the read was the one
claimed. The gate refuses with the one machine-readable `BOARD_UNREACHABLE` blocker (`codes` and
`structuredBlockers` in its output) unless that read is `"fresh"`, authenticated and under 10
minutes old at gate time: a missing, cached, unauthenticated or stale read is unknown board state,
and unknown is never a PASS and never an exemption. A session that could not read the board writes
`{ "status": "unreachable", "why": "<the error>" }` honestly; that receipt documents blocked
evidence and authorizes nothing.

A `close-issue` or `mark-done` receipt names its `issue`, and a `merge-pr` receipt names its `pr`: the
gate refuses while an issue that transition closes still reads a live lease (#411, #413). For a merge
that means every issue the PR lists in `closingIssuesReferences`, not the receipt's own `issue`.

```json
{
  "transition": "merge-pr",
  "actor": "claude-code",
  "currentHead": "<40-char sha>",
  "issue": 155,
  "pr": 157,
  "boardRead": {
    "status": "fresh",
    "authenticated": true,
    "readAt": "2026-10-21T12:00:00Z",
    "via": "gh project item-list 1 --owner Pootytxng --format json --limit 1000",
    "evidence": "logs/board-read-2026-10-21.json"
  },
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

Receipts are evidence, not scratch: keep them, don't prune them, and never edit one after it lands.
A wrong receipt is corrected by adding `<date>-correct-<receipt>.json` with `"transition":
"correct-receipt"` (#307). `scripts/work-control-receipt-append-only.test.mjs` and
`scripts/work-control-receipt-reviewer-claims.test.mjs` hold both rules.

**The receipt chain trails by one commit, by construction.** A receipt binds to the head it
authorizes, so it cannot ride inside that same commit — writing it in would change the head and
invalidate itself. Write the receipt, run the gate, do the transition, then commit the receipt on
top. Receipt `2026-08-20-merge-pr-159.json` is the first one and lands one commit behind the merge
it authorized, which is the steady state, not a lapse.
