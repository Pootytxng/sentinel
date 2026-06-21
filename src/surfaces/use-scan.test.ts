import { describe, it, expect, vi } from "vitest";

// use-scan pulls @tauri-apps/api/core at import — stub invoke so jsdom doesn't choke loading the module.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { deriveReverted, rowVerdict, type AppliedChangeLite } from "./use-scan";
import type { ReadinessCheck } from "../types";

const mk = (rec_id: string, opts: Partial<AppliedChangeLite> = {}): AppliedChangeLite => ({
  rec_id,
  rec_title: `${rec_id} title`,
  status: "applied",
  is_still_active: false,
  ...opts,
});

describe("deriveReverted (the flag-class drift core)", () => {
  it("empty in -> empty out", () => {
    expect(deriveReverted([])).toEqual([]);
  });

  it("names an applied-but-inactive change (drifted off)", () => {
    expect(deriveReverted([mk("game-mode")])).toEqual([{ rec_id: "game-mode", title: "game-mode title" }]);
  });

  it("excludes a change that is still active", () => {
    expect(deriveReverted([mk("x", { is_still_active: true })])).toEqual([]);
  });

  it("excludes a non-applied (e.g. rolled-back) change", () => {
    expect(deriveReverted([mk("x", { status: "rolled_back" })])).toEqual([]);
  });

  it("collapses to the NEWEST entry per rec — a re-applied setting that's still on does NOT count", () => {
    // older drifted entry would count alone; the newer still-active entry wins → excluded.
    const out = deriveReverted([mk("gm", { is_still_active: false }), mk("gm", { is_still_active: true })]);
    expect(out).toEqual([]);
  });

  it("the NEWEST entry decides inclusion (old rolled-back, newest drifted -> included)", () => {
    const out = deriveReverted([
      mk("gm", { status: "rolled_back" }),
      mk("gm", { status: "applied", is_still_active: false }),
    ]);
    expect(out).toEqual([{ rec_id: "gm", title: "gm title" }]);
  });

  it("one entry per drifted rec, titled from rec_title", () => {
    const out = deriveReverted([mk("a", { rec_title: "Alpha" }), mk("b", { rec_title: "Beta" })]);
    expect(out).toEqual([
      { rec_id: "a", title: "Alpha" },
      { rec_id: "b", title: "Beta" },
    ]);
  });
});

describe("rowVerdict", () => {
  it("attention -> fix", () => expect(rowVerdict("attention")).toBe("fix"));
  it("ready -> ok", () => expect(rowVerdict("ready")).toBe("ok"));
  it("advisory -> ok", () => expect(rowVerdict("advisory")).toBe("ok"));
  it("any other status -> unknown", () =>
    expect(rowVerdict("skip" as unknown as ReadinessCheck["status"])).toBe("unknown"));
});
