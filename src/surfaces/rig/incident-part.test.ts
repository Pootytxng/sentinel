// P7-rig-care: the newest assessed crash record → the part its rule is about, "away", or nothing.
// Pins the honesty table (only rules whose own evidence is about one part claim it; ambiguous rules
// never do), the one-part rule, and that the table covers every rule blackbox.rs can emit.
// Fails on the code before this slice (no incident-part module, no `rule` key).
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { AssessmentRule, CrashIncident } from "../../types";
import {
  INCIDENT_RULE_AWAY,
  INCIDENT_RULE_NONE,
  INCIDENT_RULE_PART,
  gpuNameVendor,
  incidentFocus,
  moduleVendor,
} from "./incident-part";
import type { FocusPart } from "./limiter-part";
import type { RigPartKind } from "./rig-parts";
import { newestAssessedIncident, pickCareStep } from "../care-next-step";

const part = (id: string, kind: RigPartKind, name = id, detected = true): FocusPart => ({ id, kind, name, detected });
const RIG = [part("board", "board"), part("cpu", "cpu"), part("gpu-0", "gpu", "Radeon RX 9070 XT"), part("ram", "ram")];

const inc = (when: string, rule?: AssessmentRule | null): CrashIncident =>
  ({
    incident_id: `id-${when}`,
    headline: "h",
    tag: "App crash",
    when,
    when_display: when,
    vitals: null,
    receipt: { source: "WER", event_ids: [], faulting_app: null, faulting_module: null, code: null, detail: "" },
    assessment:
      rule === null
        ? null
        : {
            ...(rule ? { rule } : {}),
            consistent_with: "c",
            strength: "strong",
            evidence: [],
            next_step: { headline: "s", detail: "d", reversible: true, research_only: false },
            beyond_us: false,
          },
  }) as CrashIncident;

describe("incidentFocus", () => {
  it("overheating and a repeating graphics-driver timeout point at the one GPU", () => {
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", "overheating"), RIG)).toEqual({
      kind: "part",
      rule: "overheating",
      partId: "gpu-0",
      partName: "Radeon RX 9070 XT",
    });
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", "graphics-driver"), RIG)).toMatchObject({
      kind: "part",
      rule: "graphics-driver",
      partId: "gpu-0",
    });
  });

  it("an app-specific record gets a note only: no part, and nothing that dims the rig", () => {
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", "app-specific"), RIG)).toEqual({ kind: "record-only" });
  });

  it("ambiguous rules claim no part (WHEA, power/hard-lock, a stop code)", () => {
    for (const r of ["hardware-error", "power-hardlock", "beyond-us"] as const)
      expect(incidentFocus(inc("2026-10-20T10:00:00Z", r), RIG), r).toBeNull();
  });

  it("two GPUs, a ghost GPU only, no rule key, no assessment, or no record → nothing", () => {
    const twoGpus = [...RIG, part("gpu-1", "gpu")];
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", "graphics-driver"), twoGpus)).toBeNull();
    const ghostOnly = [part("cpu", "cpu"), part("gpu-0", "gpu", "GPU", false)];
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", "overheating"), ghostOnly)).toBeNull();
    expect(incidentFocus(inc("2026-10-20T10:00:00Z"), RIG)).toBeNull(); // record from before the key
    expect(incidentFocus(inc("2026-10-20T10:00:00Z", null), RIG)).toBeNull();
    expect(incidentFocus(null, RIG)).toBeNull();
  });

  // Review r1 SHOULD-FIX 2: a driver record from another vendor's card (a GPU swap since) is not
  // about the card on the bench; unknown on either side keeps the one-GPU rule.
  it("graphics-driver claims the GPU only when the driver module's vendor doesn't contradict it", () => {
    const withModule = (m: string | null) => {
      const i = inc("2026-10-20T10:00:00Z", "graphics-driver");
      return { ...i, receipt: { ...i.receipt, faulting_module: m } } as CrashIncident;
    };
    expect(incidentFocus(withModule("amdkmdag.sys"), RIG)).toMatchObject({ partId: "gpu-0" }); // Radeon drawn
    expect(incidentFocus(withModule("nvlddmkm"), RIG)).toBeNull(); // NVIDIA record, Radeon drawn
    expect(incidentFocus(withModule("somedriver"), RIG)).toMatchObject({ partId: "gpu-0" }); // unknown module
    expect(incidentFocus(withModule(null), RIG)).toMatchObject({ partId: "gpu-0" });
    const unnamed = [part("cpu", "cpu"), part("gpu-0", "gpu", "Graphics adapter")];
    expect(incidentFocus(withModule("nvlddmkm"), unnamed)).toMatchObject({ partId: "gpu-0" }); // name says nothing
    // Overheating reads a measured GPU temperature, not a driver module: no vendor check.
    const hot = { ...inc("2026-10-20T10:00:00Z", "overheating"), receipt: { ...withModule("nvlddmkm").receipt } } as CrashIncident;
    expect(incidentFocus(hot, RIG)).toMatchObject({ partId: "gpu-0" });
  });

  it("vendor readers know the common module and card names, and nothing else", () => {
    expect(moduleVendor("atikmdag.sys")).toBe("amd");
    expect(moduleVendor("NVLDDMKM")).toBe("nvidia");
    expect(moduleVendor("igdkmd64.sys")).toBe("intel");
    expect(moduleVendor("dxgkrnl.sys")).toBeNull();
    expect(gpuNameVendor("AMD Radeon RX 9070 XT")).toBe("amd");
    expect(gpuNameVendor("NVIDIA GeForce RTX 4070")).toBe("nvidia");
    expect(gpuNameVendor("Intel(R) Arc(TM) A770")).toBe("intel");
    expect(gpuNameVendor("Microsoft Basic Display Adapter")).toBeNull();
  });

  it("RAM is never claimed (no rule says memory alone)", () => {
    expect(Object.values(INCIDENT_RULE_PART)).not.toContain("ram");
  });
});

describe("the record the rig reads is the one the Care step is drawn from", () => {
  it("newestAssessedIncident skips unassessed and unparseable records, and matches pickCareStep", () => {
    const older = inc("2026-10-20T10:00:00Z", "overheating");
    const newer = inc("2026-10-22T10:00:00Z", "app-specific");
    const unassessed = inc("2026-10-25T10:00:00Z", null);
    const badDate = inc("not a date", "graphics-driver");
    const list = [older, unassessed, newer, badDate];
    expect(newestAssessedIncident(list)).toBe(newer);
    const step = pickCareStep(list, null);
    expect(step?.source === "incident" && step.incidentId).toBe(newer.incident_id);
    expect(newestAssessedIncident([])).toBeNull();
    expect(newestAssessedIncident(undefined)).toBeNull();
  });
});

// Drift guard: every rule key blackbox.rs can emit (the kebab-case enum) is classified exactly once
// here, and the TS union lists the same keys.
describe("the table covers every rule blackbox.rs can emit", () => {
  const rs = readFileSync(join("src-tauri", "src", "blackbox.rs"), "utf8");
  const body = rs.slice(rs.indexOf("pub(crate) enum AssessmentRule {"), rs.indexOf("}", rs.indexOf("pub(crate) enum AssessmentRule {")));
  const kebab = (v: string) => v.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const rustRules = [...body.matchAll(/^\s{4}([A-Z][A-Za-z]+),/gm)].map((m) => kebab(m[1]));

  it("found the enum's variants", () => {
    expect(rustRules).toHaveLength(6);
  });

  it("each is classified exactly once (part, away, or none)", () => {
    for (const r of rustRules) {
      const where = [r in INCIDENT_RULE_PART, INCIDENT_RULE_AWAY.has(r as AssessmentRule), INCIDENT_RULE_NONE.has(r as AssessmentRule)];
      expect(where.filter(Boolean), r).toHaveLength(1);
    }
    const classified = [...Object.keys(INCIDENT_RULE_PART), ...INCIDENT_RULE_AWAY, ...INCIDENT_RULE_NONE];
    expect(classified.sort()).toEqual([...rustRules].sort());
  });

  it("the TypeScript union names the same keys", () => {
    const ts = readFileSync(join("src", "types.ts"), "utf8");
    const union = ts.slice(ts.indexOf("export type AssessmentRule ="), ts.indexOf(";", ts.indexOf("export type AssessmentRule =")));
    const tsRules = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(tsRules.sort()).toEqual([...rustRules].sort());
  });
});
