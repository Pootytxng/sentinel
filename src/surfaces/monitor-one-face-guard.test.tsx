import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// MONITOR ONE-FACE GUARD (comprehensibility sweep 2026-08-20, issue #180 §D — bug→guard tier 1).
//
// The owner caught the Live room carrying a Basic/Advanced fork whose whole visible payoff was
// one gauge and a hidden tab row: "the basic and advanced tab in the live section are still both
// present when i recall us agreeing the advanced mode was the obvious and more sensible default
// ... so removing basic mode i was thought to believe was the result to be had." The sweep
// removed the fork (MonitorBasic.tsx, the `mode` prop, compy_view_mode, compy_monitor_console).
// This guard makes the removal permanent: each case below fails on the RETURN of the defect.
//
// Source-text on purpose, same reasoning as cpu-temp-reachability-guard: a render test proves a
// tree renders, it cannot prove a fork is ABSENT from every composition.

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Monitor one-face guard (issue #180)", () => {
  it("MonitorBasic stays deleted", () => {
    expect(
      existsSync(join("src", "surfaces", "MonitorBasic.tsx")),
      "MonitorBasic.tsx is back — the Live room has ONE face (owner call, issue #180)",
    ).toBe(false);
  });

  it("MonitorV2 carries no Basic/Advanced mode fork", () => {
    const src = stripComments(read("src", "surfaces", "MonitorV2.tsx"));
    for (const marker of ["ViewMode", "readViewMode", "MonitorBasic", "detailLevelAria", '"basic"']) {
      expect(
        src.includes(marker),
        `MonitorV2.tsx references ${marker} — the Basic/Advanced fork is returning`,
      ).toBe(false);
    }
    // Exactly ONE segmented control (Live/Sessions). A second one is the mode picker reborn.
    const segs = src.match(/<SegmentedControl\b/g) ?? [];
    expect(segs.length, "MonitorV2 renders more than one SegmentedControl").toBe(1);
  });

  it("MonitorConsole takes no mode prop and branches on none", () => {
    const src = stripComments(read("src", "surfaces", "MonitorConsole.tsx"));
    expect(/\bmode\s*[:=]/.test(src), "MonitorConsole grew a mode prop again").toBe(false);
  });

  it("the retired keys stay out of theme.ts (no resurrected flag or view-mode store)", () => {
    const theme = stripComments(read("src", "design", "theme.ts"));
    for (const key of ["compy_view_mode", "compy_monitor_console"]) {
      expect(
        new RegExp(`"${key}"`).test(theme),
        `theme.ts defines ${key} again — the sweep retired it; a new face rides the room, not a flag`,
      ).toBe(false);
    }
  });
});
