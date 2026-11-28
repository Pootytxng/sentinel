import { describe, it, expect, vi } from "vitest";
import { rerankAfterSessionRead, type PendingRank } from "./session-rerank";

// Break check: make rerankAfterSessionRead return without ranking, or drop either seq comparison,
// and the matching case fails.
const pending: PendingRank<string, string[], string[]> = {
  seq: 3,
  readiness: "ready",
  recommendations: ["rec"],
  startup: ["app"],
};

describe("rerankAfterSessionRead", () => {
  it("ranks with the refresh's kept answers and the re-read sessions, and applies the ranking", async () => {
    const rank = vi.fn(() => Promise.resolve("ranked"));
    const apply = vi.fn();
    await rerankAfterSessionRead(pending, () => 3, ["s1"], rank, apply);
    expect(rank).toHaveBeenCalledWith({
      readiness: "ready",
      recommendations: ["rec"],
      startup: ["app"],
      sessions: ["s1"],
    });
    expect(apply).toHaveBeenCalledWith("ranked");
  });

  it("no kept answers: no ranking", async () => {
    const rank = vi.fn(() => Promise.resolve("ranked"));
    const apply = vi.fn();
    await rerankAfterSessionRead(null, () => 3, ["s1"], rank, apply);
    expect(rank).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a newer refresh started before the re-read landed: no ranking (that refresh ranks itself)", async () => {
    const rank = vi.fn(() => Promise.resolve("ranked"));
    const apply = vi.fn();
    await rerankAfterSessionRead(pending, () => 4, ["s1"], rank, apply);
    expect(rank).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a newer refresh started while the ranking ran: its result is dropped", async () => {
    let seq = 3;
    const rank = vi.fn(() => {
      seq = 4;
      return Promise.resolve("ranked");
    });
    const apply = vi.fn();
    await rerankAfterSessionRead(pending, () => seq, ["s1"], rank, apply);
    expect(rank).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a failed ranking is logged and changes nothing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const apply = vi.fn();
    await rerankAfterSessionRead(pending, () => 3, ["s1"], () => Promise.reject(new Error("no")), apply);
    expect(apply).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
