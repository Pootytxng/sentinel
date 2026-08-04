import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MonitorV2 } from "./MonitorV2";
import Monitor from "./Monitor";
import { monitorVerdict as monitorVerdictRaw } from "./monitor-v2-data";
import type { SessionSummary } from "../types";
// i18n update (2026-07-23): monitorVerdict's headline/sub now come from t(...) (Simplified
// Chinese translation pass) instead of literal English strings, so it takes a TFunction as its
// last param. This test-local wrapper resolves it through the real i18next instance (English is
// the default language, matching what every assertion below already expects) so every call site
// below stays exactly as written — same text, just sourced from locale JSON instead of a .ts
// literal.
import i18n from "../i18n";

const monitorVerdict = (sessions: SessionSummary[]) => monitorVerdictRaw(sessions, i18n.t);

// V2-5 guards (bug→guard tier 1): the V2 Monitor room composes RoomShell (one verdict, one
// door to Blackbook), its verdict is a PURE derivation from the real session records (graded
// by the SAME shortVerdict the debrief uses; honest empty state; branch-proper copy — never
// "(s)"), Basic/Advanced + Live/Sessions semantics match the classic shell exactly, the quiet
// slot carries the advisory Tuning presets in Advanced only, and the CLASSIC Monitor render
// stays pinned unchanged (no RoomShell chrome, standalone presets title intact).

// Play and MonitorBasic are the audited heavy surfaces — composed VERBATIM with the same
// props, covered by their own suites. Stubs expose `view` and the onOpenSessions route so the
// shell contracts are testable. monitor-v2-data imports the REAL shortVerdict/fmtDur from
// ./Play, so the mock must pass the original named exports through.
vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    default: (props: { view: string; onFpsActive?: (a: boolean) => void }) => (
      <div data-testid={`play-${props.view}`}>
        <button type="button" onClick={() => props.onFpsActive?.(true)}>
          stub-play-capture-on
        </button>
      </div>
    ),
  };
});
vi.mock("./MonitorBasic", () => ({
  MonitorBasic: (props: { onOpenSessions: () => void; onFpsActive?: (a: boolean) => void }) => (
    <div data-testid="monitor-basic">
      <button type="button" onClick={props.onOpenSessions}>
        stub-open-sessions
      </button>
      <button type="button" onClick={() => props.onFpsActive?.(true)}>
        stub-capture-on
      </button>
      <button type="button" onClick={() => props.onFpsActive?.(false)}>
        stub-capture-off
      </button>
    </div>
  ),
}));
// MonitorV2's one-shot sensor pre-warm (read-only) — jsdom has no Tauri IPC. `get_fps_status` is
// driven by `ipc.fpsActive` so the self-correcting off-Live capture poll (below) is testable.
const ipc = vi.hoisted(() => ({ fpsActive: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) =>
    Promise.resolve(cmd === "get_fps_status" ? { active: ipc.fpsActive } : null),
  ),
}));

beforeAll(() => {
  // jsdom lacks the observers the vendored DecryptedText uses; inert stubs, animation never starts.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.viewMode;
});

// This suite pins the CLASSIC room composition — the Instrument HUD is default-ON since the
// 2026-07-06 owner approval, and the Monitor console is default-ON since 2026-07-12, so the
// classic tree lives behind BOTH "0" failsafes; the HUD masthead's own contract is pinned in
// hud-rooms-flag.test.tsx, the console flag's in monitor-console-flag.test.tsx.
beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
  localStorage.setItem("compy_monitor_console", "0");
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-03T00:00:00Z",
    duration_secs: 2520, // 42m 0s
    process_name: "valorant.exe",
    samples: 3412,
    avg_fps: 240.2,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190.1, // ratio .79 → Smooth
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
    ...over,
  }) as SessionSummary;

function mount(over: Partial<Parameters<typeof MonitorV2>[0]> = {}) {
  const props = {
    active: true,
    sessions: [session()],
    sessionsSeenAt: "",
    priorities: null,
    recs: [],
    apply: vi.fn(),
    busyId: null,
    onExport: vi.fn(),
    changes: [],
    rollback: vi.fn(),
    vendor: "amd" as const,
    ...over,
  };
  const utils = render(<MonitorV2 {...props} />);
  return { ...utils, props };
}

const useReduced = () => localStorage.setItem("compy_motion", "reduced");
const useAdvanced = () => localStorage.setItem("compy_view_mode", "advanced");

describe("monitorVerdict — pure, measured, branch-proper copy", () => {
  it("no sessions → honest empty state, nothing fabricated", () => {
    const v = monitorVerdict([]);
    expect(v.headline).toBe("No game sessions measured yet.");
    expect(v.sub).toBe("Start capture and play — the debrief lands here when the session ends.");
  });

  it("grades with the SAME shortVerdict thresholds the debrief uses — and a non-smooth grade names the 1% lows that earned it (V2-9 punch h)", () => {
    expect(monitorVerdict([session()]).headline).toBe(
      "Last session ran smooth — valorant at 240 fps average.",
    );
    expect(monitorVerdict([session({ low1_fps_est: 150 })]).headline).toBe(
      "Last session had some dips — valorant's 1% lows fell to 150 fps against a 240 fps average.",
    );
    expect(monitorVerdict([session({ low1_fps_est: 100 })]).headline).toBe(
      "Last session ran rough — valorant's 1% lows fell to 100 fps against a 240 fps average.",
    );
  });

  it("sub carries the real duration + sample count and the live-estimate honesty framing", () => {
    const v = monitorVerdict([session()]);
    expect(v.sub).toContain("42m 0s");
    expect(v.sub).toContain("3,412 samples");
    expect(v.sub).toContain("not a benchmark");
  });

  it("never '(s)' across every branch", () => {
    for (const sessions of [[], [session()], [session(), session()]]) {
      const v = monitorVerdict(sessions);
      expect(`${v.headline} ${v.sub ?? ""}`).not.toContain("(s)");
    }
  });
});

describe("MonitorV2 — RoomShell composition", () => {
  it("renders ONE verdict (the pure helper's output) and ONE forward door to Blackbook", () => {
    useReduced();
    const { container } = mount();
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe("Last session ran smooth — valorant at 240 fps average.");
    const doors = container.querySelectorAll(".v2-door");
    expect(doors.length).toBe(1);
    expect(doors[0].textContent).toContain("See what changed");
  });

  it("no measured-line header strip — header space is header-format text only (owner law 2026-07-10)", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".v2-measured")).toBeNull();
  });

  it("no primary action — the room's actions live with their tiles (one-mention law)", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
  });

  // V2-8 (P6 §2 placement): the door belongs to the session-end state — ABSENT while a capture
  // session is live, back when it ends. The faces mirror their already-polled get_fps_status up
  // via onFpsActive (no second IPC).
  it("closes the forward door during a live capture session, reopens when it ends", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelectorAll(".v2-door").length).toBe(1);
    fireEvent.click(screen.getByText("stub-capture-on"));
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
    fireEvent.click(screen.getByText("stub-capture-off"));
    expect(container.querySelectorAll(".v2-door").length).toBe(1);
  });

  it("the Advanced live face reports capture state through the same door signal", () => {
    useReduced();
    useAdvanced();
    const { container } = mount();
    expect(container.querySelectorAll(".v2-door").length).toBe(1);
    fireEvent.click(screen.getByText("stub-play-capture-on"));
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  // bug→guard (MonitorV2.tsx capture poll): only the Live face polls get_fps_status and mirrors it
  // up via onFpsActive. Leaving Live mid-capture unmounts that poller, so if nothing else re-read the
  // backend the door would stay closed FOREVER once the session actually ended off-screen. The
  // self-correcting off-Live poll re-reads real state; when the backend reports active:false the door
  // must reopen without the user returning to Live.
  it("reopens the door when a capture ends while the user is off the Live segment", async () => {
    useReduced();
    useAdvanced();
    ipc.fpsActive = true;
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-play-capture-on")); // capture live → door closed
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" })); // leave Live → poller unmounts
    ipc.fpsActive = false; // the session ends off-screen (picked up by the 2s poll)
    await waitFor(() => expect(container.querySelectorAll(".v2-door").length).toBe(1), {
      timeout: 3000,
    });
  });
});

// bug→guard (Q7 acceptance §398 "one owner supplies each sensor stream to all consumers that need
// it", + §397 idle cost). The test above proves the shell's fallback poll EXISTS; these prove it
// stays a fallback. §398 is a RUNTIME-ownership rule, so the original guard (`segment === "live"`)
// was too narrow: in Basic mode a face is mounted at EVERY segment value and already polls
// get_fps_status at 1 Hz, and that composition is reachable on all-default flags (Basic's
// last-session door sets Advanced+Sessions; switching back to Basic leaves segment "sessions").
// Own timers are the measurement here — invoke is only ever called by MonitorV2 itself in this
// suite (Play/MonitorBasic are stubs, the console flag is off), so a get_fps_status call count IS
// the shell's ownership of the stream.
describe("MonitorV2 — the shell owns get_fps_status only where no face does", () => {
  const fpsCalls = () =>
    vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_fps_status").length;

  /** jsdom's `hidden`/`visibilityState` are read-only; the hook reads them and listens for the event. */
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  // Own describe on purpose: the off-Live door test above runs on REAL timers (waitFor), and mixing
  // the two modes in one block is how a suite starts passing for the wrong reason.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockClear();
    ipc.fpsActive = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  /** Flush the mocked-IPC promise the tick fires (advanceTimersByTimeAsync drains microtasks). */
  const settle = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("polls in Advanced+Sessions — the one composition where no face is mounted to own it", async () => {
    useReduced();
    useAdvanced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-play-capture-on"));
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelectorAll(".v2-door").length).toBe(0); // capture live, door closed
    expect(fpsCalls()).toBe(1); // immediate re-read on mount of the effect
    await settle(2000);
    expect(fpsCalls()).toBe(2); // …then the 2s interval
  });

  it("stands down on Advanced+Live — the live face owns the stream there", async () => {
    useReduced();
    useAdvanced();
    mount();
    fireEvent.click(screen.getByText("stub-play-capture-on"));
    vi.mocked(invoke).mockClear();
    await settle(6000);
    expect(fpsCalls()).toBe(0);
  });

  it("stands down in Basic at any segment — a face is mounted there and already polls it", async () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-open-sessions")); // → Advanced + Sessions
    fireEvent.click(screen.getByRole("tab", { name: "Basic" })); // → Basic, segment stays "sessions"
    fireEvent.click(screen.getByText("stub-capture-on"));
    expect(screen.getByTestId("monitor-basic")).toBeTruthy(); // the face IS mounted…
    expect(container.querySelectorAll(".v2-door").length).toBe(0); // …and a capture IS live
    vi.mocked(invoke).mockClear();
    await settle(6000);
    expect(fpsCalls()).toBe(0); // …so the shell must not be a second poller
  });

  it("stands down while the window is hidden, and re-reads the instant it comes back", async () => {
    useReduced();
    useAdvanced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-play-capture-on"));
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));

    act(() => setHidden(true)); // alt-tab into the fullscreen game
    vi.mocked(invoke).mockClear();
    await settle(10_000);
    expect(fpsCalls()).toBe(0); // five ticks' worth of nothing, behind the game

    ipc.fpsActive = false; // the session ends while nobody is looking
    act(() => setHidden(false));
    await settle(0); // no interval elapsed — only the effect's immediate tick
    expect(fpsCalls()).toBe(1);
    expect(container.querySelectorAll(".v2-door").length).toBe(1); // door correct before it's seen
  });
});

describe("MonitorV2 — Basic/Advanced + Live/Sessions (classic semantics preserved)", () => {
  it("defaults to Basic: the glanceable face, no section segments, no quiet slot", () => {
    useReduced();
    const { container } = mount();
    expect(screen.getByTestId("monitor-basic")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Monitor sections" })).toBeNull();
    expect(container.querySelector(".v2-quiet-slot")).toBeNull();
  });

  it("Advanced lands on Live first (owner ruling) and Sessions is one tab away", () => {
    useReduced();
    useAdvanced();
    mount();
    expect(screen.getByTestId("play-live")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
  });

  it("Basic's last-session door routes to Advanced → Sessions (never a dead end)", () => {
    useReduced();
    mount();
    fireEvent.click(screen.getByText("stub-open-sessions"));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
    expect(localStorage.getItem("compy_view_mode")).toBe("advanced");
  });
});

describe("MonitorV2 — quiet slot (advisory Tuning presets, Advanced only)", () => {
  it("the expander names what's inside, opens/closes, and the presets render bare (no stacked title)", () => {
    useReduced();
    useAdvanced();
    const { container } = mount();
    const head = screen.getByRole("button", { name: /Tuning presets/ });
    expect(head.textContent).toContain("Compy never changes these for you");
    const body = container.querySelector("#mv2-presets-body") as HTMLElement;
    expect(body.hidden).toBe(true);
    fireEvent.click(head);
    expect(body.hidden).toBe(false);
    // The real advisory chips render inside (the same TUNING_PRESETS knowledge layer)…
    expect(body.querySelectorAll(".chip").length).toBeGreaterThan(0);
    // …but bare: the ONE name comes from the expander head, not a stacked <h2>.
    expect(body.querySelector("h2")).toBeNull();
  });
});

describe("classic Monitor — pinned unchanged (flag-off byte-identity at the render level)", () => {
  it("renders no RoomShell chrome and keeps its standalone presets title", () => {
    useAdvanced();
    const { container } = render(
      <Monitor
        active
        sessions={[session()]}
        sessionsSeenAt=""
        priorities={null}
        recs={[]}
        apply={vi.fn()}
        busyId={null}
        onExport={vi.fn()}
        changes={[]}
        rollback={vi.fn()}
        vendor="amd"
      />,
    );
    expect(container.querySelector(".v2-verdict")).toBeNull();
    expect(container.querySelector(".v2-door")).toBeNull();
    expect(container.querySelector(".v2-quiet")).toBeNull();
    // TuningPresets without `bare` (the classic call) keeps its own <h2> title.
    expect(screen.getByRole("heading", { name: "Tuning presets" })).toBeTruthy();
  });
});
