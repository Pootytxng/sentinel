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
    expect(screen.getByText(`ROB RUN stopped working and closed 25 times in the Windows records Compy read, from ${from} to ${to}.`)).toBeTruthy();
    // The limit is said: these are the newest records Compy read, so the count is not a total.
    expect(screen.getByText("Compy reads only the newest records Windows keeps (at most 25 are listed), so this counts only those; older ones may exist that it did not count.")).toBeTruthy();
    // The shared reading, once.
    expect(screen.getAllByText(/WEAK SIGNAL/i)).toHaveLength(1);
    expect(screen.getAllByText(/That record alone can't tell where the problem is/)).toHaveLength(1);
    expect(screen.queryByText("Did this point you the right way?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the receipt" })).toBeNull();
  });

  it("a group says what it counted at ANY size: 'records Compy read' and the limit note, never 'that Windows recorded'", async () => {
    const { container } = await open(many(3));
    expect(screen.getByText(/closed 3 times in the Windows records Compy read/)).toBeTruthy();
    expect(screen.getAllByText(/at most 25 are listed/)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/that Windows recorded/);
  });

  it("every group in a mixed list carries the limit note, including a group of 2", async () => {
    const hang = (i: number) => rob(i, { tag: "App hang", headline: `ROB RUN stopped responding (froze) — ${rob(i).when_display}` });
    const { container } = await open([rob(0), rob(1), hang(5), hang(6), hang(7)]);
    expect(container.querySelectorAll(".bb-group")).toHaveLength(2);
    expect(container.querySelectorAll(".bb-group-cap")).toHaveLength(2);
  });

  it("a session-game tail is not lost: each record keeps its full headline behind the button", async () => {
    const tailed = (i: number) =>
      rob(i, {
        headline: `Launcher stopped working and closed — Nov 10, 12:0${i} PM, during or just after a session of ROB RUN that Compy recorded`,
        receipt: { ...rob(i).receipt, faulting_app: "Launcher.exe" },
      });
    const { container } = await open([tailed(0), tailed(1), tailed(2)]);
    expect(container.querySelector(".bb-group .bb-headline")!.textContent).toMatch(/^Launcher stopped working and closed 3 times in the Windows records Compy read/);
    expect(container.textContent).not.toMatch(/a session of ROB RUN that Compy recorded/);
    fireEvent.click(screen.getByRole("button", { name: "Show each one (3)" }));
    expect(
      screen.getAllByText(/Launcher stopped working and closed — Nov 10, 12:0\d PM, during or just after a session of ROB RUN that Compy recorded/),
    ).toHaveLength(3);
    // A record without the tail is a different group.
    const plain = rob(3, { receipt: { ...rob(3).receipt, faulting_app: "Launcher.exe" }, headline: "Launcher stopped working and closed — Nov 10, 12:03 PM" });
    cleanup();
    const again = await open([tailed(0), tailed(1), plain]);
    expect(again.container.querySelectorAll(".bb-group")).toHaveLength(1);
    expect(again.container.querySelectorAll(".bb-list > .bb-item")).toHaveLength(2);
  });

  it("each record shows its own faulting module and code; none is presented as shared", async () => {
    const withFault = (i: number, mod: string, code: string) => rob(i, { receipt: { ...rob(i).receipt, faulting_module: mod, code } });
    const { container } = await open([withFault(0, "a.dll", "0xc0000005"), withFault(1, "b.dll", "0xc0000409")]);
    expect(container.querySelector(".bb-group")!.textContent).not.toMatch(/a\.dll|b\.dll|0xc000/);
    fireEvent.click(screen.getByRole("button", { name: "Show each one (2)" }));
    const lines = [...container.querySelectorAll(".bb-compact-fault")].map((p) => p.textContent);
    expect(lines).toEqual(["Faulting module: b.dll · Code: 0xc0000409", "Faulting module: a.dll · Code: 0xc0000005"]);
  });

  it("the disclosure's aria-controls names an element that exists while collapsed, and each Yes/No is described by its record", async () => {
    await open(many(3));
    const btn = screen.getByRole("button", { name: "Show each one (3)" });
    const id = btn.getAttribute("aria-controls")!;
    const list = document.getElementById(id)!;
    expect(list, "aria-controls points at nothing while collapsed").not.toBeNull();
    expect(list.hidden).toBe(true);
    fireEvent.click(btn);
    expect(list.hidden).toBe(false);
    const yes = screen.getAllByRole("button", { name: "Yes" });
    expect(yes).toHaveLength(3);
    const label = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby")!)?.textContent;
    expect(yes.map(label)).toEqual(["Nov 10, 12:02 PM", "Nov 10, 12:01 PM", "Nov 10, 12:00 PM"].map((_, i) => rob(2 - i).headline));
    screen.getAllByRole("button", { name: "No" }).forEach((b) => expect(label(b)).toBeTruthy());
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
    expect(blocks[2].textContent).toMatch(/closed 2 times in the Windows records Compy read/);
  });

  it("a differing strength keeps two otherwise identical crashes apart", async () => {
    const b = rob(1);
    b.assessment = { ...b.assessment!, strength: "partial" };
    const { container } = await open([rob(0), b]);
    expect(container.querySelectorAll(".bb-list > .bb-item")).toHaveLength(2);
    expect(container.querySelectorAll(".bb-group")).toHaveLength(0);
  });

  it("the deep-linked incident opens its group, stays marked, and is scrolled to", async () => {
    const spy = vi.fn();
    const orig = HTMLElement.prototype.scrollIntoView; // the test setup stubs it here (jsdom lacks it)
    HTMLElement.prototype.scrollIntoView = spy;
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(2).incident_id} />);
    await screen.findByText(/closed 5 times/);
    HTMLElement.prototype.scrollIntoView = orig;
    expect(spy, "the targeted record was not scrolled into view").toHaveBeenCalledTimes(1);
    expect((spy.mock.contexts[0] as HTMLElement).getAttribute("data-selected")).toBe("true");
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("This is the one you came here to see.");
    expect(marked[0].textContent).toContain("Nov 10, 12:02 PM");
  });

  it("a record that is only marked (a waiting pointer, not a deep link) never opens its group", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    // selectedIncidentId marks and scans; expandGroupFor={null} says nobody asked for the group open.
    render(<BlackBox selectedIncidentId={rob(4).incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    expect(screen.getByRole("button", { name: "Show each one (5)" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll(".bb-group-list > .bb-item")).toHaveLength(0);
  });

  // review r1 B2: the red dot's record sits in a folded group on a plain visit, so no row is on
  // screen. The group itself must say so and carry a button of its own for THAT record.
  it("a marked record inside a folded group: the group carries the mark, says so, and its own button opens it and scrolls to that record", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const target = rob(1); // NOT the care step's record (the newest, rob(4))
    const { container } = render(<BlackBox selectedIncidentId={target.incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    const group = container.querySelector(".bb-group") as HTMLElement;
    expect(group.getAttribute("data-selected")).toBe("true");
    expect(within(group).getByText(/The record you came here to see is in this group\./)).toBeTruthy();
    expect(document.querySelectorAll(".bb-group-list > .bb-item")).toHaveLength(0);
    const spy = vi.fn();
    const orig = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    fireEvent.click(within(group).getByRole("button", { name: "Show that record" }));
    HTMLElement.prototype.scrollIntoView = orig;
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked).toHaveLength(1); // the row only; the open group no longer carries the mark
    expect(marked[0].textContent).toContain("Nov 10, 12:01 PM");
    expect(spy.mock.contexts.some((el) => el === marked[0]), "the marked record was not scrolled to").toBe(true);
    expect(screen.queryByText(/The record you came here to see is in this group\./)).toBeNull();
  });

  it("the care step's button still targets the care step's record, not the marked one", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(1).incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    fireEvent.click(screen.getByRole("button", { name: "Show this record in the list" }));
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("Nov 11, 12:04 PM"); // the newest = the step's record
  });

  it("a marked record that is in no group shows no group line", async () => {
    reportMock.value = { incidents: [rob(0), rob(1, { tag: "App hang", headline: `ROB RUN stopped responding (froze) — ${rob(1).when_display}` })], skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(1).incident_id} expandGroupFor={null} />);
    await screen.findAllByText(/ROB RUN/);
    expect(container.querySelectorAll(".bb-group")).toHaveLength(0);
    expect(screen.queryByText(/is in this group/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show that record" })).toBeNull();
    expect(container.querySelectorAll('.bb-item[data-selected="true"]')).toHaveLength(1);
  });

  it("says the group line in Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    reportMock.value = { incidents: many(3), skipped_sources: [] };
    render(<BlackBox selectedIncidentId={rob(1).incident_id} expandGroupFor={null} />);
    await screen.findByText(/你要查看的那条记录在这一组里。/);
    expect(screen.getByRole("button", { name: "显示那条记录" })).toBeTruthy();
  });

  it("the next-step block's 'Show this record in the list' opens the folded group and scrolls to that record", async () => {
    const spy = vi.fn();
    const orig = HTMLElement.prototype.scrollIntoView;
    const { container } = await open(many(5));
    // Folded on arrival; the pointer is a button.
    expect(screen.getByRole("button", { name: "Show each one (5)" }).getAttribute("aria-expanded")).toBe("false");
    const pointer = screen.getByRole("button", { name: "Show this record in the list" });
    HTMLElement.prototype.scrollIntoView = spy;
    fireEvent.click(pointer);
    HTMLElement.prototype.scrollIntoView = orig;
    expect(screen.getByRole("button", { name: "Hide the individual records" }).getAttribute("aria-expanded")).toBe("true");
    const marked = container.querySelectorAll('.bb-item[data-selected="true"]');
    expect(marked).toHaveLength(1);
    // The step's record is the newest one in the group.
    expect(marked[0].textContent).toContain("Nov 11, 12:04 PM");
    expect(spy.mock.contexts.some((el) => el === marked[0]), "the record was not scrolled to").toBe(true);
  });

  it("says it in Chinese, with a plural-safe count and no cause or fix wording", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = await open(many(25));
    expect(container.querySelector(".bb-group .bb-headline")!.textContent).toMatch(/^在 Compy 读取的 Windows 记录中，ROB RUN 停止工作并关闭，共 25 次，从 .+ 到 .+。$/);
    expect(screen.getByRole("button", { name: "展开每一条（25）" }).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bb-group-cap")!.textContent).toBe("Compy 只读取 Windows 保留的最新记录（最多列出 25 条），所以这里只统计这些；可能还有更早的记录没有被计入。");
    expect(container.textContent).not.toMatch(/guarantee|caused|fixed|probably/i);
  });

  it("never says caused, fixed, guarantee, probably or counts 'issues'", async () => {
    const { container } = await open(many(25));
    fireEvent.click(screen.getByRole("button", { name: "Show each one (25)" }));
    expect(container.textContent).not.toMatch(/\bcaused\b|\bfixed\b|guarantee|probably|issues? found/i);
  });
});

describe("Problems room - focus follows a press that reveals a record", () => {
  it("'Show that record': focus lands on the revealed record, which a screen reader hears by name", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const target = rob(1);
    const { container } = render(<BlackBox selectedIncidentId={target.incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    const group = container.querySelector(".bb-group") as HTMLElement;
    const button = within(group).getByRole("button", { name: "Show that record" });
    button.focus();
    fireEvent.click(button);
    const row = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    expect(row.textContent).toContain("Nov 10, 12:01 PM");
    expect(document.activeElement, "focus fell off the revealed record").toBe(row);
    expect(row.getAttribute("tabindex")).toBe("-1");
    expect(row.getAttribute("aria-label")).toBe(`Record: ${target.headline}`);
  });

  it("the care step's 'Show this record in the list' moves focus to that record too", async () => {
    const { container } = await open(many(5));
    fireEvent.click(screen.getByRole("button", { name: "Show this record in the list" }));
    const row = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    expect(row.textContent).toContain("Nov 11, 12:04 PM");
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-label")).toBe(`Record: ${rob(4).headline}`);
  });

  it("a plain deep-link arrival marks and scrolls but does not take focus", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(1).incident_id} />);
    await screen.findByText(/This is the one you came here to see\./);
    const row = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    expect(document.activeElement).not.toBe(row);
  });

  it("hiding and showing the group again does not pull focus back to the record", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(1).incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    fireEvent.click(screen.getByRole("button", { name: "Show that record" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide the individual records" }));
    const again = screen.getByRole("button", { name: "Show each one (5)" });
    again.focus();
    fireEvent.click(again);
    expect(document.activeElement).toBe(again);
    expect(document.activeElement).not.toBe(container.querySelector('.bb-item[data-selected="true"]'));
  });
});

describe("Problems room - records outside a group are counted, not hidden", () => {
  // Real data (2026-11-21): 22 ROB RUN crash records read "no graphics-driver timeout ... in the System
  // log"; the 23rd (Nov 11, 7:17 AM) said Compy couldn't read the System log for its time. Different
  // evidence, so a separate block; the group must still say how many records Compy read in all.
  const odd = (i: number) =>
    rob(i, {
      assessment: {
        ...rob(i).assessment!,
        evidence: ["Compy couldn't read the Windows System log for that time, so it can't say whether a system-level error was logged around it."],
      },
    });

  it("22 identical + 1 with different evidence: the group keeps its count and says 23 of the listed crash records are ROB RUN, 1 shown separately", async () => {
    const { container } = await open([...many(22), odd(22)]);
    expect(container.querySelectorAll(".bb-list > .bb-item")).toHaveLength(2);
    expect(screen.getByText(/closed 22 times in the Windows records Compy read/)).toBeTruthy();
    // B6 (view-1122a finding 9): the 22 above and the 1 apart add up to the 23 in the sentence, said in it.
    expect(screen.getByText("Compy read 23 crash records for ROB RUN: the 22 counted above, and 1 shown separately because its details differ.")).toBeTruthy();
  });

  it("said in Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    await open([...many(22), odd(22)]);
    expect(screen.getByText("Compy 读到 ROB RUN 的崩溃记录共 23 条：上面统计的 22 条，以及因细节不同而单独显示的 1 条。")).toBeTruthy();
  });

  it("no line when every record of that program and kind is in the group", async () => {
    const { container } = await open(many(4));
    expect(container.querySelector(".bb-group-apart")).toBeNull();
  });

  it("a different program is not counted", async () => {
    const other = rob(9, { receipt: { ...rob(9).receipt, faulting_app: "Discord.exe" } });
    const { container } = await open([...many(3), other]);
    expect(container.querySelector(".bb-group-apart")).toBeNull();
  });
});

describe("Problems room - a second reveal still moves focus (review B1)", () => {
  it("care-step reveal, hide the group, then 'Show that record': focus lands on the record again, not the page", async () => {
    const { container } = await open(many(5));
    fireEvent.click(screen.getByRole("button", { name: "Show this record in the list" }));
    const first = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    expect(document.activeElement).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Hide the individual records" }));
    const again = screen.getByRole("button", { name: "Show that record" });
    again.focus();
    fireEvent.click(again);
    const row = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    expect(row.textContent).toContain("Nov 11, 12:04 PM");
    expect(document.activeElement, "focus fell to the page on the second reveal").toBe(row);
  });

  it("the marked record's note is its description, so a screen reader hears it with the record's name", async () => {
    reportMock.value = { incidents: many(5), skipped_sources: [] };
    const { container } = render(<BlackBox selectedIncidentId={rob(1).incident_id} expandGroupFor={null} />);
    await screen.findByText(/closed 5 times/);
    fireEvent.click(screen.getByRole("button", { name: "Show that record" }));
    const row = container.querySelector('.bb-item[data-selected="true"]') as HTMLElement;
    const note = document.getElementById(row.getAttribute("aria-describedby")!);
    expect(note?.textContent).toBe("This is the one you came here to see.");
    expect(row.getAttribute("aria-label")).toContain("Record: ");
  });
});
