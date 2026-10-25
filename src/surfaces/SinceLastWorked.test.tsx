import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { BlackBox } from "./BlackBox";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { sinceRows, MAX_SINCE_ROWS } from "./SinceLastWorked";
import i18n from "../i18n";
import type { BlackBoxReport, CrashIncident, IntelEvent } from "../types";

// P6-timeline: the Care view's one "Since it last worked" list.

const reportMock = vi.hoisted(() => ({ value: null as unknown as BlackBoxReport }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) =>
    cmd === "get_crash_blackbox" ? Promise.resolve(reportMock.value) : Promise.resolve(null),
  ),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
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
  } as IntelEvent;
}

function incident(when: string, headline: string): CrashIncident {
  return {
    incident_id: `inc-${when}`,
    headline,
    tag: "App crash",
    when,
    when_display: when,
    vitals: null,
    receipt: { source: "Application log", event_ids: [1000], faulting_app: null, faulting_module: null, code: null, detail: "" },
  } as CrashIncident;
}

const REPORT: BlackBoxReport = {
  incidents: [
    incident("2026-10-24T20:00:00Z", "Elden Ring stopped working and closed"),
    // Before the session that worked: not part of "since".
    incident("2026-10-18T20:00:00Z", "An older crash"),
  ],
  skipped_sources: [],
  since_last_worked: {
    anchor: { started_at: "2026-10-20T10:00:00Z", game: "Elden Ring" },
    none_reason: null,
    events: [
      ev({
        id: "gpu:1",
        timestamp: "2026-10-23T10:00:00Z",
        event_type: "gpu-driver-change",
        source: "identity-snapshot",
        scope: "observed",
        summary: "GPU driver changed: drv-1 → drv-2",
        observed_between: ["2026-10-20T10:00:00Z", "2026-10-23T10:00:00Z"],
      }),
      ev({ id: "drift:1", timestamp: "2026-10-22T12:00:00Z", event_type: "readiness-drift", source: "drift-watch", scope: "observed", summary: "Game Mode drifted off" }),
      ev({ id: "session:2", timestamp: "2026-10-22T10:00:00Z", event_type: "session", source: "sessions", scope: "measurement", summary: "Elden Ring session — 10 min" }),
      ev({ id: "apply:1", summary: "Applied: Trim Windows visual effects", since_rolled_back: true }),
    ],
    unplaced: [],
    open_drift: [],
  },
};

async function scan(report: BlackBoxReport) {
  reportMock.value = report;
  render(
    <ConfirmProvider>
      <BlackBox />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("gaming.blackBox.scanButton") }));
  return screen.findByRole("region", { name: i18n.t("gaming.blackBox.sinceWorked.title") });
}

describe("Since it last worked (P6-timeline)", () => {
  it("lists incidents, Compy changes, drift, observed changes and sessions newest first, from the last clean session", async () => {
    const list = await scan(REPORT);
    expect(within(list).getByText(/What Compy recorded since your last session with no crash on record started \(Elden Ring,/)).toBeInTheDocument();
    expect(within(list).getByText(/not proven cause/)).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["incident", "observed", "drift", "session", "compy"]);
    expect(rows[0]).toHaveTextContent("Elden Ring stopped working and closed");
    expect(rows[1]).toHaveTextContent(/noticed between/);
    expect(rows[4]).toHaveTextContent(/Trim Windows visual effects · since undone/);
    expect(within(list).queryByText("An older crash")).not.toBeInTheDocument();
  });

  it("says so when no session can be called clean, and lists nothing", async () => {
    const list = await scan({
      ...REPORT,
      since_last_worked: { anchor: null, none_reason: "none-clean", events: [], unplaced: [], open_drift: [] },
    });
    expect(list).toHaveTextContent(i18n.t("gaming.blackBox.sinceWorked.noneClean"));
    expect(within(list).queryAllByRole("listitem")).toHaveLength(0);
    cleanup();
    const list2 = await scan({
      incidents: [],
      skipped_sources: [],
      since_last_worked: { anchor: null, none_reason: "no-session", events: [], unplaced: [], open_drift: [] },
    });
    expect(list2).toHaveTextContent(i18n.t("gaming.blackBox.sinceWorked.noSession"));
  });

  it("shows a change it can't place apart from the list, and caps a long list", async () => {
    const list = await scan({
      ...REPORT,
      since_last_worked: {
        ...REPORT.since_last_worked!,
        unplaced: [ev({ id: "hw:1", event_type: "hardware-change", scope: "observed", summary: "Hardware changed: new GPU", observed_between: ["2026-10-19T10:00:00Z", "2026-10-21T10:00:00Z"] })],
      },
    });
    expect(list).toHaveTextContent(/can't tell if it was before or after that session/);
    expect(within(list).getByText("Hardware changed: new GPU").closest("li")).toHaveAttribute("data-kind", "observed");

    const many = Array.from({ length: MAX_SINCE_ROWS + 3 }, (_, n) =>
      ev({ id: `a${n}`, timestamp: new Date(Date.parse("2026-10-21T00:00:00Z") + n * 60000).toISOString() }),
    );
    const rows = sinceRows({ ...REPORT, incidents: [], since_last_worked: { ...REPORT.since_last_worked!, events: many } });
    expect(rows).toHaveLength(MAX_SINCE_ROWS + 3);
    expect(rows![0].key).toBe(`a${MAX_SINCE_ROWS + 2}`);
  });

  it("shows every open drift even when no session worked, and apart from the dated list when one did", async () => {
    const drift = ev({ id: "drift:old", timestamp: "2026-10-12T10:00:00Z", event_type: "readiness-drift", scope: "observed", summary: "Game Mode was found changed" });
    const list = await scan({
      ...REPORT,
      since_last_worked: { anchor: null, none_reason: "none-clean", events: [], unplaced: [], open_drift: [drift] },
    });
    expect(list).toHaveTextContent(i18n.t("gaming.blackBox.sinceWorked.noneClean"));
    expect(list).toHaveTextContent("Still drifted now:");
    expect(within(list).getByText("Game Mode was found changed").closest("li")).toHaveAttribute("data-kind", "drift");
    cleanup();
    const list2 = await scan({ ...REPORT, since_last_worked: { ...REPORT.since_last_worked!, open_drift: [drift] } });
    expect(list2).toHaveTextContent("Still drifted now, from before that session:");
  });

  it("is read-only: the list has no buttons", async () => {
    const list = await scan(REPORT);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
  });
});
