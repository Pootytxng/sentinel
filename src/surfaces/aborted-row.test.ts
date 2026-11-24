import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { BACKEND_SENTENCES } from "../data/backend-error";
import { APPLY_REFUSALS_BEFORE_WRITE, FAILED_APPLY_HEAD, refusedBeforeWrite } from "./aborted-row";

// D7 review r1 F2: an aborted Trial row says "nothing was changed" only when experiment.rs mark_failed_apply stored a
// refusal that returns before any write. Break checks: add or drop a name in either list (TS here, Rust
// APPLY_REFUSALS_BEFORE_WRITE) -> "equals the Rust list" fails; make refusedBeforeWrite ignore FAILED_APPLY_HEAD ->
// "needs the failed-apply head" fails; make it match any "nothing was changed" sentence -> "an unlisted mapped
// sentence" fails.

const RUST = readFileSync(join("src-tauri", "src", "experiment.rs"), "utf8").replace(/\r\n/g, "\n");
const text = (name: string) => BACKEND_SENTENCES.find((s) => s.rust === name)!.text;

describe("aborted Trial row: refused before anything was written (D7 r1 F2)", () => {
  it("the TS list equals the Rust APPLY_REFUSALS_BEFORE_WRITE, name for name, in order", () => {
    const start = RUST.indexOf("const APPLY_REFUSALS_BEFORE_WRITE: &[&str] = &[");
    expect(start, "the Rust list").toBeGreaterThan(-1);
    const body = RUST.slice(start, RUST.indexOf("];", start)).split("= &[")[1];
    const names = body
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split("::").pop()!);
    expect(names).toEqual([...APPLY_REFUSALS_BEFORE_WRITE]);
    for (const n of APPLY_REFUSALS_BEFORE_WRITE) expect(BACKEND_SENTENCES.some((s) => s.rust === n), n).toBe(true);
  });

  it("the stored head is mark_failed_apply's: every `why` begins with it", () => {
    expect(RUST).toContain('rec.stop_reason = Some(format!("start-aborted: {why}: {err}"));');
    const fn = RUST.slice(RUST.indexOf("fn mark_failed_apply("), RUST.indexOf("const APPLY_REFUSALS_BEFORE_WRITE"));
    const whys = [...fn.matchAll(/^\s*"(the apply reported an error[^"]*)/gm)];
    expect(whys.length).toBe(3);
    expect(FAILED_APPLY_HEAD).toBe("start-aborted: the apply reported an error");
  });

  it("a refused-before-write reason is recognised", () => {
    for (const n of APPLY_REFUSALS_BEFORE_WRITE) {
      const stored = `${FAILED_APPLY_HEAD}; the setting reads as not changed, but a change that stopped part-way can read that way too, and Compy saved no undo record for it: ${text(n)}`;
      expect(refusedBeforeWrite(stored), n).toBe(true);
    }
  });

  it("needs the failed-apply head", () => {
    expect(refusedBeforeWrite(`start-aborted: something else: ${text("TRIAL_HOLDS_SETTING_REFUSAL")}`)).toBe(false);
    expect(refusedBeforeWrite(text("TRIAL_HOLDS_SETTING_REFUSAL"))).toBe(false);
  });

  it("an unlisted mapped sentence, an OS error or an older wording keeps the fixed line", () => {
    expect(refusedBeforeWrite(`${FAILED_APPLY_HEAD}: ${text("BENCH_STACK_NOTHING_APPLIED")}`)).toBe(false);
    expect(refusedBeforeWrite(`${FAILED_APPLY_HEAD}: access denied (os error 5)`)).toBe(false);
    const older =
      "A setting this action changes is being tested by a Trial right now, so Compy won't run it on top of the test. Let the Trial finish, or end it with Restore now in Test, first. Nothing was changed.";
    expect(refusedBeforeWrite(`${FAILED_APPLY_HEAD}: ${older}`)).toBe(false);
  });
});
