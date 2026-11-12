import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MonitorConsole } from "./MonitorConsole";
import { READING_ROWS } from "../design/console/Reading";

/** [label, value] of one boxed delta cell (`data-k` = avg | low1 | spikes). */
const cell = (row: Element, k: string): [string, string] => {
  const c = row.querySelector(`.mc-delta-v[data-k="${k}"]`)!;
  return [c.querySelector(".mc-delta-vk")!.textContent!, c.querySelector(".mc-delta-vv")!.textContent!];
};
import type { SessionSummary } from "../types";

// MonitorConsole guards (plan 2026-07-10-console-hud-phase3-monitor Task 3; v5 rewire per plan
// 2026-07-11-monitor-v5-deck-stack T3): the instruments draw ONLY real polled telemetry — (a) a
// live fps stream feeds the deck hero + fps oscilloscope and the gauges show measured values
// with graded ink; (b) helper stopped ⇒ honest STOPPED/no-signal states, never a frozen-as-live
// trace, never a fabricated number; (c) capture state keeps mirroring up via onFpsActive (the
// V2-8 door); (d) NVIDIA GPU temp stays ungraded (LOCKED rule 5); (e) header-slop pin — no
// headings/ledes in the subtree; (f) the v5 face contract — deck delta row (session-scoped,
// cross-game labeled) + SessionStack always mounted, the stack IS the shelf. The Basic/Advanced
// mode fork was retired 2026-08-20 (issue #180 — see monitor-one-face-guard.test.tsx): ONE face,
// and the full gauge cluster (incl. GPU load) is unconditional.

const { invokeMock, deckProps, stackProps } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  deckProps: [] as { ftWin: number[]; live: boolean; budget?: number }[],
  stackProps: [] as { sessions?: SessionSummary[] }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

// The deck hero + stack have their own guard suites (deck-scope.test.tsx /
// session-stack.test.tsx); here we pin the CONTRACT MonitorConsole owes them: always mounted,
// honest live flag + cleared window when the helper stops, the content-stable ftWin REFERENCE
// on content-equal polls (the v3 idle-canvas bug→guard class — a fresh-but-equal array must
// never reach the canvas), and the same sessions array the app passes.
vi.mock("./monitor/DeckScope", () => ({
  DeckScope: (props: { ftWin: number[]; live: boolean; budget?: number }) => {
    deckProps.push({ ftWin: props.ftWin, live: props.live, budget: props.budget });
    return <div data-testid="deck-scope" data-live={String(props.live)} />;
  },
}));
vi.mock("./monitor/SessionStack", () => ({
  SessionStack: (props: { sessions?: SessionSummary[] }) => {
    stackProps.push({ sessions: props.sessions });
    return <div data-testid="session-stack" data-count={String(props.sessions?.length ?? 0)} />;
  },
}));

const cpuSnap = {
  usage_overall_pct: 34.2,
  frequency_mhz: 5100,
  ram_used_bytes: 14.2 * 1024 ** 3,
  ram_total_bytes: 29.4 * 1024 ** 3,
};
const gpuSnap = [{ vendor: "amd", temperature_c: 62, utilization_gpu_pct: 97 }];
const liveFps = {
  active: true,
  status: "capturing",
  sample: {
    fps: 142.3,
    low1_fps: 98.4,
    avg_frametime_ms: 7.0,
    recent_frametimes_ms: [7.1, 6.9, 7.3, 7.0],
  },
};
const stoppedFps = { active: false, status: "idle", sample: null };

function mockPolls(fpsImpl: () => unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
    if (cmd === "get_gpu_sensors") return Promise.resolve(gpuSnap);
    if (cmd === "get_fps_status") return Promise.resolve(fpsImpl());
    return Promise.resolve(null);
  });
}

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
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
    ...over,
  } as SessionSummary;
}
const session = sess();

function mount(over: Partial<Parameters<typeof MonitorConsole>[0]> = {}) {
  const props = {
    active: true,
    sessions: [session],
    onFpsActive: vi.fn(),
    ...over,
  };
  const utils = render(<MonitorConsole {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  // Snap CountTo/motion so gauge numbers render final values immediately.
  localStorage.setItem("compy_motion", "reduced");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  invokeMock.mockReset();
  deckProps.length = 0;
  stackProps.length = 0;
});

describe("MonitorConsole — live stream feeds real instruments (a)", () => {
  it("the fps oscilloscope draws the buffered real samples; the sensor strip shows measured values with graded ink", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelectorAll(".osc-trace").length).toBe(1);
    });
    // Latest readout is the real value.
    expect(screen.getByText(/142\s*fps/)).toBeTruthy();
    // THE SENSOR STRIP (issue #49 slice 4). The five corner ArcGauges became the shared kit's
    // five Readings -- same five facts, same sources, same grading. AMD GPU temp 62°C grades
    // (non-neutral ink), CPU load stays deliberately ungraded (busy while gaming is fine), and a
    // measured cell carries the MEASURED attestation the dial's `measured` prop used to.
    const read = (id: string) => container.querySelector<HTMLElement>(`[data-read="${id}"]`)!;
    expect(container.querySelectorAll(".mc-ev-sensors > .reading").length).toBe(5);
    await waitFor(() => expect(read("gpuTemp").querySelector(".rd-n")!.textContent).toBe("62"));
    expect(read("gpuTemp").classList.contains("rd-good")).toBe(true);
    expect(read("gpuTemp").querySelector(".rd-tag")).not.toBeNull();
    expect(read("cpuLoad").querySelector(".rd-n")!.textContent).toBe("34"); // CPU %
    expect(read("cpuLoad").classList.contains("rd-neutral")).toBe(true);
    expect(read("ram").querySelector(".rd-n")!.textContent).toBe("48"); // RAM % (14.2/29.4)
  });

  it("consumer-term readouts derive from the same real windows (v3 T2)", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(1));
    for (const label of ["MAX FPS", "AVG FPS", "LOWEST LATENCY", "SPIKES"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // One poll buffered fps 142.3 → MAX and AVG both read 142; lowest latency = min(6.9…) ms.
    const values = [...container.querySelectorAll(".mc-readout-v")].map((n) => n.textContent);
    expect(values[0]).toBe("142");
    expect(values[1]).toBe("142");
    expect(values[2]).toBe("6.9 ms");
    expect(values[3]).toBe("0");
  });

  it("the deck hero gets the REAL backend frametime window + budget; stopped ⇒ live=false + a CLEARED window, never frozen-as-live", async () => {
    let live = true;
    mockPolls(() => (live ? liveFps : stoppedFps));
    mount();
    await waitFor(() => {
      const el = screen.getByTestId("deck-scope");
      expect(el.getAttribute("data-live")).toBe("true");
    });
    const fed = deckProps[deckProps.length - 1];
    expect(fed.ftWin).toEqual(liveFps.sample.recent_frametimes_ms);
    live = false;
    await waitFor(
      () => expect(screen.getByTestId("deck-scope").getAttribute("data-live")).toBe("false"),
      { timeout: 3000 },
    );
    const last = deckProps[deckProps.length - 1];
    expect(last.ftWin).toEqual([]);
  }, 8000);

  it("overlay control rides the same audited commands (v3 T4): show on toggle, corner picker persists", async () => {
    mockPolls(() => liveFps);
    mount();
    const btn = await screen.findByRole("button", { name: "Overlay" });
    btn.click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("show_overlay"));
    const corner = await screen.findByRole("button", { name: "Overlay corner bottom right" });
    corner.click();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_overlay_corner", { corner: "bottom-right" }),
    );
    expect(localStorage.getItem("compy_overlay_corner")).toBe("bottom-right");
  });

  it("content-equal polls keep the deck's ftWin REFERENCE stable (idle-canvas bug→guard, v3 self-review round-1 catch)", async () => {
    // Every poll deserializes a FRESH but value-identical window — exactly what the real
    // 1 Hz get_fps_status does when no new frames landed. The deck must receive the SAME
    // array reference each time, or downstream memos rebuild every second.
    mockPolls(() => ({
      ...liveFps,
      sample: { ...liveFps.sample, recent_frametimes_ms: [...liveFps.sample.recent_frametimes_ms] },
    }));
    mount();
    await screen.findByTestId("deck-scope");
    await waitFor(
      () => expect(deckProps.filter((p) => p.ftWin.length > 0).length).toBeGreaterThanOrEqual(3),
      { timeout: 4000 },
    );
    expect(new Set(deckProps.filter((p) => p.ftWin.length > 0).map((p) => p.ftWin)).size).toBe(1);
  }, 8000);

  it("idle STOPPED polls keep the cleared window reference stable too (v4 self-review round-1 catch)", async () => {
    // The !active branch used to assign a fresh [] every 1 Hz tick — a new reference each
    // second that repainted at rest. The reset must be idempotent.
    mockPolls(() => ({ ...stoppedFps }));
    mount();
    await screen.findByTestId("deck-scope");
    await waitFor(() => expect(deckProps.length).toBeGreaterThanOrEqual(3), {
      timeout: 4000,
    });
    expect(new Set(deckProps.map((p) => p.ftWin)).size).toBe(1);
  }, 8000);

  it("capture ON mirrors up via onFpsActive (c)", async () => {
    mockPolls(() => liveFps);
    const { props } = mount();
    await waitFor(() => expect(props.onFpsActive).toHaveBeenLastCalledWith(true));
  });
});

describe("MonitorConsole — helper stopped ⇒ honest stillness (b)", () => {
  it("stopped ⇒ no-signal on the fps scope, Start capture control, no fabricated numbers", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelectorAll(".osc-nosignal").length).toBe(1);
    });
    expect(container.querySelectorAll(".osc-trace").length).toBe(0);
    expect(container.querySelectorAll(".osc-read").length).toBe(0); // no readout invented
    expect(screen.getByRole("button", { name: "Start capture" })).toBeTruthy();
    expect(screen.getByText("start capture, then play")).toBeTruthy();
    // The empty scope says what the next press is, in a sentence, under the eyebrow
    // (intimidation pass 2026-08-20 — "NO SIGNAL" alone read as a fault).
    expect(container.querySelector(".osc-nosignal .osc-nosignal-k")!.textContent).toBe("no signal");
    expect(container.querySelector(".osc-nosignal .osc-nosignal-hint")!.textContent).toBe(
      "Press Start capture, then play — the line draws here.",
    );
    // v3 readouts show honest em-dashes, never fabricated zeros.
    const values = [...container.querySelectorAll(".mc-readout-v")].map((n) => n.textContent);
    expect(values).toEqual(["—", "—", "—", "—"]);
  });

  it("a live trace CLEARS when the helper stops — never frozen-as-live (and the door signal follows)", async () => {
    let live = true;
    mockPolls(() => (live ? liveFps : stoppedFps));
    const { container, props } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(1));
    live = false; // next 1 Hz poll reports stopped
    await waitFor(
      () => expect(container.querySelectorAll(".osc-nosignal").length).toBe(1),
      { timeout: 3000 },
    );
    expect(container.querySelectorAll(".osc-trace").length).toBe(0);
    // The mirror fires in a passive effect (post-paint) — the DOM can show no-signal a beat
    // before it flushes under load, so await it (flaked at full-suite load 2026-07-22).
    await waitFor(() => expect(props.onFpsActive).toHaveBeenLastCalledWith(false), {
      timeout: 3000,
    });
  }, 8000);
});

describe("MonitorConsole — the v5 deck delta row (session-scoped, honest) (f)", () => {
  it("with a same-game prior: plain-number glyph deltas + the changes-on tag (recorded facts only)", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ avg_fps: 247, low1_fps_est: 194, compy_changes_active: 2 }),
        sess({ avg_fps: 240, low1_fps_est: 190 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta")).not.toBeNull());
    const row = container.querySelector(".mc-delta")!;
    // Intimidation pass 2026-08-20: the sentence is plain and the game name keeps its case —
    // no more "VS YOUR LAST VALORANT SESSION".
    expect(row.querySelector(".mc-delta-k")!.textContent).toBe("Compared with your last Valorant session");
    expect(row.textContent).not.toMatch(/different game/i);
    // CR-view-1111d-wording: every delta carries its unit, as History's "+2 fps vs last" does.
    expect(cell(row, "avg")).toEqual(["Avg FPS", "▲7 fps"]);
    expect(cell(row, "low1")).toEqual(["1% low", "▲4 fps"]);
    expect(cell(row, "spikes")).toEqual(["Spikes", "±0 spikes"]);
    expect(row.querySelector(".mc-delta-tag")!.textContent).toContain("2 Compy changes were on");
    // …and NO cross-game caveat, because the prior IS the same game. A caveat that prints
    // unconditionally teaches the reader to stop reading caveats.
    expect(row.querySelector(".mc-delta-note")).toBeNull();
  });

  it("CR-view-1111d-wording: the spikes value says its unit, singular at one, and zh-CN writes it with no space", async () => {
    const { default: i18n } = await import("../i18n");
    const v = (glyph: string, count: number, lng: string) =>
      i18n.t("monitor.monitorConsole.deltaSpikesValue", { glyph, count, lng });
    expect(v("▲1", 1, "en")).toBe("▲1 spike");
    expect(v("▼2", 2, "en")).toBe("▼2 spikes");
    expect(v("±0", 0, "en")).toBe("±0 spikes");
    expect(v("▲4", 4, "zh-CN")).toBe("▲4次");
  });

  it("CR-live-changes-twice: the changes-on count is said once, in the comparison's tag, not again in the readings", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ avg_fps: 247, compy_changes_active: 14 }),
        sess({ avg_fps: 240 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta-tag")).not.toBeNull());
    expect(container.querySelector(".mc-ev-changes")).toBeNull();
    expect((container.textContent!.match(/14 Compy changes were on/g) ?? []).length).toBe(1);
    // Review nit: the strip drops its third column rather than leaving it empty.
    expect(container.querySelector(".mc-ev-readings")!.classList.contains("mc-ev-readings-two")).toBe(true);
  });

  it("CR-live-changes-twice: one change on is also said once (the tag, without the combined-effect note)", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({ sessions: [sess({ avg_fps: 247, compy_changes_active: 1 }), sess({ avg_fps: 240 })] });
    await waitFor(() => expect(container.querySelector(".mc-delta-tag")).not.toBeNull());
    expect(container.querySelector(".mc-ev-changes")).toBeNull();
  });

  it("CR-live-changes-twice: with no comparison (one session) the readings still say the count", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({ sessions: [sess({ avg_fps: 247, compy_changes_active: 14 })] });
    await waitFor(() => expect(container.querySelector(".mc-ev-changes")).not.toBeNull());
    expect(container.querySelector(".mc-delta-tag")).toBeNull();
    expect(container.querySelector(".mc-ev-changes")!.textContent).toBe("14 Compy changes were on");
  });

  it("multiple changes on → the tag says COMBINED EFFECT (no per-change attribution implied); a single change doesn't", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ avg_fps: 247, compy_changes_active: 11 }),
        sess({ avg_fps: 240 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta")).not.toBeNull());
    const tag = container.querySelector(".mc-delta-tag")!;
    expect(tag.textContent).toBe("11 Compy changes were on · combined effect");
    // #677: the caveat is the app's own styled tooltip, not a native `title` on a labelled span.
    // No element in the tag carries a title; the tag's text is a real trigger that hover, focus
    // and tap all open, and the opened tooltip is announced as the trigger's description.
    expect(tag.getAttribute("title")).toBeNull();
    expect(tag.querySelector("[title]")).toBeNull();
    const trigger = tag.querySelector<HTMLButtonElement>("button.kl-term")!;
    expect(trigger.textContent).toBe("11 Compy changes were on · combined effect");
    expect(tag.querySelector('[role="tooltip"]')).toBeNull();
    fireEvent.focus(trigger);
    const tip = tag.querySelector('[role="tooltip"]')!;
    expect(tip.textContent).toContain("one-change-at-a-time");
    expect(tip.textContent).toContain("together");
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    // A caveat, not a glossary entry: no "more in the library" link inside it.
    expect(tip.querySelector("button")).toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(tag.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("exactly one change on → plain tag, no combined-effect caveat", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ avg_fps: 247, compy_changes_active: 1 }),
        sess({ avg_fps: 240 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta")).not.toBeNull());
    const tag = container.querySelector(".mc-delta-tag")!;
    expect(tag.textContent).toBe("1 Compy change was on");
    expect(tag.textContent).not.toMatch(/combined/i);
    expect(tag.getAttribute("title")).toBeNull();
    // One change IS attributable, so there is no caveat to open: plain text, no trigger.
    expect(tag.querySelector("button")).toBeNull();
  });

  it("cross-game prior is LABELED; unrecorded spikes read em-dash, never 0", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ stutter_events: undefined }),
        sess({ process_name: "palworld.exe", avg_fps: 90 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta")).not.toBeNull());
    const row = container.querySelector(".mc-delta")!;
    expect(row.querySelector(".mc-delta-k")!.textContent).toBe(
      "Compared with your last Palworld session · a different game",
    );
    expect(cell(row, "spikes")).toEqual(["Spikes", "—"]);
    // …and it says what the tag MEANS for the three numbers, which is the part a reader acts
    // on (02-live-approved.png prints exactly this line under the cells). Two genres can
    // differ by 50 fps with nothing wrong and nothing improved.
    expect(row.querySelector(".mc-delta-note")!.textContent).toBe(
      "Different game — context only, not a verdict.",
    );
  });

  // Intimidation pass 2026-08-20 (⭐ standing directive: grouping, boxed templates, fewer words —
  // never a switch). The installed build showed the debrief as one all-caps mono string that
  // wrapped mid-thought; the template below is the contract that keeps it a template.
  it("the deck delta is a boxed template: one sentence, three labeled cells, one caveat — no caps-lock", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({
      sessions: [
        sess({ avg_fps: 247, low1_fps_est: 194, compy_changes_active: 2 }),
        sess({ avg_fps: 240, low1_fps_est: 190 }),
      ],
    });
    await waitFor(() => expect(container.querySelector(".mc-delta")).not.toBeNull());
    const row = container.querySelector<HTMLElement>(".mc-delta")!;
    // DOM shape: sentence → cells → tag, in that order; exactly three cells, each label-over-value.
    const kids = Array.from(row.children).map((e) => e.className);
    expect(kids).toEqual(["mc-delta-k", "mc-delta-cells", "mc-delta-tag"]);
    const cells = Array.from(row.querySelectorAll(".mc-delta-cells > .mc-delta-v"));
    expect(cells.length).toBe(3);
    for (const c of cells) {
      expect(Array.from(c.children).map((e) => e.className)).toEqual(["mc-delta-vk", "mc-delta-vv"]);
    }
    // No shouting anywhere in the row: every word of label copy is sentence case.
    const words = row.textContent!.match(/[A-Za-z]{3,}/g) ?? [];
    expect(words.filter((w) => w === w.toUpperCase() && w !== "FPS")).toEqual([]);
    // CSS contract: the row is a column, the cells a 3-up grid, the labels sans (no mono, no
    // uppercase), the value mono.
    const css = readFileSync(join("src", "surfaces", "monitor-console.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`${sel.replace(/[.[\]"=]/g, (ch) => `\\${ch}`)}\\s*\\{([^}]*)\\}`));
      if (!m) throw new Error(`no rule for ${sel}`);
      return m[1];
    };
    expect(rule(':root[data-v2="on"] .mc-delta')).toMatch(/flex-direction:\s*column/);
    expect(rule(':root[data-v2="on"] .mc-delta')).not.toMatch(/font-family/);
    expect(rule(':root[data-v2="on"] .mc-delta-cells')).toMatch(/grid-template-columns:\s*repeat\(3,/);
    expect(rule(':root[data-v2="on"] .mc-delta-v')).toMatch(/border:/);
    for (const sel of [".mc-delta-k", ".mc-delta-vk", ".mc-delta-tag"]) {
      const r = rule(`:root[data-v2="on"] ${sel}`);
      expect(r, `${sel} must not be mono`).not.toMatch(/font-family/);
      expect(r, `${sel} must not shout`).not.toMatch(/text-transform:\s*uppercase/);
    }
    expect(rule(':root[data-v2="on"] .mc-delta-vv')).toMatch(/font-family:\s*var\(--ix-mono\)/);
    // "Fewer words" is part of the directive, and the first review of this pass measured the
    // template at +68% words over the string it replaced (the caveats had grown into clauses).
    // The old string, same facts: "VS YOUR LAST VALORANT SESSION AVG FPS ▲7 1% LOW ▲4 SPIKES ±0
    // 2 COMPY CHANGES ON · COMBINED EFFECT" = 21 words. The template may not exceed it.
    const wordsAll = row.textContent!.trim().split(/\s+/).filter(Boolean);
    expect(wordsAll.length, row.textContent!).toBeLessThanOrEqual(21);
  });

  it("the four readouts are a fixed 2×2 — auto-fit orphaned SPIKES under a two-line LOWEST LATENCY", () => {
    const css = readFileSync(join("src", "surfaces", "monitor-console.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.mc-readouts\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).not.toMatch(/\.mc-readouts\s*\{[^}]*auto-fit/);
  });

  it("no prior session → the row renders NOTHING (honest empty)", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount({ sessions: [session] });
    await waitFor(() => expect(screen.getByTestId("deck-scope")).toBeTruthy());
    expect(container.querySelector(".mc-delta")).toBeNull();
  });
});

describe("MonitorConsole — the stack IS the shelf (f)", () => {
  it("SessionStack mounts with the app's own sessions array; no mode toggle anywhere", async () => {
    mockPolls(() => liveFps);
    mount({ sessions: [session, sess({ avg_fps: 200 })] });
    await waitFor(() => expect(screen.getByTestId("session-stack")).toBeTruthy());
    expect(screen.getByTestId("session-stack").getAttribute("data-count")).toBe("2");
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("no in-console session-history door — the Live/Sessions segments in MonitorV2 are the ONE way over (issue #180)", async () => {
    mockPolls(() => liveFps);
    mount();
    await waitFor(() => expect(screen.getByText("GPU load")).toBeTruthy());
    expect(screen.queryByText("Session history")).toBeNull();
  });
});

describe("MonitorConsole — vendor honesty (d)", () => {
  it("NVIDIA fixture ⇒ the GPU temp reading stays ungraded (LOCKED rule 5)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
      if (cmd === "get_gpu_sensors")
        return Promise.resolve([{ vendor: "nvidia", temperature_c: 62, utilization_gpu_pct: 97 }]);
      if (cmd === "get_fps_status") return Promise.resolve(stoppedFps);
      return Promise.resolve(null);
    });
    const { container } = mount();
    // A reading's identity is WHICH FACT it states, never where it sits (Reading.tsx). That is
    // exactly why this guard survived slice 4 moving the fact out of a corner-pinned dial and
    // into the strip: the selector never described the layout in the first place.
    await waitFor(() =>
      expect(container.querySelector('[data-read="gpuTemp"] .rd-n')!.textContent).toBe("62"),
    );
    const gpuRead = container.querySelector('[data-read="gpuTemp"]')!;
    expect(gpuRead.classList.contains("rd-neutral")).toBe(true);
    expect(gpuRead.classList.contains("rd-good")).toBe(false);
    expect(gpuRead.classList.contains("rd-warn")).toBe(false);
  });

  // Codebase review 2026-11-03: the tone came from hw.gpus[0]'s vendor, so a hybrid laptop (iGPU
  // first in DXGI order) graded the hottest snapshot — the RTX's NVML reading — as verified.
  it("the hottest snapshot grades by ITS OWN vendor, so a hybrid rig's NVML reading stays neutral", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
      if (cmd === "get_gpu_sensors")
        return Promise.resolve([
          { vendor: "NVIDIA", temperature_c: 91, utilization_gpu_pct: 97 },
          { vendor: "AMD", temperature_c: 48, utilization_gpu_pct: 3 },
        ]);
      if (cmd === "get_fps_status") return Promise.resolve(stoppedFps);
      return Promise.resolve(null);
    });
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-read="gpuTemp"] .rd-n')!.textContent).toBe("91"),
    );
    expect(container.querySelector('[data-read="gpuTemp"]')!.classList.contains("rd-neutral")).toBe(true);
  });
});

describe("MonitorConsole — motion contract (Task 4)", () => {
  it("reduced motion → the console root carries data-motion='reduced' (still page), no reticle", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(container.querySelector(".monitor-console")!.getAttribute("data-motion")).toBe(
      "reduced",
    );
    // The reticle Target Cursor renders nothing under reduced motion (kit contract).
    expect(container.querySelector(".lc-reticle")).toBeNull();
  });

  it("full motion → data-motion='full' (the reveal/spotlight CSS keys off it)", async () => {
    localStorage.setItem("compy_motion", "full");
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(container.querySelector(".monitor-console")!.getAttribute("data-motion")).toBe("full");
  });

  it("never paints the vendor MagicBento purple — the console is token-only", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(1));
    expect(container.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
  });
});

describe("MonitorConsole — laws (e) + the one face", () => {
  // SHARPENED for the bento conversion (2026-08-12). The old form counted h1/h2/h3 and required 0,
  // which was a PROXY for the title-header law ("a header is a name, never a status sentence") back
  // when the console had no headings of any kind. BentoTile labels its boxes with an <h3
  // class="v2-tile-title">, so the count would now fail on markup the law actually allows. The pin
  // is therefore made stricter, not weaker: still zero room-level headings inside a room body, and
  // every h3 must be a tile title carrying a short noun phrase — no lede strip, no sentence.
  it("header-slop pin: no lede strips; every heading is a short noun-phrase tile title", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    // RE-SCOPED, NOT RELAXED (issue #49 slice 4). The live face now composes its own RoomShell,
    // so the room has exactly ONE h1 and it is the shell's verdict slot -- the same slot every
    // other room fills. What the law actually bans is a heading inside the room BODY and a
    // heading that is really a status sentence, and both are still pinned below.
    expect(
      container.querySelectorAll(".monitor-console h1, .monitor-console h2, .monitor-console h3")
        .length,
    ).toBe(0);
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s.length).toBe(1);
    expect(h1s[0].closest(".v2-verdict"), "the one h1 must be the shell's verdict").not.toBeNull();
    const h3s = [...container.querySelectorAll("h2, h3")];
    for (const h of h3s) {
      expect(h.className, `heading "${h.textContent}" is not a titled tile or panel`).toMatch(
        /v2-tile-title|mc-ev-title/,
      );
      const text = (h.textContent ?? "").trim();
      expect(text.length, `tile title "${text}" is long enough to be a status sentence`).
        toBeLessThanOrEqual(24);
      expect(text, `tile title "${text}" is punctuated like a sentence`).not.toMatch(/[.!?]$/);
    }
  });

  it("the full gauge cluster is unconditional — GPU load renders on the one face (issue #180)", async () => {
    mockPolls(() => liveFps);
    mount();
    await waitFor(() => expect(screen.getByText("GPU temp")).toBeTruthy());
    expect(screen.getByText("GPU load")).toBeTruthy();
  });
});

// == issue #49 slice 4: the contracts that MOVED INTO this component =========================
// The approved Live comp is the four-room SPLIT -- a narrative column beside an evidence column --
// and both halves are built from state THIS component owns (the capture stream, the sensors, the
// session array). So the live face composes its own RoomShell instead of having that ownership
// hoisted into MonitorV2 and the room's one 1 Hz poll split in two. These are the shell contracts
// that used to be pinned in monitor-v2.test.tsx against a MonitorConsole *stub*; a stub cannot
// prove them any more, so they are pinned here, against the real component.
describe("MonitorConsole - the live face owns the room's shell (issue #49 slice 4)", () => {
  it("ONE verdict, ONE forward door to Blackbook, ONE primary action and it is the capture toggle", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toContain("Ready when you are");
    // The forward affordance MOVED into the narrative foot as the comp's route row (2026-08-23)
    // -- it did not multiply: the bottom doorknob is gone from this face, and there is still
    // exactly one way forward, to the same room the DOOR_MAP always sent it to.
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
    const routes = container.querySelectorAll(".v2-route-row");
    expect(routes.length).toBe(1);
    expect(routes[0].textContent).toContain("View all sessions in History");
    // The one-mention law: the capture control MOVED into the action slot, it was not copied
    // there -- there is still exactly one Start/Stop capture button on the screen.
    const actions = container.querySelectorAll(".v2-verdict-action button");
    expect(actions.length).toBe(1);
    expect(actions[0].textContent).toBe("Start capture");
    expect(screen.getAllByRole("button", { name: /^(Start|Stop) capture$/ }).length).toBe(1);
  });

  it("closes the forward door while a capture is recording (V2-8 placement, carried)", async () => {
    // The door belongs to the session-END state. It used to be MonitorV2 that closed it, off the
    // onFpsActive mirror; the face owns the stream, so it now answers directly -- and the mirror
    // still fires, because Sessions (where no face is mounted) still needs it.
    let live = true;
    mockPolls(() => (live ? liveFps : stoppedFps));
    const { container, props } = mount();
    await waitFor(() => expect(container.querySelectorAll(".v2-route-row").length).toBe(0));
    expect(container.querySelector(".v2-verdict h1")!.textContent).toContain(
      "Recording your session",
    );
    // The padlocked method line is NOT the door and does not close with it -- how capture works
    // is true while it is running, and that is exactly when a user wants to read it.
    expect(container.querySelectorAll(".v2-footnote").length).toBe(1);
    live = false;
    await waitFor(() => expect(container.querySelectorAll(".v2-route-row").length).toBe(1), {
      timeout: 3000,
    });
    await waitFor(() => expect(props.onFpsActive).toHaveBeenLastCalledWith(false), {
      timeout: 3000,
    });
  }, 8000);

  it("renders the two pieces the ROOM hands down - segment bar and quiet slot", async () => {
    // bug->guard: MonitorV2 builds the segment bar and the advisory-presets expander once (they
    // belong to the room, not to either face) and passes them down. Drop either prop and the Live
    // screen silently loses its tab bar -- a whole navigation control, gone with a green build.
    mockPolls(() => stoppedFps);
    const { container } = mount({
      bar: <div data-testid="room-bar" />,
      quiet: <button type="button">room-quiet</button>,
    });
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(screen.getByTestId("room-bar")).toBeTruthy();
    expect(container.querySelector(".v2-quiet-slot button")!.textContent).toBe("room-quiet");
  });

  it("the evidence column states the last session, and says so honestly when there is none", async () => {
    mockPolls(() => stoppedFps);
    const { container, unmount } = mount();
    await waitFor(() => expect(container.querySelector(".mc-ev-title")).not.toBeNull());
    expect(container.querySelector(".mc-ev-title")!.textContent).toContain("Valorant");
    expect(container.querySelector('[data-read="avgFps"] .rd-n')!.textContent).toBe("240");
    expect(container.querySelector('[data-read="low1"] .rd-n')!.textContent).toBe("190");
    unmount();

    const bare = mount({ sessions: [] });
    await waitFor(() => expect(bare.container.querySelector(".mc-ev-none")).not.toBeNull());
    // Honest empty: no session is a real state, and it never renders as a zero-fps session.
    expect(bare.container.querySelector(".mc-ev-none")!.textContent).toContain(
      "No session recorded yet",
    );
    expect(bare.container.querySelector('[data-read="avgFps"]')).toBeNull();
  });
});

// == THE READING_ROWS PARENT CONTRACT, guarded from the PLACING side ==========================
// bug->guard, carried from Health's self-review round 10 (issue #49). A Reading subgrids onto its
// PARENT's rows so row 1 is as tall as the tallest LABEL across the whole strip. Health shipped
// the staggered version -- "GPU TEMP" wrapping at 1280x720 where "AVG FPS" did not, pushing one
// value 17px below its neighbours -- and a full review round was spent finding it. Live places
// Readings in TWO strips, so it inherits the obligation twice. Reading.tsx states the contract;
// this is the half that proves Live actually satisfies it, and it derives every number from
// READING_ROWS so adding a fourth row to the cell can never leave a strip declaring three.
describe("MonitorConsole - the READING_ROWS parent contract on both strips", () => {
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rulesFor = (cls: string, source: string) =>
    Array.from(stripComments(source).matchAll(/([^{}]+)\{([^}]*)\}/g))
      .filter(([, sel]) => new RegExp("\\" + cls + "(?![\\w-])").test(sel))
      .map(([, , body]) => body)
      .join("\n");

  const sheet = () => readFileSync(join("src", "surfaces", "monitor-console.css"), "utf8");

  for (const strip of [".mc-ev-readings", ".mc-ev-sensors"]) {
    it("CSS: " + strip + " owns exactly READING_ROWS row tracks", () => {
      const blk = rulesFor(strip, sheet());
      expect(blk, strip + " must be styled at all").not.toBe("");
      expect(blk, strip + " places Readings, so it must be the grid they subgrid onto").toMatch(
        /display:\s*grid/,
      );
      const rows = /grid-template-rows:\s*([^;]+);/.exec(blk);
      expect(rows, strip + " must own the rows its readings are laid onto").not.toBeNull();
      expect(
        rows![1].trim().split(/\s+/).length,
        "label, value and attestation - Reading.tsx's READING_ROWS, which is what its cells span",
      ).toBe(READING_ROWS);
    });
  }

  it("every NON-Reading cell in either strip spans the strip's rows", async () => {
    // The half a CSS-only guard cannot see. `.mc-ev-changes` is a plain span sitting between two
    // Readings; without an explicit span it occupies the LABEL row alone and the strip grows a
    // fourth line under it. This walks the RENDERED children, so the next sibling somebody adds is
    // caught the same way -- the failure class, not the one instance.
    mockPolls(() => stoppedFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".mc-ev-readings")).not.toBeNull());
    const css = sheet();
    for (const strip of [".mc-ev-readings", ".mc-ev-sensors"]) {
      const el = container.querySelector(strip)!;
      const strays = [...el.children].filter((c) => !c.classList.contains("reading"));
      for (const c of strays) {
        const cls = [...c.classList].map((n) => "." + n);
        expect(
          cls.length,
          "a bare <" + c.tagName.toLowerCase() + "> in " + strip + " has no class to span with",
        ).toBeGreaterThan(0);
        const span = /grid-row:\s*span\s*(\d+)/.exec(cls.map((n) => rulesFor(n, css)).join("\n"));
        expect(
          span,
          cls.join("") + " sits in " + strip + " beside Readings and must span its rows " +
            "explicitly, or it lands in the label row alone and the strip grows a row under it",
        ).not.toBeNull();
        expect(
          Number(span![1]),
          cls.join("") + " spans " + span![1] + " of " + strip + "'s " + READING_ROWS + " rows",
        ).toBe(READING_ROWS);
      }
    }
  });
});
