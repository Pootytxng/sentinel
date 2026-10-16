import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Priorities, Recommendation, SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";

// #608 — the Session Debrief states only measured frame rates (honest-measurement law).
//
// The sampler's "unknown" is 0, an older record can lack the field, and nothing upstream
// guarantees finiteness or even the type. Before this guard the Debrief printed such a value
// as a tile reading ("0", "-5", "NaN"), and its 1%-low/average ratio — which fell back to 1
// for an unknown average and to 0 for an unknown low — chose the headline ("Smooth session",
// "Rough — frequent stutter"), the "{{pct}}% of your average" sentence, the GPU-loafed and
// prime-suspect insights, the clean "Good session" line and the "#1 fix" wording. None of
// that is evidence without BOTH readings. Every site now asks knownFps (finite, above zero).
//
// Out of scope here and pinned elsewhere: the ComparisonCard (a resolved Trial is its own
// evidence) and the arm_comparison baseline seeding, which is a separate safety slice.

const UNKNOWN: unknown[] = [0, -0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "120"];
const LOCALES = ["en", "zh-CN"] as const;
const ABSENT = "—";

const base: SessionSummary = {
  started_at: "2026-10-16T20:00:00Z",
  duration_secs: 3600,
  process_name: "eldenring.exe",
  samples: 900,
  avg_fps: 160,
  avg_frametime_ms: 6.25,
  low1_fps_est: 140,
  peak_gpu_temp_c: 68,
  // Low enough that the GPU-loafed insight WOULD fire on any ratio under 0.7.
  peak_gpu_usage_pct: 50,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  stutter_insight: null,
};

const limiterRec: Recommendation = {
  id: "power-plan",
  title: "Switch to the Ultimate Performance power plan",
  category: "power",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "any",
  currently_applied: false,
  provenance: "verified",
};

// A machine-derived limiter, so the prime-suspect insight WOULD fire on any ratio under 0.75.
const priorities: Priorities = {
  limiters: [
    {
      id: "power-plan",
      title: "Power plan",
      reason: "Windows is on Balanced.",
      linked: "power-plan",
      confidence: "medium",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const draw = (s: SessionSummary) =>
  render(
    <ConfirmProvider>
      <SessionDebrief
        s={s}
        priorities={priorities}
        recs={[limiterRec]}
        apply={vi.fn()}
        busyId={null}
        onExport={vi.fn()}
        changes={[]}
        rollback={vi.fn()}
      />
    </ConfirmProvider>,
  );

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").trim();
const tiles = (c: HTMLElement) => [...c.querySelectorAll(".debrief-tile")];
const tileValue = (c: HTMLElement, i: number) => text(tiles(c)[i]?.querySelector(".debrief-tile-value"));
const tileLabel = (c: HTMLElement, i: number) => text(tiles(c)[i]?.querySelector(".debrief-tile-label"));
const tileColor = (c: HTMLElement, i: number) =>
  (tiles(c)[i]?.querySelector(".debrief-tile-value") as HTMLElement | null)?.style.color ?? "";

const BANDS = ["smooth", "dips", "rough"] as const;
const bandHeadlines = () => BANDS.map((b) => t(`monitor.sessionDebrief.verdict.${b}.headline`));

// Everything the ratio used to decide, none of which may appear without both readings.
function expectNoRatioConclusion(c: HTMLElement) {
  const headline = text(c.querySelector(".debrief-verdict"));
  const sub = text(c.querySelector(".debrief-sub"));
  for (const h of bandHeadlines()) expect(headline).not.toBe(h);
  expect(headline).toBe(t("monitor.sessionDebrief.verdict.unmeasured.headline"));
  expect(sub).toBe(t("monitor.sessionDebrief.verdict.unmeasured.sub"));
  expect(sub).not.toMatch(/\d+\s*%/);
  expect(c.querySelector(".debrief-insight")).toBeNull();
  expect(c.textContent).not.toContain(t("monitor.sessionDebrief.cleanSessionOffer"));
  expect(c.textContent).not.toContain(t("monitor.sessionDebrief.cleanSession"));
  // The offer stays (help is never hidden), but it may not call the change a fix.
  expect(screen.getByRole("button", { name: t("monitor.sessionDebrief.applyTry") })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: t("monitor.sessionDebrief.applyFix") })).toBeNull();
}

afterEach(cleanup);
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe.each(LOCALES)("Session Debrief states only measured frame rates (%s)", (lang) => {
  beforeEach(async () => {
    await i18n.changeLanguage(lang);
  });

  it("the not-graded verdict and the absent-reading note are real strings in this locale", () => {
    for (const k of [
      "monitor.sessionDebrief.verdict.unmeasured.headline",
      "monitor.sessionDebrief.verdict.unmeasured.sub",
      "common.arcGauge.noReading",
    ]) {
      expect(i18n.exists(k)).toBe(true);
      expect(t(k)).not.toBe(k);
    }
  });

  it.each(UNKNOWN.map((v) => [String(v), v]))("unknown average (%s): absent tile, no ratio conclusion", async (_l, v) => {
    const { container } = draw({ ...base, avg_fps: v as number });
    await screen.findByText(/eldenring/i);
    expect(tileValue(container, 0)).toBe(ABSENT);
    expect(tileLabel(container, 0)).toContain(t("common.arcGauge.noReading"));
    expect(tileColor(container, 0)).toBe("");
    // The measured low is still shown, but a 1% low is graded against its average: no grade.
    expect(tileValue(container, 1)).toBe("140");
    expect(tileColor(container, 1)).toBe("");
    expectNoRatioConclusion(container);
  });

  it.each(UNKNOWN.map((v) => [String(v), v]))("unknown 1% low (%s): absent tile, no ratio conclusion", async (_l, v) => {
    const { container } = draw({ ...base, low1_fps_est: v as number });
    await screen.findByText(/eldenring/i);
    expect(tileValue(container, 1)).toBe(ABSENT);
    expect(tileLabel(container, 1)).toContain(t("common.arcGauge.noReading"));
    expect(tileLabel(container, 1)).not.toContain(t("monitor.sessionDebrief.estimateNote"));
    expect(tileColor(container, 1)).toBe("");
    expect(tileValue(container, 0)).toBe("160");
    expectNoRatioConclusion(container);
  });

  it.each(UNKNOWN.map((v) => [String(v), v]))("both unknown (%s): two absent tiles, no ratio conclusion", async (_l, v) => {
    const { container } = draw({ ...base, avg_fps: v as number, low1_fps_est: v as number });
    await screen.findByText(/eldenring/i);
    expect(tileValue(container, 0)).toBe(ABSENT);
    expect(tileValue(container, 1)).toBe(ABSENT);
    expectNoRatioConclusion(container);
  });

  // Measured controls — byte-for-byte the behavior that shipped before #608's Debrief slice.
  it("measured smooth session keeps its numbers, verdict, percent and clean line", async () => {
    const { container } = draw({ ...base, peak_gpu_usage_pct: 92 });
    await screen.findByText(/eldenring/i);
    expect(tileValue(container, 0)).toBe("160");
    expect(tileValue(container, 1)).toBe("140");
    expect(tileLabel(container, 1)).toContain(t("monitor.sessionDebrief.estimateNote"));
    expect(tileLabel(container, 0)).not.toContain(t("common.arcGauge.noReading"));
    expect(text(container.querySelector(".debrief-verdict"))).toBe(t("monitor.sessionDebrief.verdict.smooth.headline"));
    expect(text(container.querySelector(".debrief-sub"))).toBe(t("monitor.sessionDebrief.verdict.smooth.sub", { pct: 88 }));
    expect(container.textContent).toContain(t("monitor.sessionDebrief.cleanSessionOffer"));
    expect(screen.getByRole("button", { name: t("monitor.sessionDebrief.applyTry") })).toBeInTheDocument();
  });

  it("measured rough session keeps its verdict, percent, GPU-loafed insight and #1-fix wording", async () => {
    const { container } = draw({ ...base, low1_fps_est: 80 });
    await screen.findByText(/eldenring/i);
    expect(tileValue(container, 1)).toBe("80");
    expect(text(container.querySelector(".debrief-verdict"))).toBe(t("monitor.sessionDebrief.verdict.rough.headline"));
    expect(text(container.querySelector(".debrief-sub"))).toBe(t("monitor.sessionDebrief.verdict.rough.sub", { pct: 50 }));
    expect(text(container.querySelector(".debrief-insight p"))).toBe(t("monitor.sessionDebrief.gpuLoafedInsight", { pct: 50 }));
    expect(screen.getByRole("button", { name: t("monitor.sessionDebrief.applyFix") })).toBeInTheDocument();
    expect(container.textContent).not.toContain(t("monitor.sessionDebrief.cleanSessionOffer"));
  });

  it("measured dips session keeps its verdict and prime-suspect insight", async () => {
    const { container } = draw({ ...base, low1_fps_est: 100, peak_gpu_usage_pct: 92 });
    await screen.findByText(/eldenring/i);
    expect(text(container.querySelector(".debrief-verdict"))).toBe(t("monitor.sessionDebrief.verdict.dips.headline"));
    expect(text(container.querySelector(".debrief-sub"))).toBe(t("monitor.sessionDebrief.verdict.dips.sub", { pct: 63 }));
    expect(text(container.querySelector(".debrief-insight p"))).toBe(
      t("monitor.sessionDebrief.primeSuspectInsight", { limiter: "power plan", reason: "Windows is on Balanced." }),
    );
  });

  it("a measured stutter correlation is still shown when a reading is unknown (its own evidence)", async () => {
    const { container } = draw({ ...base, low1_fps_est: 0, stutter_insight: "Stutter lined up with disk activity." });
    await screen.findByText(/eldenring/i);
    expect(text(container.querySelector(".debrief-insight p"))).toBe("Stutter lined up with disk activity.");
    expect(text(container.querySelector(".debrief-verdict"))).toBe(t("monitor.sessionDebrief.verdict.unmeasured.headline"));
  });
});
