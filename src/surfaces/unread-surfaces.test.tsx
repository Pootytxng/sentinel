import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./monitor/DeckScope", () => ({ DeckScope: () => <div data-testid="deck-scope" /> }));
vi.mock("./monitor/SessionStack", () => ({ SessionStack: () => <div data-testid="session-stack" /> }));

import { MonitorConsole } from "./MonitorConsole";
import Play, { verdictLabel } from "./Play";
import { monitorVerdict } from "./monitor-v2-data";
import { liveStrip } from "./command-center-data";
import { comparisonWait } from "./comparison-wait";
import { usableReading } from "../lib/session-metrics";
import { prettyGameName } from "./game-name";
import { ConfirmProvider } from "../design/ConfirmDialog";

// M6-unread: a session of which more than a fifth went unmeasured is "not graded" EVERYWHERE the
// debrief says so: the Play last-session line and list, the Monitor evidence headline and colours,
// the Home strip, the comparison wait, and the journey/bench "usable reading" test. Exactly a fifth
// is still graded. The same rule as sessions.rs `mostly_unread`.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: "2026-11-20T10:00:00Z",
    duration_secs: 1200,
    process_name: "aniimo.exe",
    samples: 1000,
    avg_fps: 144,
    avg_frametime_ms: 6.9,
    low1_fps_est: 130,
    peak_gpu_temp_c: 70,
    peak_gpu_usage_pct: 60,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
    stutter_timeline: [],
    stutter_events: [],
    ...over,
  } as SessionSummary;
}
const game = prettyGameName("aniimo.exe");
const trusted = sess({ unreadable_seconds: 240 }); // exactly a fifth of 1200 s
const ungraded = sess({ unreadable_seconds: 241 }); // one second over

beforeEach(() => localStorage.setItem("compy_motion", "reduced"));
afterEach(async () => {
  cleanup();
  localStorage.clear();
  invokeMock.mockReset();
  await i18n.changeLanguage("en");
});

describe.each(["en", "zh-CN"] as const)("a mostly-unread session is not graded anywhere (%s)", (lang) => {
  it("Play verdictLabel: Not graded past a fifth, the grade word at exactly a fifth", async () => {
    await i18n.changeLanguage(lang);
    expect(verdictLabel(i18n.t, ungraded)).toBe(t("monitor.play.notGradedVerdict"));
    expect(verdictLabel(i18n.t, trusted)).toBe(t("monitor.play.smoothVerdict"));
  });

  it("monitorVerdict: names the game, says it is not graded and why, and says nothing smooth or rough", async () => {
    await i18n.changeLanguage(lang);
    const line = monitorVerdict([ungraded], i18n.t);
    expect(line.headline).toBe(t("monitor.monitorV2.verdict.notGradedHeadline", { game }));
    expect(line.headline).not.toBe(t("monitor.monitorV2.verdict.smoothHeadline", { game, fps: 144 }));
    expect(line.sub).toBe(t("monitor.monitorV2.verdict.notGradedSub", { duration: "20m 0s" }));
    expect(monitorVerdict([trusted], i18n.t).headline).toBe(
      t("monitor.monitorV2.verdict.smoothHeadline", { game, fps: 144 }),
    );
  });

  it("Home strip (HomeConsole, HomeHud, HomeV2 all read liveStrip): the numbers show, flagged ungraded", async () => {
    await i18n.changeLanguage(lang);
    const strip = liveStrip([ungraded], i18n.t);
    expect(strip).toMatchObject({ kind: "data", avgFps: 144, low1Est: 130, ungraded: true });
    expect(liveStrip([trusted], i18n.t)).toMatchObject({ kind: "data", ungraded: false });
    expect(liveStrip([], i18n.t).kind, "an ungraded session is not 'no session'").toBe("empty");
    expect(liveStrip([ungraded], i18n.t).kind).toBe("data");
  });

  it("MonitorConsole: the evidence headline says not graded and the last session's numbers get no grade colour", async () => {
    await i18n.changeLanguage(lang);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_fps_status") return Promise.resolve({ active: false, status: "off", sample: null });
      return Promise.resolve(null);
    });
    const shown = render(<MonitorConsole active sessions={[ungraded]} onFpsActive={vi.fn()} />);
    await waitFor(() =>
      expect(shown.container.querySelector(".mc-ev-verdict")?.textContent).toBe(
        t("monitor.monitorV2.verdict.notGradedHeadline", { game }),
      ),
    );
    expect(shown.container.querySelector('[data-read="avgFps"]')?.className).toContain("rd-neutral");
    expect(shown.container.querySelector('[data-read="low1"]')?.className).toContain("rd-neutral");
    cleanup();
    const graded = render(<MonitorConsole active sessions={[trusted]} onFpsActive={vi.fn()} />);
    await waitFor(() => expect(graded.container.querySelector('[data-read="low1"]')).not.toBeNull());
    expect(graded.container.querySelector('[data-read="low1"]')?.className, "a graded session still colours").not.toContain(
      "rd-neutral",
    );
  });

  it("Play: the last-session line says Not graded, not Smooth or Rough", async () => {
    await i18n.changeLanguage(lang);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_fps_status") return Promise.resolve({ active: false, status: "off", sample: null });
      return Promise.resolve(null);
    });
    const props = {
      active: true,
      view: "sessions" as const,
      sessionsSeenAt: "",
      priorities: null,
      recs: [],
      apply: vi.fn(),
      busyId: null,
      onExport: vi.fn(),
      changes: [],
      rollback: vi.fn(),
    };
    const bad = render(
      <ConfirmProvider>
        <Play {...props} sessions={[ungraded]} />
      </ConfirmProvider>,
    );
    await waitFor(() => expect(bad.container.querySelector(".play-hero-verdict")).not.toBeNull());
    const verdict = bad.container.querySelector(".play-hero-verdict")?.textContent;
    expect(verdict).toBe(
      t("monitor.play.heroVerdict", { verdict: t("monitor.play.notGradedVerdict"), duration: "20m 0s" }),
    );
    // The hero's average / 1% low / frame time carry no grade colour either.
    const values = [...bad.container.querySelectorAll(".play-hero-value")].slice(0, 3);
    expect(values.map((n) => n.getAttribute("style"))).toEqual([null, null, null]);
  });

  it("comparisonWait: a mostly-unread after-session leaves the comparison waiting, and says why", async () => {
    await i18n.changeLanguage(lang);
    const armed = { game: "aniimo.exe", armed_at: "2026-11-01T00:00:00Z", rec_title: "x" } as never;
    expect(comparisonWait(ungraded, armed)).toEqual({ reason: "mostly-unread" });
    expect(comparisonWait(trusted, armed)).toBeNull();
    expect(comparisonWait(sess({ ...ungraded, samples: 10 }), armed)).toMatchObject({ reason: "short" });
  });

  it("usableReading (Guided Journey and the Test bench): refuses a mostly-unread session, accepts a fifth", async () => {
    await i18n.changeLanguage(lang);
    expect(usableReading(ungraded)).toBe(false);
    expect(usableReading(trusted)).toBe(true);
    expect(usableReading(sess({ process_name: " " }))).toBe(false);
    expect(usableReading(sess({ low1_fps_est: 0 }))).toBe(false);
  });
});
