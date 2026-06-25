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

// --- Batch 1 handoff (the broader "Handed to content" set that honesty's §⑥ digest under-listed) ---

describe("power-plan — overstatement scoped to CPU-bound (corpus audit)", () => {
  const { verdict, body } = tweakBody("power-plan");
  it("stays real but no longer claims a win on 'many rigs' — scoped to CPU-bound", () => {
    expect(verdict).toBe("real");
    expect(body).toMatch(/cpu-bound/);
    expect(body).not.toMatch(/win.{0,20}many rigs/);
  });
});

describe("shader-cache-size — re-compile mechanism + vendor specificity (corpus audit)", () => {
  const { verdict, body } = tweakBody("shader-cache-size");
  it("attributes the benefit to re-compiles (not first-run) and notes it's mainly NVIDIA", () => {
    expect(verdict).toBe("real");
    expect(body).toMatch(/reuse|re-?use|rebuild|after a driver|recompile/);
    expect(body).toMatch(/nvidia/);
  });
});

describe("nvidia-reflex — uses NVIDIA's own 'click-to-display' term (corpus audit)", () => {
  const { body } = tweakBody("nvidia-reflex");
  it("says click-to-display, not click-to-pixel", () => {
    expect(body).toMatch(/click-to-display/);
    expect(body).not.toMatch(/click-to-pixel/);
  });
});

describe("fan-curves — fan-noise trade-off named, absolute softened (corpus audit)", () => {
  const { verdict, body } = tweakBody("fan-curves");
  it("stays real and now names the honest fan-noise trade-off", () => {
    expect(verdict).toBe("real");
    expect(body).toMatch(/noise|louder/);
  });
});

describe("low-latency-mode — Ultra's real condition is GPU-bound (corpus audit)", () => {
  const { verdict, body } = tweakBody("low-latency-mode");
  it("states GPU-bound as the condition for Ultra (not the vaguer 'above refresh')", () => {
    expect(verdict).toBe("real");
    expect(body).toMatch(/gpu-bound/);
  });
});

describe("ram-cleaners — undocumented 'fixed years ago' absolute softened (corpus audit)", () => {
  const { verdict, body } = tweakBody("ram-cleaners");
  it("stays placebo and no longer asserts the bug 'was fixed in Windows itself years ago'", () => {
    expect(verdict).toBe("placebo");
    expect(body).not.toMatch(/fixed in windows itself years ago/);
    expect(body).toMatch(/modern.{0,20}memory|most rigs|handles/);
  });
});
