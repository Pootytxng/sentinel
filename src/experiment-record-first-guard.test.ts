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
      /None => crash_outcome\(baseline, treatment\)/,
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

  it("a failed apply reads the setting before it says nothing changed", () => {
    expect(start).toMatch(
      /Err\(e\) => \{\s*let check = crate::history::probe_rec_target\([^)]*\);\s*return Err\(settle_failed_apply\(&mut store, idx, &e, check\)\);/,
    );
    expect(start, "the start drops its record without a read again").not.toContain("experiments.remove(");
    const settle = fnBody(EXPERIMENT, "fn settle_failed_apply(");
    expect(settle).toMatch(/let Some\(message\) = mark_failed_apply\([\s\S]*?\) else \{\s*store\.experiments\.remove\(idx\)/);
  });

  it("§3 at conclude: another Compy change during the test confounds, ahead of the target check", () => {
    const fold = conclude.indexOf("with_compy_state(judged, other_compy_change(rec, baseline, treatment, rows.as_deref()))");
    expect(fold, "the conclude no longer checks Compy's other changes").toBeGreaterThanOrEqual(0);
    expect(fold).toBeGreaterThan(conclude.indexOf("crash_outcome(baseline, treatment)"));
    expect(fold).toBeLessThan(conclude.indexOf("guard_target_at_conclude(judged,"));
  });

  it("a crash is checked against the baseline's conditions when both sessions exist", () => {
    const crash = fnBody(EXPERIMENT, "pub(crate) fn crash_outcome(");
    expect(crash).toContain("crate::comparability::derive(baseline, treatment)");
    expect(crash).toContain("with_comparability(crash, &pairing)");
  });
});

// Self-review #583 lane 2b: the Trial's abort and restore messages reach the owner verbatim (the
// bench's alert and aborted-row line), and eighteen of them sent him to "Fix" — a room the rail
// retired (83b91afb, 59249bb6). Undo lives in Test → Applied & history. Comments may still name the
// old surface; only code lines, where the string literals live, are held to this.
describe("the Trial's messages name a room that exists", () => {
  it("no experiment.rs string sends the owner to the retired Fix room", () => {
    const code = EXPERIMENT.split("\n").filter((l) => !/^\s*\/\//.test(l));
    const stale = code.filter((l) => /\b(?:in|from|open) (?:the )?Fix\b|Fix surface/.test(l));
    expect(stale, stale.join("\n")).toEqual([]);
  });
});
