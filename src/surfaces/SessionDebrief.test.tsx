import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { SessionSummary } from "../types";

// The debrief loads its comparison via invoke on mount; resolve null = no armed comparison.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { LibraryContext } from "./library-context";

afterEach(cleanup);

const session: SessionSummary = {
  started_at: "2026-06-10T20:00:00Z",
  duration_secs: 5400,
  process_name: "eldenring.exe",
  samples: 900,
  avg_fps: 142.4,
  avg_frametime_ms: 7.0,
  low1_fps_est: 118.2,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 98,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 2,
  stutter_insight: null,
};

const baseProps = {
  s: session,
  priorities: null,
  recs: [],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [],
  rollback: vi.fn(),
};

// The Depth door is per-mount state. A late async re-render can swap the card
// node after findByTestId, leaving a held reference detached with its door shut
// (the r23 full-gate flake). Re-query the live card and open its door until the
// explanation is there; clicking only a shut door keeps this idempotent.
async function openWhy(): Promise<HTMLElement> {
  await waitFor(() => {
    const live = screen.getByTestId("cmp-card");
    const door = live.querySelector<HTMLDetailsElement>('[data-testid="cmp-depth-why"]')!;
    if (!door.open) fireEvent.click(door.querySelector("summary")!);
    expect(live.querySelector(".cmp-delta")).not.toBeNull();
  });
  return screen.getByTestId("cmp-card");
}

describe("SessionDebrief (audit M1)", () => {
  it("renders the session receipt: game, tiles, and the 1%-low ESTIMATE label", async () => {
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    // Header names the game (de-jargoned for display — the trailing ".exe" is stripped; the raw
    // name is kept for exports/comparison matching, never shown in the title).
    expect(await screen.findByText(/eldenring/)).toBeInTheDocument();
    expect(screen.queryByText(/eldenring\.exe/)).not.toBeInTheDocument();
    // Tiles: avg FPS + 1% low, with the honest-measurement "estimate" tag on the 1% low.
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText(/·\s*estimate/)).toBeInTheDocument();
    // GPU receipts render real values, not dashes, when present.
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("71°C")).toBeInTheDocument();
  });

  it("P9-target: the average is compared with the screen the session was played on", async () => {
    const hw = { hash: "h", gpu: "RX 7800 XT", gpu_driver: "", ram_gb: 32, display: "1920x1080@250" };
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} s={{ ...session, hw_fingerprint: hw }} />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring/);
    // 142.4 fps on a 250 Hz screen = 57%.
    expect(screen.getByText("Your average was about 57% of your 250 Hz screen.")).toBeInTheDocument();
    cleanup();
    // Unread rate or unmeasured FPS: no line, never a guess.
    for (const s of [
      { ...session, hw_fingerprint: { ...hw, display: "1920x1080@0" } },
      { ...session, hw_fingerprint: null },
      { ...session, hw_fingerprint: hw, avg_fps: 0 },
    ]) {
      const { container } = render(
        <ConfirmProvider>
          <SessionDebrief {...baseProps} s={s} />
        </ConfirmProvider>,
      );
      await screen.findByText(/eldenring/);
      expect(container.querySelector(".debrief-screen-target")).toBeNull();
      cleanup();
    }
  });

  it("missing sensors degrade to a dash — never a fabricated number", async () => {
    render(
      <ConfirmProvider>
        <SessionDebrief
          {...baseProps}
          s={{ ...session, peak_gpu_temp_c: null, peak_gpu_usage_pct: null }}
        />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  // Codebase review 2026-11-03 (LOCKED rule 5): a session's peak is the hottest reading across every
  // adapter, recorded without its adapter. On a rig with an NVIDIA adapter it may be NVML's, so it
  // must not take the first adapter's (AMD) colour.
  it("a peak that may be an NVML reading stays uncoloured, whatever the first adapter is", async () => {
    const hot = { ...session, peak_gpu_temp_c: 92 };
    const tempTile = () =>
      screen.getByText("92°C").closest(".debrief-tile")!.querySelector<HTMLElement>(".debrief-tile-value")!;
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} s={hot} vendor="amd" peakTempVendor="NVIDIA" />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring/);
    expect(tempTile().style.color).toBe("");
    cleanup();
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} s={hot} vendor="amd" peakTempVendor="AMD Radeon RX 9070 XT" />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring/);
    expect(tempTile().style.color).not.toBe("");
  });

  it("the context strip counts Compy changes active during the session, and Share exports", async () => {
    const onExport = vi.fn();
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} onExport={onExport} />
      </ConfirmProvider>,
    );
    expect(
      await screen.findByText(/During this session: 2 Compy changes active/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onExport).toHaveBeenCalled();
  });
});

// P7-depth-verdicts (Constitution §13): the comparison card is one verdict at three depths. The
// answer is the verdict and the keep/revert choice; the comparison against the noise floor is one
// tap; the before/after readings and the exact fields one more. Fails on the code before this slice.
describe("SessionDebrief comparison card: Answer / Explanation / Technical receipt", () => {
  const comparison = {
    rec_id: "game-mode",
    rec_title: "Game Mode",
    game: "eldenring.exe",
    baseline_avg_fps: 140.4,
    baseline_low1_fps: 110.2,
    after_avg_fps: 141.1,
    after_low1_fps: 111.0,
    delta_avg_pct: 0.5,
    delta_low1_pct: 0.7,
    noise_floor_pct: 3,
    verdict: "no-change" as const,
  };
  it("measurement item 8: no measured band shows the numbers and calls nothing (never a fixed 3%)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const unmeasured = {
      ...comparison,
      after_low1_fps: 124.0,
      delta_low1_pct: 12.5,
      noise_floor_pct: 0,
      verdict: "unmeasured" as const,
      unmeasured: "noise-unmeasured" as const,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? unmeasured : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    let card = await screen.findByTestId("cmp-card");
    expect(card.textContent).toMatch(/Can't call this one/);
    expect(screen.getByTestId("cmp-unmeasured").textContent).toMatch(/hasn't measured how much eldenring moves between your sessions/i);
    expect(card.textContent).not.toMatch(/improvement|made it worse|No measurable change|noise floor/i);
    card = await openWhy();
    expect(card.querySelector(".cmp-delta")!.textContent).toMatch(/\+12\.5%\), not judged/);
    expect(card.querySelector(".cmp-nf")).toBeNull();
    // A changed frame cap says so.
    cleanup();
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "get_latest_comparison" ? { ...unmeasured, unmeasured: "frame-cap-changed" } : null),
    );
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    expect((await screen.findByTestId("cmp-unmeasured")).textContent).toMatch(/frame cap wasn't the same/);
    cleanup();
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "get_latest_comparison" ? { ...unmeasured, unmeasured: "not-comparable" } : null),
    );
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    expect((await screen.findByTestId("cmp-unmeasured")).textContent).toMatch(/weren't played under comparable conditions/);
  });

  it("measurement item 8: a measured band reads +rise / -fall, the way it was judged", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const worse = {
      ...comparison,
      after_low1_fps: 90.4,
      delta_low1_pct: -18.0,
      noise_floor_pct: 20.6,
      noise_fall_pct: 17.0,
      game_noise: { low1_band_pct: 20.6, sessions: 9, cap: { state: "uncapped" as const } },
      verdict: "regressed" as const,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? worse : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    await screen.findByTestId("cmp-card");
    const card = await openWhy();
    const line = card.querySelector(".cmp-delta")!.textContent ?? "";
    expect(line).toMatch(/outside the \+20\.6% \/ -17% this game moves between your sessions with nothing changed/);
    expect(line).not.toMatch(/±20\.6%/);
  });

  it("a null result: the answer carries the verdict and the choice; the numbers wait behind the doors", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? comparison : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    let card = await screen.findByTestId("cmp-card");
    expect(card.textContent).toMatch(/No measurable change/);
    expect(screen.getByRole("button", { name: /Revert|Take it back|put it back/i })).toBeInTheDocument();
    // Answer face: no FPS number, no noise-floor figure, no "inside the noise floor" line yet.
    expect(card.querySelector(".cmp-delta")).toBeNull();
    expect(card.querySelector(".cmp-receipts")).toBeNull();
    expect(card.textContent).not.toMatch(/140|141|110|111|±3%/);
    card = await openWhy();
    // Depth mounts the explanation on the details' toggle, which jsdom delivers on a later task:
    // wait for it instead of reading in the same tick (full-suite flake under load, r23 2026-10-27).
    expect(card.querySelector(".cmp-delta")!.textContent).toMatch(/inside the ±3% normal run-to-run wobble \(the noise floor\)/);
    expect(card.querySelector(".cmp-means")!.textContent).toMatch(/your dips aren't game mode/);
    const door1 = card.querySelector('[data-testid="cmp-depth-receipt"] > summary')!;
    fireEvent.click(door1);
    // Depth mounts a door's content on the details' toggle (a later task in jsdom): wait for it.
    await waitFor(() => expect(door1.parentElement!.children.length).toBeGreaterThan(1));
    const rows = Object.fromEntries(
      [...card.querySelectorAll(".cmp-receipt-fields dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(rows).toEqual({
      Change: "game-mode",
      Game: "eldenring.exe",
      "Before, average": "140.4 fps",
      "After, average": "141.1 fps (+0.5%)",
      "Before, 1% low": "110.2 fps",
      "After, 1% low": "111.0 fps (+0.7%)",
      Verdict: "no-change",
    });
    expect(card.querySelector(".cmp-nf")!.textContent).toBe("noise floor ±3%");
    // P7-teach: both deltas inside the floor is the verdict itself, not a lesson.
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });

  // CR-1102-left: the comparison was read once per game and kept on a failed read, so switching the
  // debrief to another game whose read failed left the first game's verdict under the second.
  it("switching to another game drops the first game's verdict, even when the new read fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? comparison : null));
    const { rerender } = render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    await screen.findByTestId("cmp-card");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_latest_comparison" ? Promise.reject(new Error("unreadable")) : Promise.resolve(null),
    );
    rerender(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} s={{ ...session, process_name: "cs2.exe" }} />
      </ConfirmProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("cmp-card")).toBeNull());
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });

  // P7-teach (Constitution §14): after this PC's own result, at most one lesson from the P5-learned
  // rule table, behind the Why door, linking the Library entry it reads from. Fails on the code before
  // this slice (the card taught nothing).
  it("a measured result teaches one lesson in the explanation, with a link into the Library", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const won = { ...comparison, after_low1_fps: 118.9, delta_low1_pct: 7.9, after_avg_fps: 141.6, delta_avg_pct: 0.9, verdict: "improved" as const };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? won : null));
    const openLibrary = vi.fn();
    render(
      <LibraryContext.Provider value={{ openLibrary }}>
        <ConfirmProvider>
          <SessionDebrief {...baseProps} />
        </ConfirmProvider>
      </LibraryContext.Provider>,
    );
    let card = await screen.findByTestId("cmp-card");
    // Answer face: the verdict and the choice; the lesson waits behind the Why door.
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    card = await openWhy();
    // Depth mounts the explanation on the details' toggle, which jsdom delivers on a later task:
    // wait for it instead of reading in the same tick (full-suite flake under load, r23 2026-10-27).
    const lesson = card.querySelector('[data-testid="cmp-lesson"]')!;
    expect(lesson.getAttribute("data-rule")).toBe("steadier-not-faster");
    expect(lesson.textContent).toContain("What Compy learned on this PC:");
    expect(lesson.textContent).toContain("With Game Mode, 1% lows rose and the average barely moved: eldenring got steadier, not faster.");
    expect(card.querySelectorAll('[data-testid="cmp-lesson"]')).toHaveLength(1);
    fireEvent.click(lesson.querySelector("button")!);
    expect(openLibrary).toHaveBeenCalledWith("one-percent-lows");
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });

  it("the stored verdict wins: a null verdict with the average above the floor teaches 'faster, not steadier'; contradicting readings teach nothing", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const avgUp = { ...comparison, after_avg_fps: 151.6, delta_avg_pct: 8, verdict: "no-change" as const };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? avgUp : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    let card = await screen.findByTestId("cmp-card");
    card = await openWhy();
    // Depth mounts the explanation on the details' toggle, which jsdom delivers on a later task:
    // wait for it instead of reading in the same tick (full-suite flake under load, r23 2026-10-27).
    expect(card.querySelector('[data-testid="cmp-lesson"]')!.getAttribute("data-rule")).toBe("faster-not-steadier");
    cleanup();
    // The engine said no-change, but the stored 1% low delta reads beyond the floor: the verdict wins.
    const contradicts = { ...comparison, delta_low1_pct: 9, delta_avg_pct: 0.2, verdict: "no-change" as const };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? contradicts : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    card = await screen.findByTestId("cmp-card");
    card = await openWhy();
    // Depth mounts the explanation on the details' toggle, which jsdom delivers on a later task:
    // wait for it instead of reading in the same tick (full-suite flake under load, r23 2026-10-27).
    expect(card.querySelector(".cmp-delta")).not.toBeNull();
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });

  it("a confounded comparison teaches nothing: no rule, no lesson", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const confounded = { ...comparison, delta_low1_pct: 9, delta_avg_pct: 0.2, verdict: "confounded" as const };
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? confounded : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    let card = await screen.findByTestId("cmp-card");
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    expect(card.textContent).not.toMatch(/What Compy learned/);
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });
});
