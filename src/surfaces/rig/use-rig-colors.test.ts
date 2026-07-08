import { describe, it, expect } from "vitest";
import { partColor, PART_KIND_COLORS, FAN_COLOR } from "./use-rig-colors";
import type { RigColors } from "./use-rig-colors";
import type { RigPartKind } from "./rig-parts";

// Guard for the fixed part-identity palette (owner directive 2026-07-07): every component KIND
// wears its own distinct, THEME-INDEPENDENT hue so parts are instantly tellable apart. The old
// rule cycled the 3-hue theme palette — near-identical hues made the model read as one blob.
// A synthetic RigColors fixture with loud, distinct slots proves exactly what partColor reads.
const makeColors = (over: Partial<RigColors> = {}): RigColors => ({
  accent: "#111111",
  palette: ["#aa0000", "#00bb00", "#0000cc"],
  ghost: "#5d6679",
  ...over,
});

const ALL_KINDS: RigPartKind[] = ["board", "cpu", "ram", "gpu", "storage", "cooler", "psu"];

describe("partColor — fixed per-kind identity", () => {
  it("returns the ghost ink for an undetected part (every kind — honesty rule)", () => {
    const c = makeColors();
    for (const kind of ALL_KINDS) {
      expect(partColor(c, false, kind)).toBe(c.ghost);
    }
  });

  it("returns the kind's fixed identity hue for a detected part", () => {
    const c = makeColors();
    for (const kind of ALL_KINDS) {
      expect(partColor(c, true, kind)).toBe(PART_KIND_COLORS[kind]);
    }
  });

  it("is theme-independent: a detected part's colour never changes with the theme", () => {
    // Two wildly different "themes" must produce identical detected-part colours — the uniform
    // theme tint was exactly why the owner couldn't distinguish the model.
    const a = makeColors();
    const b = makeColors({ accent: "#ff00ff", palette: ["#123456", "#654321", "#0f0f0f"] });
    for (const kind of ALL_KINDS) {
      expect(partColor(a, true, kind)).toBe(partColor(b, true, kind));
    }
  });

  it("never returns the accent or a theme-palette slot for a detected part", () => {
    const c = makeColors();
    for (const kind of ALL_KINDS) {
      const got = partColor(c, true, kind);
      expect(got).not.toBe(c.accent);
      expect(c.palette).not.toContain(got);
    }
  });
});

describe("PART_KIND_COLORS — the identity palette itself", () => {
  it("covers every RigPartKind", () => {
    for (const kind of ALL_KINDS) {
      expect(PART_KIND_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("every kind hue is unique (incl. the fan colour) — differentiation is the whole point", () => {
    const all = [...ALL_KINDS.map((k) => PART_KIND_COLORS[k]), FAN_COLOR].map((h) =>
      h.toLowerCase(),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("no kind hue collides with the ghost ink (detected must never read as undetected)", () => {
    const c = makeColors();
    for (const kind of ALL_KINDS) {
      expect(PART_KIND_COLORS[kind].toLowerCase()).not.toBe(c.ghost.toLowerCase());
    }
    expect(FAN_COLOR.toLowerCase()).not.toBe(c.ghost.toLowerCase());
  });
});
