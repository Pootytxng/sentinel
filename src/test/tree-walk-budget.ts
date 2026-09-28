// #515: the timeout every test that walks the WHOLE tree or the whole worktree fleet must run on.
//
// vitest's 15 s default (vitest.config.ts) is a hang guard sized for render tests, and a whole-tree
// walk is not a render test: its cost is the tree's size times the disk's current speed. On
// 2026-09-23 the pre-push gate refused a clean push twice with nothing but `Test timed out in
// 15000ms`, rotating between three walkers, while the owner played a game with a recorder running.
// Reading the 2,018 tracked files took 10 s under that load against 2.7 s quiet.
//
// This is a HANG GUARD, not an assertion. A walker that passes at 16 s is a pass; a walker stuck
// forever still fails, at this number instead of at 15 s. Nothing it checks gets weaker. Sized from
// a measurement under synthetic CPU + disk load, recorded with the numbers in
// scripts/lib/tree-walk-tripwire.mjs. scripts/lib/tree-walk-tripwire-setup.mjs fails any test that
// walks the real tree or fleet on less than this, so a new walker cannot land on the default.
export const TREE_WALK_TIMEOUT_MS = 600_000;

// #563: the timeout every test or hook that starts GIT_SPAWN_FLOOR (scripts/lib/tree-walk-tripwire.mjs)
// or more git processes must run on, fixture repositories in os.tmpdir() included.
//
// Those tests walk nothing, so the budget above does not reach them, yet each git process pays for a
// process start that the full suite's own parallelism starves. On 2026-09-24 seven of them took
// turns failing the pre-push gate on the 15 s default, their files running 8.3 to 11.4 times slower
// than in a 2026-09-26 census of the whole suite. The slowest git test in that census took 4.3 s; at
// 11.4 times that is 49 s, and this leaves 2.4 times on top. Like the budget above it is a HANG
// GUARD: nothing it checks gets weaker, and a hung test still fails, at this number.
export const GIT_SPAWN_TIMEOUT_MS = 120_000;
