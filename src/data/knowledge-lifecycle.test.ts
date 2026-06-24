import { describe, it, expect } from "vitest";
import { lifecycle } from "./knowledge";

// A3 lifecycle mapper — shapes the optional status/supersededBy off a raw entry. The lint
// (knowledge.lint.test.ts) enforces that a superseded id is real + different; this just maps.
describe("knowledge lifecycle mapper (A3)", () => {
  it("absent or unknown status → current (no lifecycle fields)", () => {
    expect(lifecycle({})).toEqual({});
    expect(lifecycle({ status: "active" })).toEqual({});
    expect(lifecycle({ status: "whatever" })).toEqual({});
  });

  it("deprecated → status only", () => {
    expect(lifecycle({ status: "deprecated" })).toEqual({ status: "deprecated" });
  });

  it("superseded → carries the replacement id", () => {
    expect(lifecycle({ status: "superseded", supersededBy: "vrr" })).toEqual({
      status: "superseded",
      supersededBy: "vrr",
    });
  });

  it("superseded with no supersededBy → empty string (the lint then rejects it)", () => {
    expect(lifecycle({ status: "superseded" })).toEqual({ status: "superseded", supersededBy: "" });
  });
});
