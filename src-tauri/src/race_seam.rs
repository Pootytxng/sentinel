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

#[cfg(test)]
impl Widened {
    pub(crate) fn arm() -> Self {
        // Recover a poisoned gate rather than panicking: a test that failed while armed must not
        // take every other seam test down with it — they would then fail for the wrong reason.
        let gate = GATE.lock().unwrap_or_else(|poisoned| {
            GATE.clear_poison();
            poisoned.into_inner()
        });
        WIDENED.store(true, std::sync::atomic::Ordering::Release);
        Widened(gate)
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
