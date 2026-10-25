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

const state = vi.hoisted(() => ({ fps: null as Record<string, unknown> | null, sessions: [] as unknown[], concluded: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_fps_status") return Promise.resolve(state.fps);
    if (cmd === "get_gpu_sensors") return Promise.resolve([]);
    if (cmd === "get_session_summaries") return Promise.resolve(state.sessions);
    if (cmd === "get_experiments") return Promise.resolve([]);
    if (cmd === "start_experiment")
      return Promise.resolve({ id: "exp:1-0", rec_id: "hags", rec_title: "HAGS", game: "Valorant", status: "running", verdict: null });
    if (cmd === "conclude_experiment") {
      state.concluded += 1;
      // The backend's own grade of an after-session whose halves differ past the floor (experiment.rs).
      return Promise.resolve({ id: "exp:1-0", rec_id: "hags", rec_title: "HAGS", game: "Valorant", status: "restored", verdict: "too-noisy", outcome: "recommended" });
    }
    return Promise.resolve(null);
  }),
}));

import Overlay from "../Overlay";
import { GuidedJourney, resetJourneyForTests } from "./GuidedJourney";
import { enoughLine, enoughState, JOURNEY_RECORDING_KEY, SETTLE_CAP_SAMPLES, type CaptureProgress } from "./journey-enough";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";

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
  state.sessions = [];
  state.concluded = 0;
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

describe("P5-enough-f1: halves that never settle don't keep the line up forever", () => {
  it("caps 'hasn't settled' at twice the minimum counted readings, then says so plainly", () => {
    expect(SETTLE_CAP_SAMPLES).toBe(2 * MIN_BASELINE_SAMPLES);
    expect(enoughState(prog(SETTLE_CAP_SAMPLES - 1, 240, 250))).toEqual({ kind: "settling" });
    expect(enoughLine(prog(SETTLE_CAP_SAMPLES - 1, 240, 250), t, "overlay")).toBe("Not settled yet. Keep playing this area.");
    expect(enoughState(prog(SETTLE_CAP_SAMPLES, 240, 250))).toEqual({ kind: "unsettled", untraced: false });
    expect(enoughState(prog(5400, 240, 300))).toEqual({ kind: "unsettled", untraced: false });
    expect(enoughLine(prog(SETTLE_CAP_SAMPLES, 240, 250), t)).toBe(
      "The frame rate in this game keeps changing, so it may not settle. You can stop now; Compy will count this session as uneven.",
    );
    expect(enoughLine(prog(SETTLE_CAP_SAMPLES, 240, 250), t, "overlay")).toBe("Keeps changing. Stop now; it counts as uneven.");
    // Steady halves past the cap are still plain "enough", never the cap line.
    expect(enoughState(prog(SETTLE_CAP_SAMPLES, 240, 245))).toEqual({ kind: "enough" });
    // No trace: never called uneven, because nothing was measured swinging.
    expect(enoughState({ samples: SETTLE_CAP_SAMPLES, fps_series: [] })).toEqual({ kind: "unsettled", untraced: true });
    expect(enoughLine({ samples: SETTLE_CAP_SAMPLES, fps_series: [] }, t)).not.toMatch(/uneven/);
    expect(enoughLine({ samples: SETTLE_CAP_SAMPLES, fps_series: [] }, t, "overlay")).toBe("Can't check if it's steady. You can stop now.");
  });

  it("has zh-CN copy for every cap line", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(enoughLine(prog(SETTLE_CAP_SAMPLES, 240, 250), t)).toBe("这个游戏的帧率一直在变，可能稳定不下来。你现在可以停下；Compy 会把这一局记为不平稳。");
    expect(enoughLine(prog(SETTLE_CAP_SAMPLES, 240, 250), t, "overlay")).toBe("帧率一直在变。可以停下；这局记为不平稳。");
    expect(enoughLine({ samples: SETTLE_CAP_SAMPLES, fps_series: [] }, t, "overlay")).toBe("无法判断是否稳定。你现在可以停下。");
  });

  it("offers Stop now in the panel, and stopping lands in the journey's own uneven step", async () => {
    const t0 = Date.now();
    state.fps = playing(prog(900, 240, 250));
    render(
      <GuidedJourney game="Valorant" change={{ id: "hags", title: "HAGS" }} canStart outcome="recommended" onOutcome={() => {}} refresh={async () => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Optimize my game" }));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toMatch(/hasn't settled/));
    expect(screen.queryByRole("button", { name: "Stop now" })).toBeNull();
    state.fps = playing(prog(SETTLE_CAP_SAMPLES, 240, 250));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toMatch(/keeps changing/));
    expect(screen.queryByRole("button", { name: "Done playing" })).toBeNull();
    // The saved session is the one the capture measured: graded by the shared rule, not by this line.
    const n = SETTLE_CAP_SAMPLES / 10;
    state.sessions = [
      {
        started_at: new Date(t0 + 500).toISOString(),
        process_name: "Valorant",
        samples: SETTLE_CAP_SAMPLES,
        avg_fps: 245,
        low1_fps_est: 180,
        avg_frametime_ms: 4.1,
        duration_secs: SETTLE_CAP_SAMPLES,
        fps_series: Array.from({ length: n }, (_, i) => [i * 10, i < n / 2 ? 240 : 250] as [number, number]),
      },
    ];
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    await waitFor(() => expect(screen.getByTestId("journey").getAttribute("data-phase")).toBe("uneven"));
    expect(screen.getByTestId("journey-line").textContent).toMatch(/swung from 240 to 250 fps, too uneven/);
    expect(screen.queryByTestId("journey-enough")).toBeNull();
    expect(localStorage.getItem(JOURNEY_RECORDING_KEY)).toBeNull();
  });

  /** A saved session as the capture measured it: `traced` false = no fps buckets at all. */
  const saved = (at: number, samples: number, first: number, second: number, traced = true) => {
    const n = samples / 10;
    return {
      started_at: new Date(at).toISOString(),
      process_name: "Valorant",
      samples,
      avg_fps: (first + second) / 2,
      low1_fps_est: 180,
      avg_frametime_ms: 4.1,
      duration_secs: samples,
      fps_series: traced ? Array.from({ length: n }, (_, i) => [i * 10, i < n / 2 ? first : second] as [number, number]) : [],
    };
  };
  const journey = () =>
    render(
      <GuidedJourney game="Valorant" change={{ id: "hags", title: "HAGS" }} canStart outcome="recommended" onOutcome={() => {}} refresh={async () => {}} />,
    );

  it("no trace: Stop now is offered and lands in the journey's untraced step, never called uneven", async () => {
    const t0 = Date.now();
    state.fps = playing({ samples: SETTLE_CAP_SAMPLES, fps_series: [] });
    journey();
    fireEvent.click(screen.getByRole("button", { name: "Optimize my game" }));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toMatch(/can't see enough of the frame-rate trace/));
    expect(screen.queryByRole("button", { name: "Done playing" })).toBeNull();
    state.sessions = [saved(t0 + 500, SETTLE_CAP_SAMPLES, 240, 240, false)];
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    await waitFor(() => expect(screen.getByTestId("journey").getAttribute("data-phase")).toBe("uneven"));
    expect(screen.getByTestId("journey-line").textContent).toMatch(
      /^Compy couldn't check how steady that session was, so it can't compare against it\./,
    );
    expect(screen.getByTestId("journey-line").textContent).not.toMatch(/swung/);
  });

  it("session 2: Stop now goes to conclude, whose too-noisy verdict puts the change back", async () => {
    const t0 = Date.now();
    // Session 1 is steady and enough: the owner stops it the usual way.
    state.fps = playing(prog(900, 240, 242));
    journey();
    fireEvent.click(screen.getByRole("button", { name: "Optimize my game" }));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toBe("Compy has enough; you can stop."));
    const baseline = saved(t0 + 500, 900, 240, 242);
    state.sessions = [baseline];
    fireEvent.click(screen.getByRole("button", { name: "Done playing" }));
    await waitFor(() => expect(screen.getByTestId("journey").getAttribute("data-phase")).toBe("with-change"));
    // Session 2 never settles: past the cap the same Stop now shows.
    state.fps = playing(prog(SETTLE_CAP_SAMPLES, 240, 250));
    await waitFor(() => expect(screen.getByTestId("journey-enough").textContent).toMatch(/keeps changing/));
    state.sessions = [baseline, saved(Date.now() + 500, SETTLE_CAP_SAMPLES, 240, 250)];
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    await waitFor(() => expect(screen.getByTestId("journey").getAttribute("data-phase")).toBe("result"));
    expect(state.concluded).toBe(1);
    expect(screen.getByTestId("journey-line").textContent).toBe("Put HAGS back: the frame rate moved around too much to tell.");
  });

  it("the overlay shows the short cap line", async () => {
    state.fps = playing(prog(SETTLE_CAP_SAMPLES, 240, 250));
    localStorage.setItem(JOURNEY_RECORDING_KEY, "1");
    render(<Overlay />);
    await waitFor(() => expect(screen.getByTestId("overlay-enough").textContent).toBe("Keeps changing. Stop now; it counts as uneven."));
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
