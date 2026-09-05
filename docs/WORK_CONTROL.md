# Kuya Work Control

> **Live execution board:** [Kuya Work Control](https://github.com/users/Pootytxng/projects/1)
>
> This file is stable operating law, not a task list. Never copy live assignments, statuses,
> deadlines, SHAs, or session logs into it.

## What this controls

Work Control coordinates execution across ChatGPT HQ, Claude Code, Codex, Cowork, VS Code, and future
tools. Its job is to prevent conflicting mutation while keeping the best available executor moving.

The core invariant is **one active mutation lease per overlapping scope**, not one permanently
privileged implementation model.

Work Control does **not** replace Compy's other truth domains:

- `docs/PRODUCT_CONSTITUTION.md` — product identity, principles, and direction.
- `docs/ARCHITECTURE_LOCKS.md` — safety and architecture constraints.
- `docs/RELEASE_STATE.md` — current build, installed, artifact, gate, and release truth.
- `docs/product/ROADMAP.md` — product sequence derived from the Constitution and current truth.
- `docs/BACKLOG.md` — records current execution status only; it does not create product direction or
  inherited priority.
- `docs/OWNER_ACTION_CHECKLIST.md` — owner obligations.
- Code, commits, tests, receipts, and runtime evidence — implementation truth.

The GitHub Project and linked issue hold the live execution layer: task, bounded scope, mutation lease,
work location, status, next action, and last verification.

## One source for each kind of truth

| Truth | Canonical home |
|---|---|
| Product identity and direction | `docs/PRODUCT_CONSTITUTION.md` |
| Safety / architecture | `docs/ARCHITECTURE_LOCKS.md` |
| Derived product sequence and priority | `docs/product/ROADMAP.md` |
| Current execution status | `docs/BACKLOG.md` (execution ledger only) |
| Gates, artifacts, installed build, publication | `docs/RELEASE_STATE.md` and release receipts |
| Current mutation lease, worktree, branch, next action | Kuya Work Control Project + linked issue |
| Goal, scope, decisions, handoffs, evidence | One linked GitHub issue |
| Implementation | Commits and pull requests |
| Conversation context | Chat only; never authoritative |

Do not maintain a second task board in Markdown, chat, a VS Code note, or another tool. Session-local
mutex/lease recovery state may record only the process/folder safety facts it enforces; it never
becomes a competing priority ledger.

## Roles are capabilities, not departments

- **ChatGPT HQ** is the default coordinator: re-derive native state, keep authority/priority/claims
  coherent, route bounded slices, and review when it did not author the proof head.
- **Claude Code, Codex, and ChatGPT HQ are all eligible executors.** Choose the executor for the next
  bounded slice from current context, remaining capacity, local-machine access, tool fit, and ability
  to reach the next proof boundary. No model receives permanent implementation jurisdiction.
- **Claude Code** is often best for long local Windows implementation/build/test sessions.
- **Codex** is often best for code-heavy implementation, audits, adversarial repair, and bounded
  autonomous slices when it has the right local context.
- **ChatGPT HQ** may implement through connected repository tools when that is the shortest safe path,
  or coordinate/review when another executor holds the mutation lease.
- **Cowork** may own research, documents, copy, design judgment, and explicitly claimed write scopes.
- **Kuya** owns only real owner gates: secrets/signing, security/system settings,
  publication/distribution, money, destructive/irreversible choices, people/account access, and
  genuine product forks. Routine executor selection and handoff are engineering coordination, not
  owner gates. Aesthetic taste is not on that list - agents decide it and show him. An aesthetic call
  is not a gate - decide it, ship it, show a before/after.

A model/tool name is not ownership. A **mutation lease** is ownership of one bounded scope at one
measured work location for one current slice.

## Dynamic mutation lease

Before repository, build, install, or system mutation, the executor must have a current mutation lease.
The lease is deliberately cheap to move because context/token/tool availability changes during work.

A lease records:

```text
### Ownership claim
- Lane: <coordination label; informational>
- Executor/tool: <actual current executor>
- Repository:
- Worktree folder:
- Branch:
- Write scope: <exact paths/globs>
- Started:
- Claim expires: (default 12 hours; alarm only)
- Next action: <next proof boundary>
- Active build/install/helper processes: none | exact process and purpose
```

`### Ownership claim` remains the machine-compatible header; semantically it is the **current mutation
lease**. The important fields are executor, folder, branch, scope, expiry, and next action. `Lane` is a
label, never a permanent model assignment.

### Selecting the next executor

At every new slice or handoff, choose the executor that can most reliably reach the next proof boundary
with enough verified remaining capacity. Consider:

1. exact current context and unfinished work already loaded;
2. local-machine/worktree access needed by the slice;
3. tool/API access needed by the slice;
4. remaining context/token budget and expected slice size;
5. specialization relevant to this slice;
6. independence needed later for proof review.

Do **not** keep work with a model merely because it held the previous lease. Do **not** transfer merely
to create artificial symmetry. Transfer when another executor is the better fit or the current holder
cannot efficiently reach the next proof boundary.

### Communication while another model holds the lease

A non-holder is not banished. It may read, inspect, reason, review, search GitHub, identify blockers,
and post coordination findings. It simply may not mutate the holder's overlapping scope.

This is the intended collaboration model:

- shared read access and native-state synchronization all the time;
- one mutation lease for any overlapping scope;
- lightweight lease transfer when execution should move;
- independent review only at proof-dependent transitions.

### Executor identity

Every executor commits with its own git identity so the gate's `mutationAuthors` list and the
reviewer-not-author rule can be checked against `git log` instead of trusted on assertion.

- `user.name` values: `claude-code`, `codex`, `cowork-hq`; HQ commits made through the GitHub API keep
  the account name.
- Identity is set per worktree (`extensions.worktreeConfig` is already true in this repository:
  `git config --worktree user.name <executor>` and matching `user.email`), or via
  `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME` in the executor's shell.
- A lease record names the identity the holder commits under.
- Commits authored as the bare desk identity (`t <t@t>`) are a defect; the next lease holder corrects
  the configuration before its first commit.

## Claim before write

Before any file, Git, build, install, or system mutation:

1. Open or identify the linked issue and its success criteria.
2. Re-derive Project/issue/PR/main state; do not trust chat or an old SHA.
3. Check active claims for folder or write-scope overlap.
4. Verify the actual repository, worktree, branch, dirty state, and relevant live processes.
5. Record or refresh the mutation lease with exact scope and next proof boundary.
6. Only then mutate.

A **fresh unclaimed** slice needs a claim, not a fictional handoff from a model that never owned it.
Inherited or overlapping work needs a durable handoff/takeover record before the incoming executor
writes.

## Collision rules

A separate worktree or clone is mandatory for every active writer. Shared checkouts are read-only.

1. **One folder, one writer.** A different branch does not make concurrent writes in the same working
   folder safe.
2. **One active mutation lease per overlapping scope.** If two claimed scopes overlap, they serialize.
3. **Disjoint scopes may proceed in parallel** only when they use separate worktrees/branches and both
   exact scopes are current and machine-measurable. Shared issue numbers do not by themselves create
   a collision; overlapping paths do.
4. **Scope is measured, not trusted.** `scripts/scope-drift-gate.mjs` and
   `.claude/hooks/scope-drift-check.mjs` enforce the claimed write set. Dispatch must refuse a new
   slice whose scope overlaps another live mutation lease.
5. **Unknown means locked.** Unknown folder, scope, dirty state, or live-process ownership is not a
   permission to proceed.
6. **Expiry is an alarm, not a takeover.** A stale board claim never authorizes reset, stash, discard,
   delete, force, process kill, or overwrite. Inspect actual state first and record the takeover.
7. **No silent process control.** Do not stop another tool's build, dev server, helper, editor, or
   session just to make a claim convenient.
8. **No chat-only handoff.** The linked issue records evidence, remaining work, exact next action, and
   lease release/transfer.

These rules prohibit conflicting mutation, not collaboration. Read-only analysis by other models is
expected while a lease is active.

## Lightweight handoff

A handoff transfers only mutation authority for the bounded scope. It does not transfer product
ownership, erase context, or require the outgoing model to stop participating read-only.

Outgoing executor posts:

```text
### Handoff
- Outcome:
- Files/commits/PR:
- Verification:
- Remaining work:
- Gates or owner actions:
- Worktree state:
- Active processes:
- Exact next action:
- Claim: released | transferred to <executor> until <time>
```

Incoming executor then re-derives current repository/remote/worktree/branch/dirty/process state and
posts/refreshes its mutation lease. For ordinary engineering work this transfer does not require Kuya
approval.

For an abandoned or stale claim:

```text
### Verified takeover
- Previous lease:
- Worktree/process evidence checked:
- Preserved work:
- New executor/worktree/branch/scope:
- New expiry:
- Next action:
```

No takeover may use destructive Git/filesystem cleanup as its first move. Preserve unknown work before
reconciliation.

## Local folder lease is an enforcement mechanism, not authority

Every verified local session may take a per-folder record under `%LOCALAPPDATA%\CompyEntry\sessions\`
naming the conversation/process writing there. That record enforces **one folder, one writer on this
machine**. It does not choose which model should implement, create product priority, or grant takeover
rights.

A provably dead local conversation/process may let the **local folder record** lapse, but the board
mutation lease still requires actual-state inspection and a takeover/handoff record. A live or
unmeasurable local session keeps the folder locked.

Project/session hooks should ask only: "does this exact session hold the current lease for this folder
and scope?" They must not encode "Claude owns implementation" or "Codex is always read-only."

## Proof order and independent review

Exact required gates cannot be substituted. A narrower or filtered test is supplemental only. If the
exact required gate cannot run, environment inability is **BLOCKED**, not PASS.

A proof-dependent GitHub transition includes at least:

- mark PR ready;
- close a superseded PR based on replacement proof;
- merge;
- close the issue;
- mark Project item Done.

Before such a transition, save a receipt and run:

```text
node scripts/work-control-gate.mjs <receipt.json>
```

The receipt binds proof to the exact full 40-character current head and to canonical remote
reachability. It should also record **all models that authored mutation in the proof delta** as
`mutationAuthors` when more than one executor contributed through sequential leases.

Independent review is a **transition gate**, not a permanent implementation department. The reviewer:

- must review the exact current head;
- must not be one of the mutation authors represented in the proof delta being approved;
- may be Claude Code, Codex, ChatGPT HQ, or another competent independent context;
- becomes stale when the reviewed head changes.

A handoff between executors does not by itself require independent review. Review happens when evidence
is being used to authorize a proof-dependent transition. If independent review is genuinely
impractical, the receipt must say why; it may not silently self-approve.

Only `PASS` from the exact Work Control gate authorizes the transition.

## Windows-session collision guards

The Project claim and linked issue remain authoritative. Windows mutexes enforce only process-level
critical sections in the current Windows logon/Terminal Services session; acquiring one never creates
or transfers a mutation lease.

- `Local\Compy.ReleasePipeline.v1` is held by `scripts/release.ps1` through prepare/prove/publish exit.
- `Local\Compy.InstalledBinary.v1` is held by `scripts/ship-reinstall.ps1` through installed-binary
  replacement/proof/relaunch.

A second process in the same Windows session fails immediately. It does not wait, steal, expire, or
reclaim the mutex.

Normal exit removes the process-owner breadcrumb while still holding the mutex. Crash/abandonment
creates recovery-required state under `%APPDATA%\Compy\work-control\process-mutex`. Recovery is
read-only first: run `scripts/inspect-process-mutex-recovery.ps1 -Resource <name>`, inspect the named
process/worktree/Git/release/installed state, and post concrete evidence on the linked open
`work-control` issue. Clearing requires `-Clear` plus that issue-comment URL and rechecks the recovery
state hash while holding the mutex. Time, claim expiry, process death, a free mutex, unreachable
GitHub, or a plausible-looking URL never clears recovery automatically.

## Status meanings

- **Inbox** — captured, not yet shaped.
- **Ready** — clear next action, no unresolved gate, no active mutation lease for its scope.
- **Active** — at least one valid mutation lease exists for the work being executed.
- **Review** — mutation has stopped at a proof boundary; independent evidence is pending.
- **Needs Kuya** — the next action is genuinely owner-only.
- **Blocked** — progress is impossible without an external change.
- **Done** — named evidence exists and no required work remains.

Closing an issue means Done. Reopening returns it to Ready. Do not close merely because a session
ended, a test passed, or one slice shipped.

## Anti-staleness

GitHub/native state wins over chat and remembered assignments. On every resume, handoff, review, or
transition, re-derive the exact branch/head, issue/PR state, mutation lease, scope, worktree/dirty
state, relevant processes, and required gate evidence.

The weekly coordination audit is read-only. It may report expired/conflicting leases, stale review,
missing proof, or orphaned worktrees. It does not edit, build, install, commit, push, or stop processes
unless it separately acquires a bounded mutation lease.

## Starting a future project

Use the same Work Control model rather than creating a board per AI tool. New repositories keep their
own product/release truth, use the same mutation-lease and handoff shapes, and preserve the same core
rule:

**route each bounded slice to the best-fit available executor; allow shared read-only coordination;
serialize only overlapping mutation; independently review exact proof heads before transitions.**
