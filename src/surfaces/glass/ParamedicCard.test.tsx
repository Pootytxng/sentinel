// PC Paramedic F1: the card renders what the engine returned, in the four states the design names.
// The engine's answer is mocked (numbers and codes only); every sentence asserted here is the card's own.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown, calls: [] as unknown[][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    answer.calls.push(args);
    return Promise.resolve(answer.value);
  },
}));

import "../../i18n";
import type { ParamedicDiagnosis, ParamedicSessionRef } from "../../types";
import { ParamedicCard } from "./ParamedicCard";

afterEach(() => {
  cleanup();
  answer.value = null;
  answer.calls.length = 0;
});

const ref = (at: string): ParamedicSessionRef => ({
  started_at: at,
  game: "game-a",
  duration_secs: 3600,
  samples: 3500,
  avg_fps: 120,
  low1_fps: 80,
});

const base: ParamedicDiagnosis = {
  complaint: "unknown",
  state: { kind: "found" },
  game: "game-a",
  game_name: "Game A",
  problem: {
    rule: "stutter-collapse",
    spikes: false,
    avg_lower: false,
    before: { ratio: 0.9, p99_ms: null, avg_fps: 120 },
    now: { ratio: 0.5, p99_ms: null, avg_fps: 110 },
    last_normal_at: "2026-11-11T14:14:22Z",
    sessions_affected: [ref("2026-11-20T01:01:24Z")],
    partial_sessions: [],
    other_games_affected: [],
  },
  findings: [
    {
      id: "gpu-driver-change",
      confidence: "likely",
      in_play: false,
      evidence: [
        { kind: "known", code: "driver-changed", args: { from: "1.0", to: "2.0" }, against: false, source: "snapshots" },
      ],
      since_when: { kind: "observed-between", from: "2026-11-19T05:12:26Z", to: "2026-11-19T16:54:51Z" },
      fix: { kind: "steps", code: "gpu-driver-change", args: { from: "1.0" } },
    },
    {
      id: "background-load",
      confidence: "possible",
      in_play: false,
      evidence: [{ kind: "unknown", code: "load-not-recorded", args: {}, against: false, source: "sessions" }],
      since_when: { kind: "unknown" },
      fix: { kind: "steps", code: "background-load", args: {} },
    },
  ],
  not_it: [{ id: "hardware-change", args: {} }],
  unknowns: ["game-patch"],
  baseline: ref("2026-11-11T14:14:22Z"),
  first_bad: ref("2026-11-20T01:01:24Z"),
  why_first: "tie",
  method: "paramedic-rules-v1",
};

const ask = async (d: ParamedicDiagnosis | null) => {
  answer.value = d;
  render(<ParamedicCard />);
  fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
};

describe("ParamedicCard", () => {
  it("asks nothing until the button is pressed", () => {
    render(<ParamedicCard />);
    expect(answer.calls.length).toBe(0);
    expect(screen.getByRole("button", { name: "Something's wrong" })).toBeTruthy();
  });

  it("found: leads with the most likely finding, its evidence and its steps", async () => {
    await ask(base);
    await waitFor(() => expect(screen.getByText("Most likely")).toBeTruthy());
    expect(answer.calls[0][0]).toBe("paramedic_diagnose");
    expect(screen.getAllByText("Your graphics driver was updated").length).toBeGreaterThan(0);
    expect(screen.getByText("Your graphics driver changed from 1.0 to 2.0.")).toBeTruthy();
    expect(screen.getByText(/Press Windows \+ X and open Device Manager/)).toBeTruthy();
    expect(screen.getAllByText("Also possible").length).toBeGreaterThan(0);
    expect(screen.getByText("What Compy checked")).toBeTruthy();
  });

  it("nothing wrong: says so and offers no finding", async () => {
    await ask({ ...base, state: { kind: "nothing-wrong", sessions_checked: 4 }, problem: null, findings: [] });
    await waitFor(() => expect(screen.getByText("Nothing looks wrong")).toBeTruthy());
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("can't tell: says why, and never guesses", async () => {
    await ask({
      ...base,
      state: { kind: "needs-more-play", sessions_needed: 2, have: 1 },
      problem: null,
      findings: [],
    });
    await waitFor(() => expect(screen.getByText("Compy can't tell yet")).toBeTruthy());
    expect(screen.getByText(/needs 3 normal sessions of Game A/)).toBeTruthy();
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("measured but nothing recorded changed: reports the problem without inventing a cause", async () => {
    await ask({ ...base, state: { kind: "cant-tell", why: { kind: "nothing-changed" } }, findings: [] });
    await waitFor(() =>
      expect(screen.getByText("Compy measured the problem, but nothing it records changed before it")).toBeTruthy(),
    );
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("not separable: lists the candidates in order, ranks no winner, and says how to find out", async () => {
    const [driver, load] = base.findings;
    await ask({
      ...base,
      why_first: "not-separable",
      findings: [
        { ...driver, confidence: "possible", in_play: true },
        { ...load, in_play: true },
      ],
    });
    await waitFor(() => expect(screen.getByText("Compy can't tell which of these it is yet")).toBeTruthy());
    expect(screen.queryByText("Most likely")).toBeNull();
    expect(screen.getAllByText("Your graphics driver was updated").length).toBeGreaterThan(0);
    expect(screen.getByText("To find out: play Game A once with nothing else running. Compy will compare.")).toBeTruthy();
  });

  it("not separable without background load: does not promise that a quiet PC will tell them apart", async () => {
    const [driver] = base.findings;
    const windows: ParamedicDiagnosis["findings"][number] = {
      id: "windows-build-change",
      confidence: "possible",
      in_play: true,
      evidence: [{ kind: "known", code: "value-changed", args: { from: "1", to: "2" }, against: false, source: "sessions" }],
      since_when: { kind: "unknown" },
      fix: { kind: "none", code: "no-safe-change" },
    };
    await ask({ ...base, why_first: "not-separable", findings: [{ ...driver, confidence: "possible", in_play: true }, windows] });
    await waitFor(() => expect(screen.getByText("Compy can't tell which of these it is yet")).toBeTruthy());
    expect(screen.queryByText(/play Game A once with nothing else running/)).toBeNull();
    expect(screen.getByText("Play Game A once more. Compy may still not be able to tell these apart.")).toBeTruthy();
  });

  it("a setting that drifted is named for what the records say", async () => {
    const drift = (check: string): ParamedicDiagnosis["findings"][number] => ({
      id: "setting-drift",
      confidence: "possible",
      in_play: true,
      evidence: [{ kind: "known", code: "drift-noticed", args: { check }, against: false, source: "drift" }],
      since_when: { kind: "unknown" },
      fix: { kind: "steps", code: "setting-drift", args: {} },
    });
    await ask({ ...base, why_first: null, findings: [drift("applied-changes")] });
    await waitFor(() => expect(screen.getByText("A setting Compy applied is no longer on")).toBeTruthy());
    expect(screen.queryByText(/outside Compy/)).toBeNull();
    cleanup();
    await ask({ ...base, why_first: null, findings: [drift("power-profile")] });
    await waitFor(() => expect(screen.getByText("A setting Compy watches changed")).toBeTruthy());
  });

  it("an unread record is said as unread, and memory names the line the engine applied", async () => {
    await ask({
      ...base,
      unknowns: ["drift-unreadable", "identity-unreadable"],
      not_it: [{ id: "memory-pressure", args: { percent: "90" } }],
    });
    await waitFor(() => expect(screen.getByText("Memory: never reached 90% full in these sessions.")).toBeTruthy());
    expect(screen.getByText("Its record of setting changes, which couldn't be read")).toBeTruthy();
    expect(screen.getByText("Its record of graphics driver and power plan checks, which couldn't be read")).toBeTruthy();
  });

  it("partly measured and looked rough: says so and names the game", async () => {
    await ask({
      ...base,
      state: { kind: "cant-tell", why: { kind: "partial-measure", percent: 40, looked_rough: true } },
      findings: [],
    });
    await waitFor(() => expect(screen.getByText(/only measured part of your last Game A session \(40%\)/)).toBeTruthy());
    expect(screen.queryByText("Nothing looks wrong")).toBeNull();
  });

  it("frame cap changed: refuses to compare and offers no stutter verdict", async () => {
    await ask({ ...base, state: { kind: "cant-tell", why: { kind: "frame-cap-changed" } }, findings: [] });
    await waitFor(() => expect(screen.getByText(/frame cap changed, or Compy can't read it/)).toBeTruthy());
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("names the game it picked when none was asked for", async () => {
    await ask({ ...base, game: "game-b", game_name: "Game B", why_first: null });
    await waitFor(() => expect(screen.getByText("Game B has been running much rougher than usual")).toBeTruthy());
    expect(answer.calls[0][1]).toEqual(expect.objectContaining({ game: null }));
  });

  it("a failed read says nothing was changed", async () => {
    await ask(null);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/Nothing on your PC was changed/);
  });
});

describe("paramedic words", () => {
  const en = readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8");
  const zh = readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8");
  const keys = (src: string) => {
    const out: string[] = [];
    const walk = (o: Record<string, unknown>, p: string) =>
      Object.entries(o).forEach(([k, v]) =>
        typeof v === "string" ? out.push(p + k) : walk(v as Record<string, unknown>, p + k + "."),
      );
    walk(JSON.parse(src), "");
    return out.sort();
  };

  it("never hard-codes a percentage and never claims a cause", () => {
    expect(en).not.toMatch(/\d%/);
    expect(en).not.toMatch(/\bcaused\b|because of/i);
  });

  it("claims no more than the records show", () => {
    expect(en).not.toMatch(/were busy|got rougher|usual speed|outside Compy|nearly full in these/i);
    expect(JSON.parse(zh).answer.likely).not.toMatch(/原因/);
  });

  it("has the same keys in both languages", () => {
    expect(keys(zh)).toEqual(keys(en));
  });
});
