import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "../../i18n";
import { PatternsTile } from "./PatternsTile";
import { wordFromPattern } from "../../data/confidence-word";
import type { PatternReport, SessionPattern } from "../../types";

// view-1121b: History said "RAM pressure during ROB RUN is growing / LIKELY" while Home had already
// moved to "Known" and the Paramedic card to "Possible". History's pattern rows went through the
// What-changed hypothesis mapper (any supported band -> the strength word "Likely"). They now go
// through the pattern mapper in certainty.ts (a measured trend: "Measured"), so no History row can say
// a strength word above "Possible" without the two supports the Paramedic requires.
const report = vi.hoisted(() => ({ value: null as unknown as PatternReport }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) =>
    cmd === "get_intelligence_patterns" ? Promise.resolve(report.value) : Promise.resolve(null),
  ),
}));
vi.mock("../../design/use-hud", () => ({ useIntelligenceFlag: () => true }));

const pattern = (id: string, confidence: SessionPattern["confidence"], title: string): SessionPattern => ({
  id,
  game: "ROB RUN",
  title,
  detail: "Peak RAM use during ROB RUN moved about +30 percentage points across 20 sessions.",
  confidence,
  confidence_reason: "20 sessions, a steady rise.",
  supporting_evidence: [],
  raises_confidence: [],
  next_test: null,
});

const RETIRED = /\b(likely|most likely|probably|probable|certainly|definitely)\b|较可能|很可能|大概率/i;

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const open = async () => {
  report.value = {
    patterns: [
      pattern("memory-growth", "high", "RAM pressure during ROB RUN is growing"),
      pattern("performance-trend", "medium", "ROB RUN is getting slower"),
      pattern("thermal-trend", "low", "ROB RUN sessions are running hotter"),
    ],
    coverage: [],
    sessions_considered: 53,
    games_considered: 10,
  };
  const view = render(<PatternsTile />);
  await screen.findByText("RAM pressure during ROB RUN is growing");
  return view;
};

describe("History's pattern rows: the strength words the product retired never appear", () => {
  it("a supported pattern says Measured, an unsupported one Unknown, and no row says Likely", async () => {
    const { container } = await open();
    const tags = [...container.querySelectorAll(".bpt-card-conf")].map((n) => n.textContent);
    expect(tags).toEqual(["Measured", "Measured", "Unknown"]);
    expect(container.textContent).not.toMatch(RETIRED);
    // The raw band stays on the chip for the technical layer.
    expect([...container.querySelectorAll(".bpt-card-conf [data-confidence]")].map((n) => n.getAttribute("data-confidence"))).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("says the same in Chinese, with no retired strength word", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = await open();
    const tags = [...container.querySelectorAll(".bpt-card-conf")].map((n) => n.textContent);
    expect(tags).toEqual(["已实测", "已实测", "未知"]);
    expect(container.textContent).not.toMatch(RETIRED);
  });

  it("wordFromPattern: only a supported band is a measured trend; low, unknown and missing are Unknown", () => {
    expect(wordFromPattern("high")).toBe("measured");
    expect(wordFromPattern("medium")).toBe("measured");
    expect(wordFromPattern("low")).toBe("unknown");
    expect(wordFromPattern(null)).toBe("unknown");
    expect(wordFromPattern(undefined)).toBe("unknown");
    for (const band of ["high", "medium", "low", null] as const) expect(wordFromPattern(band)).not.toBe("likely");
  });
});

// The two screens cannot disagree again by construction: History's rows may not use the
// hypothesis-band word (the one that maps every supported band to "Likely").
const SOURCES = import.meta.glob(["./*.tsx", "../BlackbookV2.tsx", "!./*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("History screen sources", () => {
  it("no History source renders the hypothesis-band ConfidenceWord", () => {
    const files = Object.entries(SOURCES);
    expect(files.length, "History sources not scanned").toBeGreaterThan(1);
    const hits = files.filter(([, text]) => /<ConfidenceWord\b/.test(text)).map(([f]) => f);
    expect(hits, `these History files use <ConfidenceWord band>: ${hits.join(", ")}`).toEqual([]);
  });
});
