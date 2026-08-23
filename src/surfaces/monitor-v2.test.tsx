import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { MonitorV2 } from "./MonitorV2";
import { TuningPresets } from "./TuningPresets";
import { monitorVerdict as monitorVerdictRaw } from "./monitor-v2-data";
import type { SessionSummary } from "../types";
import { readFileSync } from "fs";
import { join } from "path";
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
// "(s)"), Live/Sessions are the room's ONE pair of faces (the Basic/Advanced mode fork was
// retired in the 2026-08-20 comprehensibility sweep, issue #180 — see
// monitor-one-face-guard.test.tsx), and the quiet slot carries the advisory Tuning presets.

// Play and MonitorConsole are the audited heavy surfaces — composed VERBATIM with the same
// props, covered by their own suites. Stubs expose `view` and onFpsActive so the shell
// contracts are testable. monitor-v2-data imports the REAL shortVerdict/fmtDur from ./Play,
// so the mock must pass the original named exports through.
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
vi.mock("./MonitorConsole", () => ({
  // Since issue #49 slice 4 the live face composes the room's RoomShell ITSELF (the approved Live
  // comp is the four-room split, and both of its columns are built from state the face owns), so
  // this stub deliberately renders no shell — that absence is what the delegation guard below
  // measures. It DOES render `bar` and `quiet`, because those two are the ROOM's and are handed
  // down: a stub that swallowed them would let every navigation assertion in this file pass
  // against a screen with no tab bar on it.
  MonitorConsole: (props: {
    onFpsActive?: (a: boolean) => void;
    bar?: ReactNode;
    quiet?: ReactNode;
  }) => (
    <div data-testid="monitor-console">
      {props.bar}
      <button type="button" onClick={() => props.onFpsActive?.(true)}>
        stub-capture-on
      </button>
      <button type="button" onClick={() => props.onFpsActive?.(false)}>
        stub-capture-off
      </button>
      {props.quiet}
    </div>
  ),
}));
// jsdom has no Tauri IPC. `get_fps_status` is driven by `ipc.fpsActive` so the self-correcting
// off-Live capture poll (below) is testable.
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
});

// This suite pins the room's composition with the HUD masthead off — the verdict sentence as the
// h1 (the Instrument HUD is default-ON since 2026-07-06; its masthead contract is pinned in
// hud-rooms-flag.test.tsx).
beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
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

// TWO FACES, TWO COMPOSITIONS (issue #49 slice 4). The approved Live comp is the four-room
// SPLIT, whose evidence column is built entirely from state MonitorConsole owns, so the live face
// composes its own RoomShell and this shell delegates. Sessions has no evidence column — it is a
// different composition, not the same one with a slot left empty — so its shell is still this
// one's. The Live-side shell contracts (one verdict, one door, the door closing during a capture,
// and the ONE primary action the comp adds) are pinned against the REAL component in
// monitor-console.test.tsx, where a stub can no longer stand in for them.
describe("MonitorV2 — RoomShell composition", () => {
  it("Live: the face owns the shell, and this one does not render a second", () => {
    // The guard against the obvious wrong fix — wrapping the delegated face in a RoomShell here
    // "for consistency", which would print two verdicts and two forward doors on one screen.
    useReduced();
    const { container } = mount();
    expect(screen.getByTestId("monitor-console")).toBeTruthy();
    expect(container.querySelectorAll(".v2-verdict").length).toBe(0);
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  it("Sessions: renders ONE verdict (the pure helper's output) and ONE forward door to Blackbook", () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    // The h1 is eyebrow + headline (one header idiom per room, slice 4); the VERDICT is the
    // headline, asserted exactly rather than as a substring so a stray sentence still fails.
    expect(h1s[0].querySelector(".mc-masthead-eyebrow")!.textContent).toContain("Session monitor");
    expect(h1s[0].querySelector(".mc-headline")!.textContent).toBe(
      "Last session ran smooth — valorant at 240 fps average.",
    );
    // Sessions is the LINEAR face -- no evidence column, so no narrative foot to carry a route
    // row, so it keeps the doorknob. Same destination, re-copied to the comp's sentence.
    const doors = container.querySelectorAll(".v2-door");
    expect(doors.length).toBe(1);
    expect(doors[0].textContent).toContain("View all sessions in History");
  });

  it("no measured-line header strip — header space is header-format text only (owner law 2026-07-10)", () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelector(".v2-measured")).toBeNull();
  });

  it("Sessions: no primary action — the debrief's actions live with its cards (one-mention law)", () => {
    // Live is now the exception the approved comp asked for, and it is an exception that MOVED a
    // control rather than adding one (monitor-console.test.tsx proves there is still exactly one
    // Start/Stop capture button on that screen). Sessions gained nothing and still has no slot.
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
  });

  // V2-8 (P6 §2 placement): the door belongs to the session-end state — ABSENT while a capture
  // session is live, back when it ends. The Live face mirrors its already-polled get_fps_status
  // up via onFpsActive (no second IPC), which is what keeps this shell's own door honest after
  // the user walks over to Sessions mid-capture.
  it("Sessions: the door stays shut while a capture the Live face reported is still recording", () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-capture-on"));
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    fireEvent.click(screen.getByText("stub-capture-off"));
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelectorAll(".v2-door").length).toBe(1);
  });

  it("CSS: the Sessions header STACKS — a two-line h1 cannot seat its sub-line beside itself", () => {
    // Caught reading the cascade, not the screen, but it is a real defect and gets a real guard.
    // Live is the split layout, whose narrative column already stacks. Sessions is NOT split, so
    // it inherits the shell's linear header: a flex ROW with `align-items: baseline`. That was
    // correct while the h1 was one 17px sentence; the moment slice 4 put an eyebrow line above
    // that sentence, "baseline" became the EYEBROW's baseline and the sub-line would sit up beside
    // a two-line heading. Delete the override and the header silently comes apart again.
    const css = readFileSync(join("src", "surfaces", "monitor-v2.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const rule = css
      .split("}")
      .find((b) => b.includes('[data-room="play"]') && b.includes(".v2-verdict"));
    expect(rule, "the room must own its header's stacking").toBeDefined();
    expect(rule, "only the non-split face needs it — Live's column already stacks").toContain(
      ':not([data-layout="split"])',
    );
    expect(rule).toMatch(/flex-direction:\s*column/);
  });

  it("hands the ROOM's two pieces down to the live face — segment bar and quiet slot", () => {
    // bug→guard (issue #49 slice 4). The bar and the presets expander belong to the room, not to
    // either face, so they are built once here and passed down. Drop either prop and the Live
    // screen silently loses a whole navigation control with a green build behind it.
    useReduced();
    const { container } = mount();
    const console_ = screen.getByTestId("monitor-console");
    expect(console_.querySelector(".mv2-bar"), "the segment bar must reach the live face").not.toBeNull();
    expect(
      console_.querySelector("#mv2-presets-body"),
      "the advisory presets must reach the live face",
    ).not.toBeNull();
    // …and exactly once: the room must not ALSO render them outside the face it handed them to.
    expect(container.querySelectorAll(".mv2-bar").length).toBe(1);
    expect(container.querySelectorAll("#mv2-presets-body").length).toBe(1);
  });

  // bug→guard (MonitorV2.tsx capture poll): only the Live face polls get_fps_status and mirrors it
  // up via onFpsActive. Leaving Live mid-capture unmounts that poller, so if nothing else re-read the
  // backend the door would stay closed FOREVER once the session actually ended off-screen. The
  // self-correcting off-Live poll re-reads real state; when the backend reports active:false the door
  // must reopen without the user returning to Live.
  it("reopens the door when a capture ends while the user is off the Live segment", async () => {
    useReduced();
    ipc.fpsActive = true;
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-capture-on")); // capture live → door closed
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
// stays a fallback. On Live, MonitorConsole owns the 1 Hz poll; Sessions is the one composition
// where no face polls, so the shell owns it there. Own timers are the measurement here — invoke is
// only ever called by MonitorV2 itself in this suite (Play/MonitorConsole are stubs), so a
// get_fps_status call count IS the shell's ownership of the stream.
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

  it("polls on Sessions — the one composition where no face is mounted to own it", async () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-capture-on"));
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(container.querySelectorAll(".v2-door").length).toBe(0); // capture live, door closed
    expect(fpsCalls()).toBe(1); // immediate re-read on mount of the effect
    await settle(2000);
    expect(fpsCalls()).toBe(2); // …then the 2s interval
  });

  it("stands down on Live — the live face owns the stream there", async () => {
    useReduced();
    mount();
    fireEvent.click(screen.getByText("stub-capture-on"));
    vi.mocked(invoke).mockClear();
    await settle(6000);
    expect(fpsCalls()).toBe(0);
  });

  it("stands down while the window is hidden, and re-reads the instant it comes back", async () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByText("stub-capture-on"));
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

describe("MonitorV2 — one face per segment (comprehensibility sweep, issue #180)", () => {
  it("lands on Live first (owner ruling) with the console face and both segments visible", () => {
    useReduced();
    mount();
    expect(screen.getByTestId("monitor-console")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeTruthy();
  });

  it("Sessions is one tab away and renders the full debrief", () => {
    useReduced();
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
  });

  it("renders NO Basic/Advanced detail-level control — the mode fork is retired", () => {
    useReduced();
    mount();
    expect(screen.queryByRole("tab", { name: "Basic" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Advanced" })).toBeNull();
  });
});

describe("MonitorV2 — quiet slot (advisory Tuning presets)", () => {
  it("the expander names what's inside, opens/closes, and the presets render bare (no stacked title)", () => {
    useReduced();
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

describe("TuningPresets — the un-`bare` face, which the v2 quiet slot never renders", () => {
  // The classic Monitor shell used to be the only caller that rendered TuningPresets without
  // `bare`, and this case reached the component THROUGH it. That shell was deleted with backlog
  // C-18 (issue #146) — it had no production importer — so the assertion that still means
  // something is made against the component itself: absent `bare`, it supplies its own title.
  // Deleting this instead would have let a dead shell take a live contract down with it.
  it("keeps its own standalone <h2> title", () => {
    render(<TuningPresets vendor="amd" />);
    expect(screen.getByRole("heading", { name: "Tuning presets" })).toBeTruthy();
  });
});
