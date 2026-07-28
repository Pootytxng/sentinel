# Release autonomy policy

> Repository law for Claude Code, Cowork, Codex, and every future agent working on Compy. This
> document governs release-engineering authority; `docs/RELEASE_STATE.md` governs live state.

## One authorization covers the reversible train

When the owner authorizes a release train, that one authorization covers every reversible
engineering action needed to reach the stated owner boundary. Agents autonomously diagnose, repair,
guard, commit, push, retry, and continue. A failed test, release gate, script, build, proof, or
correctable documentation check is evidence to preserve and repair, not an automatic reason to send
the decision back to the owner.

Reversible release engineering includes commits and branches in the **private source repository**,
normal fast-forward source pushes, private-source preparation tags, builds, signed local artifacts,
receipt creation, local installs, local runtime proofs, mocked/sandboxed publication tests, and
compatible resume of an already-started private transaction. A ref or release object in the public
releases repository is external state and is created only within an explicitly authorized publish
action. Engineering forks inside the reversible scope are resolved by the agent and documented in
code, tests, commits, or release evidence.

## Preservation and provenance are mandatory

Before resetting, replacing, superseding, or abandoning a failed candidate, preserve its useful
evidence and immutable refs. Never move, recreate, overwrite, or force-update an existing tag.
Never replace an incompatible release or asset. If a receipt-bound release commit is invalidated,
preserve the candidate and advance SemVer.

Every artifact must remain bound to its exact receipt, source commit, source tag, installer hash,
updater-signature hash, manifest hash, and embedded runtime stamp. A local transaction journal is
evidence only: every rerun re-verifies real local and remote state before it resumes. Existing state
is reusable only when it is exactly compatible; every mismatch fails closed.

External transaction outcomes cannot be committed inside the immutable release-source commit that
precedes them. Record them in the receipt-bound journal immediately, then reconcile
`docs/RELEASE_STATE.md` in the first normal follow-up source commit. That follow-up may advance
private `main`; publication remains valid only when the release commit is an ancestor of that main
and the immutable source tag still resolves exactly to the receipt commit.

Verification is never bypassed, weakened, or reclassified for momentum. Expected absence may be
accepted only when it is positively distinguished from authentication, permission, network,
timeout, malformed-response, and other failures. Public release publication stays last, after exact
draft-asset verification.

## Owner stop boundaries

Stop for the owner only at:

1. the first fleet-visible publication or distribution step;
2. secrets, signing-key exposure, or key rotation;
3. security or Windows system-setting changes;
4. force-push, destructive history rewrite, or deletion without preservation;
5. spending money;
6. material product-scope or aesthetic decisions outside the authorized train; or
7. genuinely unresolved options with meaningfully different irreversible consequences.

These gates do not prevent read-only verification of public state or use of a protected signing key
through the existing release pipeline. They do prevent exposing key material, changing security
posture, publishing to the fleet, or sending artifacts without the corresponding owner decision.

## Required failure loop

For every reversible release failure:

1. preserve useful evidence;
2. diagnose the complete defect class;
3. add a failing regression guard when mechanizable;
4. repair the root cause without weakening fail-closed behavior;
5. run focused and adjacent verification;
6. commit and fast-forward push with exact provenance; and
7. resume the authorized train from re-verified state.

The agent reports the final evidence and remaining owner boundary; it does not ask the owner to
relay routine reversible engineering decisions.
