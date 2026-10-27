import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  it("a null result: the answer carries the verdict and the choice; the numbers wait behind the doors", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => Promise.resolve(cmd === "get_latest_comparison" ? comparison : null));
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    const card = await screen.findByTestId("cmp-card");
    expect(card.textContent).toMatch(/No measurable change/);
    expect(screen.getByRole("button", { name: /Revert|Take it back|put it back/i })).toBeInTheDocument();
    // Answer face: no FPS number, no noise-floor figure, no "inside the noise floor" line yet.
    expect(card.querySelector(".cmp-delta")).toBeNull();
    expect(card.querySelector(".cmp-receipts")).toBeNull();
    expect(card.textContent).not.toMatch(/140|141|110|111|±3%/);
    fireEvent.click(card.querySelector('[data-testid="cmp-depth-why"] > summary')!);
    expect(card.querySelector(".cmp-delta")!.textContent).toMatch(/inside the ±3% normal run-to-run wobble \(the noise floor\)/);
    expect(card.querySelector(".cmp-means")!.textContent).toMatch(/your dips aren't game mode/);
    fireEvent.click(card.querySelector('[data-testid="cmp-depth-receipt"] > summary')!);
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
    const card = await screen.findByTestId("cmp-card");
    // Answer face: the verdict and the choice; the lesson waits behind the Why door.
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    fireEvent.click(card.querySelector('[data-testid="cmp-depth-why"] > summary')!);
    const lesson = card.querySelector('[data-testid="cmp-lesson"]')!;
    expect(lesson.getAttribute("data-rule")).toBe("steadier-not-faster");
    expect(lesson.textContent).toContain("What Compy learned on this PC:");
    expect(lesson.textContent).toContain("With Game Mode, 1% lows rose and the average barely moved: eldenring got steadier, not faster.");
    expect(card.querySelectorAll('[data-testid="cmp-lesson"]')).toHaveLength(1);
    fireEvent.click(lesson.querySelector("button")!);
    expect(openLibrary).toHaveBeenCalledWith("one-percent-lows");
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
    const card = await screen.findByTestId("cmp-card");
    expect(card.querySelector('[data-testid="cmp-lesson"]')).toBeNull();
    expect(card.textContent).not.toMatch(/What Compy learned/);
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });
});
