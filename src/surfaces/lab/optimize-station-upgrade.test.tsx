// P9-upgrade-block-reachable (s22 finding): the shipped Optimize room composes Check with v2Ia, which
// suppresses Check's upgrade block (V2-4b: demoted content never leads the room) for a card OptimizeV2
// rendered below its action groups. OptimizeV2 was deleted with the dead room generations (1ab831fb,
// 2026-08-06) and no other room took the card, so the measured Phase 9 lines (the limiter, what it was
// measured from, the screen limit, what Compy can't check) never reached a user. The room renders it
// again, below its groups, labeled early, with no retail links (owner call; the default is none).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const scan = vi.hoisted(() => ({ upgrade: null as unknown, evidence: undefined as unknown, limiters: [] as unknown[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "priorities_from")
      return Promise.resolve({
        limiters: scan.limiters,
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: scan.upgrade,
        ...(scan.evidence === undefined ? {} : { upgrade_evidence: scan.evidence }),
      });
    if (cmd === "get_recommendations" || cmd === "get_applied_changes" || cmd === "get_nic_driver_info")
      return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const { invalidateProbe } = await import("../../data/probe-cache");
import type { LabFastPathProps } from "./OptimizeStation";

const fast: LabFastPathProps = {
  recs: [],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
};

const GPU_ROW = {
  kind: "gpu",
  title: "GPU was the measured limiter",
  why: "In your most recent monitored session the GPU sat at or above 95% for 80% of the time.",
  links: [{ retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" }],
  measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95 },
};

const mount = () =>
  render(
    <ConfirmProvider>
      <OptimizeStation {...fast} />
    </ConfirmProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateProbe();
  scan.upgrade = null;
  scan.evidence = undefined;
  scan.limiters = [];
});

describe("P9-upgrade-block-reachable: the Optimize room shows the measured upgrade lines", () => {
  it("a GPU-limited scan renders the block below the groups, labeled early, with what it was measured from and no retail links", async () => {
    scan.upgrade = { items: [GPU_ROW], disclosure: "x" };
    mount();
    const block = await screen.findByTestId("check-upgrade");
    expect(block).toHaveAttribute("data-links", "off");
    // Exactly one copy: Check under "More cleanup" still suppresses its own (one-mention law).
    expect(screen.getAllByTestId("check-upgrade")).toHaveLength(1);
    // Below the groups, not folded inside the "More cleanup" disclosure.
    expect(block.closest("details")).toBeNull();
    expect(block).toHaveTextContent("Upgrade path (advisory)");
    expect(screen.getByTestId("check-upgrade-early")).toHaveTextContent("early — being developed");
    expect(block).toHaveTextContent("GPU was the measured limiter");
    expect(screen.getByTestId("check-upgrade-source").textContent).toMatch(
      /^Measured from your ROB RUN session on Nov 1[12](, 2026)?: 720 of 900 GPU readings were at 95% load or more\.$/,
    );
    expect(screen.getByTestId("check-upgrade-fit")).toHaveTextContent(/^Before any card: Compy can't read/);
    // No shopping: no copy buttons, no anchors, no money disclosure.
    expect(block.querySelectorAll("button, a")).toHaveLength(0);
    expect(block).not.toHaveTextContent(/Amazon|search link|earns nothing/);
  });

  it("a session that filled the screen names the screen, not the GPU", async () => {
    scan.upgrade = {
      items: [{ ...GPU_ROW, measured_from: { ...GPU_ROW.measured_from, avg_fps: 252, refresh_hz: 250 } }],
      disclosure: "x",
    };
    mount();
    await screen.findByTestId("check-upgrade");
    expect(screen.getByTestId("check-upgrade-screen")).toHaveTextContent("your screen ran at 250 Hz, so it could show at most 250 frames a second");
    expect(screen.queryByText("GPU was the measured limiter")).toBeNull();
    expect(screen.queryByTestId("check-upgrade-fit")).toBeNull();
  });

  it("an HDD install drive renders its row with what Compy can't check before any drive", async () => {
    scan.upgrade = {
      items: [{ kind: "ssd", title: "Games are on an HDD", why: "Your game install drive check found HDD storage.", links: GPU_ROW.links, measured_from: null }],
      disclosure: "x",
    };
    mount();
    const block = await screen.findByTestId("check-upgrade");
    expect(block).toHaveTextContent("Games are on an HDD");
    expect(screen.getByTestId("check-upgrade-fit")).toHaveTextContent(/^Before any drive: Compy can't read/);
    expect(screen.queryByTestId("check-upgrade-source")).toBeNull();
    expect(block.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("a re-run that measures no limiter takes the block away (never a stale limiter)", async () => {
    scan.upgrade = { items: [GPU_ROW], disclosure: "x" };
    mount();
    await screen.findByTestId("check-upgrade");
    scan.upgrade = null;
    fireEvent.click(screen.getByRole("button", { name: /re-run/i, hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("check-upgrade")).toBeNull());
  });

  it("an upgrade path with no rows renders no block in the room", async () => {
    scan.upgrade = { items: [], disclosure: "x" };
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-upgrade")).toBeNull();
  });

  it("no hardware limiter measured: no block at all", async () => {
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-upgrade")).toBeNull();
    expect(screen.queryByText("Upgrade path (advisory)")).toBeNull();
  });
});

// P9-no-upgrade-named + P9-cpu-gpu-balance: with no hardware limiter named, the room says "No upgrade
// recommended" and what it was read from, or "not measured yet"; never an empty block.
describe("P9-no-upgrade-named: the Optimize room names 'no upgrade recommended' and its source", () => {
  const NEWEST = {
    game: "ROB RUN.exe",
    started_at: "2026-11-11T20:36:00Z",
    busy: 120,
    readings: 900,
    threshold_pct: 95,
    limit_share_pct: 50,
    gpu_limited: false,
    gpu_tie: "this-card",
  };

  it("measured clear: the count, the newest session's counts, and no retail anything", async () => {
    scan.evidence = { measured_sessions: 3, gpu_limited_sessions: 0, newest: NEWEST };
    mount();
    const block = await screen.findByTestId("check-no-upgrade");
    expect(block.closest("details")).toBeNull();
    expect(block).toHaveTextContent("No upgrade recommended");
    expect(screen.getByTestId("check-no-upgrade-source").textContent).toMatch(
      /^Read from the last check, which names no part holding this PC back, and 3 measured game sessions, none of them GPU-limited \(sessions recorded on another graphics card are left out\)\. In the newest, your ROB RUN session on Nov 1[12](, 2026)?, 120 of 900 GPU readings were at 95% load or more, under the 50% Compy counts as GPU-limited, so Compy doesn't count the GPU as the limit there\.$/,
    );
    // Its average and refresh unmeasured: no CPU line (unknown stays unknown).
    expect(screen.queryByTestId("check-no-upgrade-balance")).toBeNull();
    expect(screen.queryByTestId("check-upgrade")).toBeNull();
    expect(block.querySelectorAll("button, a")).toHaveLength(0);
    expect(block).not.toHaveTextContent(/Amazon|Newegg|search link|earns nothing|\$/);
  });

  it("P9-cpu-gpu-balance: under the refresh rate it ran at, it says Compy can't measure the CPU's share", async () => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: { ...NEWEST, avg_fps: 141.6, refresh_hz: 250 } };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.getByTestId("check-no-upgrade-source")).toHaveTextContent(/and 1 measured game session, none of them GPU-limited/);
    // Review r1: the spec's two claims only (not the limit there; the CPU's share unmeasured), no guess.
    expect(screen.getByTestId("check-no-upgrade-balance").textContent).toBe(
      "That session averaged 142 fps, under the 250 Hz the screen ran at. Compy can't measure the CPU's share yet, so it can't say what held the frame rate there.",
    );
  });

  it("P9-cpu-gpu-balance: an average that would round up to the refresh rate keeps its decimal (review nit)", async () => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: { ...NEWEST, avg_fps: 59.6, refresh_hz: 60 } };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.getByTestId("check-no-upgrade-balance")).toHaveTextContent(/^That session averaged 59\.6 fps, under the 60 Hz/);
  });

  it("a GPU-limited session among those counted (older, or another game's): no 'no upgrade recommended' (review r1)", async () => {
    scan.evidence = { measured_sessions: 2, gpu_limited_sessions: 1, newest: NEWEST };
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-no-upgrade")).toBeNull();
  });

  it("a setting the check names (not a part) still leaves 'no upgrade recommended' (review r1)", async () => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: NEWEST };
    scan.limiters = [{ id: "power-profile", title: "Power plan", reason: "", linked: null, confidence: "medium", status: "attention" }];
    mount();
    expect(await screen.findByTestId("check-no-upgrade")).toHaveTextContent("No upgrade recommended");
  });

  it.each([
    ["at the refresh rate", { avg_fps: 250, refresh_hz: 250 }],
    ["above it", { avg_fps: 252, refresh_hz: 250 }],
    ["refresh unmeasured", { avg_fps: 141 }],
  ])("P9-cpu-gpu-balance: %s, no CPU line", async (_n, extra) => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: { ...NEWEST, ...extra } };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.queryByTestId("check-no-upgrade-balance")).toBeNull();
  });

  it("no measured session on this card: 'not measured yet', never an empty block", async () => {
    scan.evidence = { measured_sessions: 0, gpu_limited_sessions: 0 };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.getByTestId("check-no-upgrade-source").textContent).toBe(
      "Not measured yet: Compy hasn't recorded a game session with enough GPU readings on this graphics card, and the last check names no part holding this PC back.",
    );
  });

  it("a newest session that can't be tied to this card says so", async () => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: { ...NEWEST, gpu_tie: "not-recorded" } };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.getByTestId("check-no-upgrade-untied")).toHaveTextContent("didn't record which graphics card it ran on");
  });

  it("a part the check names is not 'no upgrade': no block", async () => {
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: NEWEST };
    scan.limiters = [{ id: "ram-capacity", title: "Memory", reason: "", linked: null, confidence: "medium", status: "attention" }];
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-no-upgrade")).toBeNull();
  });

  it("an upgrade row wins: the block with the row, never 'no upgrade recommended' beside it", async () => {
    scan.upgrade = { items: [GPU_ROW], disclosure: "x" };
    scan.evidence = { measured_sessions: 1, gpu_limited_sessions: 0, newest: { ...NEWEST, gpu_limited: true, busy: 720 } };
    mount();
    await screen.findByTestId("check-upgrade");
    expect(screen.queryByTestId("check-no-upgrade")).toBeNull();
  });
});

// CR-view-1112c-zh-gap (screen check view-1112c, 04-optimize-zh-CN.png): in zh-CN the block's sentences
// joined with an ASCII space after the full stop ("。 在最近一次"); English keeps its space.
describe("CR-view-1112c-zh-gap: no space after a Chinese full stop in the upgrade area", () => {
  it("zh-CN: the no-upgrade block and the untied line follow the full stop directly", async () => {
    const { default: i18n } = await import("../../i18n");
    await i18n.changeLanguage("zh-CN");
    try {
      scan.evidence = {
        measured_sessions: 2,
        gpu_limited_sessions: 0,
        newest: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 1, readings: 996, threshold_pct: 95, limit_share_pct: 50, gpu_limited: false, gpu_tie: "not-recorded" },
      };
      mount();
      await screen.findByTestId("check-no-upgrade");
      const text = screen.getByTestId("check-no-upgrade-source").textContent ?? "";
      expect(text).toContain("。在最近一次");
      expect(text).not.toMatch(/。 /);
      expect(screen.getByTestId("check-no-upgrade-untied").textContent).toMatch(/^那次会话/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("zh-CN: the GPU row's untied line follows the measured-from sentence directly", async () => {
    const { default: i18n } = await import("../../i18n");
    await i18n.changeLanguage("zh-CN");
    try {
      scan.upgrade = { items: [{ ...GPU_ROW, measured_from: { ...GPU_ROW.measured_from, gpu_tie: "card-unread" } }], disclosure: "x" };
      mount();
      await screen.findByTestId("check-upgrade");
      // Review r1: the untied line must be there, so the negative match can't pass vacuously.
      expect(screen.getByTestId("check-upgrade-untied").textContent).toMatch(/^Compy 还没有读取到/);
      expect(screen.getByTestId("check-upgrade-source").textContent).not.toMatch(/。 /);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("en keeps one space between the sentences", async () => {
    scan.evidence = {
      measured_sessions: 2,
      gpu_limited_sessions: 0,
      newest: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 1, readings: 996, threshold_pct: 95, limit_share_pct: 50, gpu_limited: false, gpu_tie: "this-card" },
    };
    mount();
    await screen.findByTestId("check-no-upgrade");
    expect(screen.getByTestId("check-no-upgrade-source").textContent).toContain("are left out). In the newest");
  });
});
