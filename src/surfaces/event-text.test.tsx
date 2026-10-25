import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BlackBox } from "./BlackBox";
import { WhatChangedPanel } from "./WhatChangedPanel";
import { eventText } from "./event-text";
import i18n from "../i18n";
import fixture from "../test/fixtures/timeline-event-parts.json";
import type { BlackBoxReport, CrashIncident, IntelEvent, WhatChangedOutcome } from "../types";

// P6-changed-f1: timeline event lines were Rust's English `summary`, so zh-CN read English inside
// the translated "Changed before this", "Since it last worked" and What-changed blocks. The backend
// now sends the facts as `parts`; the line is worded from a translated template, values kept as data.

const harness = vi.hoisted(() => ({ report: null as unknown, outcome: null as unknown }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve(harness.report);
    if (cmd === "what_changed_for_session") return Promise.resolve(harness.outcome);
    return Promise.resolve(null);
  }),
}));

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

function ev(over: Partial<IntelEvent>): IntelEvent {
  return {
    id: "x",
    timestamp: "2026-10-21T10:00:00Z",
    event_type: "change-applied",
    source: "trust-ledger",
    scope: "compy-applied",
    game: null,
    summary: "",
    detail: null,
    observed_between: null,
    since_rolled_back: false,
    rec_id: null,
    ...over,
  };
}

const DRIVER = ev({
  id: "gpu:1",
  timestamp: "2026-10-23T10:00:00Z",
  event_type: "gpu-driver-change",
  source: "identity-snapshot",
  scope: "observed",
  summary: "GPU driver changed: 32.0.15.6094 → 32.0.15.6614",
  observed_between: ["2026-10-20T10:00:00Z", "2026-10-23T10:00:00Z"],
  parts: { kind: "gpu-driver", from: "32.0.15.6094", to: "32.0.15.6614" },
});
const APPLIED = ev({
  id: "apply:1",
  timestamp: "2026-10-22T10:00:00Z",
  summary: "Trim Windows visual effects applied (since rolled back)",
  since_rolled_back: true,
  rec_id: "visual-effects",
  parts: { kind: "applied", title: "Trim Windows visual effects" },
});
const SESSION = ev({
  id: "session:1",
  timestamp: "2026-10-21T12:00:00Z",
  event_type: "session",
  source: "sessions",
  scope: "measurement",
  summary: "Elden Ring session — 10 min · 120 avg FPS · 100 1% low",
  parts: { kind: "session", game: "Elden Ring", duration_secs: 600, fps: ["120", "100"] },
});
const HARDWARE = ev({
  id: "hw:1",
  event_type: "hardware-change",
  scope: "observed",
  summary: "Hardware changed — GPU: GPU A → GPU B · RAM: 16 GB → 32 GB",
  observed_between: ["2026-10-19T10:00:00Z", "2026-10-21T10:00:00Z"],
  parts: {
    kind: "hardware",
    changes: [
      { part: "gpu", from: "GPU A", to: "GPU B" },
      { part: "ram", from: "16 GB", to: "32 GB" },
    ],
  },
});
const DRIFT = ev({
  id: "drift:1",
  timestamp: "2026-10-12T10:00:00Z",
  event_type: "readiness-drift",
  source: "drift-watch",
  scope: "observed",
  summary: "No longer ready: Game Mode",
  parts: { kind: "drift", label: "Game Mode" },
});

describe("eventText", () => {
  it("in English reads exactly as the backend's summary, for every event the real builders emit", () => {
    // intelligence.rs `event_parts_fixture_matches_what_the_builders_emit` keeps this fixture equal
    // to what assemble_timeline produces, so these summaries are Rust's own, not typed here.
    const t = i18n.getFixedT("en");
    const rows = fixture as { event_type: string; summary: string; since_rolled_back: boolean; parts: IntelEvent["parts"] }[];
    expect(new Set(rows.map((r) => r.parts!.kind)).size).toBe(9);
    for (const r of rows) {
      const e = ev({ event_type: r.event_type, summary: r.summary, since_rolled_back: r.since_rolled_back, parts: r.parts });
      expect(eventText(e, t)).toBe(r.summary);
    }
  });

  it("falls back to the summary for old data and kinds this build doesn't know", () => {
    const t = i18n.getFixedT("zh-CN");
    expect(eventText(ev({ summary: "Verified win: X (avg +3.0%)" }), t)).toBe("Verified win: X (avg +3.0%)");
    const future = ev({ summary: "Something new", parts: { kind: "new-kind" } as unknown as IntelEvent["parts"] });
    expect(eventText(future, t)).toBe("Something new");
  });
});

const ENGLISH = /GPU driver changed|applied|rolled back|session —|Hardware changed|No longer ready|avg FPS/;

describe("zh-CN reads whole on the Care view and the What-changed panel (P6-changed-f1)", () => {
  it("Changed before this and Since it last worked word every event in Chinese, values kept", async () => {
    await i18n.changeLanguage("zh-CN");
    const inc: CrashIncident = {
      incident_id: "inc-1",
      headline: "Elden Ring 停止工作并关闭",
      tag: "App crash",
      when: "2026-10-24T20:00:00Z",
      when_display: "Oct 24",
      vitals: null,
      receipt: { source: "Application log", event_ids: [1000], faulting_app: null, faulting_module: null, code: null, detail: "" },
      changed_before: {
        anchor_kind: "clean",
        anchor: { started_at: "2026-10-20T10:00:00Z", game: "Elden Ring" },
        window_end: "2026-10-24T20:00:00Z",
        items: [
          { category: "compy-changes", status: "changed", events: [APPLIED], unknown_reason: null, last_reading_at: null, checked_between: null },
          { category: "driver", status: "changed", events: [DRIVER], unknown_reason: null, last_reading_at: null, checked_between: null },
        ],
      } as unknown as CrashIncident["changed_before"],
    };
    harness.report = {
      incidents: [inc],
      skipped_sources: [],
      since_last_worked: {
        anchor: { started_at: "2026-10-20T10:00:00Z", game: "Elden Ring" },
        none_reason: null,
        events: [DRIVER, APPLIED, SESSION],
        unplaced: [HARDWARE],
        open_drift: [DRIFT],
      },
    } satisfies BlackBoxReport;
    const { container } = render(<BlackBox />);
    fireEvent.click(container.querySelector(".bb-scan")!);
    await screen.findByRole("region", { name: i18n.t("gaming.blackBox.sinceWorked.title") });

    const changed = [...container.querySelectorAll(".bb-changed-events li")].map((li) => li.textContent ?? "");
    expect(changed.some((s) => s.startsWith("已应用 Trim Windows visual effects(之后已撤销)"))).toBe(true);
    expect(changed.some((s) => s.startsWith("显卡驱动已变更:32.0.15.6094 → 32.0.15.6614"))).toBe(true);

    const since = [...container.querySelectorAll(".bb-since-text")].map((s) => s.textContent ?? "");
    expect(since).toEqual(
      expect.arrayContaining([
        "显卡驱动已变更:32.0.15.6094 → 32.0.15.6614",
        expect.stringMatching(/^已应用 Trim Windows visual effects\(之后已撤销\)/),
        "Elden Ring 会话——10 分钟 · 平均 120 FPS · 1% 最低帧 100",
        "硬件已变更——显卡:GPU A → GPU B · 内存:16 GB → 32 GB",
        "不再就绪:Game Mode",
      ]),
    );
    for (const s of [...changed, ...since]) expect(s).not.toMatch(ENGLISH);
  });

  it("What changed lists the events between sessions in Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    const sref = (started_at: string) => ({
      started_at, game: "Elden Ring", duration_secs: 3600, samples: 3400, avg_fps: 120, low1_fps: 100,
      gaming_mode_active: null, hw_hash: "hw1",
    });
    harness.outcome = {
      kind: "report",
      baseline: sref("2026-10-20T10:00:00Z"),
      current: sref("2026-10-24T10:00:00Z"),
      game: "Elden Ring",
      verdict: "regressed",
      headline: "x",
      observations: [],
      noise_floor_pct: 3,
      events_between: [DRIVER, APPLIED],
      leading_hypotheses: [],
      ruled_out: [],
      unknowns: [],
      next_action: null,
      next_action_rec_id: null,
      confounded: false,
      gap_days: 4,
      notes: [],
      method_note: "",
      evidence_graph: { nodes: [], edges: [] },
      comparability: {
        verdict: "comparable", reasons: [], changed_context: [], missing_context: [], candidate_causes: [],
        shared_metrics: [], confidence_limit: "high", allowed_conclusions: [],
      },
    } as unknown as WhatChangedOutcome;
    const { container } = render(<WhatChangedPanel startedAt="2026-10-24T10:00:00Z" />);
    await waitFor(() => expect(container.querySelector(".wcp-detail-toggle")).toBeTruthy());
    fireEvent.click(container.querySelector(".wcp-detail-toggle")!);
    await waitFor(() => expect(container.querySelectorAll(".wcp-between li")).toHaveLength(2));
    const lines = [...container.querySelectorAll(".wcp-between li")].map((li) => li.textContent ?? "");
    expect(lines[0]).toMatch(/^显卡驱动已变更:32\.0\.15\.6094 → 32\.0\.15\.6614/);
    expect(lines[1]).toMatch(/^已应用 Trim Windows visual effects\(之后已撤销\)/);
  });
});
