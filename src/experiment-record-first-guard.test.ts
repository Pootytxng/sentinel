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
