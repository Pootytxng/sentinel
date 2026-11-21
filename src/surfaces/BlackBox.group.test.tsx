import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { BlackBox } from "./BlackBox";
import { ConfirmProvider } from "../design/ConfirmDialog";
import i18n from "../i18n";
import type { AppliedChange, BlackBoxReport, CrashIncident } from "../types";

// P2-group: the Problems room shows identical incidents as one group (blackbox-group.ts).
const reportMock = vi.hoisted(() => ({ value: { incidents: [], skipped_sources: [] } as BlackBoxReport }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve(reportMock.value);
    if (cmd === "get_experiments") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

afterEach(async () => {
  cleanup();
  localStorage.clear();
  reportMock.value = { incidents: [], skipped_sources: [] };
  await i18n.changeLanguage("en");
});

const ITEM = (category: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ category, status, events: [], unknown_reason: null, last_reading_at: null, checked_between: null, ...extra }) as never;

/** i = 0 is the oldest (Nov 10), the highest i the newest (Nov 20). */
function rob(i: number, over: Partial<CrashIncident> = {}): CrashIncident {
  const day = 10 + Math.floor((i * 10) / 24);
  const minute = String(i).padStart(2, "0");
  return {
    incident_id: `a${String(i).padStart(15, "0")}`,
    headline: `ROB RUN stopped working and closed — Nov ${day}, 12:${minute} PM`,
    tag: "App crash",
    when: `2026-11-${day}T12:${minute}:00Z`,
    when_display: `Nov ${day}, 12:${minute} PM`,
    vitals: null,
    receipt: { source: "Application log · 1000", event_ids: [1000], faulting_app: "ROB RUN.exe", faulting_module: null, code: null, detail: `raw-detail-${i}` },
    assessment: {
      rule: "app-specific",
      statement: "app-crash",
      subject: "ROB RUN",
      consistent_with: "ROB RUN crashing",
      strength: "weak",
      evidence: ["Compy found no graphics-driver timeout, blue screen, hardware error or unexpected shutdown in the Windows System log within 10 minutes of it."],
      next_step: { headline: "Verify the game's files, then update it", detail: "In the launcher.", reversible: true, research_only: false },
      beyond_us: false,
    },
    changed_before: {
      anchor_kind: "clean",
      anchor: { started_at: "2026-11-09T10:00:00Z", game: "ROB RUN" },
      window_end: "2026-11-10T00:00:00Z",
      items: [
        ITEM("driver", "unknown", { unknown_reason: "no-reading-after", last_reading_at: "2026-11-09T11:00:00Z" }),
        ITEM("hardware", "unknown", { unknown_reason: "no-reading-after", last_reading_at: `2026-11-09T11:${minute}:00Z` }),
        ITEM("drift", "unknown", { unknown_reason: "drift-not-kept" }),
      ],
    },
    ...over,
  };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => rob(i));
const open = async (incidents: CrashIncident[], changes?: AppliedChange[]) => {
  reportMock.value = { incidents, skipped_sources: [] };
  const view = render(
    <ConfirmProvider>
      <BlackBox changes={changes} />
    </ConfirmProvider>,
  );
  fireEvent.click(view.container.querySelector(".bb-scan")!);
  await screen.findAllByText(/ROB RUN|Other/);
  return view;
};
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });

describe("Problems room - identical incidents grouped", () => {
  it("25 identical incidents become ONE block: a count-and-range headline, the reading once, nothing per incident yet", async () => {
    const { container } = await open(many(25));
    expect(container.querySelectorAll(".bb-list > .bb-item")).toHaveLength(1);
    const from = dayLabel(many(25)[0].when);
    const to = dayLabel(many(25)[24].when);
    expect(screen.getByText(`ROB RUN stopped working and closed 25 times that Windows recorded, from ${from} to ${to}.`)).toBeTruthy();
    // The cap is said: 25 is what the reader keeps, so it is not a total.
    expect(screen.getByText(/at most the 25 most recent records, so this counts only those; older ones may exist/)).toBeTruthy();
    // The shared reading, once.
    expect(screen.getAllByText(/WEAK SIGNAL/i)).toHaveLength(1);
    expect(screen.getAllByText(/That record alone can't tell where the problem is/)).toHaveLength(1);
    expect(screen.queryByText("Did this point you the right way?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the receipt" })).toBeNull();
  });

  it("a group below the cap says nothing about a cut", async () => {
    await open(many(3));
    expect(screen.getByText(/closed 3 times that Windows recorded/)).toBeTruthy();
    expect(screen.queryByText(/most recent .* records/)).toBeNull();
  });

  it("'Show each one' is a real button with aria-expanded; opening it lists all 25 with every per-incident control", async () => {
    const { container } = await open(many(25));
    const btn = screen.getByRole("button", { name: "Show each one (25)" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    const toggle = screen.getByRole("button", { name: "Hide the individual records" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(list).toBeTruthy();
    const rows = list.querySelectorAll(":scope > .bb-item");
    expect(rows).toHaveLength(25);
    expect(screen.getAllByText("Did this point you the right way?")).toHaveLength(25);
    expect(screen.getAllByRole("button", { name: "Show the receipt" })).toHaveLength(25);
    expect(screen.getAllByText(/Compy wasn't monitoring at that moment/)).toHaveLength(25);
    // Each record keeps its own time, newest first.
    expect(rows[0].textContent).toContain("Nov 20, 12:24 PM");
    expect(rows[24].textContent).toContain("Nov 10, 12:00 PM");
    // The receipt of one record opens to that record's own raw detail.
    fireEvent.click(within(rows[3] as HTMLElement).getByRole("button", { name: "Show the receipt" }));
    expect(rows[3].textContent).toContain("raw-detail-21");
    expect(container.querySelectorAll(".bb-list .bb-list > .bb-item")).toHaveLength(25);
  });

  it("an answer stays per incident: one 'Yes' marks that record only, stored as before", async () => {
    await open(many(3));
    fireEvent.click(screen.getByRole("button", { name: "Show each one (3)" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Yes" })[0]);
    expect(screen.getAllByText("Did this point you the right way?")).toHaveLength(2);
    const log = JSON.parse(localStorage.getItem("compy_bb_feedback")!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ when: rob(2).when, rule: "app-specific", vote: "yes" });
    expect(localStorage.getItem(`compy_bb_helpful_${rob(2).when}`)).toBe("yes");
  });

  it("an unknown row identical for every incident is said once; one that differs stays per incident, still Unknown", async () => {
    await open(many(4));
    // Same source and reason for all four: once, at group level (drift), and the driver row too.
    expect(screen.getAllByText(/Compy only keeps drift that is still open/)).toHaveLength(1);
    expect(screen.getAllByText("The same for all 4 of these records")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show each one (4)" }));
    // The hardware row differs per incident (a different last reading): four rows, each still Unknown.
    const hardware = document.querySelectorAll('.bb-group-list [data-category="hardware"]');
    expect(hardware).toHaveLength(4);
    hardware.forEach((h) => expect(h.textContent).toMatch(/Unknown: Compy hasn't read this since/));
    // And the shared rows are not repeated inside the records.
    expect(document.querySelectorAll('.bb-group-list [data-category="drift"]')).toHaveLength(0);
    expect(document.querySelectorAll('.bb-group-list [data-category="driver"]')).toHaveLength(0);
    expect(document.querySelectorAll('.bb-group [data-category="drift"]')).toHaveLength(1);
  });

  it("every restore offer stays reachable behind the disclosure, one per incident", async () => {
    const applies = [
      {
        id: "apply:c1", timestamp: "2026-11-09T12:00:00+00:00", event_type: "change-applied", source: "trust-ledger", scope: "compy-applied",
        game: null, summary: "Game Mode applied", detail: null, observed_between: null, since_rolled_back: false, rec_id: "rec-c1",
      },
    ];
    const withRestore = (i: number) => {
      const c = rob(i);
      c.changed_before!.items = [ITEM("compy-changes", "changed", { events: applies })];
      return c;
    };
    const ledger: AppliedChange[] = [
      { id: "c1", rec_id: "rec-c1", rec_title: "Game Mode", applied_at: "2026-11-09T12:00:00+00:00", snapshot: null, status: "applied", is_still_active: true, active_check: "on", restores_label: "Off" } as AppliedChange,
    ];
    await open([withRestore(0), withRestore(1)], ledger);
    expect(screen.queryAllByRole("button", { name: /Put back how it was on/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show each one (2)" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Put back how it was on/ })).toHaveLength(2));
  });

  it("incidents that differ in program, kind or reading stay separate groups; a single one renders as it does today", async () => {
    const hang = rob(30, { tag: "App hang", headline: "ROB RUN stopped responding (froze) — Nov 21, 12:30 PM", when: "2026-11-21T12:30:00Z", when_display: "Nov 21, 12:30 PM" });
    const other = rob(31, { receipt: { ...rob(31).receipt, faulting_app: "Other.exe" }, headline: "Other stopped working and closed — Nov 22, 12:31 PM", when: "2026-11-22T12:31:00Z", when_display: "Nov 22, 12:31 PM" });
    const { container } = await open([rob(0), rob(1), hang, other]);
    const blocks = container.querySelectorAll(".bb-list > .bb-item");
    expect(blocks).toHaveLength(3);
    // Newest first: the single Other crash, the single hang, then the pair.
    expect(blocks[0].classList.contains("bb-group")).toBe(false);
    expect(blocks[0].textContent).toContain("Other stopped working and closed — Nov 22, 12:31 PM");
    expect(blocks[1].textContent).toContain("ROB RUN stopped responding (froze) — Nov 21, 12:30 PM");
    expect(blocks[1].querySelector('button[aria-expanded]')!.textContent).toBe("Show the receipt");
    expect(blocks[2].classList.contains("bb-group")).toBe(true);
    expect(blocks[2].textContent).toMatch(/closed 2 times that Windows recorded/);
  });

  it("a differing strength keeps two otherwise identical crashes apart", async () => {
    const b = rob(1);
    b.assessment = { ...b.assessment!, strength: "partial" };
    const { container } = await open([rob(0), b]);
    expect(container.querySelectorAll(".bb-list > .bb-item")).toHaveLength(2);
    expect(container.querySelectorAll(".bb-group")).toHaveLength(0);
  });

  it("the deep-linked incident opens its group and stays marked", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(2).incident_id} />);
    await screen.findByText(/closed 5 times/);
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("This is the one you came here to see.");
    expect(marked[0].textContent).toContain("Nov 10, 12:02 PM");
  });

  it("says it in Chinese, with a plural-safe count and no cause or fix wording", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = await open(many(25));
    expect(container.querySelector(".bb-group .bb-headline")!.textContent).toMatch(/^Windows 记录到 ROB RUN 停止工作并关闭，共 25 次，从 .+ 到 .+。$/);
    expect(screen.getByRole("button", { name: "展开每一条（25）" }).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bb-group-cap")!.textContent).toContain("25");
    expect(container.textContent).not.toMatch(/guarantee|caused|fixed|probably/i);
  });

  it("never says caused, fixed, guarantee, probably or counts 'issues'", async () => {
    const { container } = await open(many(25));
    fireEvent.click(screen.getByRole("button", { name: "Show each one (25)" }));
    expect(container.textContent).not.toMatch(/\bcaused\b|\bfixed\b|guarantee|probably|issues? found/i);
  });
});
