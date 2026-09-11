# Two-agent protocol — Claude (Cowork) ⇄ Sol, on one desk

**Purpose:** let two agents work the same repo, the same machine and the same release pipeline
without losing work or colliding. This replaces "one lane at a time" as a *hard* constraint with a
*disciplined* one — but only if every rule below is followed. **If you will not follow the protocol,
go back to one lane at a time. A half-followed lock is worse than no lock**, because it manufactures
false confidence.

**Honest framing first: 100% foolproof is not achievable here.** Two processes share one working
tree, one installed binary, one `RELEASE_STATE.md` and one globally-minted version counter. What this
protocol buys is: **collisions become loud and early instead of silent and late**, and **nothing is
ever lost** even when a collision happens. That is the realistic target, and it is worth having.

---

## 1. The shared medium: a lease directory OUTSIDE the repo

Both agents reach `C:\Users\Kuya\code\sentinel` through Desktop Commander on device
`nexusli-usarho3`. That shared filesystem is the only channel both sides can read and write
synchronously — use it.

```
C:\Users\Kuya\code\.compy-lanes\          <- create once; NOT inside the repo
  LANES.md          <- current leases. The single arbiter of "who owns what right now".
  JOURNAL.md        <- append-only. Every claim, release, finding, handoff. Never edited, only appended.
  msg-to-claude.md  <- async inbox: things Sol needs Claude to know
  msg-to-sol.md     <- async inbox: things Claude needs Sol to know
```

**Why outside the repo:** `release-prepare.ps1` and `release-publish.ps1` **refuse a dirty tree**, and
an untracked lock file is dirt. Putting the lease inside the repo would block the very pipeline it is
meant to protect. This was learned the hard way — scratch files in `docs/ui-sweep/` had to be deleted
before every ship.

## 2. LANES.md format — keep it boring and parseable

```markdown
# LANES — current leases (edit ONLY while holding the file, append to JOURNAL for history)

## LANE: rig-idle-127
owner:        sol
claimed:      2026-08-14T09:12Z
heartbeat:    2026-08-14T09:48Z
files:        src/surfaces/rig/**, src/surfaces/home-console.css, docs/perf/raw/**
branch:       fix/rig-idle-127
exclusive:    RELEASE_STATE, VERSION-MINT, PUBLISH   (none, unless shipping)
note:         probe running detached, log $env:TEMP\compy-q7-lane.log

## LANE: (free)
```

**Rules:**
- **`files:` is a claim, and it is binding.** Do not edit a path another live lane lists. If you need
  one, write to their inbox and wait — do not "just quickly" touch it.
- **`heartbeat:` must be refreshed at least every 30 minutes of active work.** A lease whose heartbeat
  is **>90 minutes** stale is **abandoned** — see §6.
- **`exclusive:`** names the single-writer resources this lane currently holds. Only ever ONE lane may
  hold each.

## 3. The three single-writer resources — these are where catastrophes come from

| Resource | Why it cannot be shared | Rule |
|---|---|---|
| **`docs/RELEASE_STATE.md`** | It is the authoritative state doc; two writers = drift, which an external audit named the project's #1 risk | Only the lane holding `RELEASE_STATE` edits it. Everyone else reads. |
| **VERSION MINT** | `release-prepare.ps1` mints `configured + 1` and commits **before** gates run. A failed prepare still burns the number. Two prepares = two burned numbers and a confused ledger | Only the lane holding `VERSION-MINT` may run prepare. Claim it, prepare, release it. |
| **PUBLISH** | One publish pen, and Kuya's GO is per-build | Only the lane holding `PUBLISH`. **Before claiming: check `$env:TEMP\publish-*.log` for a fresh run and read the journal's `completed_stages`.** |

**The installed binary is a fourth, sneakier one.** `prepare` installs over `%LOCALAPPDATA%\Compy`, so
if Sol ships a desk build while Claude is mid-look, Claude is now looking at Sol's build and will
report nonsense. **Treat "installed desk build" as owned by whoever holds VERSION-MINT.** If you are
doing a visual review, say so in your lane `note:` and check it before you trust a screenshot.

## 4. Claim / work / release — the actual sequence

**CLAIM (before any edit):**
```powershell
# one command, so the read and the git check cannot drift apart
cd C:\Users\Kuya\code\sentinel
git branch --show-current; git status --short; git fetch origin --quiet; git rev-parse --short HEAD origin/main
Get-Content C:\Users\Kuya\code\.compy-lanes\LANES.md
Get-Content C:\Users\Kuya\code\.compy-lanes\msg-to-<you>.md
```
Then append your lane block to `LANES.md` **and** an entry to `JOURNAL.md`. If your `files:` overlap a
live lane — **stop and write to their inbox.**

**WORK:** refresh `heartbeat:` every ~30 min. Keep your `note:` truthful — especially any detached
process and its log path, so the other agent knows a background job is live and does not restart it.

**RELEASE (when done or stopping):** land your work (committed and pushed, or explicitly abandoned and
reverted), append the outcome to `JOURNAL.md`, then remove your lane block. **Never leave a lease
behind on a clean stop.**

## 5. The Git rules that actually prevent the catastrophe

Two agents in **one working tree** is the real hazard — not the lock file.

- **Branch per lane.** Never both on `main`. `git checkout -b <lane>` and stay there.
- **Only one agent may hold a checkout at a time for edits.** The safest arrangement: whoever is *not*
  editing works read-only, or uses a **separate clone** (`C:\Users\Kuya\code\sentinel-feedback` and
  `sentinel-quietpitwall` already exist as live worktrees). **A fresh worktree needs its own
  `node_modules` before it can run one test** — budget ~2 minutes for that, and do not skip it.
- **Re-run `git branch --show-current` + `git status --short` in the SAME command as every commit.**
  This is already a standing rule and it exists because the checkout is shared.
- **Never `git checkout` / `git stash` / `git reset` while another lane is live.** You will silently
  yank files out from under a running process. If you must, claim `CHECKOUT` as an exclusive first.
- **Push often.** Origin is the durable record. Work that only exists in the working tree is work that
  can be lost by the other agent's checkout.

## 6. Stale lease recovery — the part everyone skips

A lease goes stale when a session dies mid-lane (**the Cowork↔desk bridge dropped three lanes running
— this WILL happen**).

**If `heartbeat:` is >90 minutes old:**
1. Check whether the work is actually still running: `Get-Process`, the `note:` log path, and
   `git log --oneline -5` on the lane's branch. **Detached background jobs survive a dead session** —
   a bridge drop does not mean the gate stopped.
2. Append a `RECLAIM` entry to `JOURNAL.md` naming the lane, the evidence you checked, and the state
   you found it in.
3. **Do not delete their branch. Do not revert their commits.** Leave the work; take the lease.
4. If their tree is dirty, **commit it on their branch as `wip: recovered from abandoned lane <name>`**
   rather than discarding. Nothing is ever lost — that is the whole point.

## 7. Communication: three channels, each with a job

| Channel | Use for | Latency |
|---|---|---|
| `msg-to-claude.md` / `msg-to-sol.md` | direct asks, blocked-on-you, "I need a file you hold" | next time they check — **check at claim time and at every heartbeat** |
| `JOURNAL.md` | durable record of what happened and why; findings; reclaims | permanent, append-only |
| **GitHub issue comments** | anything a future session must find without reading the journal | permanent, searchable, survives the desk |
| `claude/HQ_DECISION_LEDGER.md` | **decisions and standing laws only** — not chatter | permanent, the first-read |

**Keep the ledger clean.** It is the cold-start handoff and it works because it is decisions, not a
log. Findings go to the journal or the issue; only *decisions* go to the ledger.

## 8. Division of labour that actually fits the two of you

This is where synchronicity is won or lost — not in the lock file, but in **not wanting the same
thing at the same time.**

- **Sol takes the mechanical and the measurable:** probe runs, reproductions, forensics
  (`package-lock` archaeology), housekeeping, coverage audits, disposition assignments. These are
  long-running, evidence-producing, and cheap to verify.
- **Claude takes judgment and synthesis:** fix shape, guard design, what a finding *means*, ledger
  curation, anything where being wrong is expensive and being fast is worthless.
- **Never both on the same surface.** #127 and the rig wheel bug live in the same file — that is why
  they are **one lane, not two**, regardless of who runs it.
- **Ship lanes are exclusive by construction.** Whoever ships holds RELEASE_STATE + VERSION-MINT +
  PUBLISH for the duration and the other agent goes read-only. A ship is ~15 minutes of wall clock;
  waiting is cheaper than a burned version number.

## 9. Bootstrapping this (one-time, ~5 minutes)

1. `mkdir C:\Users\Kuya\code\.compy-lanes`
2. Create `LANES.md` with a single `## LANE: (free)` line, and an empty `JOURNAL.md` and both inboxes.
3. Add one line to `docs/WORK_CONTROL.md` and to `claude/HQ_DECISION_LEDGER.md` pointing at this
   protocol, so a cold session finds it. **That pointer is the load-bearing part** — a protocol nobody
   is told about is a protocol nobody follows.
4. First agent to start claims a lane and appends to the journal. That is it.

## 10. The failure modes this does NOT solve — know them

- **Two agents editing the same file inside the 30-minute heartbeat window.** The lock is advisory,
  not enforced by the OS. Mitigation: narrow `files:` claims and push often.
- **A shared installed binary during a visual review.** Mitigation: §3, and check `LANES.md` before
  trusting a screenshot.
- **The bridge dropping mid-write.** Files on disk were never damaged across three occurrences, but a
  panicked re-run *would* have doubled edits. Mitigation: on reconnect, `RefreshMcpTools`, re-load
  Desktop Commander schemas, then re-check branch + status **before touching anything**, and treat
  detached work as still running.
- **Human-in-the-loop resources** — Kuya's GO, anything naming a tester. No protocol covers these.
  Draft, never send; publish only on explicit GO.

**If any of this feels like too much ceremony for the work at hand, that is a real signal: stay on one
lane.** The protocol is worth it when two agents genuinely have non-overlapping, multi-hour work. It
is not worth it for a single afternoon's fix.
