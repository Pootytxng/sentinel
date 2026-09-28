//! A seam a test can hold OPEN from inside a critical section, so a race lands every run.
//!
//! ## Why this exists
//!
//! #283's read-then-act sequences are microseconds wide. A test that merely starts two threads at
//! one of them passes whether or not the lock is there — the "green that is not evidence" shape.
//! That is not a hypothetical here: the first draft of the comparison race tests stayed green with
//! every lock acquisition removed, and an independent review of PR #395 then found two more tests
//! in the same family that could not fail either.
//!
//! So the seam is widened DELIBERATELY, and only while a test arms it. [`hold`] is `#[cfg(test)]`
//! and default-off; in a release build it is an empty `#[inline(always)]` function and the flag it
//! reads does not exist at all.
//!
//! ## What it proves, and what it does not
//!
//! The widening does not CREATE the race. It is called from inside the critical section, between the
//! read and the act, and touches no shared state — with the lock held it merely delays whoever is
//! waiting. Removing **only** the lock, with the widening left in place, is what turns the tests
//! red. That asymmetry is the evidence; the pass on its own is not.
//!
//! It is also not a claim that the real window is 60ms wide. It says the interleaving is POSSIBLE
//! and that the lock is the only thing forbidding it. How wide the un-widened window actually is was
//! measured separately, by removing the locks and counting what survived.

/// Armed by [`Widened`], read by [`hold`]. Process-global, which is why [`GATE`] exists.
#[cfg(test)]
static WIDENED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// How long an armed seam stays open. Long enough that a thread starting ~20ms later is certainly
/// inside the window; short enough that the handful of tests using it do not dominate the suite.
#[cfg(test)]
pub(crate) const HOLD: std::time::Duration = std::time::Duration::from_millis(60);

/// Serializes armed tests against each other, across modules. The flag is process-global and libtest
/// runs tests in parallel, so without this one test's teardown could disarm the seam while another
/// is still inside it — and that test would then pass for the wrong reason, lock or no lock.
#[cfg(test)]
static GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Arms the seam for one test and disarms it on the way out **even if the test panics**, so a
/// failure can never silently alter another test's timing.
#[cfg(test)]
#[must_use = "the seam is armed only while this guard is alive; bind it, e.g. `let _seam = ...`"]
pub(crate) struct Widened(#[allow(dead_code)] std::sync::MutexGuard<'static, ()>);

/// Takes [`GATE`], recovering it rather than panicking: a test that failed while armed must not take
/// every other seam test down with it — they would then fail for the wrong reason.
#[cfg(test)]
fn gate() -> std::sync::MutexGuard<'static, ()> {
    GATE.lock().unwrap_or_else(|poisoned| {
        GATE.clear_poison();
        poisoned.into_inner()
    })
}

/// [`GATE`] with nothing armed, for a test that asserts on process-global lock state rather than on
/// a seam. Two tests deliberately poison `COMPARISON_LOCK`; this is what stops one of them from
/// clearing the flag the other is reading. It does NOT exclude the ~20 ordinary tests that take that
/// lock, which is why a test may never assert the flag is SET — see the note in `comparison.rs`.
#[cfg(test)]
#[must_use = "the exclusion lasts only while this guard is alive; bind it, e.g. `let _x = ...`"]
pub(crate) fn exclusive() -> std::sync::MutexGuard<'static, ()> {
    gate()
}

#[cfg(test)]
impl Widened {
    pub(crate) fn arm() -> Self {
        let g = gate();
        WIDENED.store(true, std::sync::atomic::Ordering::Release);
        Widened(g)
    }
}

#[cfg(test)]
impl Drop for Widened {
    fn drop(&mut self) {
        WIDENED.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// Call from INSIDE a locked section, at the point between reading a store and acting on what was
/// read. Costs one relaxed atomic load in a test build and nothing at all in a release build.
#[cfg(test)]
pub(crate) fn hold() {
    if WIDENED.load(std::sync::atomic::Ordering::Acquire) {
        std::thread::sleep(HOLD);
    }
}

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn hold() {}

// ---------------------------------------------------------------------------------------------
// A seam a test can make PANIC, so a claim about what a half-finished sequence leaves behind can
// be checked instead of asserted.
//
// PR #395's second independent review found that `lock_comparison`'s doc justified clearing poison
// with "a thread that panicked mid-section can only have left the PREVIOUS complete file plus an
// orphan temp". True per FILE, and `comparison.rs` holds ONE lock across TWO files: a panic between
// the two writes leaves the pair split, and `clear_poison` unblocks the lock without reconciling
// anything. The review's verdict was "latent, not an active bug" — no `unwrap`/`expect`/indexing
// sits in either window today — so the repair is not to invent a reconciler for a failure that
// cannot currently happen. It is to stop the doc claiming more than it proves, and to make the
// window itself testable so the day someone adds a panic surface there is the day a test says so.
// ---------------------------------------------------------------------------------------------

/// Seam ids. `const`, so a release build carries the identifier and no state.
pub(crate) const AFTER_ARMED_WRITE: u8 = 1;
pub(crate) const AFTER_RESULT_WRITE: u8 = 2;

/// Which seam, if any, is armed to panic. `0` is none.
#[cfg(test)]
static PANIC_SEAM: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Arms one panic seam for one test, under the same [`GATE`] as [`Widened`] so an armed panic and
/// an armed widening can never overlap. Disarms on the way out even if the test panics.
#[cfg(test)]
#[must_use = "the seam is armed only while this guard is alive; bind it, e.g. `let _seam = ...`"]
pub(crate) struct PanicAt(#[allow(dead_code)] std::sync::MutexGuard<'static, ()>);

#[cfg(test)]
impl PanicAt {
    pub(crate) fn arm(seam: u8) -> Self {
        let g = gate();
        PANIC_SEAM.store(seam, std::sync::atomic::Ordering::Release);
        PanicAt(g)
    }
}

#[cfg(test)]
impl Drop for PanicAt {
    fn drop(&mut self) {
        PANIC_SEAM.store(0, std::sync::atomic::Ordering::Release);
    }
}

/// Call from inside a locked section at a point where a panic would leave work half-done. Fires at
/// most ONCE per arming — the recovering caller must not walk into the same panic again.
#[cfg(test)]
pub(crate) fn panic_at(seam: u8) {
    use std::sync::atomic::Ordering;
    if PANIC_SEAM.load(Ordering::Acquire) == seam
        && PANIC_SEAM
            .compare_exchange(seam, 0, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    {
        panic!("deliberate: race_seam panic at seam {seam}, armed by a test");
    }
}

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn panic_at(_seam: u8) {}

// ---------------------------------------------------------------------------------------------
// The lock-acquisition recorder (#398).
//
// ## Why this replaces a text scanner
//
// PR #395 shipped `scripts/store-lock-order-guard.test.mjs`, which asserted "nothing reachable from
// inside a store lock reaches back into one" by scanning Rust source from JavaScript. FIVE
// consecutive independent reviews walked around it with ordinary Rust: a bare `use crate::x;`, a
// nested use-group, a `//` inside a string, a `/*` inside a string, and finally a crate-root
// re-export — `pub(crate) use comparison::report_tuning_crash as alias;` called as `crate::alias()`,
// which has no module segment for any extractor to see. That last one left the guard 31/31 GREEN
// with a genuine self-deadlocking back edge present.
//
// Escalating to a real Rust parser does not fix it. `crate::alias()` PARSES perfectly, into two path
// segments; knowing that `alias` IS `comparison::report_tuning_crash` is NAME RESOLUTION, which
// `syn` does not do and `tree-sitter` does not do. And indexing re-exports would still leave
// macro-generated paths, trait-object dispatch, and function pointers stored in structs — three more
// ordinary shapes, and the pattern of those five reviews says a sixth reviewer finds the next one.
//
// So this checks the LOCK rather than the text that led to it. By the time a thread is asking for a
// second lock, the spelling no longer exists: there is only a thread holding one lock and acquiring
// another. Re-export, macro, trait object and function pointer collapse to that same observation.
//
// ## What it cannot do, stated plainly
//
// It observes only what the test suite EXECUTES. A cycle on a path no test drives is invisible to
// it, where the scanner looked at all reachable text. That is why the scanner is kept — narrowed to
// the claim a text scanner can actually support — rather than deleted. The two fail in opposite
// directions and neither subsumes the other.
//
// ## Why the record is taken BEFORE the lock
//
// `acquiring` pushes onto the thread-local stack and then the caller blocks. That ordering is the
// point: a re-entrant acquisition PANICS with a named message instead of hanging forever with no
// output, which is what `std::sync::Mutex` does. Recording after a successful `.lock()` would never
// run on the one case this exists to catch.
// ---------------------------------------------------------------------------------------------

/// Every process-wide **persistence** lock in the crate: each `static` mutex that serializes a
/// read-modify-write of state that reaches disk under the data root.
///
/// **That boundary is narrower than "every process-wide lock", and the narrowing is the point.**
/// The first version of this enum claimed to enumerate every process-wide store lock and did not —
/// `experiment::store_write_gate`, `intelligence::store_write_gate` and `benchmark::state_cache`
/// were all missing, and the Experiment gate is held across entries into `HISTORY_LOCK` from all
/// three lifecycle commands (`start_experiment`, `conclude_experiment`, `restore_experiment`). With
/// the outer lock unrecorded the recorder saw an empty stack
/// and could not have detected Experiment re-entry, an inverted `History -> Experiment` edge, or a
/// cycle through Experiment at all. A false "all locks" claim is worse than an honest partial one,
/// because it tells a reader not to look.
///
/// Locks deliberately OUT of class — in-memory caches, throttles, one-shot inits and session
/// markers that never write a store — are not listed here, but they are not merely unlisted either:
/// `scripts/store-lock-order-guard.test.mjs` carries a census of **every** `Mutex`/`RwLock` in
/// `src-tauri/src` with a per-lock verdict, and fails when a lock exists that the census does not
/// name or when the census names one that no longer exists. That tripwire is what stops the next
/// persistence lock from being added silently, which is exactly how these three were missed.
///
/// This is NOT a rank. The permitted nestings are the explicit pairs in [`ALLOWED_NESTING`]; there
/// is deliberately no total order, because a total order needs constraints between locks that have
/// never been nested and nothing could falsify those.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum StoreLock {
    /// `comparison::COMPARISON_LOCK` — the armed baseline and the surfaced result, one acquisition.
    Comparison,
    /// `drift::DRIFT_LOCK`.
    Drift,
    /// `readiness::DISMISSALS_LOCK`.
    Readiness,
    /// `incident_observer::STATE_LOCK`.
    IncidentObserver,
    /// `history::HISTORY_LOCK` — the Trust Ledger. Taken at eight sites, every one of them through
    /// `history::lock_history`, which propagates poison as an `Err` at all eight. One policy, not two.
    History,
    /// `support_evidence`'s `LOCK`. A leaf, and the innermost lock of THREE declared nestings, not
    /// one: `Comparison`, `History` and `Experiment` each reach it. `record` appends and
    /// `clear_support_evidence` deletes; neither takes another store lock, so every chain ends here.
    SupportEvidence,
    /// `benchmark_scoreboard::SCOREBOARD_LOCK`.
    BenchmarkScoreboard,
    /// `experiment::store_write_gate`'s `GATE` — the outermost lock this crate takes. Held across
    /// `history::apply_recommendation` and `history::rollback_change`, so it sits above `History`.
    Experiment,
    /// `intelligence::store_write_gate`'s `GATE` — guards `load_store` → `append_if_changed` →
    /// `save_store` on the identity log. A leaf: nothing inside reaches another store.
    Intelligence,
    /// `benchmark::state_cache`'s `CACHE`. In class, not out: it guards `BenchmarkState` in memory,
    /// but `set_baseline` and `clear_baseline` hold it **across `save_store`**, so a torn window
    /// here is a torn `benchmark.json`. All five acquisition sites are recorded, not just the two
    /// that persist — an unrecorded site of the same mutex would make re-entrancy detection unsound.
    Benchmark,
    /// Not real locks. Three synthetic ids, so the recorder's own behaviour can be pinned without
    /// borrowing a production lock's id.
    ///
    /// Three, not two, and never a production id: the recorder's tests need a two-deep chain, and
    /// the first version of them built it out of `Comparison -> SupportEvidence`. That MASKED the
    /// thing those tests exist to measure — deleting both production pairs from `ALLOWED_NESTING`
    /// reddened only these two tests, so the table looked exercised when no production nesting ran
    /// anywhere in the suite. A synthetic id may never appear in a production pair, and a production
    /// id may never appear in a recorder test, or the next such mutation lies the same way again.
    #[cfg(test)]
    TestOuter,
    #[cfg(test)]
    TestMiddle,
    #[cfg(test)]
    TestInner,
}

#[cfg(test)]
impl StoreLock {
    fn name(self) -> &'static str {
        match self {
            StoreLock::Comparison => "COMPARISON_LOCK",
            StoreLock::Drift => "DRIFT_LOCK",
            StoreLock::Readiness => "DISMISSALS_LOCK",
            StoreLock::IncidentObserver => "incident_observer::STATE_LOCK",
            StoreLock::History => "HISTORY_LOCK",
            StoreLock::SupportEvidence => "support_evidence::LOCK",
            StoreLock::BenchmarkScoreboard => "SCOREBOARD_LOCK",
            StoreLock::Experiment => "experiment::store_write_gate",
            StoreLock::Intelligence => "intelligence::store_write_gate",
            StoreLock::Benchmark => "benchmark::state_cache",
            StoreLock::TestOuter => "TEST_OUTER",
            StoreLock::TestMiddle => "TEST_MIDDLE",
            StoreLock::TestInner => "TEST_INNER",
        }
    }
}

/// The nestings this crate is KNOWN to perform, outer first. Anything else panics.
///
/// Each entry is here because the code does it, not because an ordering seemed sensible:
///
/// - `Comparison -> SupportEvidence` — `on_session_finalized_at` calls `history::ledger_len_checked`
///   while holding `COMPARISON_LOCK`; on the corrupt-ledger branch `load_history` calls
///   `support_evidence::record`, which takes that module's lock. This is the pair PR #395's review
///   derived by hand and then defended with a sentence nobody had checked.
/// - `History -> SupportEvidence` — `load_history` / `save_history` report a damaged or unwritable
///   ledger through `support_evidence::record`, and the eight `HISTORY_LOCK` sites hold the ledger
///   lock across those calls.
/// - `Experiment -> History` — the live one, and the one the first version of this table missed
///   entirely because the Experiment gate was not recorded. `start_experiment` holds
///   `experiment::store_write_gate` and calls `history::apply_recommendation` inside it;
///   `conclude_experiment` and `restore_experiment` hold it and call `history::rollback_change`.
///   Each of those enters `HISTORY_LOCK`. **Direction matters and is asserted, not assumed:** nothing in the
///   crate calls into `experiment` at all except `lib.rs` (its command registration, and the
///   launch-time `reconcile_interrupted_starts` in `.setup`, which holds no store lock), so no production
///   path takes `History` and then `Experiment` — which is why
///   `the_inverted_history_to_experiment_edge_is_undeclared_and_panics` can use that direction as a
///   live positive control.
/// - `Experiment -> SupportEvidence` — required by the all-held-lock rule, on two distinct real
///   paths. **Two-deep:** `apply_recommendation` and `rollback_change` call
///   `record_operation_failure` on their error branch, and that call happens after the inner
///   function has released `HISTORY_LOCK` but while `start_experiment` still holds the Experiment
///   gate; likewise `active_change_count`, `applied_changes_summary`, `comparison::arm_watermark`,
///   `ledger_len_checked`, the §3 one-change ledger reads in `start_experiment` and
///   `conclude_experiment`, and the read-only launch `reconcile_interrupted_starts`
///   (#583) each run `load_history` under the Experiment gate and
///   reach `support_evidence::record` on the corrupt-ledger branch. **Three-deep:** inside
///   `apply_recommendation_inner`, `HISTORY_LOCK` is held and `begin_mutation` → `load_history_for`
///   takes the same corrupt-ledger branch, so the thread holds `[Experiment, History]` and takes
///   `SupportEvidence`. Because every held lock is checked, that needs `Experiment -> SupportEvidence`
///   as well as the already-declared `History -> SupportEvidence`; omitting it would panic on a real
///   failure path in a release-shaped scenario the recorder is supposed to bless.
///
/// **An allowed pair claims the nesting is SAFE, not merely that it happens.** Safety here rests on
/// two facts, not on the ordering looking sensible. `support_evidence` is a leaf — `record` appends
/// and `clear_support_evidence` deletes, and neither reaches another store — so every `-> SupportEvidence`
/// pair terminates. And `Experiment` is a root: `lib.rs`'s command registration is the only caller
/// of the module, so no store lock is ever held when the Experiment gate is taken. A root, a middle
/// and a leaf cannot close a cycle. That property is asserted rather than assumed:
/// `declared_nestings_are_acyclic` fails if a future entry makes this graph cyclic, because a cycle
/// in THIS table would let a real deadlock through while the recorder stayed green.
///
/// A nesting missing from this table is a prompt to re-derive, which is why the panic names the pair
/// instead of suggesting the table be widened.
///
/// # Coverage — which entries this suite actually exercises
///
/// Read this before treating a green run as a proof. The four production entries do NOT have equal
/// standing.
///
/// **EXERCISED — `Experiment -> History` and `Experiment -> SupportEvidence`.**
/// `production_nesting_tests` drives the real acquisition helpers — `experiment::lock_store`,
/// `history::lock_history`, `support_evidence::lock_store` — in the real order, and each is the
/// exact function the shipping code paths call. Deleting either entry from this table turns a named
/// test red, and deleting the `acquiring` call inside `experiment::lock_store` turns a different
/// named test red without hanging. Those are the falsifications #398 asks for.
///
/// **What that pair of tests does NOT prove.** They prove the recorder blesses this order and
/// panics on the inverse; they do not prove that `start_experiment` really calls
/// `apply_recommendation`, because they call the lock helpers directly rather than the lifecycle
/// commands. That second half is a source fact, and it is checked as a source fact:
/// `scripts/store-lock-order-guard.test.mjs` slices the three `let _g = lock_store()?;` sections out
/// of `experiment.rs` and fails unless all three still reach `history::apply_recommendation` or
/// `history::rollback_change` inside the gate. It matches on structure, not on line numbers: a call
/// that MOVES inside its own section keeps it green, while a call that leaves the gate — or an
/// acquisition that bypasses `lock_store()` — turns it red. This file therefore cites functions, not
/// line numbers, which went stale as the lifecycle grew; the section shape is what is pinned.
/// Two bounded checks, each honest about its half; neither is upgraded into a claim about the whole.
///
/// **UNVERIFIED COVERAGE — `Comparison -> SupportEvidence` and `History -> SupportEvidence`.**
/// Unchanged from the previous candidate, and still not a passed guarantee. Both sit on failure
/// branches — a damaged ledger, a ledger that will not save — and nothing in the suite drives those
/// branches through a locked gateway. Deleting both still leaves the suite green.
///
/// They are not fixable from here without doing something worse. The one production entry point a
/// test could reach the branch through is `begin_mutation`, and in a `#[cfg(test)]` build
/// `data_root::mutation_root()` resolves to the machine's REAL `%APPDATA%\Compy` root, so reaching
/// it would mean corrupting the owner's actual ledger. Entering lower, at `load_history_for` with a
/// temp root, reaches the real `support_evidence::record`, which has no path seam and appends to the
/// real support store — a test would be writing "your ledger was unreadable" into the record support
/// reads to answer that exact question. Neither is worth a green tick. This is the same limitation
/// PR #400 reported, still true, still reported as UNVERIFIED rather than dressed up.
#[cfg(test)]
const ALLOWED_NESTING: &[(StoreLock, StoreLock)] = &[
    (StoreLock::Comparison, StoreLock::SupportEvidence),
    (StoreLock::History, StoreLock::SupportEvidence),
    (StoreLock::Experiment, StoreLock::History),
    (StoreLock::Experiment, StoreLock::SupportEvidence),
    // The recorder's own tests. Disjoint from every production id on purpose (see `TestOuter`), and
    // deliberately NOT transitively closed: `TestOuter -> TestInner` is absent even though
    // `TestOuter -> TestMiddle -> TestInner` is declared, which is what
    // `an_outer_lock_two_levels_up_is_still_checked` pins.
    (StoreLock::TestOuter, StoreLock::TestMiddle),
    (StoreLock::TestMiddle, StoreLock::TestInner),
];

// Locks this thread holds right now, outermost first. Thread-local, because a deadlock is: ONE
// thread, holding a lock, asking for another. (`//`, not `///`: rustdoc does not document a macro
// invocation, and `-D warnings` rejects a doc comment on one.)
#[cfg(test)]
thread_local! {
    static HELD: std::cell::RefCell<Vec<StoreLock>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// One recorded acquisition. Pops the thread-local stack on drop.
#[cfg(test)]
#[must_use = "the acquisition is recorded only while this guard is alive; bind it, e.g. `let _order = ...`"]
pub(crate) struct Acquisition {
    lock: StoreLock,
}

// There is deliberately no `#[cfg(not(test))]` twin of `Acquisition` or `acquiring`. There used to
// be — an empty struct and an `#[inline(always)]` no-op kept for signature parity — because
// `history.rs` open-coded `acquiring(..)` above a bare `.lock()` at eight sites. Every production
// acquisition now goes through `hold_lock`/`try_hold_lock` instead, whose release-build bodies do
// not mention the recorder at all, so both items became dead code that only `-D warnings` noticed.
// They are deleted rather than `#[allow(dead_code)]`-ed: a release build that cannot even NAME the
// recorder is a stronger statement of "no test instrumentation ships" than a comment claiming it.

/// Record that this thread is about to take `lock`. **Call before blocking on it**, never after.
///
/// Panics — rather than letting the process hang — when
///
/// - this thread already holds `lock` (`std::sync::Mutex` is not reentrant: the real build
///   deadlocks here), or
/// - some lock this thread holds has no declared nesting to `lock` in [`ALLOWED_NESTING`].
///
/// Every held lock is checked, not only the innermost: holding A and B and taking C risks a cycle
/// through either, so both `A -> C` and `B -> C` must be declared.
#[cfg(test)]
pub(crate) fn acquiring(lock: StoreLock) -> Acquisition {
    HELD.with(|cell| {
        let mut held = cell.borrow_mut();
        let trail = held.iter().map(|l| l.name()).collect::<Vec<_>>().join(" -> ");
        if held.contains(&lock) {
            panic!(
                "lock-order: RE-ENTRANT acquisition of {} — this thread already holds it, and \
                 std::sync::Mutex is not reentrant, so the release build DEADLOCKS here with no \
                 output at all. Held, outermost first: [{}] -> {}",
                lock.name(),
                trail,
                lock.name(),
            );
        }
        if let Some(outer) = held.iter().find(|o| !ALLOWED_NESTING.contains(&(**o, lock))) {
            panic!(
                "lock-order: UNDECLARED nesting {} -> {} — that pair is not in \
                 race_seam::ALLOWED_NESTING. Re-derive whether it can close a cycle before adding \
                 it; a pair added to silence this message is a deadlock the recorder will not \
                 report. Held, outermost first: [{}] -> {}",
                outer.name(),
                lock.name(),
                trail,
                lock.name(),
            );
        }
        held.push(lock);
    });
    Acquisition { lock }
}

#[cfg(test)]
impl Drop for Acquisition {
    fn drop(&mut self) {
        HELD.with(|cell| {
            let popped = cell.borrow_mut().pop();
            // Never panic while already unwinding — that aborts the process and destroys the real
            // failure's message. A deliberate `#[should_panic]` test unwinds through here.
            if popped != Some(self.lock) && !std::thread::panicking() {
                panic!(
                    "lock-order: released {} but the innermost recorded acquisition was {:?} — an \
                     Acquisition outlived its lock guard, or was moved out of scope",
                    self.lock.name(),
                    popped.map(|l| l.name()),
                );
            }
        });
    }
}

/// A recorded acquisition **and** the mutex guard it stands for, in one value.
///
/// The field order is load-bearing: Rust drops struct fields in declaration order, so `guard`
/// releases the mutex and only then does `order` leave the thread-local stack. The reverse would
/// leave a window in which the lock is held but no longer recorded.
/// Generic over the guarded value, defaulting to `()`. Most store locks guard nothing but the right
/// to run a critical section, but `benchmark::state_cache` guards real state, and it has to go
/// through the same recorded path as every other persistence lock — a lock with one recorded and
/// four unrecorded acquisition sites cannot detect its own re-entrancy.
#[cfg(test)]
pub(crate) struct StoreGuard<T: 'static = ()> {
    #[allow(dead_code)]
    guard: std::sync::MutexGuard<'static, T>,
    #[allow(dead_code)]
    order: Acquisition,
}

#[cfg(not(test))]
pub(crate) struct StoreGuard<T: 'static = ()> {
    #[allow(dead_code)]
    guard: std::sync::MutexGuard<'static, T>,
}

// `Deref`/`DerefMut` so a caller reads and writes the guarded value exactly as it did through the
// bare `MutexGuard`, and the swap to a recorded guard is a type change with no behaviour change.
#[cfg(test)]
impl<T: 'static> std::ops::Deref for StoreGuard<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.guard
    }
}

#[cfg(test)]
impl<T: 'static> std::ops::DerefMut for StoreGuard<T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.guard
    }
}

#[cfg(not(test))]
impl<T: 'static> std::ops::Deref for StoreGuard<T> {
    type Target = T;
    #[inline(always)]
    fn deref(&self) -> &T {
        &self.guard
    }
}

#[cfg(not(test))]
impl<T: 'static> std::ops::DerefMut for StoreGuard<T> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.guard
    }
}

/// Record, then acquire, then bundle the two so they are released together.
///
/// `acquire` is a closure rather than an already-taken guard for the reason in the module note
/// above: the record has to exist BEFORE the caller blocks, or a self-deadlock hangs instead of
/// panicking.
#[cfg(test)]
pub(crate) fn hold_lock<T: 'static>(
    lock: StoreLock,
    acquire: impl FnOnce() -> std::sync::MutexGuard<'static, T>,
) -> StoreGuard<T> {
    let order = acquiring(lock);
    StoreGuard { guard: acquire(), order }
}

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn hold_lock<T: 'static>(
    _lock: StoreLock,
    acquire: impl FnOnce() -> std::sync::MutexGuard<'static, T>,
) -> StoreGuard<T> {
    StoreGuard { guard: acquire() }
}

/// [`hold_lock`] for the modules whose poison policy is to REFUSE rather than recover.
///
/// `history`, `experiment`, `intelligence` and `benchmark` all propagate a poisoned lock instead of
/// clearing it, so their acquisition is fallible and cannot use `hold_lock`'s infallible closure.
/// Before this existed those sites open-coded `acquiring(...)` plus a bare `.lock()`, which is how
/// `experiment` came to have three acquisition sites and zero records: nothing tied the two lines
/// together. Here the record and the guard are one value, and a site that forgets the record does
/// not type-check.
///
/// The record is taken **before** `acquire` runs and dropped with the guard on the error path, so a
/// refused acquisition leaves the thread-local stack exactly as it found it.
#[cfg(test)]
pub(crate) fn try_hold_lock<T: 'static, E>(
    lock: StoreLock,
    acquire: impl FnOnce() -> Result<std::sync::MutexGuard<'static, T>, E>,
) -> Result<StoreGuard<T>, E> {
    let order = acquiring(lock);
    Ok(StoreGuard { guard: acquire()?, order })
}

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn try_hold_lock<T: 'static, E>(
    _lock: StoreLock,
    acquire: impl FnOnce() -> Result<std::sync::MutexGuard<'static, T>, E>,
) -> Result<StoreGuard<T>, E> {
    Ok(StoreGuard { guard: acquire()? })
}

/// What this thread holds, for the recorder's own tests. Not a production surface.
#[cfg(test)]
pub(crate) fn held_now() -> Vec<StoreLock> {
    HELD.with(|cell| cell.borrow().clone())
}

/// The production nestings, driven through the shipping lock helpers.
///
/// # What these tests are, and what they are not
///
/// Every acquisition below goes through the exact function the shipping code calls —
/// `experiment::lock_store`, `history::lock_history`, `support_evidence::lock_store`. None of them
/// is reimplemented here, because a lookalike passes while the real path is broken; that is the
/// failure #395's review caught in a different guard and it is not worth repeating.
///
/// They do NOT drive `start_experiment`/`conclude_experiment`/`restore_experiment`, and the reason
/// is a hard constraint rather than a shortcut. In a `#[cfg(test)]` build
/// `data_root::mutation_root()` resolves to the machine's REAL `%APPDATA%\Compy` root; every one of
/// those commands enters `history::apply_recommendation` or `history::rollback_change`, which read
/// the owner's real ledger, mutate real Windows state on the success branch, and call
/// `record_operation_failure` — a real write to the real support store — on the failure branch.
/// There is no seam that lets a test walk that call chain without touching the owner's data, and
/// manufacturing one would be a larger and riskier change to the mutation boundary than #398 is
/// allowed to make.
///
/// So the claim is split in two, each half checked by something that can actually fail:
///
/// - **"these locks may be nested in this order, and the reverse panics"** — here, on the real
///   locks, hermetically. Taking a mutex writes nothing.
/// - **"production really nests them in this order"** — a source fact, checked as a source fact by
///   `scripts/store-lock-order-guard.test.mjs`, which pins the three call sites in `experiment.rs`
///   that enter `history` under the gate and fails when one moves or disappears.
///
/// Neither half is presented as the whole. That is the honest shape of what is measurable here.
#[cfg(test)]
mod production_nesting_tests {
    use super::*;

    /// `Experiment -> History`, the live nesting the previous candidate could not see at all.
    ///
    /// Falsifies the `(Experiment, History)` entry: delete it from `ALLOWED_NESTING` and the
    /// recorder panics `UNDECLARED nesting experiment::store_write_gate -> HISTORY_LOCK` here.
    #[test]
    fn the_experiment_gate_may_be_held_while_entering_the_trust_ledger() {
        let _experiment = crate::experiment::lock_store().expect("experiment gate");
        assert_eq!(held_now(), vec![StoreLock::Experiment]);
        let _history = crate::history::lock_history().expect("history lock");
        assert_eq!(held_now(), vec![StoreLock::Experiment, StoreLock::History]);
    }

    /// `[Experiment, History] -> SupportEvidence`, the three-deep chain a corrupt ledger produces
    /// inside `apply_recommendation_inner`.
    ///
    /// Falsifies the `(Experiment, SupportEvidence)` entry specifically. `History -> SupportEvidence`
    /// was already declared, so before this pair existed the all-held-lock rule would have panicked
    /// on the OUTER lock — which is the whole point of checking every held lock rather than the
    /// innermost one.
    #[test]
    fn a_damaged_ledger_may_report_itself_from_under_both_outer_locks() {
        let _experiment = crate::experiment::lock_store().expect("experiment gate");
        let _history = crate::history::lock_history().expect("history lock");
        let _support = crate::support_evidence::lock_store();
        assert_eq!(
            held_now(),
            vec![StoreLock::Experiment, StoreLock::History, StoreLock::SupportEvidence]
        );
    }

    // ── The two rejection tests, and why their OUTER hold is a bare record ──
    //
    // Both of the tests below expect a panic, and in both the lock under test is the real
    // `experiment::lock_store`. What their outer hold must NOT be is a real mutex guard.
    //
    // Panicking with a `MutexGuard` alive POISONS that mutex for the whole process, and `cargo
    // test` runs every test in one process. The first version of these two tests held
    // `HISTORY_LOCK` and the experiment gate for real, and the measured result was three unrelated
    // failures — `history::leftover_restore_tests` twice and the green nesting test above — all
    // reporting a poisoned lock they never touched. `history` and `experiment` both REFUSE on
    // poison by design and this lane does not change that policy, so the poison is permanent for
    // the run.
    //
    // The record is the thing under test in both cases: the recorder decides from the thread-local
    // stack, and it decides BEFORE the inner mutex is taken. So the outer hold is
    // `acquiring(...)` — the same function the production helper calls, one layer down, holding no
    // mutex — and the inner acquisition stays the real shipping helper. The panic then fires with
    // nothing locked, and no test that did not opt in pays for it.

    /// The inverse edge, as a live positive control on the RECORD itself.
    ///
    /// This is the test that falsifies `acquiring(StoreLock::Experiment)` inside
    /// `experiment::lock_store`: remove that call and the helper takes its mutex silently, no panic
    /// happens, and this `#[should_panic]` test goes RED. It cannot hang — the recorder reports the
    /// undeclared direction before anything blocks.
    ///
    /// `History -> Experiment` is genuinely undeclared, not merely omitted: `lib.rs`'s command
    /// registration is the only thing in the crate that calls into `experiment` at all, so no
    /// production path can hold the ledger lock and then take the experiment gate.
    #[test]
    #[should_panic(expected = "UNDECLARED nesting HISTORY_LOCK -> experiment::store_write_gate")]
    fn the_ledger_may_not_be_held_while_taking_the_experiment_gate() {
        let _history = acquiring(StoreLock::History);
        let _experiment = crate::experiment::lock_store().expect("experiment gate");
    }

    /// Re-entering the experiment gate panics by name instead of deadlocking — the exact hazard
    /// HQ's review named as undetectable while this gate was unrecorded.
    ///
    /// Also a second falsification of the record: the re-entrancy check reads the thread-local
    /// stack, so it fires only if `experiment::lock_store` puts `Experiment` on it. Remove that and
    /// the helper simply takes its mutex and this test goes RED rather than hanging, because the
    /// outer hold is a record and not the mutex itself.
    #[test]
    #[should_panic(expected = "RE-ENTRANT acquisition of experiment::store_write_gate")]
    fn the_experiment_gate_is_not_reentrant() {
        let _first = acquiring(StoreLock::Experiment);
        let _second = crate::experiment::lock_store();
    }

    /// `intelligence::store_write_gate` is a leaf: it may be entered with nothing held, and nothing
    /// inside it reaches another store. A negative control for the falsification matrix — it must
    /// stay GREEN while the deliberate breakages above go red, or the matrix is measuring the suite
    /// rather than the change.
    ///
    /// **`benchmark::state_cache` is deliberately NOT driven here, and that is a real gap, not an
    /// oversight.** Its `OnceLock` hydrates from `load_store()` on first access, which calls
    /// `compy_data_dir()`, which in turn can run `migrate_legacy_data_once` — a recursive COPY of
    /// the owner's entire pre-rename `%APPDATA%\Sentinel` into `%APPDATA%\Compy`. Taking that lock
    /// from a test would reach into the owner's real data to manufacture a green tick, which is
    /// exactly what this lane is forbidden to do. The lock IS instrumented at all five sites and the
    /// census in `scripts/store-lock-order-guard.test.mjs` fails if a sixth appears unrecorded; what
    /// is NOT proven at runtime is that those records fire. Recorded as UNVERIFIED COVERAGE.
    #[test]
    fn the_intelligence_gate_is_a_leaf_taken_alone() {
        {
            let _i = crate::intelligence::lock_store().expect("intelligence gate");
            assert_eq!(held_now(), vec![StoreLock::Intelligence]);
        }
        assert!(held_now().is_empty(), "the stack must unwind exactly");
    }
}

#[cfg(test)]
mod recorder_tests {
    use super::*;

    /// The table claims these nestings cannot close a cycle. A cycle IN THE TABLE would let a real
    /// deadlock through green, so the claim is checked rather than trusted — this is the acyclicity
    /// argument PR #395 defended with an unchecked sentence, moved onto data.
    #[test]
    fn declared_nestings_are_acyclic() {
        let mut reach: Vec<(StoreLock, StoreLock)> = ALLOWED_NESTING.to_vec();
        loop {
            let mut added = false;
            for &(a, b) in &reach.clone() {
                for &(c, d) in ALLOWED_NESTING {
                    if b == c && !reach.contains(&(a, d)) {
                        reach.push((a, d));
                        added = true;
                    }
                }
            }
            if !added {
                break;
            }
        }
        for &(a, b) in &reach {
            assert!(
                a != b,
                "ALLOWED_NESTING is cyclic through {a:?}: a cycle here means two threads can take \
                 the same pair in opposite orders with this recorder staying green"
            );
        }
    }

    #[test]
    fn a_declared_nesting_is_allowed() {
        let _outer = acquiring(StoreLock::TestOuter);
        let _inner = acquiring(StoreLock::TestMiddle);
        assert_eq!(held_now(), vec![StoreLock::TestOuter, StoreLock::TestMiddle]);
    }

    #[test]
    #[should_panic(expected = "RE-ENTRANT acquisition of TEST_OUTER")]
    fn a_reentrant_acquisition_panics_instead_of_deadlocking() {
        let _outer = acquiring(StoreLock::TestOuter);
        let _again = acquiring(StoreLock::TestOuter);
    }

    #[test]
    #[should_panic(expected = "UNDECLARED nesting TEST_MIDDLE -> TEST_OUTER")]
    fn the_inverse_of_a_declared_nesting_panics() {
        let _inner = acquiring(StoreLock::TestMiddle);
        let _outer = acquiring(StoreLock::TestOuter);
    }

    #[test]
    #[should_panic(expected = "UNDECLARED nesting TEST_OUTER -> TEST_INNER")]
    fn a_nesting_nobody_declared_panics_even_in_a_plausible_direction() {
        let _outer = acquiring(StoreLock::TestOuter);
        // Outermost-to-innermost by name, and reachable through TestMiddle, so this is exactly the
        // shape a reader assumes is fine. The table is a whitelist of pairs the code is known to
        // take, not a rank order, so reachability is not permission.
        let _other = acquiring(StoreLock::TestInner);
    }

    /// The check runs against EVERY held lock, not only the innermost. Without that, `A -> B` and
    /// `B -> C` declared would silently permit A being held across C.
    #[test]
    #[should_panic(expected = "UNDECLARED nesting TEST_OUTER -> TEST_INNER")]
    fn an_outer_lock_two_levels_up_is_still_checked() {
        let _outermost = acquiring(StoreLock::TestOuter);
        let _middle = acquiring(StoreLock::TestMiddle);
        // TestMiddle -> TestInner is declared and TestMiddle is the innermost held lock, so a check
        // against only the innermost would pass this. TestOuter -> TestInner is not declared.
        let _inner = acquiring(StoreLock::TestInner);
    }

    /// Sequential acquisitions are not nestings. Without this the recorder would forbid a thread
    /// from touching two stores in one command, which is ordinary and safe.
    #[test]
    fn releasing_before_taking_the_next_is_not_a_nesting_in_either_direction() {
        {
            let _a = acquiring(StoreLock::TestInner);
        }
        {
            let _b = acquiring(StoreLock::TestOuter);
        }
        {
            let _c = acquiring(StoreLock::TestMiddle);
        }
        assert!(held_now().is_empty(), "every acquisition popped on drop");
    }

    /// A violation unwinds through the outer guards' `Drop`. If that path re-panicked the process
    /// would abort and the real message would be lost — so the caught payload must be the violation,
    /// not a release complaint, and the stack must come back empty.
    #[test]
    fn a_violation_unwinds_cleanly_and_leaves_no_residue() {
        let caught = std::panic::catch_unwind(|| {
            let _outer = acquiring(StoreLock::TestOuter);
            let _bad = acquiring(StoreLock::TestOuter);
        })
        .unwrap_err();
        let msg = caught.downcast_ref::<String>().map(String::as_str).unwrap_or("");
        assert!(
            msg.contains("RE-ENTRANT acquisition of TEST_OUTER"),
            "the surfacing panic must be the violation, not a Drop complaint: {msg}"
        );
        assert!(
            held_now().is_empty(),
            "a violation must not leave this thread's stack dirty for the next test on it"
        );
    }

    /// A deadlock is per-thread. Two threads each holding one lock is normal, and flagging it would
    /// make the recorder useless the first time a command ran concurrently with a scan.
    #[test]
    fn another_thread_holding_the_same_lock_is_not_a_violation() {
        let _mine = acquiring(StoreLock::TestOuter);
        std::thread::spawn(|| {
            let _theirs = acquiring(StoreLock::TestOuter);
            assert_eq!(held_now(), vec![StoreLock::TestOuter]);
        })
        .join()
        .expect("a second thread's stack is its own");
    }

    /// The panic must name the CHAIN, not just the pair — that is what makes it actionable when the
    /// back edge is three modules away from the lock that took it.
    #[test]
    fn the_message_reports_the_whole_held_chain() {
        let caught = std::panic::catch_unwind(|| {
            let _a = acquiring(StoreLock::TestOuter);
            let _b = acquiring(StoreLock::TestMiddle);
            let _c = acquiring(StoreLock::TestOuter);
        })
        .unwrap_err();
        let msg = caught.downcast_ref::<String>().map(String::as_str).unwrap_or("");
        assert!(
            msg.contains("[TEST_OUTER -> TEST_MIDDLE] -> TEST_OUTER"),
            "the held chain belongs in the message: {msg}"
        );
    }
}
