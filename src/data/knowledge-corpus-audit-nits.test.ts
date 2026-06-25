// Content guards for the honesty corpus-audit precision nits (handoff 2026-06-25; bug->guard).
// honesty's 8-agent web-verified audit found a few debunks whose wording OVERSHOT — making a blanket
// absolute claim ("no measurable win") where a narrow, documented subset measurably benefits. A blanket
// "never anything" claim is itself an unmeasured absolute (against the never-claim-unmeasured doctrine),
// so the fix tightens the language to be precise WITHOUT weakening the verdict (the typical-case verdict
// is unchanged) and WITHOUT adding tool-vendor numbers honesty flagged. Each guard pins the honesty
// property — verdict held + the exception acknowledged — so the corpus can't regress to the overshoot.
import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";

function tweakBody(id: string): { verdict: string; body: string } {
  const e = KNOWLEDGE_BY_ID.get(id);
  expect(e, `entry "${id}" must exist`).toBeTruthy();
  if (e!.type !== "tweak") throw new Error(`${id} expected to be a tweak`);
  return { verdict: e!.verdict, body: `${e!.what} ${e!.why}`.toLowerCase() };
}

describe("disable-smt-gaming — overshoot softened, verdict held (corpus audit)", () => {
  const { verdict, body } = tweakBody("disable-smt-gaming");

  it("stays placebo for the typical modern CPU (honesty did not flag the verdict)", () => {
    expect(verdict).toBe("placebo");
  });

  it("no longer makes the blanket 'no measurable win exists' absolute", () => {
    expect(body).not.toMatch(/no measurable win waiting/);
  });

  it("acknowledges the narrow documented subset, without a fabricated number", () => {
    expect(body).toMatch(/exception|narrow|a few|some specific|specific.{0,20}(game|title)/);
    expect(body, "no fabricated FPS promise").not.toMatch(/more fps|higher fps|guaranteed/);
  });
});

describe("exclusive-fullscreen-fps — competitive latency edge surfaced (corpus audit)", () => {
  const { verdict, body } = tweakBody("exclusive-fullscreen-fps");

  it("stays placebo (the FPS myth is busted for the typical player)", () => {
    expect(verdict).toBe("placebo");
  });

  it("surfaces the real competitive latency edge (no longer buried), keeps the measure-it framing", () => {
    expect(body).toMatch(/competitive/);
    expect(body).toMatch(/compositor|input lag|latency/);
    expect(body).toMatch(/measur/); // still 'measure it yourself', not an assertion of a number
  });
});

describe("disable-vbs — performance cost not understated, security held (corpus audit)", () => {
  const { verdict, body } = tweakBody("disable-vbs");

  it("stays risky (real gain, real security cost — a trade-off, never auto-applied)", () => {
    expect(verdict).toBe("risky");
  });

  it("does not cap the gain at only 'a few percent', and keeps the security caveat firm", () => {
    expect(body).toMatch(/or more|more in some|depending on/); // gain can exceed a few percent
    expect(body).toMatch(/security|mitigation|protection/); // the cost stays named
  });
});

describe("disable-defender — safe remedy named, hard-no held (corpus audit)", () => {
  const { verdict, body } = tweakBody("disable-defender");

  it("stays risky / blocklisted (the security stance does not soften)", () => {
    expect(verdict).toBe("risky");
    expect(body).toMatch(/hard no|blocklist/);
    expect(body).toMatch(/protection|antivirus|security/);
  });

  it("names the SAFE fix for the real heavy-I/O stutter case — a per-game exclusion, not disabling AV", () => {
    expect(body).toMatch(/exclusion/);
  });
});
