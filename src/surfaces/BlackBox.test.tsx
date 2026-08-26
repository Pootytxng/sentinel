import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { BlackBox } from "./BlackBox";
import type { BlackBoxReport, CrashIncident } from "../types";

// Settable per-test scan response (vi.mock factories are hoisted — this must be too).
const reportMock = vi.hoisted(() => ({
  value: { incidents: [], skipped_sources: [] } as BlackBoxReport,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve(reportMock.value);
    return Promise.resolve(null);
  }),
}));

function assessedIncident(): CrashIncident {
  return {
    headline: "Your graphics driver stopped responding and recovered — Jun 12",
    tag: "GPU timeout",
    when: "2026-06-12T21:00:00Z",
    when_display: "Jun 12, 9:00 PM",
    vitals: null,
    receipt: {
      source: "System log · Display 4101",
      event_ids: [4101],
      faulting_app: null,
      faulting_module: "amdkmdag",
      code: null,
      detail: "Display driver amdkmdag stopped responding and has recovered.",
    },
    assessment: {
      consistent_with: "your graphics driver (amdkmdag) repeatedly timing out",
      strength: "strong",
      evidence: [
        "the same driver module (amdkmdag) stopped responding across 2 separate crashes",
        "the GPU temperature was not in the overheating range in those sessions",
      ],
      next_step: {
        headline: "Do a clean reinstall of your graphics driver",
        detail: "Download the latest driver and install it with the clean-install option.",
        reversible: true,
        research_only: false,
      },
      beyond_us: false,
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(invoke).mockClear();
  reportMock.value = { incidents: [], skipped_sources: [] };
});

const scan = () => fireEvent.click(screen.getByRole("button", { name: /scan for recent crashes/i }));

describe("BlackBox surface (v2 triage UI)", () => {
  it("renders the triage block — consistent-with framing, a strength WORD, evidence, the next step", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    expect(await screen.findByText("What this points to")).toBeInTheDocument();
    expect(screen.getByText(/your graphics driver \(amdkmdag\) repeatedly timing out/)).toBeInTheDocument();
    expect(screen.getByText("Strong signal")).toBeInTheDocument(); // strength is a word, never a %
    expect(screen.getByText(/clean reinstall of your graphics driver/i)).toBeInTheDocument();
  });

  it("the rendered UI never asserts a cause and never shows a percentage (honesty law on screen)", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const body = document.body.textContent || "";
    expect(body).toContain("consistent with"); // the only framing
    expect(body).not.toMatch(/\d%/); // no percentage anywhere
    expect(body).not.toMatch(/\b(the cause is|caused by|definitely|guaranteed)\b/i);
  });

  it("an incident with NO assessment (gate OFF) renders v1 only — no triage block", async () => {
    const inc = assessedIncident();
    inc.assessment = null;
    reportMock.value = { incidents: [inc], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText(inc.headline);
    expect(screen.queryByText("What this points to")).not.toBeInTheDocument();
  });

  it("marking the step helpful shows the local 'you marked this helped' state, never 'fixed/solved'", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(await screen.findByText(/you marked this pointed you the right way/i)).toBeInTheDocument();
    expect(document.body.textContent || "").not.toMatch(/\b(fixed|solved|worked)\b/i);
  });

  it("a clean machine renders the honest empty state", async () => {
    reportMock.value = { incidents: [], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    expect(await screen.findByText(/no crashes or freezes recorded/i)).toBeInTheDocument();
  });
});

// ─── Characterization: the pre-Tier-1 freeze (#220, plan task 1) ───────────────────────────────
//
// Tier 1 case intelligence (Q8) adds a signed, pull-only advisory catalog behind a hard-false gate.
// These tests do not test Tier 1 — they pin what the crash station does TODAY, so that the moment
// any part of Tier 1 becomes reachable in the shipped path, a test says so out loud instead of the
// change arriving silently. Each one is expected to be edited deliberately, by the task that is
// allowed to change that behavior, and never re-baselined to make a red suite green.
describe("Black Box — frozen pre-Tier-1 behavior (characterization)", () => {
  it("a scan issues exactly ONE backend call, get_crash_blackbox, and no other", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["get_crash_blackbox"]);
  });

  it("raw receipt evidence stays BEHIND the expander — ids and codes are absent until it is opened", async () => {
    const inc = assessedIncident();
    inc.receipt.code = "0x00000116";
    reportMock.value = { incidents: [inc], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText(inc.headline);

    expect(document.body.textContent || "").not.toContain("0x00000116");
    expect(document.body.textContent || "").not.toContain("System log · Display 4101");

    fireEvent.click(screen.getByRole("button", { name: /show the receipt/i }));
    expect(screen.getByText("0x00000116")).toBeInTheDocument();
    expect(screen.getByText("System log · Display 4101")).toBeInTheDocument();
  });

  it("the 'did this help' mark is written LOCALLY and sends nothing — no extra backend call", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    vi.mocked(invoke).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));
    await screen.findByText(/you marked this pointed you the right way/i);

    expect(vi.mocked(invoke).mock.calls).toHaveLength(0);
    expect(localStorage.getItem("compy_bb_feedback")).toContain('"vote":"yes"');
  });

  it("an incident carrying an UNKNOWN optional field renders exactly as one without it", async () => {
    // The Tier 1 wire contract adds an optional `case_intelligence` field to the incident. Today the
    // station has no such field and must ignore one that appears. When task 7 lands, this test is the
    // one that has to be changed on purpose — its failure is the signal, not a nuisance.
    const withField = {
      ...assessedIncident(),
      case_intelligence: { case_id: "unused", level: "MatchedKnownIssue" },
    } as unknown as CrashIncident;

    reportMock.value = { incidents: [withField], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const withText = document.body.textContent || "";

    cleanup();
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");

    expect(document.body.textContent || "").toBe(withText);
    expect(withText).not.toContain("unused");
  });

  it("no known-issue / advisory-source chrome exists on the station yet", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const body = document.body.textContent || "";
    expect(body).not.toMatch(/known issue/i);
    expect(body).not.toMatch(/matches the recorded shape/i);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
