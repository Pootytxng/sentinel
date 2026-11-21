import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";

// M6-unread: seconds Compy could not look at (the capture helper could not read the Windows process
// snapshot) are left out of every number and said, once, in plain words. "Couldn't read" is never
// "none": nothing is said when there are none, and past a fifth of the session the figures are
// marked, not graded.

const LOCALES = ["en", "zh-CN"] as const;

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: new Date().toISOString(),
    duration_secs: 70,
    process_name: "aniimo.exe",
    samples: 60,
    avg_fps: 144,
    avg_frametime_ms: 6.9,
    low1_fps_est: 130,
    peak_gpu_temp_c: 70,
    peak_gpu_usage_pct: 95,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
    stutter_timeline: [],
    stutter_events: [],
    ...over,
  } as SessionSummary;
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;

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

afterEach(cleanup);
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("the debrief line for seconds Compy couldn't measure", () => {
  it("says it in plain words (English, exact)", async () => {
    await i18n.changeLanguage("en");
    const { container } = debrief(sess({ unreadable_seconds: 10 }));
    expect(container.querySelector(".debrief-unreadable")?.textContent).toBe(
      "Compy couldn't measure 10 of this session's 70 seconds, so the numbers cover the rest.",
    );
  });

  it("says the same thing in Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = debrief(sess({ unreadable_seconds: 10 }));
    expect(container.querySelector(".debrief-unreadable")?.textContent).toBe(
      "本次会话的 70 秒中，Compy 有 10 秒无法测量，所以这些数字只涵盖其余部分。",
    );
  });

  describe.each(LOCALES)("(%s)", (lang) => {
    it("is absent when there are none: 0, null and a row that never had the field", async () => {
      await i18n.changeLanguage(lang);
      for (const v of [0, null, undefined]) {
        const { container } = debrief(sess({ unreadable_seconds: v }));
        expect(container.querySelector(".debrief-unreadable")).toBeNull();
        cleanup();
      }
    });

    it("stands beside the normal verdict while under a fifth is unmeasured, and grades as before", async () => {
      await i18n.changeLanguage(lang);
      const { container } = debrief(sess({ unreadable_seconds: 14 })); // exactly 20% of 70 s
      expect(container.querySelector(".debrief-unreadable")?.textContent).toBe(
        t("monitor.sessionDebrief.unreadable", { count: 14, total: 70 }),
      );
      expect(container.querySelector(".debrief-sub")?.textContent).not.toBe(
        t("monitor.sessionDebrief.verdict.partial.sub"),
      );
    });

    it("past a fifth the figures are marked: no verdict, the partial reason, the numbers still shown", async () => {
      await i18n.changeLanguage(lang);
      const { container } = debrief(sess({ unreadable_seconds: 15 })); // over 20% of 70 s
      expect(container.querySelector(".debrief-verdict")?.textContent).toBe(
        t("monitor.sessionDebrief.verdict.partial.headline"),
      );
      expect(container.querySelector(".debrief-sub")?.textContent).toBe(
        t("monitor.sessionDebrief.verdict.partial.sub"),
      );
      expect(container.querySelector(".debrief-unreadable")?.textContent).toBe(
        t("monitor.sessionDebrief.unreadable", { count: 15, total: 70 }),
      );
      // The measured seconds' own figures are still printed (ungraded), never blanked into "0".
      expect(container.textContent).toContain("144");
    });

    it("a session with no reading at all and every second unreadable is not graded and says why", async () => {
      await i18n.changeLanguage(lang);
      const { container } = debrief(
        sess({ samples: 0, avg_fps: 0, avg_frametime_ms: 0, low1_fps_est: 0, unreadable_seconds: 70 }),
      );
      expect(container.querySelector(".debrief-sub")?.textContent).toBe(
        t("monitor.sessionDebrief.verdict.partial.sub"),
      );
      expect(container.querySelector(".debrief-unreadable")?.textContent).toBe(
        t("monitor.sessionDebrief.unreadable", { count: 70, total: 70 }),
      );
    });
  });
});
