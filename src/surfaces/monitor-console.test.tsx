import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MonitorConsole } from "./MonitorConsole";

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
    vendor: "amd" as const,
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
  it("the fps oscilloscope draws the buffered real samples; gauges show measured values with graded ink", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelectorAll(".osc-trace").length).toBe(1);
    });
    // Latest readout is the real value.
    expect(screen.getByText(/142\s*fps/)).toBeTruthy();
    // Gauges: AMD GPU temp 62°C grades (non-neutral ink), CPU stays deliberately ungraded.
    const gauges = container.querySelectorAll(".arc-gauge");
    expect(gauges.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".arc-gauge.ag-good")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("62")).toBeTruthy());
    expect(screen.getByText("34")).toBeTruthy(); // CPU %
    expect(screen.getByText("48")).toBeTruthy(); // RAM % (14.2/29.4)
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
    expect(cell(row, "avg")).toEqual(["Avg FPS", "▲7"]);
    expect(cell(row, "low1")).toEqual(["1% low", "▲4"]);
    expect(cell(row, "spikes")).toEqual(["Spikes", "±0"]);
    expect(row.querySelector(".mc-delta-tag")!.textContent).toContain("2 Compy changes were on");
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
    expect(tag.getAttribute("title")).toContain("one-change-at-a-time");
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
  it("NVIDIA fixture ⇒ the GPU temp gauge stays ungraded (LOCKED rule 5)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
      if (cmd === "get_gpu_sensors")
        return Promise.resolve([{ vendor: "nvidia", temperature_c: 62, utilization_gpu_pct: 97 }]);
      if (cmd === "get_fps_status") return Promise.resolve(stoppedFps);
      return Promise.resolve(null);
    });
    mount({ vendor: "nvidia" });
    await waitFor(() => expect(screen.getByText("62")).toBeTruthy());
    const gpuGauge = screen.getByText("GPU temp").closest(".arc-gauge");
    expect(gpuGauge?.classList.contains("ag-neutral")).toBe(true);
    expect(gpuGauge?.classList.contains("ag-good")).toBe(false);
    expect(gpuGauge?.classList.contains("ag-warn")).toBe(false);
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
    expect(container.querySelectorAll("h1, h2").length).toBe(0);
    const h3s = [...container.querySelectorAll("h3")];
    for (const h of h3s) {
      expect(h.className, `heading "${h.textContent}" is not a bento tile title`).toContain(
        "v2-tile-title",
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
