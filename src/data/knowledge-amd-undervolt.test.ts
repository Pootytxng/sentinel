// Content guard for the AMD-undervolting clarifier (A4 content lane; AMD-verified ONLY per LOCKED
// rule #5 — no NVIDIA/Intel undervolt claims). "AMD undervolting" splits into a safe, easy, reversible
// Radeon GPU path (the one Compy actually guides) and a risky, advanced Ryzen CPU/BIOS path; the
// existing entries explain each piece but nothing routed a confused searcher to the safe lane. This
// term does. Asserts it ships, routes to both real entries, is findable, and stays honest (GPU = safer,
// CPU = risky/advanced; no FPS promise; AMD-only). Bug->guard.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const ID = "amd-undervolting";

describe("AMD undervolting clarifier", () => {
  const e = KNOWLEDGE_BY_ID.get(ID);

  it("ships as a power-topic term", () => {
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("term");
    expect(e!.topic).toBe("power");
  });

  it("routes to both the safe GPU path and the risky CPU path", () => {
    expect(e!.related).toContain("amd-gpu-undervolt"); // the safe, guided Radeon path
    expect(e!.related).toContain("pbo-curve-optimizer"); // the risky, advanced Ryzen path
  });

  it("is findable for both Radeon and Ryzen undervolt searches", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    for (const q of ["amd undervolt", "radeon undervolt", "ryzen undervolt"]) {
      expect(searchKnowledge(q, all).map((x) => x.id), `query: ${q}`).toContain(ID);
    }
  });

  it("stays honest — distinguishes safe GPU from risky CPU, AMD-only, no FPS promise", () => {
    if (e!.type !== "term") throw new Error("expected term");
    const body = `${e!.what} ${e!.more}`.toLowerCase();
    expect(body).toMatch(/risk|advanced/); // CPU path flagged as risky/advanced
    expect(body).toMatch(/gpu|radeon/); // names the GPU side
    expect(body).toMatch(/cpu|ryzen/); // names the CPU side
    // Rule 5: AMD-verified ONLY. If it names NVIDIA/Intel at all it must be to WITHHOLD guidance
    // (the honest disclosure), never to give undervolt instructions for them.
    expect(body).toMatch(/withhold|until each is verified|not yet verified/);
    expect(body, "no fabricated FPS promise").not.toMatch(/more fps|higher fps|guaranteed fps/);
  });
});
