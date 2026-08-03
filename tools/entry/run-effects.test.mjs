// Guard: "nothing was written" is a claim about the machine, so it has to be true.
//
// `launch` is a legal-prefix sequence on purpose — every stage leaves a recoverable state, and any of
// them can refuse. The shell printed "#N was not started, and nothing was written." for EVERY nonzero
// exit. That sentence is true only of a refusal before the first write, and false after a worktree is
// created, a tier established, a claim posted, or a token, brief or overlay written.
//
// The failure it produces is not cosmetic: a claim can be sitting on the board under Kuya's name, a
// worktree can exist on disk, and the launcher has just told him none of it happened. He then has no
// reason to go and clean any of it up, and the next launch refuses on state he was told did not exist.
//
// So the run keeps a ledger and the refusal carries it. The old sentence is now reserved for the case
// the payload proves, rather than assumed for all of them.

import { describe, expect, it } from "vitest";
import { Effects } from "./launch.mjs";

describe("the ledger a refusal carries", () => {
  it("starts empty, and an empty ledger is what licenses the old sentence", () => {
    const e = new Effects();
    expect(e.wroteAnything).toBe(false);
    expect(e.payload()).toEqual({ effects: [], wroteAnything: false });
  });

  it("records what happened, in the order it happened", () => {
    const e = new Effects();
    e.record("created the worktree", "C:\\x @ b from abc1234");
    e.record("posted the ownership claim", "#23 until 2026-08-01");
    e.record("wrote the launch token");

    expect(e.wroteAnything).toBe(true);
    expect(e.payload().effects).toEqual([
      { what: "created the worktree", detail: "C:\\x @ b from abc1234" },
      { what: "posted the ownership claim", detail: "#23 until 2026-08-01" },
      { what: "wrote the launch token" },
    ]);
  });

  it("omits the detail key entirely rather than carrying an empty one", () => {
    expect(new Effects().record("did a thing").payload().effects[0]).toEqual({ what: "did a thing" });
  });

  // The distinction the whole finding turns on: a refusal AFTER writes must not be able to claim
  // nothing was written.
  it("cannot report a clean refusal once anything has been recorded", () => {
    const e = new Effects();
    e.record("established the context tier");
    expect(e.payload().wroteAnything).toBe(true);
  });
});
