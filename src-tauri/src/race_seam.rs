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

/// Every process-wide store lock in the crate. Kept as one enum so a lock added without an entry
/// here is a visible gap rather than a silent hole.
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
    /// `history::HISTORY_LOCK` — the Trust Ledger. Taken inline at eight sites, two poison policies.
    History,
    /// `support_evidence`'s `LOCK`. The innermost lock in the only nesting this crate performs.
    SupportEvidence,
    /// `benchmark_scoreboard::SCOREBOARD_LOCK`.
    BenchmarkScoreboard,
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
///
/// **An allowed pair claims the nesting is SAFE, not merely that it happens.** It is safe here for
/// one reason: `support_evidence` is a leaf — `record` appends and `clear_support_evidence` deletes,
/// and neither reaches another store — so these pairs cannot close a cycle. That property is
/// asserted rather than assumed: `declared_nestings_are_acyclic` fails if a future entry makes this
/// graph cyclic, because a cycle in THIS table would let a real deadlock through while the recorder
/// stayed green.
///
/// A nesting missing from this table is a prompt to re-derive, which is why the panic names the pair
/// instead of suggesting the table be widened.
///
/// **Neither production pair is exercised by any test in this suite, and this table is therefore
/// unverified against the running code.** Re-measured on this tree (not inherited from PR #400's,
/// which was several dozen commits behind): instrumenting `acquiring` to log every nesting and
/// running the whole suite single-threaded produced exactly nine nested acquisitions, all nine from
/// `recorder_tests`; and deleting both production pairs from this table leaves the suite at 1312
/// passed / 0 failed. Both pairs sit on failure branches — a damaged ledger, a ledger that will not
/// save — and nothing drives those branches through a locked gateway.
///
/// It is not fixable from here without doing something worse. The one production entry point a test
/// could reach the branch through is `begin_mutation`, and in a `#[cfg(test)]` build
/// `data_root::mutation_root()` resolves to the machine's REAL `%APPDATA%\Compy` root, so reaching
/// it would mean corrupting the owner's actual ledger. Entering lower, at `load_history_for` with a
/// temp root, reaches the real `support_evidence::record`, which has no path seam and appends to the
/// real support store — a test would be writing "your ledger was unreadable" into the record support
/// reads to answer that exact question. Neither is worth a green tick.
///
/// So what this recorder is proven to do is catch a nesting WHEN ONE HAPPENS, which the falsification
/// matrix on #398 demonstrates against a real back edge. What it does not do is confirm these two
/// entries, and no reader should take the suite passing as evidence that it has.
#[cfg(test)]
const ALLOWED_NESTING: &[(StoreLock, StoreLock)] = &[
    (StoreLock::Comparison, StoreLock::SupportEvidence),
    (StoreLock::History, StoreLock::SupportEvidence),
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

/// The same type in a release build: an empty struct with no `Drop`. The thread-local, the table and
/// the checks do not exist there at all.
#[cfg(not(test))]
#[must_use = "kept for signature parity with the test build; bind it, e.g. `let _order = ...`"]
pub(crate) struct Acquisition;

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

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn acquiring(_lock: StoreLock) -> Acquisition {
    Acquisition
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
#[cfg(test)]
pub(crate) struct StoreGuard {
    #[allow(dead_code)]
    guard: std::sync::MutexGuard<'static, ()>,
    #[allow(dead_code)]
    order: Acquisition,
}

#[cfg(not(test))]
pub(crate) struct StoreGuard {
    #[allow(dead_code)]
    guard: std::sync::MutexGuard<'static, ()>,
}

/// Record, then acquire, then bundle the two so they are released together.
///
/// `acquire` is a closure rather than an already-taken guard for the reason in the module note
/// above: the record has to exist BEFORE the caller blocks, or a self-deadlock hangs instead of
/// panicking.
#[cfg(test)]
pub(crate) fn hold_lock(
    lock: StoreLock,
    acquire: impl FnOnce() -> std::sync::MutexGuard<'static, ()>,
) -> StoreGuard {
    let order = acquiring(lock);
    StoreGuard { guard: acquire(), order }
}

#[cfg(not(test))]
#[inline(always)]
pub(crate) fn hold_lock(
    _lock: StoreLock,
    acquire: impl FnOnce() -> std::sync::MutexGuard<'static, ()>,
) -> StoreGuard {
    StoreGuard { guard: acquire() }
}

/// What this thread holds, for the recorder's own tests. Not a production surface.
#[cfg(test)]
pub(crate) fn held_now() -> Vec<StoreLock> {
    HELD.with(|cell| cell.borrow().clone())
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
