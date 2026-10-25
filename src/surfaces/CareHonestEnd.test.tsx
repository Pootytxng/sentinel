// P6-unknown: the Care view ends honestly. No step → "Not enough evidence yet" with only true ways
// to add evidence; a beyond-Compy record → said plainly, with the existing local support record one
// tap away. Never a step and an "unknown" claim together.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { invoke } from "@tauri-apps/api/core";
import { BlackBox } from "./BlackBox";
import { SupportEvidence } from "./SupportEvidence";
import { pickCareStep, type StutterResult } from "./care-next-step";
import { honestEndFor } from "./care-honest-end";
import type { CrashIncident, WhatChangedReport } from "../types";

const h = vi.hoisted(() => ({ incidents: [] as unknown[], skipped: [] as string[], admin: [] as string[] }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve({ incidents: h.incidents, skipped_sources: h.skipped, skipped_needs_admin: h.admin });
    if (cmd === "get_session_summaries") return Promise.resolve([]);
    if (cmd === "preview_support_evidence")
      return Promise.resolve({
        consumer: "PLAIN PREVIEW", technical: "T", support: "S",
        bundle: { events: [], unreadable_records: 0, location: "C:\\x", retention: { max_events: 400, max_bytes: 256000 } },
      });
    return Promise.resolve(null);
  }),
}));

const inc = (when: string, o: { assessed?: boolean; beyond?: boolean; tag?: string } = {}): CrashIncident => ({
  incident_id: `id-${when}`,
  headline: `Crash at ${when}`,
  tag: o.tag ?? (o.beyond ? "Blue screen" : "App crash"),
  when,
  when_display: when,
  vitals: null,
  receipt: { source: "WER", event_ids: [], faulting_app: null, faulting_module: null, code: "0x139", detail: "" },
  assessment:
    o.assessed === false
      ? null
      : {
          consistent_with: o.beyond ? "a blue-screen crash" : "a GPU driver fault",
          strength: o.beyond ? "weak" : "partial",
          evidence: ["e"],
          next_step: {
            headline: o.beyond ? "Look up the stop code, and take the evidence to a human" : "STEP",
            detail: "Detail text.",
            reversible: true,
            research_only: !!o.beyond,
          },
          beyond_us: !!o.beyond,
        },
});

const stutter = (verdict: string, next: string | null, comparable = "comparable"): StutterResult => ({
  report: {
    verdict, next_action: next, comparability: { verdict: comparable },
    baseline: { low1_fps: 80, started_at: "b", hw_hash: null }, noise_floor_pct: 3,
  } as unknown as WhatChangedReport,
  game: "Valorant",
  processName: "Valorant.exe",
  sessions: [],
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.incidents = [];
  h.skipped = [];
  h.admin = [];
  vi.mocked(invoke).mockClear();
});

const NONE = { admin: 0, other: 0 };

describe("honestEndFor: the slot's honest end, only when there is no step", () => {
  it("is null whenever there is a step, whatever else is true", () => {
    const step = pickCareStep([inc("2026-10-20T10:00:00Z")], null);
    expect(step).not.toBeNull();
    expect(honestEndFor(step, [inc("2026-10-19T10:00:00Z", { assessed: false })], { admin: 1, other: 1 }, stutter("inconclusive", null))).toBeNull();
    const beyond = pickCareStep([inc("2026-10-20T10:00:00Z", { beyond: true })], null);
    expect(honestEndFor(beyond, [], { admin: 1, other: 0 }, null)).toBeNull();
  });
  it("offers only the gaps that are true for this read", () => {
    const unassessed = [inc("2026-10-20T10:00:00Z", { assessed: false })];
    expect(honestEndFor(null, unassessed, NONE, null)?.gaps).toEqual([{ kind: "repeat" }]);
    expect(honestEndFor(null, [], { admin: 1, other: 0 }, null)?.gaps).toEqual([{ kind: "admin" }]);
    // A reader that couldn't run is not an admin matter: a plain re-scan.
    expect(honestEndFor(null, [], { admin: 0, other: 1 }, null)?.gaps).toEqual([{ kind: "rescan" }]);
    expect(honestEndFor(null, null, NONE, stutter("inconclusive", null))?.gaps).toEqual([{ kind: "session", game: "Valorant" }]);
    expect(honestEndFor(null, null, NONE, stutter("regressed", "x", "not-comparable"))?.gaps).toEqual([{ kind: "session", game: "Valorant" }]);
    expect(honestEndFor(null, null, NONE, stutter("regressed", null))?.gaps).toEqual([{ kind: "session", game: "Valorant" }]);
  });
  it("claims nothing where nothing is wrong or nothing was read", () => {
    expect(honestEndFor(null, null, NONE, null)).toBeNull(); // before a scan
    expect(honestEndFor(null, [], NONE, null)).toBeNull(); // a clean scan
    expect(honestEndFor(null, null, { admin: 3, other: 1 }, null)).toBeNull(); // no scan: skipped sources aren't known yet
    expect(honestEndFor(null, [], NONE, stutter("no-change", null))).toBeNull(); // a measured "no change"
    expect(honestEndFor(null, [], NONE, stutter("improved", null))).toBeNull();
  });
});

describe("the Care view: not enough evidence yet", () => {
  it("a record with no reading → the honest end takes the slot, at the top, with what would add evidence", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z", { assessed: false })];
    h.skipped = ["Crash dump files in \\Minidump (need administrator to read)"];
    h.admin = [...h.skipped];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-honest-unknown")).not.toBeNull());
    const box = container.querySelector(".bb-honest-unknown")!;
    expect(container.querySelector(".bb")!.children[1]).toBe(box);
    expect(box.textContent).toMatch(/Not enough evidence yet/);
    expect(box.textContent).toMatch(/start it again as administrator/);
    expect(box.textContent).toMatch(/If it happens again, scan again\./);
    expect(box.textContent).not.toMatch(/Scan again\. Some sources couldn't be read/);
    expect(container.querySelector(".bb-skipped")!.textContent).toMatch(/Run Compy as admin/);
    expect(container.querySelector(".bb-next")).toBeNull(); // never both
  });

  it("a reader that couldn't run asks for a re-scan, never for admin", async () => {
    h.skipped = ["Windows Event Log (couldn't run the reader)"];
    h.admin = [];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-honest-unknown")).not.toBeNull());
    const box = container.querySelector(".bb-honest-unknown")!;
    expect(box.textContent).toMatch(/Scan again\. Some sources couldn't be read this time/);
    expect(container.querySelector(".bb-skipped")!.textContent).toMatch(/Couldn't be read this time: Windows Event Log/);
    expect(container.querySelector(".bb-empty")!.textContent).toMatch(/scan again to try them/);
    expect(container.textContent).not.toMatch(/admin/i);
  });

  it("a clean scan claims nothing", async () => {
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-empty")).not.toBeNull());
    expect(container.querySelector(".bb-honest-unknown")).toBeNull();
    expect(container.querySelector(".bb-next")).toBeNull();
  });

  it("an assessed record → its step, and no unknown claim", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z"), inc("2026-10-19T10:00:00Z", { assessed: false })];
    h.skipped = ["System log"];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    expect(container.querySelector(".bb-honest-unknown")).toBeNull();
    expect(container.textContent).not.toMatch(/Not enough evidence yet/);
  });
});

describe("the Care view: beyond Compy", () => {
  it("says so plainly and puts the existing local support record one tap away", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z", { beyond: true })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    const box = container.querySelector(".bb-next")!;
    expect(box.querySelector(".bb-next-tag")!.textContent).toBe("Beyond Compy");
    expect(box.textContent).toMatch(/beyond what Compy can safely narrow down/);
    expect(box.textContent).toMatch(/Compy sends nothing/);
    // The receipt comes first; the support record is optional context that does not hold this crash.
    expect(box.textContent).toMatch(/share the receipt in this record below: it has the stop code/);
    expect(box.textContent).toMatch(/optional context.*not this crash/);
    expect(container.querySelector(".bb-honest-unknown")).toBeNull();
    // Nothing is read until the user asks.
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "preview_support_evidence")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open the support record" }));
    expect(box.querySelector("[data-testid='support-evidence']")).not.toBeNull();
    // No permanent delete right where the user is about to share it.
    expect(box.querySelector(".sev-clear")).toBeNull();
    expect(screen.queryByRole("button", { name: /^clear/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show me what's in it" }));
    await waitFor(() => expect(screen.getByText("PLAIN PREVIEW")).toBeTruthy());
    // The same preview → local-file commands Settings uses; no other command was called.
    const cmds = new Set(vi.mocked(invoke).mock.calls.map(([c]) => c));
    for (const c of cmds) expect(["get_crash_blackbox", "get_session_summaries", "preview_support_evidence"]).toContain(c);
  });

  it("a record Compy can read keeps its ordinary tag and no export", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z")];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    expect(container.querySelector(".bb-next-tag")!.textContent).not.toBe("Beyond Compy");
    expect(screen.queryByRole("button", { name: "Open the support record" })).toBeNull();
  });
});

describe("SupportEvidence keeps Clear where it lives (Settings)", () => {
  it("shows Clear by default, and not with allowClear={false}", () => {
    const a = render(<SupportEvidence />);
    expect(a.container.querySelector(".sev-clear")).not.toBeNull();
    cleanup();
    const b = render(<SupportEvidence allowClear={false} />);
    expect(b.container.querySelector(".sev-clear")).toBeNull();
  });
});

describe("repeat gap copy", () => {
  it.each(["en", "zh-CN"])("%s has no 'soon'", (loc) => {
    const d = JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "gaming.json"), "utf8"));
    expect(d.blackBox.honestEnd.gapRepeat).not.toMatch(/soon|不久/);
  });
});

describe("no new path out", () => {
  it("the honest end reuses SupportEvidence and calls nothing itself", () => {
    const src = readFileSync(join("src", "surfaces", "CareHonestEnd.tsx"), "utf8");
    expect(src).toMatch(/import \{ SupportEvidence \} from "\.\/SupportEvidence"/);
    expect(src).not.toMatch(/invoke|fetch\(|XMLHttpRequest|case_evidence|upload|openUrl/);
  });
});
