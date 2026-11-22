import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import wire from "./test/fixtures/paramedic-p3.wire.json";
import type { FirstLookRecorded } from "./surfaces/glass/ParamedicFirstLook";
import type { ParamedicStartRecord } from "./types";

// PARAMEDIC P3 WIRE CONTRACT (card truth).
//
// The fields the card reads for "what Compy recorded" and "which notice this is":
//   1. Rust -> fixture: `the_p3_wire_fixture_matches_what_serde_emits` (paramedic/tests.rs) and
//      `the_recorded_block_matches_the_p3_wire_fixture` (first_look/recorded.rs) prove the fixture is what serde emits.
//   2. TS types -> key lists below: `Presence<T>` makes tsc fail if a list names a key the type lacks, misses one it has,
//      or marks an optional field required (or the reverse).
//   3. Key lists -> fixture: the fixture's objects must have exactly those keys.
//   4. The card reads each evidence arg by the name the fixture pins (`n`, `of`, `noticed`, `ready`).
// A field renamed in Rust therefore cannot reach the card unnoticed.

type Presence<T> = { [K in keyof T]-?: object extends Pick<T, K> ? "optional" : "required" };

const RECORDED: Presence<FirstLookRecorded> = { state: "required", total: "required", game: "required", unmatched: "required", need: "required" };
const START_RECORD: Presence<ParamedicStartRecord> = { recorded: "required", rough: "required", normal_recorded: "required", normal: "required", open: "required" };

const keysOf = (p: Record<string, string>) => Object.keys(p).sort();

describe("Paramedic P3 wire contract", () => {
  it("the recorded block has exactly the keys FirstLookRecorded declares", () => {
    expect(Object.keys(wire.recorded).sort()).toEqual(keysOf(RECORDED));
  });

  it("start_record has exactly the keys ParamedicStartRecord declares", () => {
    expect(Object.keys(wire.start_record).sort()).toEqual(keysOf(START_RECORD));
    expect(Array.isArray(wire.start_record.open)).toBe(true);
  });

  it("the evidence args the card reads are the ones Rust sends", () => {
    expect([...wire.already_running_arg_keys].sort()).toEqual(["id", "n", "name", "of"]);
    expect([...wire.drift_noticed_arg_keys].sort()).toEqual(["check", "noticed", "ready"]);
    // f1-follow: a setting that went off and was read back on, and what the sessions since say about it.
    expect([...wire.drift_noticed_restored_arg_keys].sort()).toEqual(["check", "noticed", "ready", "restored"]);
    expect([...wire.drift_restored_none_arg_keys].sort()).toEqual(["restored"]);
    expect([...wire.drift_restored_rough_arg_keys].sort()).toEqual(["at", "count", "restored"]);
    expect([...wire.drift_restored_clear_arg_keys].sort()).toEqual(["at", "restored"]);
    expect([...wire.drift_restored_unjudged_arg_keys].sort()).toEqual(["count", "restored"]);
    expect([...wire.recovered_drift_back_arg_keys].sort()).toEqual(["restored"]);
    expect([...wire.setting_drift_moved_arg_keys].sort()).toEqual(["check", "noticed", "restored"]);
    const card = readFileSync(join("src", "surfaces", "glass", "ParamedicCard.tsx"), "utf8");
    for (const k of ["a.n)", "a.of)", "a.noticed", "a.ready", "a.check", "a.restored", "a.at)", "a.count"]) expect(card, k).toContain(k);
    const look = readFileSync(join("src", "surfaces", "glass", "ParamedicFirstLook.tsx"), "utf8");
    for (const k of ["r.state", "r.total", "r.game", "r.unmatched", "r.need"]) expect(look, k).toContain(k);
  });
});
