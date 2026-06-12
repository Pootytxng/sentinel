# Memcompress elevated-prior-read resolver (dark) — 2026-06-12

**Problem (from the R2 Review Queue / live QA 2026-06-11):** the memory-compression restore could
never run for any real user — its prior read (`Get-MMAgent`) is admin-only (ca01347) and Compy runs
non-elevated, so `restore_memory_compression()` always refused ("can't snapshot"). Correct fail-safe,
zero utility.

**Design (the §4 result-file pattern, inverted to data-out):** when the non-elevated prior read
returns `None`, ONE elevated script does — in `$ErrorActionPreference='Stop'` order —
`read prior → bank it to an app-derived result file ("prior:True|False") → Enable-MMAgent →
append "done:ok"`. The non-elevated side then parses the file fail-safe: a ledger receipt is earned
ONLY when the prior parsed AND `done:ok` confirmed (the §4 "only an explicit ok" direction); every
other shape refuses with an honest state-naming message and records nothing. A readable prior
(elevated context / future probe) still takes the plain snapshot-then-mutate path. The rollback
contract is untouched (`Snapshot::MemoryCompression { prior_enabled: Some(bool) }`,
`rollback_memory_compression_typed`).

**Why the order is safe:** EAP=Stop makes the script abort at the first failing statement, so the
mutation line can never run before the prior is banked; a decline/launch failure runs nothing; an
elevated mid-failure leaves prior-but-no-done → no receipt, honest message. The result path is the
ONE sanctioned non-integer interpolation in the resolver layer (app-derived, single-quote-escaped —
the `compose_batch_script` precedent; the file is data out, never input in).

**Still dark:** `restore_gate()` false, zero restore IPC — unchanged. Test-pinned:
`memcompress_combined_script_banks_the_prior_before_mutating` (order + exit-free + escaping),
`memcompress_result_parse_is_fail_safe`, decline-writes-nothing through the QA seam.

**Honest-detection note (recorded, not solved here):** non-elevated detection still reports
memory-compression as "needs admin to check" — it can't SEE the rotted state, so the Check UI would
never offer this restore unprompted. When the gate-flip wave is specced, decide between (a) an
elevated re-check action ("check with admin") that can surface the finding, or (b) offering the
restore only from a context where the state is known. Owner call.

**Live QA (BLOCKED on owner fixture sanction):** the manual loop
(`manual_restore_qa_memcompress_full_loop`, 6 prompts — read-backs are elevated too) seeds
`Disable-MMAgent` and cleans up with `Enable-MMAgent` (the Windows default). That pair toggles real
memory compression on the QA rig, so it is NOT in the sanctioned fixture set yet — the test's
ignore-reason says so and it must not run until the owner sanctions it.
