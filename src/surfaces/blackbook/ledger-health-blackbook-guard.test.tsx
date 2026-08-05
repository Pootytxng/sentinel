// bug → guard, sibling of `surfaces/ledger-health-disclosure-guard.test.tsx`. Same defect, second
// surface: `get_applied_changes` degrades a Trust Ledger it cannot READ to an empty array, and the
// Logbook renders that array's emptiness as an affirmative claim ABOUT THE MACHINE — the changes
// tile ("nothing changed yet"), the empty state ("No record yet") and the tape's widest sentence,
// "everything Compy has done on this PC · since <date>". All three are made false by a ledger that
// would not open, at the exact moment every apply and every rollback is refusing.
//
// The rule: the user must be able to tell "Compy did nothing" apart from "Compy can't tell you what
// it did". Two failure shapes, and they need DIFFERENT numeric treatment:
//   error       — load_history() is failing RIGHT NOW. The count is not a count; it is the output of
//                 a read that failed. Show a dash, never a 0.
//   quarantined — a ledger set aside on an EARLIER run. This load succeeded, so the count IS accurate
//                 for what survived — keep the number, narrow only the words. (After the rename every
//                 later load returns Ok(vec![]), byte-identical to a genuine first run, forever —
//                 which is why `complete` can never be derived from row count.)
//
// And the case that is NOT a defect: UNKNOWN (the probe itself failed, or the console face is off).
// Claiming incompleteness from a failed read is the same sin mirrored, so unknown must leave this
// room byte-identical — pinned literally below, by HTML equality rather than by copy matching.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// One controllable command; everything else answers with the real shape its caller destructures, so
// a sibling fetch can't throw inside its own .then and mask what this file is actually testing.
const ipc: { health: unknown; rejectHealth: boolean } = { health: null, rejectHealth: false };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_ledger_health") {
      return ipc.rejectHealth ? Promise.reject(new Error("ipc down")) : Promise.resolve(ipc.health);
    }
    if (cmd === "get_intelligence_timeline") return Promise.resolve({ events: [] });
    return Promise.resolve(null);
  }),
}));

import { BlackbookConsole } from "./BlackbookConsole";
import { BlackbookV2 } from "../BlackbookV2";
import type { LogbookRecord, LogbookChange, LogbookSession, LogbookAutopsy } from "./logbook";
import type { LedgerHealth, SessionSummary } from "../../types";

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  ipc.health = null;
  ipc.rejectHealth = false;
});

// Reduced motion makes the render deterministic (no per-row animationDelay), which is what lets the
// UNKNOWN case be pinned as exact HTML equality rather than as a list of copy assertions.
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const HEALTHY: LedgerHealth = { complete: true, error: null, quarantined: false };
const UNREADABLE: LedgerHealth = {
  complete: false,
  error: "failed to read history.json: The process cannot access the file",
  quarantined: false,
};
const QUARANTINED: LedgerHealth = { complete: false, error: null, quarantined: true };

const change = (over: Partial<LogbookChange> = {}): LogbookChange => ({
  kind: "change",
  at: Date.parse("2026-07-10T12:00:00Z"),
  id: "c1",
  title: "Enable Hardware-accelerated GPU scheduling",
  active: true,
  rolledBack: false,
  restoresLabel: "Off",
  appliedLabel: "On",
  payoffLabel: "Input latency",
  ...over,
});
const session = (over: Partial<LogbookSession> = {}): LogbookSession => ({
  kind: "session",
  at: Date.parse("2026-07-09T20:00:00Z"),
  game: "valorant.exe",
  avgFps: 240,
  low1Fps: 190,
  durationSecs: 3600,
  changesActive: 1,
  avgFpsDelta: null,
  ...over,
});
const autopsy = (over: Partial<LogbookAutopsy> = {}): LogbookAutopsy => ({
  kind: "autopsy",
  at: Date.parse("2026-07-08T08:00:00Z"),
  real: 2,
  placebo: 1,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

function mountConsole(records: LogbookRecord[], health: LedgerHealth | null) {
  return render(
    <BlackbookConsole
      records={records}
      health={health}
      vendor="amd"
      onOpenLab={vi.fn()}
      onOpenGuide={vi.fn()}
    />,
  );
}

// Every claim is asserted through the ELEMENT that carries it, not a substring of the room: a text
// matcher would keep passing if the claim were merely reworded, which is the failure this file exists
// to catch.
const tileN = (c: HTMLElement, kind: string) =>
  c.querySelector(`.bc-tile[data-kind="${kind}"] .bc-tile-n`)?.textContent;
const tileD = (c: HTMLElement, kind: string) =>
  c.querySelector(`.bc-tile[data-kind="${kind}"] .bc-tile-d`)?.textContent;
const scent = (c: HTMLElement) => c.querySelector(".bc-sect-s")?.textContent ?? "";
const notice = (c: HTMLElement) => c.querySelector(".ledger-health");

const WIDEST_CLAIM = "everything Compy has done on this PC";

describe("the Logbook may not speak for a ledger it could not read", () => {
  it("a healthy ledger is left alone — the room keeps its widest claim and shows no disclosure", () => {
    useReduced();
    const { container } = mountConsole([change(), session(), autopsy()], HEALTHY);

    expect(tileN(container, "change")).toBe("1");
    expect(tileD(container, "change")).toBe("1 still on · every one undoable");
    expect(scent(container)).toContain(WIDEST_CLAIM);
    expect(notice(container)).toBeNull();
  });

  it("UNKNOWN health is not incompleteness — the room renders byte-identically to healthy", () => {
    useReduced();
    const records = [change(), session(), autopsy()];
    const healthy = mountConsole(records, HEALTHY).container.innerHTML;
    cleanup();
    const unknown = mountConsole(records, null).container.innerHTML;

    // Not "looks similar" — exactly the same tree. A failed probe may not manufacture a warning,
    // and it may not quietly reword a single line either.
    expect(unknown).toBe(healthy);
  });

  it("an unreadable ledger withdraws the count, the tile copy AND the widest claim", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], UNREADABLE);

    // A count read off a ledger that would not open is not a count. A 0 would say "nothing ever
    // happened here"; the dash says "no number".
    expect(tileN(container, "change")).toBe("—");
    expect(tileD(container, "change")).toBe("can't be read right now");
    expect(scent(container)).toContain("what Compy can still read");
    expect(scent(container)).not.toContain(WIDEST_CLAIM);
    expect(notice(container)).toBeTruthy();
    expect(screen.getByText("Compy can't read its own record right now")).toBeTruthy();
  });

  it("the dash is scoped to the ledger — session and guide-check counts are not sourced from it", () => {
    useReduced();
    const { container } = mountConsole([session(), session(), autopsy()], UNREADABLE);

    // Over-broad blanking is its own dishonesty: these two counts come from data the ledger failure
    // never touched, and dashing them would understate a record Compy can still vouch for.
    expect(tileN(container, "session")).toBe("2");
    expect(tileN(container, "autopsy")).toBe("1");
  });

  it("a quarantined ledger keeps its real number — that load succeeded, it just isn't everything", () => {
    useReduced();
    const { container } = mountConsole([change(), change({ id: "c2" }), session()], QUARANTINED);

    expect(tileN(container, "change")).toBe("2");
    expect(tileN(container, "change")).not.toBe("—");
    expect(tileD(container, "change")).toBe("2 still on · part of the record is missing");
    expect(scent(container)).not.toContain(WIDEST_CLAIM);
    expect(screen.getByText("Compy can't tell you everything it did")).toBeTruthy();
  });

  it("a quarantined ledger with no survivors says 'none we can still show', never 'nothing changed yet'", () => {
    useReduced();
    const { container } = mountConsole([session()], QUARANTINED);

    // The exact defect at its sharpest: zero rows, and the honest reading is "the ones we had are
    // gone", not the machine claim that none were ever made.
    expect(tileN(container, "change")).toBe("0");
    expect(tileD(container, "change")).toBe("none we can still show");
    expect(tileD(container, "change")).not.toBe("nothing changed yet");
    expect(
      (container.querySelector('.bc-tile[data-kind="change"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("an empty room with an incomplete ledger narrows 'No record yet' to what it can still vouch for", () => {
    useReduced();
    const { container } = mountConsole([], QUARANTINED);

    expect(container.querySelector(".bc-strip")).toBeNull();
    expect(container.querySelector(".bc-empty-title")?.textContent).toBe("Nothing else to show");
    expect(container.querySelector(".bc-empty-sub")?.textContent).toContain(
      "separately from the change record",
    );
    expect(notice(container)).toBeTruthy();
  });

  it("the disclosure is read BEFORE the counts it qualifies", () => {
    useReduced();
    const { container } = mountConsole([change(), session()], UNREADABLE);

    const box = notice(container)!;
    const strip = container.querySelector(".bc-strip")!;
    // A caveat printed under its own subject has already failed at its job.
    expect(box.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// The console is a pure component, so the cases above would all still pass if someone dropped
// `health={health}` from the room that mounts it. These two mount the real room and prove the whole
// chain: probe → prop → rendered claim.
describe("BlackbookV2 wires the probe to the tape it qualifies", () => {
  const SESSION: SessionSummary = {
    started_at: "2026-07-09T20:00:00Z",
    duration_secs: 3600,
    process_name: "valorant.exe",
    samples: 3400,
    avg_fps: 240,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
  } as SessionSummary;

  async function mountRoom() {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "1");
    const r = render(
      <BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} sessions={[SESSION]} />,
    );
    // The disclosure is a post-mount read, not a prop.
    await act(async () => {
      await Promise.resolve();
    });
    return r;
  }

  it("a real unreadable-ledger probe reaches the room's claims", async () => {
    ipc.health = UNREADABLE;
    const { container } = await mountRoom();

    expect(notice(container)).toBeTruthy();
    expect(tileN(container, "change")).toBe("—");
    expect(scent(container)).not.toContain(WIDEST_CLAIM);
  });

  it("a probe that fails leaves the room exactly as it was", async () => {
    ipc.rejectHealth = true;
    const { container } = await mountRoom();

    expect(notice(container)).toBeNull();
    expect(tileN(container, "change")).toBe("0");
    expect(tileD(container, "change")).toBe("nothing changed yet");
    expect(scent(container)).toContain(WIDEST_CLAIM);
  });
});
