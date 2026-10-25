import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { BlackBox } from "./BlackBox";
import type { BlackBoxReport, CrashIncident, CaseIntelligenceMatch } from "../types";

// Settable per-test scan response (vi.mock factories are hoisted — this must be too).
const reportMock = vi.hoisted(() => ({
  value: { incidents: [], skipped_sources: [] } as BlackBoxReport,
}));

// The external-browser opener. Mocked so a test can prove the source URL leaves the app only after a
// click, and that it is the catalog's own verified URL rather than anything the station composed.
const openUrlMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve(reportMock.value);
    return Promise.resolve(null);
  }),
}));

function assessedIncident(): CrashIncident {
  return {
    incident_id: "a1b2c3d4e5f60718",
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
  // mockReset() strips the implementation, so the next call would return undefined and the
  // component's `.catch` would throw inside an event handler. Re-arm it as a resolved promise —
  // that is what the real plugin hands back. (Surfaced by the full-suite run, not the file's own.)
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
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

  it("an incident with the Tier 1 field ABSENT renders identically to one where it is null", async () => {
    // CHANGED ON PURPOSE by task 7 — the signal fired exactly as this suite intended. The old
    // phrasing ("an unknown optional field is ignored") stopped saying anything the moment
    // `case_intelligence` became a field the station knows. The compatibility half is what actually
    // had to survive, and it is what this now pins: a dark build OMITS the field, an explicit null
    // means the same thing, and both must render the pre-Tier-1 station exactly. The gate is off in
    // every shipped build, so this is the shipped path, not an edge case.
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const absentText = document.body.textContent || "";

    cleanup();
    const nulled = { ...assessedIncident(), case_intelligence: null } as CrashIncident;
    reportMock.value = { incidents: [nulled], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");

    expect(document.body.textContent || "").toBe(absentText);
    expect(absentText).not.toMatch(/known issue/i);
  });

  it("no known-issue or advisory-source chrome appears on an incident with no match", async () => {
    // CHANGED ON PURPOSE by task 7: the title, not the bar. Tier 1 chrome exists in the code now and
    // must stay invisible on an incident the catalog said nothing about — which is every incident in
    // every shipped build, because the gate is hard-false.
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

// ─── Tier 1 known-issue block (#220, plan task 7) ───────────────────────────────────────────────
//
// The crash station may now CARRY a signed known-issue write-up. Two rules run through every test
// here: the words on screen are the publisher's, never Compy's, and the block is visibly SEPARATE
// from Compy's own local reading — a user must always be able to tell whose word they are taking.
function matchedCase(): CaseIntelligenceMatch {
  return {
    case_id: "amd-tdr-adrenalin-2026-q1",
    catalog_version: 7,
    level: "matched_known_issue",
    title: "Adrenalin 26.1.1 display timeouts on RDNA4",
    summary: "AMD records display timeouts on this driver line with certain multi-monitor setups.",
    evidence_refs: ["faulting_module", "gpu_vendor"],
    next_steps: [
      {
        headline: "Update to Adrenalin 26.2.1 or later",
        detail: "The release notes list a fix for this timeout.",
        research_only: false,
      },
    ],
    contraindications: ["Do not do this mid-download — the display will blank while the driver swaps."],
    source_url: "https://www.amd.com/en/resources/support-articles/release-notes.html",
    source_updated_at: "2026-02-01",
  };
}

function casedIncident(over: Partial<CaseIntelligenceMatch> = {}): CrashIncident {
  return { ...assessedIncident(), case_intelligence: { ...matchedCase(), ...over } };
}

describe("Black Box — Tier 1 known-issue block", () => {
  it("a verified match renders the label, the write-up, what lined up, a next step and the provenance", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    expect(await screen.findByText("Known issue on record")).toBeInTheDocument();
    expect(screen.getByText("Adrenalin 26.1.1 display timeouts on RDNA4")).toBeInTheDocument();
    expect(screen.getByText(/AMD records display timeouts/)).toBeInTheDocument();
    expect(screen.getByText(/Update to Adrenalin 26.2.1 or later/)).toBeInTheDocument();
    // Provenance: whose list this came from, and how old it is. Without both, "known issue" is a
    // claim with no way to check it.
    expect(screen.getByText(/Published 2026-02-01/)).toBeInTheDocument();
    expect(screen.getByText(/Case list v7/)).toBeInTheDocument();
  });

  it("what lined up is shown in plain English — never a raw key, never the machine's own values", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    const body = document.body.textContent || "";
    expect(body).toContain("the file that stopped responding");
    expect(body).toContain("your graphics card brand");
    expect(body).not.toContain("faulting_module"); // the wire key must not surface
    expect(body).not.toContain("gpu_vendor");
  });

  it("the publisher's caveats ride along with the advice, never separated from it", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    expect(screen.getByText(/the display will blank while the driver swaps/)).toBeInTheDocument();
  });

  it("a PARTIAL match says so — Compy could not check everything, and does not pretend it did", async () => {
    reportMock.value = {
      incidents: [casedIncident({ level: "possible_known_issue" })],
      skipped_sources: [],
    };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    const body = document.body.textContent || "";
    expect(body).toMatch(/couldn't check every detail/i);
    expect(body).not.toMatch(/this matches a known issue/i);
  });

  it("the known-issue block is a SEPARATE section from Compy's own reading", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    const known = document.querySelector(".bb-known");
    const own = document.querySelector(".bb-assess");
    expect(known).not.toBeNull();
    expect(own).not.toBeNull();
    expect(known!.contains(own!)).toBe(false);
    expect(own!.contains(known!)).toBe(false);
    // And it says out loud whose words these are.
    expect(document.body.textContent || "").toMatch(/publisher's words, not Compy's/i);
  });

  it("the copy never claims a cause and never claims a fix", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    const body = document.body.textContent || "";
    expect(body).toMatch(/matches a known issue/i);
    expect(body).not.toMatch(/\b(caused|cause of|will fix|fixes this|fixed|solved|guaranteed)\b/i);
    expect(body).not.toMatch(/\d%/);
  });

  it("the source opens in the user's browser only after a click, at the catalog's own URL", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    // Nothing navigates on render, and there is no <a href> for the webview to follow.
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open the write-up/i }));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(matchedCase().source_url);
  });

  it("a browser that never opens says so and hands over the link, instead of looking like a dead button", async () => {
    // The defect this pins: the rejection used to be swallowed, so on a machine with no registered
    // browser handler the click did nothing at all — visually identical to a broken button, with no
    // way left to reach the page. Rare, and rare is exactly why it needs a test rather than a
    // reviewer noticing it.
    openUrlMock.mockRejectedValue(new Error("no application is registered for https"));
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");

    fireEvent.click(screen.getByRole("button", { name: /open the write-up/i }));

    // The recovery IS the URL, so it must be on screen — and it must be the catalog's own, not
    // anything the station composed.
    expect(await screen.findByText(matchedCase().source_url)).toBeInTheDocument();
    expect(document.body.textContent || "").toMatch(/couldn't hand that to a browser/i);
    // The button that cannot work is gone rather than left there to be clicked again, and it is
    // still not an <a href> — the webview must never be able to follow this itself.
    expect(screen.queryByRole("button", { name: /open the write-up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a browser that DOES open leaves no failure text — the fallback is not the default state", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    fireEvent.click(screen.getByRole("button", { name: /open the write-up/i }));
    await Promise.resolve();
    expect(document.body.textContent || "").not.toMatch(/couldn't hand that to a browser/i);
    expect(screen.queryByText(matchedCase().source_url)).not.toBeInTheDocument();
  });

  it("still issues exactly one backend call — the match arrives with the scan, not from a second fetch", async () => {
    reportMock.value = { incidents: [casedIncident()], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("Known issue on record");
    expect(vi.mocked(invoke).mock.calls.map((c) => c[0])).toEqual(["get_crash_blackbox"]);
  });

  it("a null match renders no chrome at all — an unverifiable catalog leaves no trace on screen", async () => {
    // The backend attaches the field ONLY on a real match: no catalog, an expired or unverifiable
    // one, and simply nothing that fits all arrive here the same way — as nothing. The station must
    // not hint that something was withheld.
    const inc = { ...assessedIncident(), case_intelligence: null } as CrashIncident;
    reportMock.value = { incidents: [inc], skipped_sources: [] };
    render(<BlackBox />);
    scan();
    await screen.findByText("What this points to");
    const body = document.body.textContent || "";
    expect(screen.queryByText("Known issue on record")).not.toBeInTheDocument();
    expect(body).not.toMatch(/known issue/i);
    expect(document.querySelector(".bb-known")).toBeNull();
  });
});

// ── The deep-link (Tier 1 plan task 8) ──────────────────────────────────────────────────────────
//
// Home can send the user here pointed at ONE incident. Everything below is about what that pointer
// may and may not do: it selects, it never subtracts, and when Windows no longer has the record it
// says so out loud rather than showing a list that quietly lacks the thing the user clicked.
describe("BlackBox — the deep-linked incident", () => {
  const other = (): CrashIncident => ({
    ...assessedIncident(),
    incident_id: "ffffffffffffffff",
    headline: "Windows restarted unexpectedly — Jun 10",
    when: "2026-06-10T03:00:00Z",
    when_display: "Jun 10, 3:00 AM",
    assessment: null,
  });

  it("scans on arrival, so the user does not land on an empty room", () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    render(<BlackBox selectedIncidentId="a1b2c3d4e5f60718" />);
    expect(
      vi.mocked(invoke).mock.calls.map((c) => c[0]),
      "arriving with an incident selected did not trigger the scan",
    ).toContain("get_crash_blackbox");
  });

  it("does not scan on its own when nobody pointed it anywhere", () => {
    // The station is otherwise click-to-scan by design: reading the Event Log is not free, and the
    // standing bar is that Compy is the least resource-hungry app on the PC.
    render(<BlackBox />);
    expect(
      vi.mocked(invoke).mock.calls.map((c) => c[0]),
      "the station now scans on every mount",
    ).not.toContain("get_crash_blackbox");
  });

  it("marks the pointed-at row and leaves every other row in place", async () => {
    reportMock.value = { incidents: [other(), assessedIncident()], skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId="a1b2c3d4e5f60718" />);
    await screen.findByText(/graphics driver stopped responding/i);
    const rows = container.querySelectorAll(".bb-item");
    expect(rows.length, "the selection filtered the list — the surrounding evidence is gone").toBe(2);
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked.length, "exactly one row should be marked as the one the user came for").toBe(1);
    expect(marked[0].textContent).toContain("graphics driver stopped responding");
    expect(marked[0].querySelector(".bb-selected-note")!.textContent).toBe(
      "This is the one you came here to see.",
    );
  });

  it("marks nothing when it was not sent anywhere", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    const { container } = render(<BlackBox />);
    scan();
    await screen.findByText(/graphics driver stopped responding/i);
    expect(
      container.querySelectorAll('.bb-item[data-selected="true"]').length,
      "a row is marked as deep-linked with no deep-link",
    ).toBe(0);
  });

  it("says so when the incident is no longer in Windows' records", async () => {
    // Windows rotates its own logs; some sources need admin. An honest negative is the doctrine.
    reportMock.value = { incidents: [other()], skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId="a1b2c3d4e5f60718" />);
    await screen.findByText(/Windows restarted unexpectedly/i);
    const note = container.querySelector(".bb-selected-missing");
    expect(note, "the deep-linked incident is absent and the station said nothing").not.toBeNull();
    expect(note!.textContent).toContain("isn't in this scan");
  });

  it("stays quiet about a missing incident when the one asked for IS there", async () => {
    reportMock.value = { incidents: [assessedIncident()], skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId="a1b2c3d4e5f60718" />);
    await screen.findByText(/graphics driver stopped responding/i);
    expect(
      container.querySelector(".bb-selected-missing"),
      "the station claims the incident is missing while rendering it",
    ).toBeNull();
  });
});

// P6-changed: the sidump crash from the owner's real stores (src/test/fixtures/
// incident-changed-before-453.json), as `intelligence::changed_before_incident_impl` answers it.
function sidumpIncident(changed_before: CrashIncident["changed_before"]): CrashIncident {
  return {
    incident_id: "186070d78b13c37f",
    headline: "sidump stopped working and closed — Oct 24, 4:18 AM",
    tag: "App crash",
    when: "2026-10-24T04:18:51.503609400-07:00",
    when_display: "Oct 24, 4:18 AM",
    vitals: null,
    receipt: { source: "Application log · 1000", event_ids: [1000], faulting_app: "sidump.exe", faulting_module: null, code: null, detail: "" },
    changed_before,
  };
}
const ev = (summary: string, event_type: string) => ({
  id: `${event_type}:${summary}`,
  timestamp: "2026-10-23T16:08:54.598522500+00:00",
  event_type,
  source: "trust-ledger",
  scope: "compy-applied" as const,
  game: null,
  summary,
  detail: null,
  observed_between: null,
  since_rolled_back: false,
  rec_id: "visual-effects",
});
const item = (category: string, status: string, extra: Record<string, unknown> = {}) => ({
  category,
  status,
  events: [],
  unknown_reason: null,
  last_reading_at: null,
  checked_between: null,
  ...extra,
}) as unknown as NonNullable<CrashIncident["changed_before"]>["items"][number];

describe("BlackBox — Changed before this (P6-changed)", () => {
  it("lists every category since the last clean session, each tagged not proven cause", async () => {
    reportMock.value = {
      incidents: [
        sidumpIncident({
          anchor_kind: "clean",
          anchor: { started_at: "2026-10-23T16:06:22.472457100+00:00", game: "WardogsClient" },
          window_end: "2026-10-24T04:18:51.503609400-07:00",
          items: [
            item("compy-changes", "changed", {
              events: [
                ev("Trim Windows visual effects applied (since rolled back)", "change-applied"),
                ev("Trim Windows visual effects rolled back", "change-rolled-back"),
              ],
            }),
            item("driver", "no-change", {
              checked_between: ["2026-10-23T16:06:22.472457100+00:00", "2026-10-24T19:24:22.256501300+00:00"],
            }),
            item("windows-build", "unknown", { unknown_reason: "no-reading-after", last_reading_at: "2026-10-23T14:03:14.523573500+00:00" }),
            item("power-plan", "unknown", { unknown_reason: "no-reading-after", last_reading_at: "2026-10-23T14:03:14.523573500+00:00" }),
            item("hardware", "no-change", {
              checked_between: ["2026-10-23T16:06:22.472457100+00:00", "2026-10-24T19:24:22.256501300+00:00"],
            }),
            item("drift", "unknown", { unknown_reason: "drift-not-kept" }),
          ],
        }),
      ],
      skipped_sources: [],
    };
    const { container } = render(<BlackBox />);
    scan();
    expect(await screen.findByText("Changed before this")).toBeInTheDocument();
    expect(screen.getByText(/Since your last clean session \(WardogsClient,/)).toBeInTheDocument();
    for (const label of ["Compy changes", "Graphics driver", "Windows build", "Power plan", "Hardware", "Setting drift"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const rows = container.querySelectorAll(".bb-changed-item");
    expect(rows).toHaveLength(6);
    rows.forEach((row) => expect(row.textContent).toContain("not proven cause"));
    expect(screen.getByText("Trim Windows visual effects rolled back", { exact: false })).toBeInTheDocument();
    // Unread evidence reads as unknown — never as "No change".
    for (const cat of ["windows-build", "power-plan", "drift"]) {
      const row = container.querySelector(`.bb-changed-item[data-category="${cat}"]`)!;
      expect(row.textContent).toMatch(/Unknown:/);
      expect(row.textContent).not.toMatch(/No change/);
    }
    expect(container.querySelector('[data-category="driver"]')!.textContent).toMatch(/No change: Compy read the same thing/);
    expect(container.textContent).not.toMatch(/caused|because|root cause/i);
  });

  it("says so when there was no session before the incident, and lists nothing", async () => {
    reportMock.value = {
      incidents: [sidumpIncident({ anchor_kind: "none", anchor: null, window_end: "2026-10-24T04:18:51-07:00", items: [] })],
      skipped_sources: [],
    };
    const { container } = render(<BlackBox />);
    scan();
    expect(await screen.findByText(/No session was recorded before this/)).toBeInTheDocument();
    expect(container.querySelectorAll(".bb-changed-item")).toHaveLength(0);
  });
});
