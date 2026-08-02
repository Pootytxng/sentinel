import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_SOURCE_NAMES, createDoctorScanner, scanDoctor } from "./doctor-scan.mjs";

const fixtureReaders = () => ({
  checkouts: vi.fn(() => []),
  processes: vi.fn(() => ({ ok: true, value: [], error: null })),
  work: vi.fn(() => ({ ok: true, items: [] })),
  pulls: vi.fn(() => ({ ok: true, value: [] })),
  ci: vi.fn(() => ({ ok: true, value: { meaningful: true, runs: [] } })),
  lostAndFound: vi.fn(() => []),
});

describe("zero-token Doctor scans", () => {
  it("has an explicit automatic allowlist with no agent or chat source", () => {
    expect(AUTOMATIC_SOURCE_NAMES).toEqual(["processes", "checkouts", "work"]);
    expect(AUTOMATIC_SOURCE_NAMES.join(" ")).not.toMatch(/agent|claude|codex|chat|audit/i);
  });

  it("does not call PR or CI readers during a light scan", () => {
    const readers = fixtureReaders();
    scanDoctor({ includeSlow: false, readers, now: new Date("2026-08-02T12:00:00Z") });
    expect(readers.pulls).not.toHaveBeenCalled();
    expect(readers.ci).not.toHaveBeenCalled();
    expect(readers.lostAndFound).not.toHaveBeenCalled();
    expect(readers.processes).toHaveBeenCalledOnce();
  });

  it("reports a failed process probe instead of treating it as no processes", () => {
    const readers = fixtureReaders();
    readers.processes.mockReturnValue({ ok: false, value: [], error: "CIM unavailable" });
    const result = scanDoctor({ includeSlow: false, readers, now: new Date("2026-08-02T12:00:00Z") });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_UNREACHABLE", subject: expect.objectContaining({ source: "processes" }) }),
    ]));
  });

  it("coalesces overlapping requests instead of starting another scan", async () => {
    let release;
    const scan = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const scanner = createDoctorScanner({ scan });
    const first = scanner.run();
    expect(await scanner.run()).toEqual({ busy: true });
    release({ generatedAt: "now", findings: [] });
    await first;
    expect(scan).toHaveBeenCalledOnce();
  });

  it("keeps finding state across scans only in process memory", async () => {
    const scan = vi.fn(({ previous }) => ({ generatedAt: "now", findings: previous.length
      ? [{ fingerprint: "x", state: "unchanged" }]
      : [{ fingerprint: "x", state: "new" }] }));
    const scanner = createDoctorScanner({ scan });
    const first = await scanner.run();
    const second = await scanner.run();
    expect(first.findings[0].state).toBe("new");
    expect(scan.mock.calls[1][0].previous).toEqual(first.findings);
    expect(second.findings[0].state).toBe("unchanged");
  });

  it("retains slow-finding identity across intervening light scans", async () => {
    const scan = vi.fn(({ includeSlow, previous }) => ({ generatedAt: "now", findings: includeSlow
      ? [{ code: "CI_FAILED", fingerprint: "ci", state: previous.some((item) => item.fingerprint === "ci") ? "unchanged" : "new" }]
      : [] }));
    const scanner = createDoctorScanner({ scan });
    expect((await scanner.run({ includeSlow: true })).findings[0].state).toBe("new");
    await scanner.run({ includeSlow: false });
    expect((await scanner.run({ includeSlow: true })).findings[0].state).toBe("unchanged");
  });
});
