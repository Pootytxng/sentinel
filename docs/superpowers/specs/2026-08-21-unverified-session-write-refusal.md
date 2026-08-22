# Spec — refusing project writes from an unverified session (#125)

**Status:** steps 1-3 BUILT 2026-08-22 and green; step 4 (arming it) is the owner's line, step 5 waits
on step 4. Written 2026-08-21 from measured state, not from the issue's wording. **§7 records what the
build changed about this design.**
**Issue:** [#125](https://github.com/Pootytxng/sentinel/issues/125) · **Files:**
`.claude/hooks/session-root-assert.mjs`, `.claude/hooks/project-write-assert.mjs`, `tools/entry/adopt.mjs`,
`tools/entry/session-root-assert.test.mjs`, `tools/entry/adopt.test.mjs`,
`tools/entry/project-write-assert.test.mjs`, `tools/entry/cli.mjs`, `.claude/settings.json`.

---

## 1. What the issue asks, and why it is not a one-line flip

> move unlaunched-session project WRITES from warn to refuse, keep read paths advisory if desired,
> and flip the test to pin the refusal.

Two things had to be measured before that could be written safely, and both changed the answer.

### 1a. There is no write hook to flip

`session-root-assert.mjs` is wired **only** as a `SessionStart` hook (`.claude/settings.json`). It
runs once, prints a line, and exits. `PreToolUse` today matches `Workflow`, `Agent` and `Read` — there
is **no `Write`/`Edit` matcher at all**. "Refuse project writes" is therefore not a severity change to
an existing gate; it is a **new hook**, and that is most of the work.

### 1b. The four advisory codes are not one case

`ADVISORY_CODES` is `{NO_TOKEN, TOKEN_EXPIRED, LINEAGE_EXPIRED, LAUNCH_SPENT}`. Reading what each one
actually means in `verifySession`:

| Code | What is on disk | Anything to check against? |
| --- | --- | --- |
| `NO_TOKEN` | nothing — no launch, no record | **No.** Nothing was ever verified for this folder. |
| `TOKEN_EXPIRED` | an unclaimed launch token with folder, branch, issue, window, repo, sessionId | Yes — it just aged out |
| `LAUNCH_SPENT` | a claimed token whose session record is gone | Yes — folder and issue survive |
| `LINEAGE_EXPIRED` | a session record for this folder that lapsed | Yes — folder, branch, issue, sessionId |

Only **`NO_TOKEN`** is literally the "unlaunched session" the issue names. The other three describe a
launch that *did* happen and whose clock ran out. Treating all four alike is the "naive flip" the
BACKLOG warns about, and the warning is not hypothetical — see §2.

---

## 2. The measured blast radius

`%LOCALAPPDATA%\CompyEntry\launch.json`, read 2026-08-21:

```json
{ "issue": 143, "folder": "C:\\Users\\Kuya\\code\\sentinel-home-room",
  "branch": "agent/home-room-question", "sessionId": "f5ee4707-…",
  "expiresAt": "2026-08-19T23:34:24.274Z", "claimedAt": null }
```

The session writing this spec opened with `compy-entry: the launch token has expired — this session is
unverified` (`TOKEN_EXPIRED`). Against that token it fails **three** ways:

- **branch** — live branch is `lane/rig-then-rails`; the token says `agent/home-room-question`. The
  owner instructed the rename this session. Renaming a lane branch is normal, sanctioned work.
- **sessionId** — a different conversation entirely.
- **issue** — the token is bound to #143; this session was given #126 / #156 / #128 / #125 directly in
  chat.

Everything this session has produced — the "Your rig" spec, the #126 re-proof, the #156 install gates,
the #128 merge and its fixes, PR #191 — would have been refused. So would the session that built this
very queue (also `TOKEN_EXPIRED`, recorded in `docs/BACKLOG.md`).

**This kills the obvious fallback design too.** "Let a lapsed record re-verify itself by still matching"
sounds safe and is useless: the honest, owner-directed sessions are exactly the ones whose branch,
session id and issue have all legitimately moved on. A rule that only passes sessions that changed
nothing does not pass the sessions that are doing the work.

> **The finding:** the reason these sessions are unverified is not that something went wrong. It is
> that the owner opened a window and gave it work without going through the launcher. Any design that
> treats that as an error will be wrong most of the time it fires.

---

## 3. Recommendation — refuse, but ship the way back in the same commit

A refusal with no self-service cure turns every direct instruction from the owner into "close the
window and start over." That is worse than today's advisory, because today's advisory at least does not
throw away a live conversation.

So the flip lands **with** an adoption path, and the two are one change:

### 3a. `compy-entry adopt` — verification without a relaunch

A new subcommand alongside the existing `preflight | choose | assert | bridge | handoff` in
`tools/entry/cli.mjs`. It does what the launcher does at the end of a launch, and nothing else:

```
node tools/entry/cli.mjs adopt --issue <n> --session <id>
```

Writes a session record binding **folder + branch + sessionId + issue**, after asserting:

1. the folder is a real git worktree of `Pootytxng/sentinel`,
2. the branch is the live checked-out branch (read, never set),
3. `--issue` names an **open** issue labelled `work-control`,
4. no *other* live session record claims this folder (the `WORK_CONTROL.md` one-writer rule),
5. `--session` is supplied explicitly — the CLI must never guess which conversation it is adopting.

That is the same set of assertions a launch makes. It is not a bypass: an adopted session is verified
because it proved the same facts, just later and by hand.

**Where the session id comes from.** A CLI run from Bash cannot know it. The `PreToolUse` refusal
message therefore prints the exact command with the id already filled in — the hook receives
`session_id` in its input, so the session is told how to verify itself at the moment it is stopped.
This is the whole trick, and it is why the refusal and the cure must ship together.

### 3b. The refusal itself

New `PreToolUse` hook, matcher `Write|Edit|NotebookEdit`, `.claude/hooks/project-write-assert.mjs`:

- reuses `verifySession` — **one implementation, no second copy of the identity rules**
  (`tools/entry/tracked-hooks.test.mjs` already enforces that discipline);
- refuses only when the resolved target path is **inside the project root**; anything outside
  (scratchpad, temp) is not a project write;
- refuses on `NO_TOKEN` and on every already-blocking code (`SESSION_FOREIGN`, `LINEAGE_FOREIGN`, …);
- refuses on the three lapsed codes **too** — §2 shows a lapsed record cannot honestly re-verify
  itself, so "lapsed" and "never launched" get the same answer and the same one-line cure;
- **reads stay advisory.** The issue allows it and there is no reason to make a read expensive.

### 3c. The hole, named rather than papered over

`Bash` is not matched. `sed -i`, `git commit`, `python patch.py` all still write. Matching `Bash`
would mean parsing arbitrary shell to decide whether it writes, which fails open on anything clever
and fails closed on plenty that is innocent.

That is acceptable **because the threat model is an unaware session, not an adversarial one** — the
whole entry system exists because sessions kept writing without noticing their identity was
unverified, not because an agent was routing around a gate. A refusal on the tool an unaware session
reaches for first, plus the `SessionStart` line, covers that. Anything stronger needs a different
mechanism (a pre-commit hook on the repo side), and that is a separate issue, not a silent extension
of this one.

---

## 4. Rollout order — so a bug cannot lock the machine out

The hook that refuses `Write`/`Edit` can, if wrong, prevent its own repair. Land it in this order:

1. **Split the code set as data** in `session-root-assert.mjs` — `UNVERIFIABLE` (`NO_TOKEN`) vs
   `LAPSED` (the other three) — and export it. Behaviour unchanged; both sets stay advisory at
   `SessionStart`. Pure refactor, fully testable, zero blast radius.
2. **Build `adopt`** with its own tests, including a real end-to-end adopt in a temp worktree. It is
   inert until something refuses.
3. **Build `project-write-assert.mjs`** and test it as a module against fabricated hook inputs —
   verified, `NO_TOKEN`, lapsed, path-inside, path-outside.
4. **Adopt this machine's live session first**, then wire the hook into `.claude/settings.json`. If
   the hook misbehaves, `Bash` is still available to unwire it — which is the same hole as §3c, here
   working as the escape hatch.
5. **Flip the pinned tests** in `tools/entry/session-root-assert.test.mjs`. Today
   `"only advises in a session that was never launched through the entrypoint"` pins the current
   behaviour on purpose. It becomes: `SessionStart` still advises (a read-only session is not broken),
   and the **write** path refuses. Both halves get a test; the advisory one must not be deleted, or
   the next change will silently make session start fatal.

---

## 5. Owner decision embedded in this spec

Step 4 changes how the owner's own tooling behaves for every agent on this machine, including making a
mistake cost him a window. The engineering is mine; **the moment of flipping it is his**, and it is one
line: *"turn on the write refusal."* Steps 1–3 need no decision and can land whenever the queue reaches
them.

## 6. Guards this must leave behind

- `UNVERIFIABLE` / `LAPSED` exported as data, with a test that every code produced by `verifySession`
  lands in exactly one classification — the existing
  `"classifies every refusal code the assert can actually produce"` test extended, not replaced.
- A test that `project-write-assert.mjs` imports `verifySession` rather than reimplementing it.
- A test that the refusal message contains a runnable `adopt` command including the session id — a
  refusal without its cure is the failure mode this whole spec exists to avoid.
- A test that a path outside the project root is never refused.

---

## 7. What the build changed about this design (2026-08-22)

Steps 1-3 are built and green (`tools/entry/` — 47 files, 719 tests). Three things the design could
not know until the facts were measured:

1. **The `work-control` label is a NOTE, not a gate** (§3a assertion 3). Measured: 6 of the 13 open
   issues carry it, and #125 itself is one of the 7 that do not. A gate that refuses more than half
   the real queue, including its own issue, is an outage rather than a safety property. OPEN is the
   gate; the missing label is reported in the record and in the output. Pinned in `adopt.test.mjs`.
2. **An adopted record claims a context window only when this process can see one.** `checkIdentity`
   treats a claimed window as a hard check, so a record claiming a tier the session cannot prove
   would refuse that session at its very next `SessionStart` — the cure would cause the disease.
   Unobserved stays unknown. Pinned in `adopt.test.mjs`.
3. **A STOP code is refused WITHOUT offering adoption.** §3b lists the blocking codes alongside the
   advisory ones, but the cure is not the same: a folder another live conversation holds is refused
   by `adopt` as well (`ADOPT_FOLDER_CLAIMED`), so printing the command there would be advice that
   cannot work. Advisory codes (UNVERIFIABLE + LAPSED) get the runnable `adopt` line; contradicted
   sessions get the assert's own reason and are told to resolve the disagreement. Pinned in
   `project-write-assert.test.mjs`.

Also decided during the build: **the write hook never persists** (`verifySession({persist: false})`).
It fires on every write, so it is a checkpoint, not the thing that establishes identity —
`SessionStart` owns the record. Persisting would additionally delete the lapsed record whose issue
number the refusal wants to offer.

`.claude/settings.json` is deliberately UNTOUCHED: the hook exists, is tested, and is inert until it
is registered. That registration is step 4, and it is the owner's one line.
