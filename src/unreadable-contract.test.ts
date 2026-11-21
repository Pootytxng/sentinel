import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import wire from "./test/fixtures/unreadable.wire.json";
import type { FpsUnreadStatus, SessionSummary } from "./types";
import { UNREADABLE_UNTRUSTED_PCT, mostlyUnread, unreadableSecs } from "./lib/session-metrics";

// M6-unread WIRE CONTRACT: what Rust sends about seconds Compy couldn't read, and what the app reads.
//   1. Rust -> fixture: `the_wire_fixture_is_what_serde_emits` (monitoring.rs) proves the fixture is
//      what `get_fps_status` and a saved session serialize.
//   2. fixture -> TS types: the objects below are typed by the app's own types, so tsc fails on a
//      renamed or retyped key.
//   3. Rust source -> TS constant: the untrusted threshold is one number in two languages.
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const rust = (file: string) => readFileSync(join("src-tauri", "src", file), "utf8");

describe("unreadable-seconds wire contract", () => {
  const status: FpsUnreadStatus & { sample: unknown; progress: { unreadable_secs: number } } = wire.fps_status;

  it("the live status carries the current-second flag and the helper's tick count under the names the types use", () => {
    expect(Object.keys(wire.fps_status).sort()).toEqual(
      ["active", "progress", "sample", "status", "unreadable_now", "unreadable_ticks"].sort(),
    );
    expect(status.unreadable_now).toBe(true);
    expect(status.unreadable_ticks).toBe(9);
    expect(status.sample).toBeNull();
    expect(status.progress.unreadable_secs).toBe(4);
  });

  it("a saved session carries unreadable_seconds, read by the same helpers the debrief uses", () => {
    const s: Pick<SessionSummary, "unreadable_seconds" | "duration_secs"> = {
      unreadable_seconds: wire.session_unreadable_seconds,
      duration_secs: 100,
    };
    expect(unreadableSecs(s)).toBe(12);
    expect(mostlyUnread(s)).toBe(false);
  });

  it("the Rust names are the ones the app reads, and the threshold is the same number", () => {
    const monitoring = rust("monitoring.rs");
    const sessions = rust("sessions.rs");
    for (const key of ["unreadable_now: bool", "unreadable_ticks: u64"]) expect(monitoring).toContain(key);
    for (const key of ["unreadable_seconds: u32", "unreadable_secs: u32"]) expect(sessions).toContain(key);
    const rustPct = /UNREADABLE_UNTRUSTED_PCT: u64 = (\d+);/.exec(sessions)?.[1];
    expect(Number(rustPct)).toBe(UNREADABLE_UNTRUSTED_PCT);
  });

  it("the threshold is strict, in integers, as Rust draws it", () => {
    const at = (unreadable_seconds: number, duration_secs: number) => mostlyUnread({ unreadable_seconds, duration_secs });
    expect(at(20, 100)).toBe(false);
    expect(at(21, 100)).toBe(true);
    expect(at(0, 0)).toBe(false);
    expect(at(1, 0)).toBe(true);
    expect(at(0, 100)).toBe(false);
  });
});

describe("unreadableSecs", () => {
  it("is null for nothing to say: 0, absent, null, NaN, negative", () => {
    for (const v of [0, undefined, null, NaN, -3, Infinity]) {
      expect(unreadableSecs({ unreadable_seconds: v as number | null | undefined })).toBeNull();
    }
    expect(unreadableSecs({})).toBeNull();
  });
  it("is the whole count otherwise", () => {
    expect(unreadableSecs({ unreadable_seconds: 7 })).toBe(7);
    expect(unreadableSecs({ unreadable_seconds: 7.4 })).toBe(7);
  });
});
