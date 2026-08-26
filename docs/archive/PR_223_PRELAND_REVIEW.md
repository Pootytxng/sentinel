# PR #223 pre-land review — what it caught, and the guards that hold it

> Moved out of `docs/SESSION_HANDOFF.md` on 2026-08-26 under TOKEN LAW §1 (current state only —
> history moves, never gets deleted). PR #223 has landed; every fix below is on `main` in `97a0e945`
> and every guard named is in the suite. Back to the live file:
> [`../SESSION_HANDOFF.md`](../SESSION_HANDOFF.md).

## What the pre-land review caught, and the guards that now hold it

An independent `rust-tauri-reviewer` pass found three things in the observer, all fixed in
`97a0e945`, each with a guard, per the bug→guard law. A second pass at the landing head returned
**CLEAN** after re-running the Rust suite, clippy, vitest and `tsc` itself.

1. **A dismissed crash could be announced again.** `incident_id` is a hash over the crash's traits
   *including its instant*, and `blackbox::merge_into` moves that instant — and fills in the faulting
   module — the moment a corroborating WER report lands. So one crash wears two ids across two scans,
   the second reads as never-seen, and a card you had just dismissed comes back. Fixed by recording
   each row's matching traits at observation time and reconciling shifted identities *before* anything
   decides what is new, gated on the old id having left the report so a genuine crash-loop repeat
   still counts as two. Guards: `a_dismissed_crash_is_not_reannounced_when_its_identity_shifts` and
   `two_ids_that_are_both_live_stay_two_incidents`.
2. **A lost-update race on the state file**, plus a shared temp filename. Fixed with one process lock
   around every read-modify-write (the expensive scan stays *outside* it) and a per-call temp path.
3. **A guard that read raw source**, so a `// TODO: wire ScanTrigger::Foreground` could satisfy it.
   Now comment-stripped, and it asserts real call sites.

The second pass's one nit — the `should_scan` guard regex also accepted an *unlocked* watermark read,
the exact regression finding 2 exists to catch — was taken in the same commit as this file, and
falsified before it was counted.

