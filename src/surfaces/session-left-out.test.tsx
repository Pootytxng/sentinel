import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { SessionStack } from "./monitor/SessionStack";
import { ConfirmProvider } from "../design/ConfirmDialog";

// P4-comparable-show: seconds the game spent behind another window are left out of every number
// (background_secs_excluded). The Debrief and the session list say how many, in both languages; a
// session that was behind the whole time says that is why it has no readings; a session that never
// recorded focus (null) and one that left nothing out (0) say nothing. Real Aniimo sessions on
// 2026-10-25 left out 24 s and 36 s.

const LOCALES = ["en", "zh-CN"] as const;

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: new Date().toISOString(),
    duration_secs: 1800,
    process_name: "aniimo.exe",
    samples: 1776,
    avg_fps: 144,
    avg_frametime_ms: 6.9,
    low1_fps_est: 120,
    peak_gpu_temp_c: 70,
    peak_gpu_usage_pct: 95,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
    stutter_timeline: [
      [0, 118],
      [900, 122],
      [1800, 120],
    ],
    stutter_events: [],
    ...over,
  } as SessionSummary;
}

// A session the game spent entirely behind another window: no readings at all.
const background = (secs: number) =>
  sess({
    samples: 0,
    avg_fps: 0,
    avg_frametime_ms: 0,
    low1_fps_est: 0,
    duration_secs: secs,
    stutter_timeline: [],
    background_secs_excluded: secs,
  });

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const leftOutLine = (seconds: number, ns: "sessionDebrief" | "sessionStack") =>
  t(`monitor.${ns}.leftOut`, { span: t("monitor.leftOut.seconds", { seconds }) });

const debrief = (s: SessionSummary) =>
  render(
    <ConfirmProvider>
      <SessionDebrief
        s={s}
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

const stack = (sessions: SessionSummary[]) => render(<SessionStack sessions={sessions} reduced />);
// One row opens at a time: open each in turn and read its detail line.
const details = (c: HTMLElement) =>
  [...c.querySelectorAll(".ss-row")].map((row) => {
    fireEvent.click(row);
    return c.querySelector(".ss-detail")?.textContent ?? "";
  });

afterEach(cleanup);
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe.each(LOCALES)("left-out seconds (%s)", (lang) => {
  it("the Debrief states the seconds left out (24 s)", async () => {
    await i18n.changeLanguage(lang);
    const { container } = debrief(sess({ background_secs_excluded: 24 }));
    const line = container.querySelector(".debrief-leftout");
    expect(line?.textContent).toBe(leftOutLine(24, "sessionDebrief"));
    expect(line?.textContent).toMatch(/24/);
  });

  it("the Debrief says nothing when focus wasn't recorded (null/absent) or nothing was left out", async () => {
    await i18n.changeLanguage(lang);
    for (const v of [null, undefined, 0]) {
      const { container } = debrief(sess({ background_secs_excluded: v }));
      expect(container.querySelector(".debrief-leftout")).toBeNull();
      cleanup();
    }
  });

  it("a background-only session's Debrief says why it has no readings", async () => {
    await i18n.changeLanguage(lang);
    const { container } = debrief(background(36));
    expect(container.querySelector(".debrief-verdict")?.textContent).toBe(
      t("monitor.sessionDebrief.verdict.background.headline"),
    );
    expect(container.querySelector(".debrief-sub")?.textContent).toBe(
      t("monitor.sessionDebrief.verdict.background.sub", {
        span: t("monitor.leftOut.seconds", { seconds: 36 }),
      }),
    );
    expect(container.querySelector(".debrief-sub")?.textContent).not.toBe(
      t("monitor.sessionDebrief.verdict.unmeasured.sub"),
    );
    // The reason is stated once, in the sub, not repeated as a second line.
    expect(container.querySelector(".debrief-leftout")).toBeNull();
  });

  it("the session list states the seconds left out per session (24 s, 36 s), none for null", async () => {
    await i18n.changeLanguage(lang);
    const { container } = stack([
      sess({ background_secs_excluded: 24 }),
      sess({ background_secs_excluded: 36 }),
      sess({ background_secs_excluded: null }),
    ]);
    const d = details(container);
    expect(d).toHaveLength(3);
    expect(d[0]).toContain(leftOutLine(24, "sessionStack"));
    expect(d[1]).toContain(leftOutLine(36, "sessionStack"));
    expect(d[2]).not.toContain(t("monitor.sessionStack.leftOut", { span: "" }).trim());
  });

  it("a background-only row says why it has no line instead of 'timeline not kept'", async () => {
    await i18n.changeLanguage(lang);
    const { container } = stack([sess(), background(36)]);
    const notes = [...container.querySelectorAll(".ss-notimeline")].map((n) => n.textContent);
    expect(notes).toEqual([t("monitor.sessionStack.allBackground")]);
  });

  it("minutes read as minutes and seconds", async () => {
    await i18n.changeLanguage(lang);
    const { container } = debrief(sess({ background_secs_excluded: 156 }));
    expect(container.querySelector(".debrief-leftout")?.textContent).toBe(
      t("monitor.sessionDebrief.leftOut", {
        span: t("monitor.leftOut.minutes", { minutes: 2, seconds: 36 }),
      }),
    );
  });
});
