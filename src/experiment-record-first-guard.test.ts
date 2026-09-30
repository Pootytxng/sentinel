import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// EXPERIMENT RECORD-FIRST GUARD (Trial Protocol v1, #583 lane 1, 2026-09-28).
//
// WHY THIS EXISTS — `start_experiment` used to apply the Windows change FIRST and write the experiment
// record AFTER. A crash, kill or failed save between the two left a real change on the machine that
// no experiment owned: the bench showed nothing, the change looked like an ordinary Fix apply, and
// nothing ever asked the user whether to keep it. The Rust unit tests prove the pure reconcile; they
// cannot prove the ORDER inside the command, because the apply is a real Windows mutation. So the
// order is pinned here as source text:
//
//   1. the backend refuses a second start while one is starting or running (§3, one causal question);
//   2. a Pending record is SAVED before `apply_recommendation` runs (record first), and the applied
//      change's id is saved before any later step can fail, so a reconcile matches it by id;
//   3. the app resolves interrupted starts at launch, before the first window reads the store;
//   4. the UI never receives a Pending record.
//
// A source check is a change detector, not a proof. If a refactor moves this logic, move the anchors
// with it — never delete an assertion to get green.

const EXPERIMENT = readFileSync(join("src-tauri", "src", "experiment.rs"), "utf8");
const LIB = readFileSync(join("src-tauri", "src", "lib.rs"), "utf8");

/** The body of `fn name(` up to the next top-level `fn` or `#[` attribute at column 0. */
function fnBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(?:pub(?:\(crate\))? )?fn |\n#\[|\n\/\/\/ /);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("experiment start is record-first and single-active (#583)", () => {
  const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");

  it("resolves a stale Pending, then refuses a second start, before touching anything", () => {
    const resolve = start.indexOf("reconcile_pending_locked(&mut store)?");
    const refuse = start.indexOf("active_trial(&store)");
    expect(resolve, "start no longer resolves an interrupted start under its lock").toBeGreaterThanOrEqual(0);
    expect(refuse, "single-active refusal is gone").toBeGreaterThan(resolve);
    expect(refuse).toBeLessThan(start.indexOf("apply_recommendation("));
  });

  it("names the applied change on disk before any later step can fail", () => {
    const named = start.indexOf("applied_change_id = applied.id()");
    const save = start.indexOf("save_store(&store)", named);
    expect(named, "the start no longer records its change id").toBeGreaterThanOrEqual(0);
    expect(save, "no save between naming the change and the next step").toBeGreaterThan(named);
    expect(save).toBeLessThan(start.indexOf("target_verification("));
    expect(save).toBeLessThan(start.indexOf("arm_watermark()"));
  });

  it("saves a Pending record before the apply", () => {
    const pending = start.indexOf("status: ExperimentStatus::Pending");
    const firstSave = start.indexOf("save_store(&store)?");
    const apply = start.indexOf("apply_recommendation(");
    expect(pending, "the start no longer writes a Pending record").toBeGreaterThanOrEqual(0);
    expect(firstSave, "the pre-apply save is gone").toBeGreaterThan(pending);
    expect(apply, "apply_recommendation moved out of start_experiment").toBeGreaterThan(firstSave);
  });

  it("promotes to Running only after the apply and the watermark", () => {
    const running = start.indexOf("ExperimentStatus::Running");
    expect(running).toBeGreaterThan(start.indexOf("apply_recommendation("));
    expect(running).toBeGreaterThan(start.indexOf("arm_watermark()"));
  });

  it("restores through the audited boundary when the start fails after the apply", () => {
    expect(start).toContain("abort_start(");
    const abort = fnBody(EXPERIMENT, "fn abort_start(");
    expect(abort).toContain("crate::history::rollback_change(");
  });
});

// LANE 2 (§4.1 / §4.5 / §4.10): a Trial reads the setting before it changes anything, requires the
// target to read as changed after the apply, and reads it back after every keep or restore. The pure
// decisions are Rust-tested; the READS happen against the live machine, so where they sit is pinned
// here.
const HISTORY = readFileSync(join("src-tauri", "src", "history.rs"), "utf8");
const PROBE = "crate::history::probe_rec_target(";

describe("a Trial verifies the setting before, during and after (#583 lane 2)", () => {
  const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");

  it("§4.1: reads the setting before anything is recorded or applied", () => {
    const gate = start.indexOf(`pre_apply_refusal(${PROBE}`);
    expect(gate, "the pre-apply read is gone").toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(start.indexOf("active_trial(&store)"));
    expect(gate).toBeLessThan(start.indexOf("status: ExperimentStatus::Pending"));
    expect(gate).toBeLessThan(start.indexOf("apply_recommendation("));
    expect(start).toContain("prior_state_verified: true");
  });

  it("§4.5: an unread target aborts the start just like an unchanged one", () => {
    const check = start.slice(start.indexOf("target_verification("));
    expect(check).toMatch(/Some\(false\) => \{\s*return Err\(abort_start\(/);
    expect(check).toMatch(/None => \{\s*return Err\(abort_start\(/);
  });

  it("§7 at conclude: the target is read before the keep/restore decision and can overrule it", () => {
    const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");
    const read = conclude.indexOf(PROBE);
    const guard = conclude.indexOf("guard_target_at_conclude(");
    expect(read, "conclude no longer reads the target").toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(read);
    // It wraps whatever was judged (a measured reading or a crash), after the judging and before
    // the keep/restore decision.
    expect(conclude, "the target check no longer wraps every judged outcome").toMatch(
      /let outcome = guard_target_at_conclude\(judged,/,
    );
    expect(guard).toBeGreaterThan(conclude.indexOf("conclude_outcome("));
    expect(guard).toBeLessThan(conclude.indexOf("if outcome.keep"));
  });

  it("§4.10: every restore path reads the setting back after the rollback", () => {
    for (const sig of ["fn abort_start(", "pub(crate) fn conclude_experiment(", "pub(crate) fn restore_experiment("]) {
      const body = fnBody(EXPERIMENT, sig);
      const rollback = body.indexOf("crate::history::rollback_change(");
      const settle = body.indexOf("settle_restore(");
      expect(rollback, `${sig} no longer restores`).toBeGreaterThanOrEqual(0);
      expect(settle, `${sig} no longer reads the setting back after its restore`).toBeGreaterThan(rollback);
    }
  });

  it("every one-click rec has a live probe, so no appliable rec is refused as unreadable by design", () => {
    const ids = (body: string) => [...body.matchAll(/^\s*"([a-z0-9-]+)" =>/gm)].map((m) => m[1]).sort();
    const appliable = ids(fnBody(HISTORY, "fn apply_fn_for("));
    const probed = ids(fnBody(HISTORY, "pub(crate) fn probe_rec_target("));
    expect(appliable.length, "the apply dispatch moved").toBeGreaterThan(0);
    expect(probed).toEqual(appliable);
  });

  it("the probe is read-only", () => {
    const probe = fnBody(HISTORY, "pub(crate) fn probe_rec_target(");
    expect(probe).not.toMatch(/apply_|rollback_|actions::|save_history/);
  });
});

describe("interrupted starts are resolved at launch, read-only (#583)", () => {
  it("lib.rs setup calls the reconcile", () => {
    expect(LIB).toMatch(/crate::experiment::reconcile_interrupted_starts\(\)/);
  });

  it("the launch reconcile never mutates Windows", () => {
    const reconcile = fnBody(EXPERIMENT, "pub(crate) fn reconcile_interrupted_starts(");
    const locked = fnBody(EXPERIMENT, "fn reconcile_pending_locked(");
    const pure = fnBody(EXPERIMENT, "pub(crate) fn reconcile_interrupted_starts_in(");
    expect(reconcile).toContain("reconcile_pending_locked(");
    for (const body of [reconcile, locked, pure]) {
      expect(body).not.toMatch(/rollback_change|apply_recommendation|actions::/);
    }
  });

  it("the UI never receives a Pending record", () => {
    const list = fnBody(EXPERIMENT, "pub(crate) fn get_experiments(");
    expect(list).toMatch(/\.filter\([^)]*!= ExperimentStatus::Pending/);
  });
});

// LANE 2b (§4.2 / §4.6 / §11): the baseline and the treatment are Compy's own session records, looked
// up by id. The command signatures carry no frame rate, sample count or game from the webview, and a
// pair that can't be looked up or compared is refused before anything is recorded, judged or restored.
describe("a Trial's evidence comes from Compy's own session store (#583 lane 2b)", () => {
  const signature = (sig: string) => {
    const at = EXPERIMENT.indexOf(sig);
    expect(at, `${sig} is missing`).toBeGreaterThanOrEqual(0);
    return EXPERIMENT.slice(at, EXPERIMENT.indexOf(") -> Result<", at));
  };

  it("start and conclude take session ids, never numbers the webview measured", () => {
    for (const sig of ["pub(crate) fn start_experiment(", "pub(crate) fn conclude_experiment("]) {
      const params = signature(sig);
      expect(params, `${sig} takes a frame rate, sample count or game again`).not.toMatch(
        /fps|samples|game\s*:|f64|u32/,
      );
    }
    expect(signature("pub(crate) fn start_experiment(")).toMatch(/baseline_session_id: String/);
    expect(signature("pub(crate) fn conclude_experiment(")).toMatch(/treatment_session_id: String/);
  });

  it("§4.2: the baseline is resolved before anything is recorded or applied", () => {
    const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");
    const resolve = start.indexOf("resolve_baseline(&sessions, &baseline_session_id)");
    expect(resolve, "the start no longer resolves its baseline by id").toBeGreaterThanOrEqual(0);
    expect(start.indexOf("crate::sessions::get_session_summaries()")).toBeLessThan(resolve);
    expect(resolve).toBeLessThan(start.indexOf("status: ExperimentStatus::Pending"));
    expect(resolve).toBeLessThan(start.indexOf("apply_recommendation("));
    expect(start).toMatch(/baseline_low1_fps: baseline\.low1_fps_est/);
    expect(start).toMatch(/game: baseline\.process_name/);
  });

  it("§4.6: the treatment is resolved and compared before anything is judged, recorded or restored", () => {
    const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");
    const resolve = conclude.indexOf("resolve_treatment(");
    expect(resolve, "the conclude no longer resolves its treatment by id").toBeGreaterThanOrEqual(0);
    // A refusal returns before anything is judged, recorded or restored, except after a reported
    // crash: that always restores, even when its session can't be used.
    expect(conclude, "a refused treatment no longer returns early, or a crash no longer overrides it").toMatch(
      /crash_overrides_refusal\(\s*resolve_treatment\([\s\S]*?\),\s*crashed,?\s*\)\s*\.map_err\([\s\S]*?\)\?;/,
    );
    expect(conclude, "a crash whose session can't be used no longer restores").toMatch(
      /None => crash_outcome\(rec\.applied_at\.as_deref\(\), baseline, treatment\)/,
    );
    for (const later of ["conclude_outcome(", ".treatment = resolved", "crate::history::rollback_change(", "save_store("]) {
      expect(conclude.indexOf(later), `${later} moved ahead of the treatment check`).toBeGreaterThan(resolve);
    }
    expect(conclude).toMatch(/with_comparability\(/);
  });

  // A changed condition is not a wrong pick: no later session undoes a driver or Windows update, so
  // refusing it would leave the Trial stuck. It aborts and restores (§7), ahead of any verdict.
  it("the pairing reuses comparability.rs; a changed condition aborts and restores ahead of any verdict", () => {
    const resolve = fnBody(EXPERIMENT, "pub(crate) fn resolve_treatment<");
    expect(resolve).toContain("crate::comparability::derive(baseline, treatment)");
    expect(resolve).toMatch(/Comparability::NotComparable => \{\s*return Err/);
    expect(resolve).toMatch(/Comparability::Unknown => \{\s*return Err/);
    const fold = fnBody(EXPERIMENT, "pub(crate) fn with_comparability(");
    const changed = fold.indexOf("if !pairing.changed_context.is_empty() {");
    const rest = fold.indexOf("let confidence =");
    expect(changed, "a changed condition no longer aborts the Trial").toBeGreaterThanOrEqual(0);
    expect(changed, "something is judged before a changed condition is checked").toBeLessThan(rest);
    expect(fold.slice(changed, rest)).toMatch(/keep: false/);
  });

  it("§11: the noise evidence never fills in an unmeasured noise level", () => {
    const noise = fnBody(EXPERIMENT, "pub(crate) fn noise_evidence_for(");
    expect(noise).toContain("measured_noise_pct: None");
    expect(fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(")).toContain("noise_evidence_for(&outcome");
  });
});

// Codex round 1 on #611 (b99a6c57): five ways a Trial could still credit, blame or lose track of a
// change. The pure decisions are Rust-tested; these pin that the live commands call them, in order.
describe("a Trial measures one change, and says so only when it can (#611 review round 1)", () => {
  const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");
  const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");

  it("§3: the baseline must still match Compy's changes before anything is recorded or applied", () => {
    const check = start.indexOf("baseline_is_current(baseline, ledger, crate::history::applied_changes_summary().active)");
    expect(check, "the start no longer checks that the baseline is current").toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(start.indexOf("resolve_baseline("));
    expect(check).toBeLessThan(start.indexOf("status: ExperimentStatus::Pending"));
    expect(check).toBeLessThan(start.indexOf("apply_recommendation("));
  });

  it("the after-session is timed against when the apply returned, not when the start began", () => {
    const apply = start.indexOf("apply_recommendation(");
    const stamp = start.indexOf("applied_at = Some(Utc::now().to_rfc3339())");
    expect(stamp, "the start no longer records when its change took effect").toBeGreaterThan(apply);
    expect(stamp, "the stamp is not saved with the change id").toBeLessThan(start.indexOf("save_store(&store)", stamp));
    const resolve = fnBody(EXPERIMENT, "pub(crate) fn resolve_treatment<");
    expect(resolve).toMatch(/let Some\(applied_at\) = rec\.applied_at\.as_deref\(\) else \{\s*return Err/);
    expect(resolve, "the treatment is timed against created_at again").not.toMatch(/rec\.created_at/);
  });

  it("a failed apply reads the setting and always leaves a loud record", () => {
    expect(start).toMatch(
      /Err\(e\) => \{\s*let check = crate::history::probe_rec_target\([^)]*\);\s*return Err\(settle_failed_apply\(&mut store, idx, &e, check\)\);/,
    );
    expect(start, "the start drops its record again").not.toContain("experiments.remove(");
    // #611 r3: an apply that writes in several steps can stop part-way and still read as unchanged,
    // so no read, however it comes back, drops the record.
    const settle = fnBody(EXPERIMENT, "fn settle_failed_apply(");
    expect(settle).toContain("let message = mark_failed_apply(&mut store.experiments[idx], err, check);");
    expect(settle, "a failed apply drops its record again").not.toContain("experiments.remove(");
    expect(fnBody(EXPERIMENT, "fn mark_failed_apply("), "a read can excuse a record again").not.toMatch(/return None|-> Option</);
  });

  it("§3 at conclude: another Compy change during the test confounds, ahead of the target check", () => {
    const fold = conclude.indexOf("with_compy_state(judged, other_compy_change(rec, baseline, treatment, rows.as_deref()))");
    expect(fold, "the conclude no longer checks Compy's other changes").toBeGreaterThanOrEqual(0);
    expect(fold).toBeGreaterThan(conclude.indexOf("crash_outcome(rec.applied_at.as_deref(), baseline, treatment)"));
    expect(fold).toBeLessThan(conclude.indexOf("guard_target_at_conclude(judged,"));
  });

  it("a crash is checked against the baseline's conditions when both sessions exist", () => {
    const crash = fnBody(EXPERIMENT, "pub(crate) fn crash_outcome(");
    expect(crash).toContain("crate::comparability::derive(baseline, treatment)");
    expect(crash).toContain("with_comparability(crash, &pairing)");
  });
});

// Review of b47fb6c1 on #611: a damaged ledger is set aside once, then loads as a fresh EMPTY one
// forever, which the one-change checks would read as "nothing moved". And a crash was pinned on the
// change even when its session began before the change took effect.
describe("a Trial never reads a lost history as a quiet one (#611 review round 2)", () => {
  const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");
  const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");
  const read = /ledger_for_one_change_checks\(\s*crate::history::load_history\(\),\s*crate::history::ledger_was_quarantined\(\),?\s*\)/;

  it("start and conclude read the ledger through the set-aside check, never raw", () => {
    for (const [name, body] of [["start", start], ["conclude", conclude]] as const) {
      expect(body, `${name} no longer counts a set-aside ledger as incomplete`).toMatch(read);
      expect(body.replace(read, ""), `${name} reads the ledger raw again`).not.toContain("crate::history::load_history()");
    }
    expect(fnBody(EXPERIMENT, "fn ledger_for_one_change_checks<")).toMatch(/if set_aside \{\s*return Err/);
  });

  it("a crash is pinned on the change only in a session begun after it took effect", () => {
    const crash = fnBody(EXPERIMENT, "pub(crate) fn crash_outcome(");
    const after = crash.indexOf("began_after_apply(treatment, at)) != Some(true)");
    expect(after, "a crash no longer checks when its session began").toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThan(crash.indexOf("crate::comparability::derive("));
    expect(fnBody(EXPERIMENT, "pub(crate) fn resolve_treatment<")).toContain("began_after_apply(treatment, applied_at)");
  });
});

// Codex review of 93a2458b on #611: a missing crash session still let the crash alone record a
// high-confidence regression; an empty ledger (set aside as damaged, or a receipt that failed to save)
// let the launch reconcile drop a start whose change may be in place; and settings with no live read
// count as active whether or not they stayed put. Codex round 3 (e8e5b725): a crash pair with nothing
// recorded in common was still pinned; a live read of "unchanged" still dropped a start, though an
// apply cut off part-way reads that way; and a cap still let an unconfirmed Better keep.
describe("a Trial claims nothing it can't tie to its own change (#611 review round 3)", () => {
  it("a crash reaches the change's verdict only through a found, later, comparable pair", () => {
    const crash = fnBody(EXPERIMENT, "pub(crate) fn crash_outcome(");
    expect(crash, "a crash with a missing session is pinned on the change again").not.toMatch(/return \(crash,/);
    expect(crash).toContain('unpinned("crash-session-missing"');
    expect(crash).toContain('unpinned("crash-baseline-missing"');
    expect(crash).toMatch(/Comparability::NotComparable => \{[\s\S]*?unpinned\("crash-session-not-comparable"/);
    expect(crash, "a crash pair with no shared context is pinned again").toMatch(
      /Comparability::Unknown => \{[\s\S]*?unpinned\("crash-session-comparability-unknown"/,
    );
    expect(crash).toContain("Comparability::Comparable | Comparability::Partial => {}");
    expect(crash.trimEnd().endsWith("(with_comparability(crash, &pairing), Some(pairing))\n}")).toBe(true);
  });

  it("an interrupted start is never dropped: a live read only words its loud record", () => {
    const pure = fnBody(EXPERIMENT, "pub(crate) fn reconcile_interrupted_starts_in(");
    expect(pure, "the reconcile drops a start again").not.toContain("experiments.remove(");
    expect(EXPERIMENT, "a way to drop an interrupted start is back").not.toContain("InterruptedStart::Dropped");
    expect(pure).toMatch(/None => \{\s*live_read = changed\(&store\.experiments\[i\]\.rec_id\);\s*InterruptedStart::ChangeUnrecorded/);
    expect(fnBody(EXPERIMENT, "fn reconcile_pending_locked(")).toContain(
      "target_verification(Some(crate::history::probe_rec_target(rec_id)))",
    );
  });

  it("§3/§7/§9 at conclude: other settings not confirmed in place leave the result unjudged, ahead of the target check", () => {
    const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");
    const fold = conclude.indexOf("with_unverified_changes(judged, unverified)");
    expect(fold, "the conclude no longer weighs settings it can't read back").toBeGreaterThanOrEqual(0);
    expect(fold).toBeGreaterThan(conclude.indexOf("with_compy_state(judged,"));
    expect(fold).toBeLessThan(conclude.indexOf("guard_target_at_conclude(judged,"));
    const unverified = fnBody(EXPERIMENT, "pub(crate) fn with_unverified_changes(");
    expect(unverified).toMatch(/verdict: "insufficient-evidence"\.into\(\),\s*keep: false,/);
    expect(unverified, "an unconfirmed result is only capped again, and can still keep").not.toContain("confidence.min(");
  });

  it("§3 at start: a Trial that could only end unjudged is refused before anything is recorded or applied", () => {
    const start = fnBody(EXPERIMENT, "pub(crate) fn start_experiment(");
    const count = start.indexOf("unverified_other_changes(rows, &rec_id, read_back)");
    const refuse = start.indexOf("unverified_start_refusal(unverified)");
    expect(count, "the start no longer counts other settings it can't read back").toBeGreaterThanOrEqual(0);
    expect(refuse, "the start no longer refuses on them").toBeGreaterThan(count);
    expect(count).toBeGreaterThan(start.indexOf("baseline_is_current("));
    expect(refuse).toBeLessThan(start.indexOf("status: ExperimentStatus::Pending"));
    expect(refuse).toBeLessThan(start.indexOf("apply_recommendation("));
  });

  // Codex r5 (#611): the start passed no own setting, so an older row for the setting under test,
  // undone in Windows, was refused as "another setting", though the simulator calls it testable again.
  it("the setting under test is never counted as another setting, at the start or the conclude", () => {
    const count = fnBody(EXPERIMENT, "pub(crate) fn unverified_other_changes(");
    expect(count, "the count excludes only this Trial's change row again").toContain("c.rec_id != own_rec");
    expect(fnBody(EXPERIMENT, "pub(crate) fn start_experiment(")).toContain("unverified_other_changes(rows, &rec_id, read_back)");
    expect(fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(")).toContain(
      "unverified_other_changes(rows, &rec.rec_id, read_back)",
    );
  });

  it("launch diagnostics never call a closed interrupted start unresolved or Pending", () => {
    expect(LIB, "support evidence misstates the record again").not.toContain("start could not be resolved");
    expect(LIB).not.toContain("Anything left unresolved stays Pending");
    expect(LIB).toContain("an interrupted experiment start was closed as Aborted with nothing measured");
  });

  // Codex r4 (#611): a Pending record is hidden from the bench yet blocks every later start, so an
  // unreadable ledger that left it Pending hid a change it may have made for as long as the read failed.
  it("an unreadable change history resolves an interrupted start loudly and saves it, never leaves it Pending", () => {
    const pure = fnBody(EXPERIMENT, "pub(crate) fn reconcile_interrupted_starts_in(");
    expect(pure, "an unreadable ledger skips the record again").not.toMatch(/LedgerUnreadable\);\s*i \+= 1;\s*continue;/);
    expect(pure).toMatch(/InterruptedStart::LedgerUnreadable => \{\s*rec\.status = ExperimentStatus::Aborted;/);
    const locked = fnBody(EXPERIMENT, "fn reconcile_pending_locked(");
    expect(locked, "a resolution is left unsaved again").not.toContain("!= InterruptedStart::LedgerUnreadable");
    expect(locked).toMatch(/if !outcomes\.is_empty\(\) \{\s*save_store\(store\)\?;/);
  });
});

// Self-review #583 lane 2b: the Trial's abort and restore messages reach the owner verbatim (the
// bench's alert and aborted-row line), and eighteen of them sent him to "Fix" — a room the rail
// retired (83b91afb, 59249bb6). Undo lives in Test → Applied & history. Comments may still name the
// old surface; only code lines, where the string literals live, are held to this.
// Self-review #8 (#611): the fixture gave an unpinned crash a zeroed treatment, so the preview showed
// a "+0%" reading the real app can never write, and a review judged a measurement that doesn't exist.
describe("the fixture preview shows only Trial rows the backend can write", () => {
  it("an unpinned crash row carries no treatment, because none was resolved", () => {
    const conclude = fnBody(EXPERIMENT, "pub(crate) fn conclude_experiment(");
    expect(conclude).toContain("None => crash_outcome(");
    expect(conclude).toContain("store.experiments[idx].treatment = resolved.as_ref().map(");
    const stub = readFileSync(join("docs", "ui-sweep", "fixture", "stub-core.ts"), "utf8");
    const rows = stub.split(/(?=\bid: "fx-)/).slice(1);
    const unpinned = rows.filter((r) => /stop_reason: "crash-(?:session|baseline)-/.test(r));
    expect(unpinned.length, "the fixture lost its unpinned-crash row").toBeGreaterThan(0);
    for (const row of unpinned) expect(row, row.slice(0, 40)).toMatch(/\btreatment: null,/);
  });
});

describe("the Trial's messages name a room that exists", () => {
  it("no experiment.rs string sends the owner to the retired Fix room", () => {
    const code = EXPERIMENT.split("\n").filter((l) => !/^\s*\/\//.test(l));
    const stale = code.filter((l) => /\b(?:in|from|open) (?:the )?Fix\b|Fix surface/.test(l));
    expect(stale, stale.join("\n")).toEqual([]);
  });
});
