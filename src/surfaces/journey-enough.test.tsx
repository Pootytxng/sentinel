// P5-enough: while the guided journey records, one quiet line says when the session has enough:
// a countdown to MIN_BASELINE_SAMPLES readings that count, then "enough" only once the halves are
// also steady by the shared baseline-grade rule. It shows in the journey panel and in the
// click-through overlay, and nothing on that path can take focus (a focus-stealing message would
// turn real play into background time and corrupt the very session it is counting).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";

const state = vi.hoisted(() => ({ fps: null as Record<string, unknown> | null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_fps_status") return Promise.resolve(state.fps);
    if (cmd === "get_gpu_sensors") return Promise.resolve([]);
    if (cmd === "get_session_summaries" || cmd === "get_experiments") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import Overlay from "../Overlay";
import { GuidedJourney, resetJourneyForTests } from "./GuidedJourney";
import { enoughLine, enoughState, JOURNEY_RECORDING_KEY, type CaptureProgress } from "./journey-enough";

const t = i18n.t.bind(i18n);
/** `samples` readings that count; buckets every 10 s at `first` fps, then `second` fps for the later half. */
const prog = (samples: number, first = 240, second = first): CaptureProgress => {
  const n = Math.ceil(samples / 10);
  return { samples, fps_series: Array.from({ length: n }, (_, i) => [i * 10, i < n / 2 ? first : second] as [number, number]) };
};
const playing = (progress: CaptureProgress | undefined) => ({
  active: true,
  status: "running",
  sample: { process_name: "Valorant", fps: 240, avg_frametime_ms: 4.2, low1_fps: 180, recent_frametimes_ms: [] },
  game_running: true,
  progress,
});

beforeEach(() => {
  resetJourneyForTests({ pollMs: 5, saveWaitMs: 20 });
  void i18n.changeLanguage("en");
});
afterEach(() => {
  resetJourneyForTests();
  cleanup();
  localStorage.clear();
  state.fps = null;
});

describe("the countdown and the enough rule", () => {
  it("counts down to 600 readings in plain seconds, then minutes from 2 min up", () => {
    expect(enoughState(prog(510))).toEqual({ kind: "more", secs: 90 });
    expect(enoughLine(prog(510), t)).toBe("Play the same area for about 90 s more.");
    expect(enoughLine(prog(595), t)).toBe("Play the same area for about 10 s more.");
    expect(enoughLine(prog(0), t)).toBe("Play the same area for about 10 min more.");
    expect(enoughLine(prog(300), t)).toBe("Play the same area for about 5 min more.");
  });

  it("says enough only at 600 readings with steady halves", () => {
    expect(enoughState(prog(599))).toEqual({ kind: "more", secs: 1 });
    expect(enoughState(prog(600))).toEqual({ kind: "enough" });
    expect(enoughLine(prog(600), t)).toBe("Compy has enough; you can stop.");
    // 240 -> 250 fps is a 4.2% swing, past the shared 3% halves floor: not enough yet.
    expect(enoughState(prog(900, 240, 250))).toEqual({ kind: "settling" });
    expect(enoughLine(prog(900, 240, 250), t)).toBe("Keep playing the same area: the frame rate hasn't settled yet.");
    // 240 -> 245 is 2.1%: steady.
    expect(enoughState(prog(900, 240, 245))).toEqual({ kind: "enough" });
    // No trace at all can't be called steady.
    expect(enoughState({ samples: 900, fps_series: [] })).toEqual({ kind: "settling" });
  });

  it("is the same rule as baseline-grade.ts, not a copy of it", () => {
    const src = readFileSync(join("src", "surfaces", "journey-enough.ts"), "utf8");
    expect(src).toMatch(/import \{ gradeBaseline, MIN_BASELINE_SAMPLES \} from "\.\/baseline-grade"/);
    expect(src).not.toMatch(/BASELINE_HALVES_FLOOR_PCT|\b600\b|Math\.abs/);
  });

  it("has zh-CN copy with the same placeholders", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(enoughLine(prog(510), t)).toBe("在同一区域再玩大约 90 秒。");
    expect(enoughLine(prog(600), t)).toBe("Compy 的数据已经够了，你可以停下了。");
  });
});

describe("the journey panel shows it while recording", () => {
  it("counts the readings the capture counted, then says enough", async () => {
    state.fps = playing(prog(510));
    render(
      <GuidedJourney game="Valorant" change={{ id: "hags", title: "HAGS" }} canStart outcome="recommended" onOutcome={() => {}} refresh={async () => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Optimize my game" }));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toBe("Play the same area for about 90 s more."));
    expect(localStorage.getItem(JOURNEY_RECORDING_KEY)).toBe("1");
    state.fps = playing(prog(600));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toBe("Compy has enough; you can stop."));
    state.fps = playing(prog(900, 240, 250));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toMatch(/hasn't settled/));
    // Recording ends: the line and the overlay flag go with it.
    fireEvent.click(screen.getByRole("button", { name: "Done playing" }));
    await waitFor(() => expect(screen.queryByTestId("journey-enough")).toBeNull());
    expect(localStorage.getItem(JOURNEY_RECORDING_KEY)).toBeNull();
  });
});

describe("the overlay shows it only while a journey records", () => {
  it("renders the line from its own poll when the journey flag is set", async () => {
    state.fps = playing(prog(510));
    localStorage.setItem(JOURNEY_RECORDING_KEY, "1");
    render(<Overlay />);
    await waitFor(() => expect(screen.getByTestId("overlay-enough").textContent).toBe("Play the same area for about 90 s more."));
  });

  it("shows nothing for a plain capture with no journey", async () => {
    state.fps = playing(prog(510));
    render(<Overlay />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByTestId("overlay-enough")).toBeNull();
  });
});

describe("the surface can't take focus", () => {
  const read = (...p: string[]) => readFileSync(join(...p), "utf8");
  it("the overlay window it draws in is click-through-only and never focusable", () => {
    const conf = JSON.parse(read("src-tauri", "tauri.conf.json"));
    const overlay = (conf.app.windows as Array<Record<string, unknown>>).find((w) => w.label === "overlay");
    expect(overlay?.focus).toBe(false);
    expect(overlay?.focusable).toBe(false);
  });

  it("nothing on the message path shows, raises or focuses a window", () => {
    const FOCUS = /setFocus|set_focus|show_overlay|unminimize|requestUserAttention|setAlwaysOnTop|\.focus\(|sendNotification|notification\(\)/;
    for (const f of [["src", "surfaces", "journey-enough.ts"], ["src", "Overlay.tsx"], ["src", "surfaces", "GuidedJourney.tsx"]])
      expect(read(...f), f.join("/")).not.toMatch(FOCUS);
    // The Rust side only records and returns numbers: every use of the progress slot is a plain read or write.
    const mon = read("src-tauri", "src", "monitoring.rs");
    const uses = [...mon.matchAll(/lock_progress\(\)[^\n]*/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const u of uses) expect(u).not.toMatch(/set_focus|show\(|notification/);
  });
});
