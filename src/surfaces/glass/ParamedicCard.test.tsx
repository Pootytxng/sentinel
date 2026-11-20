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
  unknowns: ["startup-programs"],
  limits: [],
  seen: [],
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

  it("Windows recorded the install time: the card says when, and drops the 'didn't read it' line", async () => {
    const [driver] = base.findings;
    await ask({
      ...base,
      why_first: null,
      findings: [
        {
          ...driver,
          confidence: "possible",
          since_when: { kind: "exact", at: "2026-11-19T12:00:00Z" },
          evidence: [
            driver.evidence[0],
            { kind: "known", code: "install-recorded", args: { when: "2026-11-19T12:00:00Z", version: "2.0" }, against: false, source: "windows" },
          ],
        },
      ],
    });
    await waitFor(() => expect(screen.getByText(/Windows recorded the driver install on/)).toBeTruthy());
    expect(screen.getByText("Your graphics driver changed from 1.0 to 2.0.")).toBeTruthy();
    expect(screen.queryByText(/didn't read the exact install time/)).toBeNull();
  });

  it("a Windows update in the period is a candidate with steps to view it and, for a quality update, remove it yourself", async () => {
    const [driver] = base.findings;
    const update: ParamedicDiagnosis["findings"][number] = {
      id: "windows-update",
      confidence: "possible",
      in_play: true,
      evidence: [{ kind: "known", code: "update-installed", args: { kb: "KB5001234", when: "2026-11-19T03:00:00Z", class: "quality" }, against: false, source: "windows" }],
      since_when: { kind: "exact", at: "2026-11-19T03:00:00Z" },
      fix: { kind: "steps", code: "windows-update", args: { kb: "KB5001234", quality: "true" } },
    };
    await ask({
      ...base,
      why_first: "not-separable",
      findings: [{ ...driver, confidence: "possible", in_play: true }, update],
      seen: [{ id: "updates-minor", args: { n: "2", m: "1" } }],
    });
    await waitFor(() => expect(screen.getByText("Windows installed an update")).toBeTruthy());
    expect(screen.getByText(/Windows installed KB5001234 on/)).toBeTruthy();
    expect(screen.getByText(/Update history to see what was installed and when/)).toBeTruthy();
    expect(screen.getByText(/You can remove KB5001234 there and restart. That's your choice; Compy won't do it for you./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /uninstall|remove|undo/i })).toBeNull();
    expect(screen.getByText("2 security definition and 1 app updates, which Compy doesn't treat as likely causes.")).toBeTruthy();
  });

  it("a feature update offers no uninstall step", async () => {
    const [driver] = base.findings;
    await ask({
      ...base,
      why_first: null,
      findings: [
        {
          ...driver,
          id: "windows-update",
          confidence: "possible",
          evidence: [],
          fix: { kind: "steps", code: "windows-update", args: { kb: "KB1", quality: "false" } },
        },
      ],
    });
    await waitFor(() => expect(screen.getByText(/Update history to see what was installed and when/)).toBeTruthy());
    expect(screen.queryByText(/Uninstall updates/)).toBeNull();
  });

  it("game files changing is worded as files, never as a patch, and a non-Steam game stays in what Compy couldn't see", async () => {
    const [driver] = base.findings;
    const files: ParamedicDiagnosis["findings"][number] = {
      id: "game-files-change",
      confidence: "possible",
      in_play: false,
      evidence: [{ kind: "known", code: "files-changed", args: { when: "2026-11-18T18:00:00Z" }, against: false, source: "steam" }],
      since_when: { kind: "exact", at: "2026-11-18T18:00:00Z" },
      fix: { kind: "steps", code: "game-files-change", args: {} },
    };
    await ask({ ...base, why_first: null, findings: [files, { ...driver, confidence: "possible" }] });
    await waitFor(() => expect(screen.getAllByText(/Game A's files changed on/).length).toBeGreaterThan(0));
    expect(screen.getByText(/That can be an update, a file verification or added content/)).toBeTruthy();
    expect(screen.getByText(/Check Game A's patch notes/)).toBeTruthy();
    expect(screen.getByText(/Verify integrity of game files/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/was patched|were patched|got patched/i);
    cleanup();
    await ask({ ...base, limits: [{ kind: "game-update", code: "not-steam", args: {} }] });
    await waitFor(() =>
      expect(screen.getByText("Game A isn't in a Steam library Compy could find, so it can't see when it was updated.")).toBeTruthy(),
    );
  });

  it("when the readers could not read, the card still renders and each kind has its own specific line", async () => {
    await ask({
      ...base,
      limits: [
        { kind: "driver", code: "access-denied", args: {} },
        { kind: "windows-update", code: "timed-out", args: {} },
        { kind: "game-update", code: "steam-unreadable", args: {} },
        { kind: "programs", code: "partial-registry", args: { n: "2" } },
        { kind: "programs", code: "no-install-date", args: { n: "3" } },
      ],
    });
    await waitFor(() => expect(screen.getByText("Most likely")).toBeTruthy());
    expect(screen.getByText("Compy couldn't see when drivers were installed: Windows needs administrator rights to show that log.")).toBeTruthy();
    expect(screen.getByText("Compy couldn't see which Windows updates were installed: reading it took too long.")).toBeTruthy();
    expect(screen.getByText("Compy couldn't see when Game A was updated: Steam's files couldn't be read.")).toBeTruthy();
    expect(screen.getByText("Compy saw only part of which programs were installed: 2 registry entries couldn't be opened.")).toBeTruthy();
    expect(screen.getByText("Compy can't see Store apps, or programs that don't record an install date (3 here).")).toBeTruthy();
    expect(screen.queryByText(/Whether Game A was updated/)).toBeNull();
  });

  it("installed programs are one collapsed line and 'unchanged' only appears when Windows was read completely", async () => {
    await ask({
      ...base,
      not_it: [
        { id: "windows-update", args: {} },
        { id: "gpu-driver-change", args: { driver: "2.0", windows: "none" } },
        { id: "game-files-change", args: { since: "2026-09-01T00:00:00Z" } },
      ],
      seen: [{ id: "programs-installed", args: { count: "4", names: "Discord, Paint Tool, Zip Thing", more: "1", day: "2026-11-19T00:00:00Z", last: "2026-11-19T00:00:00Z" } }],
    });
    await waitFor(() => expect(screen.getByText("Windows: no quality or feature update in this period.")).toBeTruthy());
    expect(screen.getByText(/4 programs were installed on .*: Discord, Paint Tool, Zip Thing and 1 more\./)).toBeTruthy();
    expect(screen.getByText("Graphics driver: still 2.0. Windows recorded no graphics driver install in this period.")).toBeTruthy();
    expect(screen.getByText(/Game A's files: unchanged since/)).toBeTruthy();
  });

  it("an install after the first rough session is shown as weakening the driver", async () => {
    const [driver] = base.findings;
    await ask({
      ...base,
      why_first: null,
      findings: [
        {
          ...driver,
          confidence: "possible",
          evidence: [
            { kind: "measured", code: "install-after-rough", args: { when: "2026-11-20T01:05:00Z" }, against: true, source: "windows" },
          ],
        },
      ],
    });
    await waitFor(() => expect(screen.getByText(/after the first rough session had started/)).toBeTruthy());
    expect(screen.getAllByText("Weakens this").length).toBeGreaterThan(0);
  });

  it("'never before it' is said only when the engine says every earlier session was normal", async () => {
    const [driver] = base.findings;
    const cross = (neverBefore: string): ParamedicDiagnosis["findings"][number] => ({
      ...driver,
      confidence: "possible",
      evidence: [{ kind: "measured", code: "cross-game", args: { games: "Game B", neverBefore }, against: false, source: "sessions" }],
    });
    await ask({ ...base, why_first: null, findings: [cross("true")] });
    await waitFor(() => expect(screen.getByText("Game B also got much rougher after the update, and never before it.")).toBeTruthy());
    cleanup();
    await ask({ ...base, why_first: null, findings: [cross("false")] });
    await waitFor(() => expect(screen.getByText("Game B's rough sessions also came after the update.")).toBeTruthy());
    expect(screen.queryByText(/never before it/)).toBeNull();
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
    // Steam's time also moves on a file verification or added content: never "the game was patched".
    expect(en).not.toMatch(/was patched|were patched|got patched/i);
    // The confounded line says what was recorded (programs starting), not that the PC was busy.
    expect(JSON.parse(en).evidence.crossGameConfounded).not.toMatch(/busy/i);
    expect(JSON.parse(zh).answer.likely).not.toMatch(/原因/);
  });

  it("has the same keys in both languages", () => {
    expect(keys(zh)).toEqual(keys(en));
  });
});
