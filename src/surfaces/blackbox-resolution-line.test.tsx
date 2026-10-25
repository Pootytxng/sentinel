import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BlackBox } from "./BlackBox";
import i18n from "../i18n";
import type { BlackBoxReport, CrashIncident } from "../types";

// P6-next-f3: the "Did this help?" measured line was built in English inside blackbox-resolution.ts,
// so a zh-CN viewer read "No App crash (Wardogs.exe) recorded in the 6 days since." in the middle of
// a Chinese page. resolutionFor now returns facts; ResolutionFeedback words them from locale keys.

const harness = vi.hoisted(() => ({ report: { incidents: [], skipped_sources: [] } as unknown }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => Promise.resolve(cmd === "get_crash_blackbox" ? harness.report : null)),
}));

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function incident(tag: string, whenMs: number, app: string | null): CrashIncident {
  return {
    incident_id: `${tag}-${whenMs}-${app}`,
    headline: `${tag} headline ${whenMs}`,
    tag,
    when: iso(whenMs),
    when_display: "d",
    vitals: null,
    receipt: { source: "s", event_ids: [], faulting_app: app, faulting_module: null, code: null, detail: "" },
    assessment: {
      consistent_with: "x",
      strength: "strong",
      evidence: [],
      next_step: { headline: "Step headline", detail: "d", reversible: true, research_only: false },
      beyond_us: false,
    },
  };
}

// A timestamped "yes" mark on `target`, as ResolutionFeedback stores it.
function markYes(target: CrashIncident, markedAtMs: number) {
  localStorage.setItem(
    "compy_bb_feedback",
    JSON.stringify([{ when: target.when, consistent_with: "x", vote: "yes", at: iso(markedAtMs) }]),
  );
}

async function lineFor(incidents: CrashIncident[], lang: "en" | "zh-CN"): Promise<string> {
  await i18n.changeLanguage(lang);
  harness.report = { incidents, skipped_sources: [] } as BlackBoxReport;
  render(<BlackBox />);
  fireEvent.click(document.querySelector(".bb-scan") as HTMLElement);
  const el = await screen.findByText((_, node) => !!node?.classList.contains("bb-resolved-since"));
  return el.textContent ?? "";
}

describe("Black Box resolution line is worded in the viewer's language (P6-next-f3)", () => {
  const now = Date.now();
  const markedAt = now - 6 * DAY - 3_600_000;

  it("zh-CN: a named app crash with no recurrence reads Chinese, app kept as data", async () => {
    const target = incident("App crash", markedAt - 3_600_000, "Wardogs.exe");
    markYes(target, markedAt);
    const line = await lineFor([target], "zh-CN");
    expect(line).toBe("此后的 6 天里没有记录到 Wardogs.exe 崩溃。");
  });

  it("zh-CN: a recurrence reads Chinese with a zh-CN date", async () => {
    const target = incident("App hang", markedAt - 3_600_000, "Wardogs.exe");
    const againAt = markedAt + 2 * DAY;
    const again = incident("App hang", againAt, "wardogs.exe");
    markYes(target, markedAt);
    const line = await lineFor([target, again], "zh-CN");
    const date = new Date(againAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    expect(line).toBe(`Wardogs.exe 在 ${date} 又停止响应了。`);
    expect(line).not.toMatch(/[A-Za-z]{3,} (happened|again|recorded)/);
  });

  it("zh-CN: a kind with no app keeps the tag as data inside a Chinese sentence", async () => {
    const target = incident("GPU timeout", markedAt - 3_600_000, null);
    markYes(target, markedAt);
    expect(await lineFor([target], "zh-CN")).toBe("此后的 6 天里没有记录到 GPU timeout。");
  });

  it("en: plural days, singular day, and the named-app recurrence", async () => {
    const target = incident("App crash", markedAt - 3_600_000, "Wardogs.exe");
    markYes(target, markedAt);
    expect(await lineFor([target], "en")).toBe("No Wardogs.exe crash recorded in the 6 days since.");
    cleanup();

    const oneDayMark = now - DAY - 3_600_000;
    const blue = incident("Blue screen", oneDayMark - 3_600_000, null);
    markYes(blue, oneDayMark);
    expect(await lineFor([blue], "en")).toBe("No Blue screen recorded in the 1 day since.");
    cleanup();

    const againAt = markedAt + 2 * DAY;
    markYes(target, markedAt);
    const line = await lineFor([target, incident("App crash", againAt, "WARDOGS.EXE")], "en");
    const date = new Date(againAt).toLocaleDateString("en", { month: "short", day: "numeric" });
    expect(line).toBe(`Wardogs.exe crashed again on ${date}.`);
  });
});
