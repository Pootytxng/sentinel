import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { SessionSummary } from "../../types";

// Guard for the gallery's WebGL-free render paths (spec 2026-07-08 §3): the honest empty state and
// the reduced-motion static grid. The 3D canvas path can't mount under jsdom (no WebGL) — it's
// exercised by the self-reviewer at native res — but the empty/grid paths are pure DOM and carry the
// anti-fabrication + completion-loop contract, so they're pinned here. buildGalleryPieces itself is
// covered by gallery-pieces.test.ts.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_scoreboard")
      return Promise.resolve({ total_points: 0, awards: [], local_percentiles: [] });
    if (cmd === "get_crash_blackbox") return Promise.resolve({ incidents: [], skipped_sources: [] });
    return Promise.resolve(null);
  }),
}));

const { TelemetryGallery } = await import("./TelemetryGallery");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // Force reduced motion so the WebGL-free static grid renders (no Canvas under jsdom).
  localStorage.setItem("compy_motion", "reduced");
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  started_at: "2026-07-06T20:00:00Z",
  duration_secs: 1800,
  process_name: "cs2.exe",
  samples: 5000,
  avg_fps: 240,
  avg_frametime_ms: 4.16,
  low1_fps_est: 180,
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 99,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  ...over,
});

describe("TelemetryGallery — honest empty state", () => {
  it("no pieces → the empty invitation, and its CTA loops back to the bench", () => {
    const onJump = vi.fn();
    const c = render(
      <TelemetryGallery sessions={[]} changes={[]} onJump={onJump} />,
    ).container;
    expect(c.querySelector(".tg-empty")).not.toBeNull();
    // No fabricated pieces, no canvas stage.
    expect(c.querySelector(".tg-grid")).toBeNull();
    expect(c.querySelector(".tg-stage")).toBeNull();
    const cta = c.querySelector(".tg-empty-cta") as HTMLButtonElement;
    expect(cta).not.toBeNull();
    fireEvent.click(cta);
    expect(onJump).toHaveBeenCalledWith("benchmark");
  });
});

describe("TelemetryGallery — reduced-motion static grid", () => {
  it("renders one card per real measured piece; a card opens its measured detail", () => {
    const c = render(
      <TelemetryGallery sessions={[session(), session({ started_at: "2026-07-05T10:00:00Z" })]} changes={[]} />,
    ).container;
    const cards = c.querySelectorAll(".tg-card");
    expect(cards.length).toBe(2);
    // The measured line is present + verbatim (no fabricated numbers).
    expect(cards[0].querySelector(".tg-card-metric")!.textContent).toContain("240 fps avg");
    // Clicking a card opens its detail rows.
    fireEvent.click(cards[0]);
    expect(c.querySelector(".tg-card-detail")).not.toBeNull();
    expect(c.querySelector(".tg-foot")!.textContent).toContain("2 pieces");
  });
});
