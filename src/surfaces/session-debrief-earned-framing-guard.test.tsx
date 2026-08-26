import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Priorities, Recommendation, SessionSummary } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);

// SESSION-DEBRIEF EARNED-FRAMING GUARD — DIR-1a on Live (owner direction 2026-08-26).
//
// The rule the owner set at Health's front door, walked into the Live room:
//   > i feel like offering help should only be an option if there an indicator that something was
//   > detected from your pc that it would even inquire that … there should perhaps be an option
//   > that doesnt indicate there is an issue whaatsoever
//
// The defect this guard was written from: `priorities.limiters` are derived from the MACHINE's
// readiness checks (src-tauri/src/priorities.rs — `PriorityStatus::Attention` → `Bucket::Limiter`),
// NOT from the session being debriefed. So a rig with any open limiter got "Apply the #1 fix"
// under a headline that had just graded the session "Smooth session", and the honest clean line was
// suppressed to make room for it. Two contradictory sentences on one card, and a problem asserted
// that nothing on the card measured.
//
// The fix is FRAMING chosen on evidence, never hiding — a switch is barred by the owner's
// 2026-08-06 reversal ("intimidation is a STRUCTURE defect … never a switch"), and wanting more fps
// on a healthy rig is one of the four goal answers Health's own front door gained on 2026-08-26.
// Rules B and C exist so a future "fix" that simply deletes the offer fails here instead of
// shipping.

const smooth: SessionSummary = {
  started_at: "2026-08-26T20:00:00Z",
  duration_secs: 3600,
  process_name: "eldenring.exe",
  samples: 900,
  avg_fps: 160,
  avg_frametime_ms: 6.25,
  low1_fps_est: 140, // ratio 0.875 — comfortably inside the "smooth" band
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 92,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  stutter_insight: null,
};

// Same rig, same open limiter — only the frames differ. ratio 0.5 → the "rough" band.
const rough: SessionSummary = { ...smooth, low1_fps_est: 80 };

const limiterRec: Recommendation = {
  id: "power-plan",
  title: "Switch to the Ultimate Performance power plan",
  category: "power",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "any",
  currently_applied: false,
  provenance: "verified",
};

// A machine-derived limiter: this is the payload shape priorities.rs emits for a readiness check
// sitting in `attention`, and it looks identical whether the last session ran smooth or rough.
const priorities: Priorities = {
  limiters: [
    {
      id: "power-plan",
      title: "Power plan",
      reason: "Windows is on Balanced.",
      linked: "power-plan",
      confidence: "medium",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const props = {
  priorities,
  recs: [limiterRec],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [],
  rollback: vi.fn(),
};

const draw = (s: SessionSummary) =>
  render(
    <ConfirmProvider>
      <SessionDebrief {...props} s={s} />
    </ConfirmProvider>,
  );

describe("session debrief — earned framing (DIR-1a on Live)", () => {
  it("RULE A — a smooth session is never handed a 'fix': the offer exists, the problem framing does not", async () => {
    draw(smooth);
    await screen.findByText(/eldenring/);
    // The verdict this card reached about THIS session.
    expect(screen.getByText(/Smooth session/i)).toBeInTheDocument();
    // …so nothing on the card may call the change a fix, or rank it as the biggest one.
    expect(screen.queryByRole("button", { name: /#1 fix/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/#1 fix/i)).not.toBeInTheDocument();
  });

  it("RULE B — the offer is still THERE (framing is chosen, help is not hidden)", async () => {
    draw(smooth);
    await screen.findByText(/eldenring/);
    // Deleting the button would make rule A pass and the product worse: "I want more fps" is a
    // legitimate reason to change something on a rig that just ran perfectly.
    const cta = screen.getByRole("button", { name: /Try one change/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAccessibleName(/compare next session/i);
  });

  it("RULE C — measured trouble still earns the direct wording", async () => {
    draw(rough);
    await screen.findByText(/eldenring/);
    expect(screen.getByRole("button", { name: /#1 fix/i })).toBeInTheDocument();
    // And the clean line must not appear over a session this card just graded rough.
    expect(screen.queryByText(/Good session, good rig/i)).not.toBeInTheDocument();
  });

  it("RULE D — the clean line and the offer never contradict each other", async () => {
    draw(smooth);
    await screen.findByText(/eldenring/);
    // The smooth session says it was smooth…
    expect(screen.getByText(/Good session, good rig/i)).toBeInTheDocument();
    // …but the moment a change is being offered, it cannot also claim there is nothing to change.
    expect(screen.queryByText(/Nothing worth changing/i)).not.toBeInTheDocument();
  });

  it("RULE D (other half) — with no offer to make, the full clean sentence survives", async () => {
    render(
      <ConfirmProvider>
        <SessionDebrief {...props} s={smooth} priorities={null} recs={[]} />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring/);
    expect(screen.getByText(/Nothing worth changing/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compare next session/i })).not.toBeInTheDocument();
  });
});
