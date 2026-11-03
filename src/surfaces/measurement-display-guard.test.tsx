import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

// The Monitor room's readings may state only what was measured (#656 visual FAIL item 3, #608).
// The headline learned "wasn't measured" (monitorVerdict + knownFps), but the cards beneath it
// still printed an unknown average / 1% low as a reading: a "0 fps" Reading wearing the MEASURED
// tag, a ▼240 delta against a 0, a "0 avg" session row graded "Some dips". The sampler's unknown
// is 0, and an older or malformed record can carry a negative, a non-finite value or nothing at
// all. Every one of those must render as the room's own absent mark and never as a number or a
// grade, in every locale. Measured readings must stay exactly as they were.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { MonitorConsole } from "./MonitorConsole";
import Play from "./Play";
import { SessionStack } from "./monitor/SessionStack";
import { ConfirmProvider } from "../design/ConfirmDialog";

/** Every shape of "not measured" a session record has been seen to carry, or could. */
const UNKNOWN: unknown[] = [0, -0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined];
const LOCALES = ["en", "zh-CN"] as const;

function sess(over: Record<string, unknown> = {}): SessionSummary {
  return {
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 2520,
    process_name: "valorant.exe",
    samples: 3412,
    avg_fps: 240.2,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190.1,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
    stutter_events: [],
    stutter_timeline: [
      [0, 180],
      [1200, 200],
      [2520, 190],
    ],
    ...over,
  } as SessionSummary;
}
const prior = (over: Record<string, unknown> = {}) =>
  sess({ started_at: "2026-07-02T00:00:00Z", avg_fps: 200, low1_fps_est: 150, ...over });

// Canvas-backed children (deck scope, session rows) only need a context that accepts calls.
const noopCtx = new Proxy(
  {},
  {
    get: (_t, p) =>
      typeof p === "string" && /^(fillStyle|strokeStyle|lineWidth|globalAlpha|font|lineJoin|lineCap|textAlign|textBaseline)$/.test(p)
        ? ""
        : () => ({ addColorStop: () => {}, width: 0 }),
    set: () => true,
  },
);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    noopCtx as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const text = (el: Element | null) => (el?.textContent ?? "").trim();

const renderConsole = (sessions: SessionSummary[]) =>
  render(<MonitorConsole active={false} sessions={sessions} />);
const renderPlay = (sessions: SessionSummary[]) =>
  render(
    <ConfirmProvider>
      <Play
        active
        view="sessions"
        sessions={sessions}
        sessionsSeenAt=""
        priorities={null}
        recs={[]}
        apply={vi.fn()}
        busyId={null}
        onExport={vi.fn()}
        changes={[]}
        rollback={vi.fn()}
      />
    </ConfirmProvider>,
  );

describe.each(LOCALES)("Monitor readings state only measured values (%s)", (lang) => {
  beforeAll(async () => {
    await i18n.changeLanguage(lang);
  });

  describe("MonitorConsole evidence Readings", () => {
    const reading = (c: HTMLElement, id: string) => c.querySelector(`[data-read="${id}"]`)!;
    const expectAbsent = (r: Element) => {
      expect(text(r.querySelector(".rd-n"))).toBe("—");
      expect(r.querySelector(".rd-tag")).toBeNull();
      expect(text(r.querySelector(".rd-none"))).toBe(t("common.arcGauge.noReading"));
      expect(r.classList.contains("rd-neutral")).toBe(true);
    };
    const expectMeasured = (r: Element, n: string) => {
      expect(text(r.querySelector(".rd-n"))).toBe(n);
      expect(text(r.querySelector(".rd-tag"))).toBe(t("common.arcGauge.measured"));
    };

    it("measured control: both readings print their numbers with the MEASURED tag", () => {
      const { container } = renderConsole([sess()]);
      expectMeasured(reading(container, "avgFps"), "240");
      expectMeasured(reading(container, "low1"), "190");
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown average (%s) reads as no reading, never a number", (_l, v) => {
      const { container } = renderConsole([sess({ avg_fps: v })]);
      expectAbsent(reading(container, "avgFps"));
      // The low is still a measured fact; without an average it simply cannot be graded.
      expectMeasured(reading(container, "low1"), "190");
      expect(reading(container, "low1").classList.contains("rd-neutral")).toBe(true);
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown 1% low (%s) reads as no reading, never a number", (_l, v) => {
      const { container } = renderConsole([sess({ low1_fps_est: v })]);
      expectAbsent(reading(container, "low1"));
      expectMeasured(reading(container, "avgFps"), "240");
    });
  });

  describe("MonitorConsole comparison row", () => {
    const cellV = (c: HTMLElement, k: string) =>
      text(c.querySelector(`.mc-delta-v[data-k="${k}"] .mc-delta-vv`));

    it("measured control: deltas against the last session are unchanged", () => {
      const { container } = renderConsole([sess(), prior()]);
      expect(cellV(container, "avg")).toBe("▲40");
      expect(cellV(container, "low1")).toBe("▲40");
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("an unknown side (%s) on either session yields the absent mark, never a delta against it", (_l, v) => {
      for (const sessions of [
        [sess({ avg_fps: v, low1_fps_est: v }), prior()],
        [sess(), prior({ avg_fps: v, low1_fps_est: v })],
      ]) {
        const { container, unmount } = renderConsole(sessions);
        expect(cellV(container, "avg")).toBe("—");
        expect(cellV(container, "low1")).toBe("—");
        unmount();
      }
    });
  });

  describe("Play sessions hero + session rows", () => {
    const heroValues = (c: HTMLElement) => [...c.querySelectorAll(".play-hero-value")].map(text);
    const graded = () => [t("monitor.play.smoothVerdict"), t("monitor.play.roughVerdict"), t("monitor.play.someDipsVerdict")];

    it("the ungradeable label exists in this locale", () => {
      expect(i18n.exists("monitor.play.notGradedVerdict")).toBe(true);
    });

    it("measured control: hero numbers, grade word and row numbers are unchanged", () => {
      const { container } = renderPlay([sess()]);
      expect(heroValues(container).slice(0, 3)).toEqual(["240", "190", "4.2"]);
      expect(text(container.querySelector(".play-hero-verdict"))).toContain(t("monitor.play.smoothVerdict"));
      expect(text(container.querySelector(".play-session-nums"))).toBe(t("monitor.play.sessionNums", { avg: "240", low1: "190" }));
      expect(text(container.querySelector(".play-session-meta"))).toContain(t("monitor.play.smoothVerdict"));
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown average (%s): absent mark in hero and row, and no grade word", (_l, v) => {
      const { container } = renderPlay([sess({ avg_fps: v })]);
      expect(heroValues(container).slice(0, 2)).toEqual(["—", "190"]);
      expect(text(container.querySelector(".play-session-nums"))).toBe(t("monitor.play.sessionNums", { avg: "—", low1: "190" }));
      for (const sel of [".play-hero-verdict", ".play-session-meta"]) {
        const line = text(container.querySelector(sel));
        expect(line).toContain(t("monitor.play.notGradedVerdict"));
        for (const g of graded()) expect(line).not.toContain(g);
      }
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown 1% low (%s): absent mark in hero and row, and no grade word", (_l, v) => {
      const { container } = renderPlay([sess({ low1_fps_est: v })]);
      expect(heroValues(container).slice(0, 2)).toEqual(["240", "—"]);
      expect(text(container.querySelector(".play-session-nums"))).toBe(t("monitor.play.sessionNums", { avg: "240", low1: "—" }));
      for (const sel of [".play-hero-verdict", ".play-session-meta"]) {
        const line = text(container.querySelector(sel));
        expect(line).toContain(t("monitor.play.notGradedVerdict"));
        for (const g of graded()) expect(line).not.toContain(g);
      }
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown frametime (%s) in the hero is the absent mark, never 0.0 ms", (_l, v) => {
      const { container } = renderPlay([sess({ avg_fps: 0, low1_fps_est: 0, avg_frametime_ms: v })]);
      expect(heroValues(container).slice(0, 3)).toEqual(["—", "—", "—"]);
    });
  });

  describe("SessionStack rows", () => {
    const detail = (sessions: SessionSummary[]) => {
      const utils = render(<SessionStack sessions={sessions} reduced />);
      fireEvent.click(utils.container.querySelector(".ss-row")!);
      return utils.container;
    };

    it("measured control: the detail line and the vs-previous chip print the readings", () => {
      const c = detail([sess(), prior()]);
      expect(text(c.querySelector(".ss-detail"))).toContain(t("monitor.sessionStack.avgTag", { value: "240" }));
      expect(text(c.querySelector(".ss-detail"))).toContain(t("monitor.sessionStack.oneLowTag", { value: "190" }));
      expect(text(c.querySelector(".ss-chip"))).toContain(t("monitor.sessionStack.vsPrevious", { glyph: "▲40" }));
    });

    it.each(UNKNOWN.map((v) => [String(v), v]))("unknown readings (%s) print the absent mark and no delta", (_l, v) => {
      const c = detail([sess({ avg_fps: v, low1_fps_est: v }), prior()]);
      expect(text(c.querySelector(".ss-detail"))).toContain(t("monitor.sessionStack.avgTag", { value: "—" }));
      expect(text(c.querySelector(".ss-detail"))).toContain(t("monitor.sessionStack.oneLowTag", { value: "—" }));
      expect(text(c.querySelector(".ss-chip"))).toContain(t("monitor.sessionStack.vsPrevious", { glyph: "—" }));
    });
  });
});
