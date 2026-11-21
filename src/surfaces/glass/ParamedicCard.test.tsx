// PC Paramedic: the card renders what the engine returned, in the states the design names, and the
// default open card is short: one-line rows, every disclosure closed (F3). The engine's answer is mocked
// (numbers and codes only); every sentence asserted here is the card's own.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown, calls: [] as unknown[][], busyFirst: 0, reject: "", gate: null as Promise<void> | null, byCmd: null as Record<string, unknown> | null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    answer.calls.push(args);
    if (answer.byCmd && String(args[0]) in answer.byCmd) return Promise.resolve(answer.byCmd[String(args[0])]);
    // A test holds the answer back (to look at the card while it is still asking) by setting a gate.
    if (answer.gate) return answer.gate.then(() => answer.value);
    if (answer.busyFirst > 0) {
      answer.busyFirst -= 1;
      return Promise.reject("paramedic-busy");
    }
    if (answer.reject) return Promise.reject(answer.reject);
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
  answer.busyFirst = 0;
  answer.reject = "";
  answer.gate = null;
  answer.byCmd = null;
});

const ref = (at: string): ParamedicSessionRef => ({
  started_at: at,
  game: "game-a",
  duration_secs: 3600,
  samples: 3500,
  avg_fps: 120,
  low1_fps: 80,
});

type F = ParamedicDiagnosis["findings"][number];

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
    last_full_normal_at: "2026-11-11T14:14:22Z",
    sessions_affected: [ref("2026-11-20T01:01:24Z")],
    partial_sessions: [],
    other_games_affected: [],
    later_unjudged: 0,
  },
  findings: [
    {
      id: "gpu-driver-change",
      confidence: "likely",
      in_play: false,
      evidence: [{ kind: "known", code: "driver-changed", args: { from: "1.0", to: "2.0" }, against: false, source: "snapshots" }],
      since_when: { kind: "observed-between", from: "2026-11-19T05:12:26Z", to: "2026-11-19T16:54:51Z" },
      fix: { kind: "steps", code: "gpu-driver-change", args: { from: "1.0" } },
      now: null,
      now_evidence: [],
    },
    {
      id: "background-load",
      confidence: "possible",
      in_play: false,
      evidence: [{ kind: "unknown", code: "load-not-recorded", args: {}, against: false, source: "sessions" }],
      since_when: { kind: "unknown" },
      fix: { kind: "steps", code: "background-load", args: {} },
      now: null,
      now_evidence: [],
    },
  ],
  not_it: [{ id: "hardware-change", args: {} }],
  unknowns: ["startup-programs"],
  limits: [],
  seen: [],
  baseline: ref("2026-11-11T14:14:22Z"),
  first_bad: ref("2026-11-20T01:01:24Z"),
  mixed_sessions: [],
  why_first: "tie",
  recovery: null,
  earlier_episode: null,
  method: "paramedic-rules-v1",
};

const find = (id: string, over: Partial<F> = {}): F => ({
  id,
  confidence: "possible",
  in_play: true,
  evidence: [],
  since_when: { kind: "unknown" },
  fix: { kind: "none", code: "no-safe-change" },
  now: null,
  now_evidence: [],
  ...over,
});
const steps = (code: string, args: Record<string, string> = {}): F["fix"] => ({ kind: "steps", code, args });

const ask = async (d: ParamedicDiagnosis | null) => {
  answer.value = d;
  render(<ParamedicCard />);
  fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
};

/** Opens every closed disclosure (rows, folds, "Show the numbers"), including ones that appear inside others. */
const openAll = () => {
  for (let i = 0; i < 6; i++) {
    const closed = screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-expanded") === "false");
    if (closed.length === 0) return;
    closed.forEach((b) => fireEvent.click(b));
  }
};

const verdict = () => screen.getByTestId("paramedic-verdict").textContent;
const rows = () => screen.queryAllByTestId("paramedic-candidate");

describe("ParamedicCard", () => {
  it("asks nothing until the button is pressed", () => {
    render(<ParamedicCard />);
    expect(answer.calls.length).toBe(0);
    expect(screen.getByRole("button", { name: "Something's wrong" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("found: the default open card is a verdict and one-line rows, with every disclosure closed", async () => {
    await ask(base);
    await waitFor(() => expect(screen.getByText("Most likely")).toBeTruthy());
    expect(answer.calls[0][0]).toBe("paramedic_diagnose");
    expect(verdict()).toBe("One change lines up best with what happened. It's listed first.");
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toMatch(/Your graphics driver was updated/);
    expect(screen.queryByText("Your graphics driver changed from 1.0 to 2.0.")).toBeNull();
    expect(screen.queryByText(/Press Windows \+ X and open Device Manager/)).toBeNull();
    expect(screen.queryByText("Other programs started while you played")).toBeNull();
    const disclosures = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(disclosures.length).toBeGreaterThanOrEqual(4);
    expect(disclosures.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    for (const name of ["Also possible", "What Compy checked", "What Compy can't see"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) }).getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.getByText(/Try the steps under the first one, play Game A once/)).toBeTruthy();
    const region = screen.getByRole("region", { name: /Scrolls if there is more/ });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("a row opens to its evidence and steps and closes again, with aria-expanded kept true", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const btn = within(rows()[0]).getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Your graphics driver changed from 1.0 to 2.0.")).toBeTruthy();
    expect(screen.getByText(/Press Windows \+ X and open Device Manager/)).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Your graphics driver changed from 1.0 to 2.0.")).toBeNull();
  });

  it("shows at most three candidates as rows, however many line up; the rest wait under Also possible", async () => {
    const five = [
      find("gpu-driver-change", { fix: steps("gpu-driver-change", { from: "1.0" }) }),
      find("background-load", { fix: steps("background-load") }),
      find("windows-update", { fix: steps("windows-update", { kb: "", quality: "false" }) }),
      find("game-files-change", { since_when: { kind: "exact", at: "2026-11-18T18:00:00Z" }, fix: steps("game-files-change") }),
      find("program-installed", {
        evidence: [{ kind: "known", code: "installed-and-started", args: { name: "Discord", day: "2026-11-19T08:00:00Z" }, against: false, source: "uninstall-keys" }],
        fix: steps("program-installed", { names: "Discord" }),
      }),
    ];
    await ask({ ...base, why_first: "not-separable", findings: five });
    await waitFor(() => expect(rows().length).toBe(3));
    expect(screen.getByRole("button", { name: /Also possible/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Also possible/ }));
    expect(rows().length).toBe(5);
  });

  it("Close returns the card to its small bar and puts focus back on its button", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: /Scrolls if there is more/ })).toBeNull();
    expect(screen.queryByTestId("paramedic-verdict")).toBeNull();
    const door = screen.getByRole("button", { name: "Something's wrong" });
    expect(document.activeElement).toBe(door);
  });

  it("nothing wrong: says so and offers no finding", async () => {
    await ask({ ...base, state: { kind: "nothing-wrong", sessions_checked: 4 }, problem: null, findings: [] });
    await waitFor(() => expect(screen.getByText("Nothing looks wrong")).toBeTruthy());
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("can't tell: says why, and never guesses", async () => {
    await ask({ ...base, state: { kind: "needs-more-play", sessions_needed: 2, have: 1 }, problem: null, findings: [] });
    await waitFor(() => expect(screen.getByText("Compy can't tell yet")).toBeTruthy());
    expect(screen.getByText(/needs 3 normal sessions of Game A/)).toBeTruthy();
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("measured but nothing recorded changed: reports the problem without inventing a cause", async () => {
    await ask({ ...base, state: { kind: "cant-tell", why: { kind: "nothing-changed" } }, findings: [] });
    await waitFor(() => expect(screen.getByText("Compy measured the problem, but nothing it records changed before it")).toBeTruthy());
    expect(screen.queryByText("Most likely")).toBeNull();
  });

  it("not separable: lists the candidates, ranks no winner, and says how to find out", async () => {
    const [driver, load] = base.findings;
    await ask({ ...base, why_first: "not-separable", findings: [{ ...driver, confidence: "possible", in_play: true }, { ...load, in_play: true }] });
    await waitFor(() => expect(verdict()).toBe("Compy can't tell which of these it is yet"));
    expect(screen.queryByText("Most likely")).toBeNull();
    expect(rows().length).toBe(2);
    expect(screen.getByText("To find out: play Game A once with nothing else running. Compy will compare.")).toBeTruthy();
  });

  it("not separable without background load: does not promise that a quiet PC will tell them apart", async () => {
    const [driver] = base.findings;
    const windows = find("windows-build-change", {
      evidence: [{ kind: "known", code: "value-changed", args: { from: "1", to: "2" }, against: false, source: "sessions" }],
    });
    await ask({ ...base, why_first: "not-separable", findings: [{ ...driver, confidence: "possible", in_play: true }, windows] });
    await waitFor(() => expect(verdict()).toBe("Compy can't tell which of these it is yet"));
    expect(screen.queryByText(/play Game A once with nothing else running/)).toBeNull();
    expect(screen.getByText("Play Game A once more. Compy may still not be able to tell these apart.")).toBeTruthy();
  });

  it("a setting that drifted is named for what the records say", async () => {
    const drift = (check: string) =>
      find("setting-drift", {
        evidence: [{ kind: "known", code: "drift-noticed", args: { check }, against: false, source: "drift" }],
        fix: steps("setting-drift"),
      });
    await ask({ ...base, why_first: null, findings: [drift("applied-changes")] });
    await waitFor(() => expect(screen.getByText("A setting Compy applied is no longer on")).toBeTruthy());
    expect(screen.queryByText(/outside Compy/)).toBeNull();
    cleanup();
    await ask({ ...base, why_first: null, findings: [drift("power-profile")] });
    await waitFor(() => expect(screen.getByText("A setting Compy watches changed")).toBeTruthy());
  });

  it("an unread record is said as unread, and memory names the line the engine applied", async () => {
    await ask({ ...base, unknowns: ["drift-unreadable", "identity-unreadable"], not_it: [{ id: "memory-pressure", args: { percent: "90", count: "1" } }] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Memory: never reached 90% full in the rough session.")).toBeTruthy();
    expect(screen.getByText("Its record of setting changes, which couldn't be read")).toBeTruthy();
    expect(screen.getByText("Its record of graphics driver and power plan checks, which couldn't be read")).toBeTruthy();
  });

  it("partly measured and looked rough: says so and names the game", async () => {
    await ask({ ...base, state: { kind: "cant-tell", why: { kind: "partial-measure", percent: 40, looked_rough: true } }, findings: [] });
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
    await waitFor(() => expect(screen.getByText("Game B ran much rougher than usual in its last session")).toBeTruthy());
    expect(answer.calls[0][1]).toEqual(expect.objectContaining({ game: null }));
  });

  it("the problem is two lines; the rest of its numbers wait behind Show the numbers", async () => {
    const p = base.problem!;
    await ask({
      ...base,
      problem: {
        ...p,
        spikes: true,
        avg_lower: true,
        before: { ...p.before, p99_ms: 20 },
        now: { ...p.now, p99_ms: 80 },
        other_games_affected: ["Game B"],
        partial_sessions: [ref("2026-11-20T02:00:00Z")],
      },
    });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.queryByText(/The slowest 1 in 100 frames/)).toBeNull();
    expect(screen.queryByText(/It also averaged/)).toBeNull();
    const more = screen.getByRole("button", { name: "Show the numbers" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/The slowest 1 in 100 frames took about 80 ms/)).toBeTruthy();
    expect(screen.getByText(/It also averaged 110 frames per second/)).toBeTruthy();
    expect(screen.getByText(/Game B also had rough sessions/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide the numbers" })).toBeTruthy();
  });

  it("Windows recorded the install time: the heading says when, the evidence does not repeat it", async () => {
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
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.queryByText(/Windows recorded the driver install on/)).toBeNull();
    expect(screen.getByText("Your graphics driver changed from 1.0 to 2.0.")).toBeTruthy();
    expect(screen.queryByText(/didn't read the exact install time/)).toBeNull();
  });

  it("a Windows update in the period is a candidate with steps to view it and, for a quality update, remove it yourself", async () => {
    const [driver] = base.findings;
    const update = find("windows-update", {
      evidence: [{ kind: "known", code: "update-installed", args: { kb: "KB5001234", when: "2026-11-19T03:00:00Z", class: "quality" }, against: false, source: "windows" }],
      since_when: { kind: "exact", at: "2026-11-19T03:00:00Z" },
      fix: steps("windows-update", { kb: "KB5001234", quality: "true" }),
    });
    await ask({ ...base, why_first: "not-separable", findings: [{ ...driver, confidence: "possible", in_play: true }, update], seen: [{ id: "updates-minor", args: { n: "2", m: "1" } }] });
    await waitFor(() => expect(screen.getByText("Windows installed an update")).toBeTruthy());
    expect(screen.queryByText(/Windows installed KB5001234 on/)).toBeNull();
    openAll();
    expect(screen.getByText(/Windows installed KB5001234 on/)).toBeTruthy();
    expect(screen.getByText(/Update history to see what was installed and when/)).toBeTruthy();
    expect(screen.getByText(/You can remove KB5001234 there and restart. That's your choice; Compy won't do it for you./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /uninstall|remove|undo/i })).toBeNull();
    expect(screen.getByText("2 security definition and 1 app updates (listed for completeness).")).toBeTruthy();
  });

  it("a feature update offers no uninstall step", async () => {
    await ask({ ...base, why_first: null, findings: [find("windows-update", { fix: steps("windows-update", { kb: "KB1", quality: "false" }) })] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/Update history to see what was installed and when/)).toBeTruthy();
    expect(screen.queryByText(/Uninstall updates/)).toBeNull();
  });

  it("game files changing is worded as files, never as a patch, and a non-Steam game stays in what Compy couldn't see", async () => {
    const [driver] = base.findings;
    const files = find("game-files-change", {
      in_play: false,
      evidence: [{ kind: "known", code: "files-changed", args: { when: "2026-11-18T18:00:00Z" }, against: false, source: "steam" }],
      since_when: { kind: "exact", at: "2026-11-18T18:00:00Z" },
      fix: steps("game-files-change"),
    });
    await ask({ ...base, why_first: null, findings: [files, { ...driver, confidence: "possible" }] });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    openAll();
    expect(screen.getAllByText(/Game A's files changed on/).length).toBeGreaterThan(0);
    expect(screen.getByText(/That can be an update, a file verification or added content/)).toBeTruthy();
    expect(screen.getByText(/Check Game A's patch notes/)).toBeTruthy();
    expect(screen.getByText(/Verify integrity of game files/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/was patched|were patched|got patched/i);
    cleanup();
    await ask({ ...base, limits: [{ kind: "game-update", code: "not-steam", args: {} }] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Compy couldn't match Game A to a Steam install, so it can't see when it was updated.")).toBeTruthy();
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
    openAll();
    expect(screen.getByText("Compy couldn't see when drivers were installed: Windows needs administrator rights to show that log.")).toBeTruthy();
    expect(screen.getByText("Compy couldn't see which Windows updates were installed: reading it took too long.")).toBeTruthy();
    expect(screen.getByText("Compy couldn't see when Game A was updated: Steam's files couldn't be read.")).toBeTruthy();
    expect(screen.getByText("Compy saw only part of which programs were installed: 2 registry entries couldn't be opened.")).toBeTruthy();
    expect(screen.getByText("Compy can't see Store apps, or programs that don't record an install date (3 here).")).toBeTruthy();
  });

  it("keeps the always-true limits under What Compy can't see, apart from the checked list", async () => {
    await ask({
      ...base,
      limits: [
        { kind: "driver", code: "classes", args: {} },
        { kind: "programs", code: "no-install-date", args: { n: "27" } },
        { kind: "driver", code: "access-denied", args: {} },
      ],
    });
    await waitFor(() => expect(screen.getByTestId("paramedic-limits")).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("paramedic-limits")).getByRole("button"));
    const fold = screen.getByTestId("paramedic-limits");
    expect(fold.textContent).toMatch(/Compy reads graphics, audio, network and chipset driver installs only/);
    expect(fold.textContent).toMatch(/27 here/);
    expect(fold.textContent).toMatch(/administrator rights/);
    expect(screen.getByTestId("paramedic-checked").textContent).not.toMatch(/administrator rights/);
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
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(within(screen.getByTestId("paramedic-checked")).getByRole("button"));
    expect(screen.getByText("Windows: no quality or feature update in this period.")).toBeTruthy();
    expect(screen.getByText(/4 programs were installed on .*: Discord, Paint Tool, Zip Thing and 1 more\./)).toBeTruthy();
    expect(screen.getByText("Graphics driver: still 2.0. Windows recorded no graphics driver install in this period.")).toBeTruthy();
    expect(screen.getByText(/Steam hasn't recorded an update to Game A since/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Game A's files: unchanged/);
  });

  it("an install after the first rough session is shown as weakening the driver", async () => {
    const [driver] = base.findings;
    await ask({
      ...base,
      why_first: null,
      findings: [{ ...driver, confidence: "possible", evidence: [{ kind: "measured", code: "install-after-rough", args: { when: "2026-11-20T01:05:00Z" }, against: true, source: "windows" }] }],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/after the first rough session had started/)).toBeTruthy();
    expect(screen.getAllByText("Weakens this").length).toBeGreaterThan(0);
  });

  it("'never before it' is said only when the engine says every earlier session was normal", async () => {
    const [driver] = base.findings;
    const cross = (neverBefore: string): F => ({
      ...driver,
      confidence: "possible",
      evidence: [{ kind: "measured", code: "cross-game", args: { games: "Game B", neverBefore }, against: false, source: "sessions" }],
    });
    await ask({ ...base, why_first: null, findings: [cross("true")] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Game B also got much rougher after the update, and never before it.")).toBeTruthy();
    cleanup();
    await ask({ ...base, why_first: null, findings: [cross("false")] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Game B's rough sessions also came after the update.")).toBeTruthy();
    expect(screen.queryByText(/never before it/)).toBeNull();
  });

  it("counts updates it could not classify, with their KB ids", async () => {
    await ask({
      ...base,
      seen: [
        { id: "updates-unclassified", args: { n: "2", kbs: "KB5009999, KB5008888" } },
        { id: "driver-reinstall-same", args: { when: "2026-11-19T12:00:00Z" } },
        { id: "driver-install-prior-unknown", args: { when: "2026-11-19T12:00:00Z" } },
        { id: "driver-other-install", args: { when: "2026-11-19T12:00:00Z" } },
      ],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("2 Windows updates Compy couldn't classify (KB5009999, KB5008888).")).toBeTruthy();
    expect(screen.getAllByText(/Windows recorded the same driver version being installed again on/).length).toBeGreaterThan(0);
    expect(screen.getByText(/the version before it isn't known/)).toBeTruthy();
    expect(screen.getByText(/for a different version than the one your rough sessions ran on/)).toBeTruthy();
  });

  it("no rendered line has an empty placeholder, for any finding in these fixtures", async () => {
    const noVersion = find("gpu-driver-change", {
      since_when: { kind: "exact", at: "2026-11-19T12:00:00Z" },
      evidence: [{ kind: "known", code: "install-recorded", args: { when: "2026-11-19T12:00:00Z", version: "" }, against: false, source: "windows" }],
    });
    const noKb = find("windows-update", {
      evidence: [{ kind: "known", code: "update-installed", args: { kb: "", when: "2026-11-19T12:00:00Z", class: "feature" }, against: false, source: "windows" }],
      fix: steps("windows-update", { kb: "", quality: "false" }),
    });
    const program = find("program-installed", {
      evidence: [{ kind: "known", code: "installed-and-started", args: { name: "Discord", day: "2026-11-19T08:00:00Z" }, against: false, source: "uninstall-keys" }],
      fix: steps("program-installed", { names: "Discord" }),
    });
    for (const findings of [[noVersion, noKb, program, find("background-load", { fix: steps("background-load") })], base.findings]) {
      await ask({ ...base, why_first: "not-separable", findings });
      await waitFor(() => expect(verdict()).toBe("Compy can't tell which of these it is yet"));
      openAll();
      const bad = [...document.querySelectorAll("li, p, span, button, h2")]
        .filter((el) => /\s{2,}| [.,]|\{\{|\(\)|\bfrom \.|version \./.test(el.textContent ?? ""))
        .map((el) => el.outerHTML.slice(0, 200));
      expect(bad).toEqual([]);
      cleanup();
    }
  });

  it("a failed read says nothing was changed", async () => {
    answer.reject = "boom";
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/Nothing on your PC was changed/);
  });
});

describe("ParamedicCard: while the episode is still going", () => {
  it("says how many sessions the rough run has lasted, and names an earlier episode that recovered", async () => {
    const p = base.problem!;
    await ask({
      ...base,
      problem: { ...p, sessions_affected: [ref("2026-11-19T01:00:00Z"), ref("2026-11-20T01:00:00Z"), ref("2026-11-21T01:00:00Z")] },
      earlier_episode: { from: "2026-11-02T01:00:00Z", to: "2026-11-04T01:00:00Z" },
    });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText(/The rough run has lasted 3 sessions so far\./)).toBeTruthy();
    expect(screen.getByText(/It also ran rough .+–.+ and recovered\./)).toBeTruthy();
  });

  it("says the game is not known to be back to normal while later sessions were only partly measured", async () => {
    await ask({ ...base, problem: { ...base.problem!, later_unjudged: 2 } });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText("Compy can't tell yet whether Game A is back to normal. Play once more.")).toBeTruthy();
    expect(screen.queryByText(/running the way it usually does again/)).toBeNull();
  });

  const unclear = (why: Partial<{ partial: boolean; one_clear: boolean; cap_changed: boolean }> = {}): ParamedicDiagnosis => ({
    ...base,
    state: { kind: "cant-tell", why: { kind: "recovery-unclear", partial: false, one_clear: false, cap_changed: false, ...why } },
    why_first: null,
  });

  it("in between: shows the problem line and collapsed rows, says it can't tell yet, and never says recovered (F8)", async () => {
    await ask(unclear());
    await waitFor(() => expect(screen.getByText("Compy can't tell yet whether Game A is back to normal. Play once more.")).toBeTruthy());
    expect(screen.getByText("Game A ran much rougher than usual in its last session")).toBeTruthy();
    expect(screen.getByText(/In a normal session, Game A's dips stay at about 90%/)).toBeTruthy();
    expect(screen.queryByText(/running the way it usually does/)).toBeNull();
    expect(rows().length).toBe(2);
    // Every row starts collapsed.
    for (const r of rows()) expect(within(r).getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });

  it("the unclear state says it once even when later sessions were only partly measured", async () => {
    await ask({ ...unclear(), problem: { ...base.problem!, later_unjudged: 2 } });
    await waitFor(() => expect(rows().length).toBe(2));
    expect(screen.getAllByText("Compy can't tell yet whether Game A is back to normal. Play once more.").length).toBe(1);
  });

  it("one clear session since says so and asks for one more (F1)", async () => {
    await ask(unclear({ one_clear: true }));
    await waitFor(() =>
      expect(screen.getByText("One session since has run the way Game A usually does. Compy needs one more to be sure.")).toBeTruthy(),
    );
    expect(screen.queryByText(/running the way it usually does/)).toBeNull();
  });

  it("a frame cap that is different now is said as a frame-cap problem, not as a vague one (F9)", async () => {
    await ask(unclear({ cap_changed: true, one_clear: true }));
    await waitFor(() =>
      expect(screen.getByText("Game A's frame cap is different now, so Compy can't compare these sessions with the earlier ones.")).toBeTruthy(),
    );
    expect(screen.queryByText(/Compy needs one more/)).toBeNull();
  });

  it("names the last fully measured normal session when the newest normal one was only partly measured (F12)", async () => {
    const p = base.problem!;
    await ask({ ...base, problem: { ...p, last_full_normal_at: "2026-11-09T10:00:00Z" } });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText(/Its last fully measured normal session was .+\. The rough run has lasted 1 session so far\./)).toBeTruthy();
    expect(screen.queryByText(/It last ran normally on/)).toBeNull();
    cleanup();
    await ask({ ...base, problem: { ...p, last_full_normal_at: null } });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.queryByText(/last ran normally|last fully measured/)).toBeNull();
  });

  it("every count in the background-programs evidence says what it counts, with the names on their own line (F16)", async () => {
    const ev = (code: string, args: Record<string, string>) => ({ kind: "measured" as const, code, args, against: false, source: "sessions" });
    await ask({
      ...base,
      why_first: "not-separable",
      findings: [
        find("background-load", {
          evidence: [
            ev("starts-seen", { count: "2", names: "Discord, Zip Thing" }),
            ev("starts-seen-partial", { date: "2026-11-18T10:00:00Z", names: "Updater" }),
            ev("starts-seen-other", { count: "3", otherGame: "Game B", names: "Encoder" }),
            { kind: "unknown", code: "load-not-recorded", args: {}, against: false, source: "sessions" },
          ],
          fix: steps("background-load"),
        }),
      ],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("2 rough Game A sessions had other programs starting during them (Discord, Zip Thing).")).toBeTruthy();
    expect(screen.getByText(/Programs were seen starting in a partly measured Game A session on .+ \(Updater\)\./)).toBeTruthy();
    expect(screen.getByText(/^Programs were also seen starting in 3 rough Game B sessions, the latest on .+ \(Encoder\)\.$/)).toBeTruthy();
    expect(screen.getByText("Compy didn't record how busy your PC was in these sessions.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Compy's own|Compy started/);
  });

  it("a count of zero is not a line: no 'starts-seen' evidence means no 'had other programs starting' text", async () => {
    await ask({ ...base, why_first: null, findings: [base.findings[1]] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.queryByText(/had other programs starting/)).toBeNull();
    expect(screen.getByText("Compy didn't record how busy your PC was in these sessions.")).toBeTruthy();
  });
});

describe("ParamedicCard: recovered", () => {
  const rec = (over: Partial<NonNullable<ParamedicDiagnosis["recovery"]>> = {}): NonNullable<ParamedicDiagnosis["recovery"]> => ({
    before: { ratio: 0.9, p99_ms: null, avg_fps: 120 },
    rough: { ratio: 0.5, p99_ms: null, avg_fps: 110 },
    now: { ratio: 0.92, p99_ms: null, avg_fps: 118 },
    rough_sessions: [ref("2026-11-20T01:00:00Z")],
    recovered_sessions: [ref("2026-11-21T01:00:00Z")],
    sessions_since: 1,
    summary: { kind: "points-to", id: "background-load" },
    also_changed: [],
    ...over,
  });
  const driver = (now: F["now"], codes: F["now_evidence"]): F =>
    find("gpu-driver-change", {
      confidence: "possible",
      in_play: false,
      evidence: [{ kind: "known", code: "driver-changed", args: { from: "1.0", to: "2.0" }, against: false, source: "snapshots" }],
      fix: steps("gpu-driver-change", { from: "1.0" }),
      now,
      now_evidence: codes,
    });
  const background = (now: F["now"], codes: F["now_evidence"]): F =>
    find("background-load", { confidence: "likely", in_play: false, fix: steps("background-load"), now, now_evidence: codes });
  const sameDriver: F["now_evidence"] = [{ kind: "measured", code: "recovered-same-driver", args: { version: "2.0" }, against: true, source: "sessions" }];
  const quiet: F["now_evidence"] = [
    { kind: "supported-inference", code: "recovered-quiet", args: { pct: "3.0" }, against: false, source: "sessions" },
    { kind: "unknown", code: "rough-load-not-recorded", args: {}, against: false, source: "sessions" },
  ];
  const recovered = (over: Partial<ParamedicDiagnosis> = {}): ParamedicDiagnosis => ({
    ...base,
    state: { kind: "recovered" },
    why_first: null,
    findings: [driver("points-away", sameDriver), background("points-to", quiet)],
    recovery: rec(),
    ...over,
  });

  it("titles the recovery with the measured before, rough and now numbers, and names what the evidence points to", async () => {
    await ask(recovered());
    await waitFor(() => expect(screen.getByText("Game A's last two sessions ran the way it usually does")).toBeTruthy());
    expect(screen.getByText("Its dips stayed at about 90% of its average before, fell to about 50% while it was rough, and are at about 92% now.")).toBeTruthy();
    // No one-session basis line any more: recovery is two clear sessions or nothing (F1).
    expect(screen.queryByText(/newest session ran at or above/)).toBeNull();
    // The numbers line is whole, never clamped to two lines (F7).
    expect(document.querySelector(".gl-para-clamp")).toBeNull();
    expect(verdict()).toBe("The evidence now points to: Other programs started while you played.");
    expect(rows().length).toBe(2);
    expect(rows()[0].textContent).toMatch(/Other programs started while you played.*Points to it/);
    expect(rows()[1].textContent).toMatch(/Your graphics driver was updated.*Points away from it/);
    expect(screen.getByText(/If it runs rough again, press Something's wrong again/)).toBeTruthy();
    openAll();
    expect(screen.queryByText("How to fix it")).toBeNull();
  });

  it("each candidate's evidence is in its row: same driver weakens it, a quiet PC supports it and says the comparison is one-sided", async () => {
    await ask(recovered());
    await waitFor(() => expect(rows().length).toBe(2));
    openAll();
    expect(
      screen.getByText("Game A ran normally again on the same driver (2.0). That weakens the driver as the reason, though some driver problems come and go."),
    ).toBeTruthy();
    expect(screen.getByText(/Compy saw no build or encoding program start, and the rest of your PC was quiet \(3\.0% CPU used by other programs\)/)).toBeTruthy();
    expect(screen.getByText("Compy didn't record how busy the PC was in every rough session, so this comparison is one-sided.")).toBeTruthy();
    expect(screen.getAllByText("Supports this").length).toBe(1);
    expect(screen.getAllByText("Since it ran normally again:").length).toBe(2);
  });

  it("a driver that changed again is dated, by Windows' record or by when Compy first saw it", async () => {
    const mk = (exact: string): F["now_evidence"] => [
      { kind: "supported-inference", code: "recovered-after-driver-change", args: { version: "3.0", when: "2026-11-20T20:00:00Z", exact, back: "false" }, against: false, source: "windows" },
    ];
    await ask(recovered({ findings: [driver("points-to", mk("true"))], recovery: rec({ summary: { kind: "points-to", id: "gpu-driver-change" } }) }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/It recovered after the driver changed to 3\.0 on /)).toBeTruthy();
    cleanup();
    await ask(recovered({ findings: [driver("points-to", mk("false"))], recovery: rec({ summary: { kind: "points-to", id: "gpu-driver-change" } }) }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/It recovered after the driver changed to 3\.0 \(Compy first saw it on /)).toBeTruthy();
  });

  it("with more than one candidate still standing it says 'Still between'", async () => {
    await ask(
      recovered({
        findings: [driver("cant-tell", []), background("points-to", quiet)],
        recovery: rec({ summary: { kind: "between", ids: ["gpu-driver-change", "background-load"] }, recovered_sessions: [ref("2026-11-21T01:00:00Z"), ref("2026-11-22T01:00:00Z")] }),
      }),
    );
    await waitFor(() => expect(verdict()).toBe("Still between: Your graphics driver was updated, Other programs started while you played."));
    expect(rows()[1].textContent).toMatch(/Still can't tell/);
  });

  const ev = (code: string, args: Record<string, string>, over: Partial<F["evidence"][number]> = {}): F["evidence"][number] => ({
    kind: "known",
    code,
    args,
    against: false,
    source: "windows",
    ...over,
  });

  it("every dated change between the rough sessions and the normal ones is its own line, and the summary stays 'Still between' (F4)", async () => {
    await ask(
      recovered({
        findings: [driver("cant-tell", [])],
        recovery: rec({
          summary: { kind: "between", ids: ["gpu-driver-change", "windows-update", "game-files-change", "program-installed"] },
          also_changed: [
            ev("gap-change", { kind: "windows-update", when: "2026-11-20T10:00:00Z", day: "false", detail: "KB5001234" }),
            ev("gap-change", { kind: "game-files", when: "2026-11-20T12:00:00Z", day: "false", detail: "" }),
            ev("gap-change", { kind: "program", when: "2026-11-20T00:00:00Z", day: "true", detail: "Zip Thing" }),
            ev("gap-change", { kind: "gpu-driver", when: "2026-11-20T13:00:00Z", day: "false", detail: "3.0" }),
            ev("gap-change", { kind: "other-driver", when: "2026-11-20T14:00:00Z", day: "false", detail: "" }),
            ev("gap-build", { from: "26100", to: "26200" }, { kind: "measured" }),
            ev("gap-unread", {}, { kind: "unknown" }),
          ],
        }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("paramedic-verdict")).toBeTruthy());
    expect(verdict()).toBe(
      "Still between: Your graphics driver was updated, Windows installed an update, Game A's files changed, A program was installed.",
    );
    expect(screen.queryByText(/The evidence now points to/)).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text.match(/Between the rough sessions and the normal ones: /g)?.length).toBe(6);
    expect(text).toMatch(/: a Windows update \(KB5001234\) on /);
    expect(text).toMatch(/: a change to Game A's files on /);
    expect(text).toMatch(/: Zip Thing was installed on /);
    expect(text).toMatch(/: a graphics driver install \(3\.0\) on /);
    expect(text).toMatch(/: a driver install on /);
    expect(text).toMatch(/Windows went from build 26100 to 26200/);
    expect(text).toMatch(/Compy couldn't read all of Windows' records for that stretch/);
  });

  it("a change to the game's files in the stretch is a candidate in its own right, with its own wording (F4)", async () => {
    const files = find("game-files-change", {
      in_play: false,
      since_when: { kind: "exact", at: "2026-11-20T12:00:00Z" },
      evidence: [ev("files-changed", { when: "2026-11-20T12:00:00Z" }, { source: "steam" })],
      now: "cant-tell",
      now_evidence: [ev("recovered-changed-again", { what: "game-files-change", count: "1", when: "2026-11-20T12:00:00Z" }, { kind: "measured" })],
    });
    await ask(recovered({ findings: [files], recovery: rec({ summary: { kind: "none" } }) }));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0].textContent).toMatch(/Game A's files changed on /);
    openAll();
    expect(screen.getByText(/Game A's files changed on .+, and it has run normally in the sessions since\./)).toBeTruthy();
  });

  it("memory and background-programs evidence say what was seen, never a conclusion (F2, F3, F5)", async () => {
    const mem = find("memory-pressure", {
      in_play: false,
      now: "cant-tell",
      now_evidence: [ev("recovered-ram-rough-lower", { peakGb: "20.0", totalGb: "32.0" }, { kind: "measured" })],
    });
    const unread = find("setting-drift", {
      in_play: false,
      now: "cant-tell",
      now_evidence: [ev("recovery-ram-rough-unread", {}, { kind: "unknown" })],
    });
    const bg = find("background-load", {
      in_play: false,
      now: "cant-tell",
      now_evidence: [ev("recovered-quiet", { pct: "3.0" }, { kind: "supported-inference" }), ev("rough-load-not-recorded", {}, { kind: "unknown" })],
    });
    await ask(recovered({ findings: [mem, unread, bg], recovery: rec({ summary: { kind: "none" } }) }));
    await waitFor(() => expect(rows().length).toBe(3));
    openAll();
    expect(
      screen.getByText("Memory peaked at 20.0 of 32.0 GB when it ran normally, but not every rough session had memory nearly full, so Compy can't say whether memory is the reason."),
    ).toBeTruthy();
    expect(screen.getByText("Compy has no memory reading for the rough sessions, so it can't compare.")).toBeTruthy();
    expect(screen.getByText(/That is consistent with background programs, but Compy can't see programs that were already running\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/doesn't explain it|alone doesn't|can't be the whole story/);
  });

  it("when nothing can be narrowed down it says so, and names a Compy change that also changed", async () => {
    await ask(
      recovered({
        findings: [driver("cant-tell", [])],
        recovery: rec({
          summary: { kind: "none" },
          also_changed: [{ kind: "known", code: "compy-changes-differ", args: { from: "5", to: "3" }, against: false, source: "sessions" }],
        }),
      }),
    );
    await waitFor(() => expect(verdict()).toBe("Compy can't narrow it down from this recovery."));
    expect(screen.getByText(/Compy's count of changes that are on also changed, from 5 to 3/)).toBeTruthy();
  });

  it("never says caused or fixed, in any state it renders", async () => {
    await ask(recovered());
    await waitFor(() => expect(rows().length).toBe(2));
    openAll();
    expect(document.body.textContent).not.toMatch(/\bcaused\b|because of|\bfixed\b|\bthe fix\b/i);
  });
});

describe("ParamedicCard: still checking", () => {
  it("a second call while one is running shows 'still checking', not a failure, and asks again", async () => {
    answer.busyFirst = 1;
    answer.value = base;
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(answer.calls.length).toBe(1));
    expect(screen.getByRole("status").textContent).toMatch(/Looking at your recent sessions/);
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByText("Most likely")).toBeTruthy(), { timeout: 4000 });
    expect(answer.calls.length).toBe(2);
  });

  it("when every retry is still busy it says 'still checking', never that it couldn't read its records (F13)", async () => {
    vi.useFakeTimers();
    try {
      answer.busyFirst = 100;
      render(<ParamedicCard />);
      fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
      for (let i = 0; i < 12; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
      expect(answer.calls.length).toBe(9);
      expect(screen.getByRole("status").textContent).toBe("Compy is still checking. Try again in a moment.");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(document.body.textContent).not.toMatch(/couldn't read its records/);
      expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unmounted card never asks again (F13)", async () => {
    vi.useFakeTimers();
    try {
      answer.busyFirst = 100;
      const { unmount } = render(<ParamedicCard />);
      fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
      expect(answer.calls.length).toBe(1);
      unmount();
      await act(async () => void (await vi.advanceTimersByTimeAsync(20000)));
      expect(answer.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("while busy the button stays focusable (aria-disabled) and a click is ignored (F14)", async () => {
    answer.busyFirst = 1;
    answer.value = base;
    render(<ParamedicCard />);
    const button = screen.getByRole("button", { name: "Something's wrong" }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(answer.calls.length).toBe(1));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(answer.calls.length).toBe(1);
    await waitFor(() => expect(screen.getByText("Most likely")).toBeTruthy(), { timeout: 4000 });
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });
});

describe("ParamedicCard: row names", () => {
  it("a row name that may be cut carries its full text as its title (F15)", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const name = rows()[0].querySelector(".gl-para-row-name") as HTMLElement;
    expect(name.textContent).toBe("Your graphics driver was updated");
    expect(name.getAttribute("title")).toBe(name.textContent);
    const when = rows()[0].querySelector(".gl-para-row-when") as HTMLElement;
    expect(when.getAttribute("title")).toBe(when.textContent);
  });

  it("the stylesheet lets a name wrap to two lines instead of one cut line (F15)", () => {
    const css = readFileSync(join("src", "surfaces", "glass-rooms.css"), "utf8");
    const rule = css.match(/\.gl-para-row-name \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/-webkit-line-clamp: 2/);
    expect(rule).not.toMatch(/white-space: nowrap/);
  });
});

describe("paramedic words", () => {
  const en = readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8");
  const zh = readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8");
  const source = readFileSync(join("src", "surfaces", "glass", "ParamedicCard.tsx"), "utf8");
  const keys = (src: string) => {
    const out: string[] = [];
    const walk = (o: Record<string, unknown>, p: string) =>
      Object.entries(o).forEach(([k, v]) => (typeof v === "string" ? out.push(p + k) : walk(v as Record<string, unknown>, p + k + ".")));
    walk(JSON.parse(src), "");
    return out.sort();
  };
  const recoveryStrings = (src: string) => {
    const o = JSON.parse(src);
    const ev = Object.entries(o.evidence as Record<string, string>).filter(([k]) => /^recover|^roughLoad|^compyChangesDiffer|^gap|^startsSeen/.test(k));
    return [...Object.values((o.recovered ?? {}) as Record<string, string>), ...ev.map(([, v]) => v)];
  };

  it("never hard-codes a percentage and never claims a cause", () => {
    expect(en).not.toMatch(/\d%/);
    expect(en).not.toMatch(/\bcaused\b|because of/i);
  });

  it("claims no more than the records show", () => {
    expect(en).not.toMatch(/were busy|got rougher|usual speed|outside Compy|nearly full in these/i);
    expect(en).not.toMatch(/was patched|were patched|got patched/i);
    expect(JSON.parse(en).evidence.crossGameConfounded).not.toMatch(/busy/i);
    expect(JSON.parse(zh).answer.likely).not.toMatch(/原因/);
  });

  it("the recovery strings say supports and weakens, never caused, fixed or a verdict word, in both languages", () => {
    for (const s of recoveryStrings(en)) expect(s).not.toMatch(/\bcaus|because|\bfix(ed)?\b/i);
    for (const s of recoveryStrings(zh)) expect(s).not.toMatch(/原因|导致|造成|修复了|治好/);
    expect(recoveryStrings(en).length).toBe(recoveryStrings(zh).length);
  });

  it("has the same keys in both languages", () => {
    expect(keys(zh)).toEqual(keys(en));
  });

  it("every key is reached by a literal t() call: no key is picked inside one call", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = [...code.matchAll(/\bt\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(50);
    expect(calls.filter((c) => !/^"[^"]+"$/.test(c))).toEqual([]);
  });
});

describe("ParamedicCard: review round 2", () => {
  const ev = (kind: "measured" | "unknown" | "supported-inference", code: string, args: Record<string, string> = {}, against = false) => ({
    kind,
    code,
    args,
    against,
    source: "sessions",
  });

  const recov = (over: Partial<NonNullable<ParamedicDiagnosis["recovery"]>> = {}): NonNullable<ParamedicDiagnosis["recovery"]> => ({
    before: { ratio: 0.9, p99_ms: null, avg_fps: 120 },
    rough: { ratio: 0.5, p99_ms: null, avg_fps: 110 },
    now: { ratio: 0.92, p99_ms: null, avg_fps: 118 },
    rough_sessions: [ref("2026-11-20T01:00:00Z")],
    recovered_sessions: [ref("2026-11-21T10:00:00Z"), ref("2026-11-22T10:00:00Z")],
    sessions_since: 2,
    summary: { kind: "none" },
    also_changed: [],
    ...over,
  });

  it("N1: a session that may hold two games is named in one note and says it was not judged", async () => {
    await ask({ ...base, mixed_sessions: ["2026-11-20T01:01:24Z"] });
    await waitFor(() => expect(screen.getByTestId("paramedic-mixed")).toBeTruthy());
    expect(screen.getByTestId("paramedic-mixed").textContent).toMatch(/^1 session \(.+\) may contain two games, so Compy didn't judge it\.$/);
    cleanup();
    await ask({ ...base, mixed_sessions: ["2026-11-20T01:01:24Z", "2026-11-19T22:00:00Z"] });
    await waitFor(() => expect(screen.getByTestId("paramedic-mixed")).toBeTruthy());
    expect(screen.getByTestId("paramedic-mixed").textContent).toMatch(/^2 sessions \(.+\) may contain two games, so Compy didn't judge them\.$/);
    cleanup();
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.queryByTestId("paramedic-mixed")).toBeNull();
  });

  it("N2: one rough session reads as one, with the one-session caveat; two do not get it", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText("Game A ran much rougher than usual in its last session")).toBeTruthy();
    expect(screen.getByText(/In your last session they fell to about 50%\./)).toBeTruthy();
    expect(screen.getByText(/The rough run has lasted 1 session so far\./)).toBeTruthy();
    expect(screen.getByText("One session isn't much to go on. If the next one is normal, this may have been a one-off.")).toBeTruthy();
    cleanup();
    const p = base.problem!;
    await ask({ ...base, problem: { ...p, sessions_affected: [ref("2026-11-19T10:00:00Z"), ref("2026-11-20T01:01:24Z")] } });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText("Game A has been running much rougher than usual")).toBeTruthy();
    expect(screen.getByText(/In your last 2 sessions they fell to about 50%\./)).toBeTruthy();
    expect(screen.getByText(/The rough run has lasted 2 sessions so far\./)).toBeTruthy();
    expect(screen.queryByText(/One session isn't much to go on/)).toBeNull();
  });

  it("M1: a quiet recovery that can't be tied to the rough sessions is a plain measurement, not 'consistent with'", async () => {
    await ask({
      ...base,
      state: { kind: "recovered" },
      recovery: recov(),
      findings: [
        find("background-load", {
          now: "cant-tell",
          now_evidence: [ev("measured", "recovered-quiet-seen", { pct: "3.0" }), ev("unknown", "rough-load-not-recorded")],
          fix: steps("background-load"),
        }),
      ],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/Compy saw no build or encoding program start, and the rest of your PC was quiet \(3\.0% CPU used by other programs\) in the sessions that ran normally\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/consistent with/);
  });

  it("S2, S3, S4: the day-only install, the Steam latest-time caveat and the partly measured driver session are each said as what they are", async () => {
    await ask({
      ...base,
      state: { kind: "recovered" },
      recovery: recov(),
      why_first: "not-separable",
      findings: [
        find("gpu-driver-change", {
          evidence: [
            ev("measured", "sessions-split-partly", { date: "2026-11-08T10:00:00Z", count: "1", baselineAt: "2026-11-08T10:00:00Z" }),
          ],
          fix: steps("gpu-driver-change", { from: "1.0" }),
        }),
        find("windows-update", {
          now: "cant-tell",
          now_evidence: [ev("unknown", "recovery-day-unplaced", { what: "windows-update", when: "2026-11-19T00:00:00Z" })],
          fix: steps("windows-update"),
        }),
        find("game-files-change", {
          now: "cant-tell",
          now_evidence: [ev("unknown", "recovered-steam-latest-only")],
          fix: steps("game-files-change"),
        }),
      ],
    });
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    openAll();
    expect(screen.getByText(/A partly measured Game A session \(.+\) used the old driver; the rough one used the new one\./)).toBeTruthy();
    expect(screen.getByText(/Windows recorded a change on .+ without a time of day, so Compy can't say whether it came before or after the rough sessions\./)).toBeTruthy();
    expect(screen.getByText(/Steam only keeps the latest update time of Game A's files/)).toBeTruthy();
  });

  it("S2: a gap line whose day is not wholly inside the stretch says the time of day is not known", async () => {
    await ask({
      ...base,
      state: { kind: "recovered" },
      recovery: {
        before: { ratio: 0.9, p99_ms: null, avg_fps: 120 },
        rough: { ratio: 0.5, p99_ms: null, avg_fps: 110 },
        now: { ratio: 0.92, p99_ms: null, avg_fps: 118 },
        rough_sessions: [ref("2026-11-20T01:00:00Z")],
        recovered_sessions: [ref("2026-11-21T10:00:00Z"), ref("2026-11-22T10:00:00Z")],
        sessions_since: 2,
        summary: { kind: "none" },
        also_changed: [ev("measured", "gap-change", { kind: "windows-update", when: "2026-11-20T00:00:00Z", day: "true", placed: "false" })],
      },
    });
    await waitFor(() => expect(screen.getByText(/time of day not known/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/between the rough sessions and the normal ones/);
  });
});
describe("ParamedicCard: graphics mods in the game's folder", () => {
  const day = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));
  const fact = (code: string, args: Record<string, string> = {}, against = false): F["evidence"][number] => ({
    kind: "known",
    code,
    args,
    against,
    source: "game-folder",
  });
  const mod = (over: Partial<F> = {}): F => find("graphics-mod", { fix: steps("graphics-mod", { name: "OptiScaler" }), ...over });
  const answerOf = (findings: F[], extra: Partial<ParamedicDiagnosis> = {}): ParamedicDiagnosis => ({
    ...base,
    why_first: null,
    findings,
    not_it: [],
    unknowns: [],
    ...extra,
  });
  const created = "2026-11-12T09:00:00Z";
  const changed = "2026-11-15T09:00:00Z";
  const logged = "2026-11-10T09:00:00Z";

  it("a mod's loader in the folder is a row named for the game and the mod, with only recorded facts as evidence", async () => {
    await ask(
      answerOf([
        mod({
          since_when: { kind: "observed-between", from: "2026-11-11T14:24:22Z", to: "2026-11-20T01:01:24Z" },
          evidence: [
            fact("mod-files-created", { date: created }),
            fact("mod-settings-changed", { date: changed }),
            fact("mod-log-written", { date: logged }),
            fact("mod-log-before-rough", {}),
          ],
        }),
      ]),
    );
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0].textContent).toMatch(/Game A's folder contains a graphics mod \(OptiScaler\)/);
    expect(rows()[0].textContent).toMatch(/Possible/);
    openAll();
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      `Files of this mod were created in this folder around ${day(created)} (Windows resets this date when a folder is copied or moved, so it is not necessarily when the mod was added).`,
    );
    expect(text).toContain(`Its settings file was last changed on ${day(changed)}.`);
    expect(text).toContain(`The mod's own log or cache file was last written on ${day(logged)}.`);
    expect(text).toContain("That is before the rough session.");
    expect(text).toContain("Check OptiScaler's own page for a newer version.");
    expect(text).toContain(
      "To test without it, move its files out of the game folder (or use its own uninstall), play once, and press Something's wrong again.",
    );
    // A file date says nothing about whether the mod was running: no line concludes that, and none weakens the mod.
    expect(text).not.toMatch(/may not have been running|probably/);
    const before = screen.getAllByText("That is before the rough session.")[0].closest("li");
    expect(within(before as HTMLElement).queryByText("Weakens this")).toBeNull();
    expect(within(rows()[0] as HTMLElement).queryByText("Weakens this")).toBeNull();
    // Files are never "installed on", "added on" or "active", and there is no one-click button.
    expect(text).not.toMatch(/installed on|added on|\bactive\b|no mods/i);
    expect(screen.queryByRole("button", { name: /remove|undo|apply|fix/i })).toBeNull();
  });

  it("with no timing it waits under 'Also possible', not among the default rows", async () => {
    const driver = find("gpu-driver-change", { confidence: "likely", in_play: false, fix: steps("gpu-driver-change", { from: "1.0" }) });
    await ask(answerOf([driver, mod({ in_play: false, evidence: [fact("mod-files-created", { date: created })] })]));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.queryByText(/contains a graphics mod/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Also possible/ }));
    expect(within(screen.getByTestId("paramedic-also")).getByText(/Game A's folder contains a graphics mod \(OptiScaler\)/)).toBeTruthy();
  });

  it("settings-only files, a clean scan and every scan that could not look are each said as exactly what they are", async () => {
    await ask(
      answerOf([find("background-load", { fix: steps("background-load") })], {
        not_it: [{ id: "graphics-mod", args: {} }],
        seen: [{ id: "mod-settings-only", args: { name: "OptiScaler" } }],
        unknowns: ["mods-no-folder", "mods-folder-unreadable", "mods-partial", "mods-unavailable"],
      }),
    );
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    const text = document.body.textContent ?? "";
    expect(text).toContain("No known graphics mod found in Game A's folder.");
    expect(text).toContain("Game A's folder contains a settings or data file from OptiScaler; Compy can't tell whether the mod itself is installed.");
    expect(text).toContain("Compy couldn't match the game to an install folder");
    expect(text).toContain("the folder couldn't be read");
    expect(text).toContain("only part of the folder was scanned");
    expect(text).toContain("looking took too long");
    expect(text).not.toMatch(/no mods\b/i);
    expect(screen.queryByText(/contains a graphics mod/)).toBeNull();
  });

  it("a scan that could not look never reads 'No known graphics mod'", async () => {
    await ask(answerOf([find("background-load", { fix: steps("background-load") })], { unknowns: ["mods-partial"] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(document.body.textContent).not.toContain("No known graphics mod");
    expect(document.body.textContent).toContain("Whether Game A's folder has a graphics mod");
  });

  it("another game's mod files are said on the cross-game evidence", async () => {
    const driver = find("gpu-driver-change", {
      confidence: "possible",
      evidence: [fact("cross-game-mod", { otherGame: "Game B", name: "ReShade" })],
      fix: steps("gpu-driver-change", { from: "1.0" }),
    });
    await ask(answerOf([driver]));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(document.body.textContent).toContain("Game B's folder contains ReShade files, so its rough sessions may have their own reason.");
  });

  it("a cited game whose folder Compy could not check says so on the cross-game evidence", async () => {
    const driver = find("gpu-driver-change", {
      confidence: "possible",
      evidence: [{ kind: "unknown", code: "cross-game-mod-unchecked", args: { otherGame: "Game B" }, against: false, source: "game-folder" }],
      fix: steps("gpu-driver-change", { from: "1.0" }),
    });
    await ask(answerOf([driver]));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(document.body.textContent).toContain("Compy couldn't check Game B's folder for graphics mods.");
  });

  it("the mod strings never claim the mod is installed, active, running or the reason, in either language", () => {
    const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8"));
    const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8"));
    const pick = (o: Record<string, Record<string, unknown>>) => [
      (o.finding.graphicsMod as Record<string, string>).what,
      ...Object.entries(o.evidence).filter(([k]) => /^mod[A-Z]|^crossGameMod$/.test(k)).map(([, v]) => v as string),
      ...Object.values(o.fix.graphicsMod as Record<string, string>),
      o.checked.graphicsMod as string,
      o.seen.modSettingsOnly as string,
      ...Object.entries(o.unknown).filter(([k]) => /^mods/.test(k)).map(([, v]) => v as string),
    ];
    const enS = pick(en);
    const zhS = pick(zh);
    expect(enS.length).toBe(zhS.length);
    for (const s of enS) expect(s).not.toMatch(/\bcaus|because|installed on|added on|\bactive\b|\bno mods\b|\bfix(ed)?\b/i);
    for (const s of zhS) expect(s).not.toMatch(/原因|导致|造成|修复了|治好|没有任何 ?mod/);
  });
});

describe("ParamedicCard: temperature and crash history", () => {
  const day = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));
  const answerOf = (findings: F[], extra: Partial<ParamedicDiagnosis> = {}): ParamedicDiagnosis => ({
    ...base,
    why_first: null,
    findings,
    not_it: [],
    unknowns: [],
    ...extra,
  });
  const background = () => find("background-load", { fix: steps("background-load") });
  const checked = () => document.body.textContent ?? "";

  it("the temperature line is one sentence with both numbers, in the singular or the plural", async () => {
    await ask(answerOf([background()], { seen: [{ id: "gpu-temp", args: { rough: "77", base: "70", count: "1" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain("Graphics card temperature peaked at 77°C in the rough session; in normal sessions it typically peaks around 70°C.");
    expect(checked()).not.toContain("the highest of them");
  });

  it("with several rough sessions the same sentence says it is the highest of them", async () => {
    await ask(answerOf([background()], { seen: [{ id: "gpu-temp", args: { rough: "88", base: "70", count: "2" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain(
      "Graphics card temperature peaked at 88°C in the rough sessions (the highest of them); in normal sessions it typically peaks around 70°C.",
    );
  });

  it("an unchanged temperature is that same one sentence under Unchanged, said once", async () => {
    await ask(answerOf([background()], { not_it: [{ id: "gpu-temp", args: { rough: "74", base: "70", count: "1" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    const line = "Graphics card temperature peaked at 74°C in the rough session; in normal sessions it typically peaks around 70°C.";
    expect(checked()).toContain(line);
    expect(checked().split(line).length).toBe(2);
  });

  it("a hotter card is a Possible row with the two peaks as evidence and fan, dust, airflow and fan-curve steps, none of which assumes dust", async () => {
    const hot = find("gpu-hotter", {
      evidence: [{ kind: "measured", code: "gpu-temp", args: { rough: "91", base: "80", count: "1" }, against: false, source: "sessions" }],
      fix: steps("gpu-hotter"),
    });
    await ask(answerOf([hot]));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0].textContent).toMatch(/Your graphics card ran hotter than usual/);
    expect(rows()[0].textContent).toMatch(/Possible/);
    openAll();
    expect(checked()).toContain("Graphics card temperature peaked at 91°C in the rough session; in normal sessions it typically peaks around 80°C.");
    expect(checked()).toMatch(/fans spin up/);
    expect(checked()).toContain("look at the fans and heatsink for dust");
    expect(checked()).not.toMatch(/clean the dust/);
    expect(checked()).toMatch(/airflow/);
    expect(checked()).toMatch(/fan curve/);
  });

  it("crash records and a missing temperature are each said as what they are", async () => {
    await ask(answerOf([background()], { unknowns: ["gpu-temp", "crashes-unavailable", "crashes-unreadable", "crashes-partial"] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain("How hot your graphics card got");
    expect(checked()).toContain("Whether Game A has closed unexpectedly before (looking took too long)");
    expect(checked()).toContain("Windows' crash records couldn't be read");
    expect(checked()).toContain("Compy could only read some of Windows' crash records, and found none for Game A in those.");
    expect(checked()).not.toMatch(/more crashes/);
    expect(checked()).not.toMatch(/no crashes/i);
  });

  it("the crash line says once or how many times since the first, and both conditions bring the signature sentence", async () => {
    const first = "2026-11-02T09:00:00Z";
    const change = "2026-11-12T09:00:00Z";
    await ask(
      answerOf([background()], {
        seen: [
          { id: "game-crashes", args: { n: "3", since: first } },
          { id: "game-crash-signature", args: { module: "nvwgf2umx.dll", before: change } },
        ],
      }),
    );
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain(`Game A has closed unexpectedly 3 times since ${day(first)}.`);
    expect(checked()).not.toMatch(/probably/);
    expect(checked()).toContain(
      `All the crashes Compy could read stopped in the same file (nvwgf2umx.dll), and some happened before the earliest dated change Compy found (${day(change)}), so that change can't be the whole story for them.`,
    );
  });

  it("memory says it was checked against the rough sessions, in the plural when there were several", async () => {
    await ask(answerOf([background()], { not_it: [{ id: "memory-pressure", args: { percent: "90", count: "3" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain("Memory: never reached 90% full in the rough sessions.");
    expect(checked()).not.toMatch(/in these sessions/);
  });

  it("a crash complaint that reaches the card gets a truthful line, not the no-game text", async () => {
    await ask({ ...base, state: { kind: "cant-tell", why: { kind: "crash-not-covered" } }, findings: [] });
    await waitFor(() => expect(screen.getByText("Crashes have their own page for now. Open Problems to see what Windows recorded.")).toBeTruthy());
  });

  it("one crash is said in the singular and carries no signature sentence", async () => {
    const first = "2026-11-02T09:00:00Z";
    await ask(answerOf([background()], { seen: [{ id: "game-crashes", args: { n: "1", since: first } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain(`Game A has closed unexpectedly once, on ${day(first)}.`);
    expect(checked()).not.toMatch(/same signature|probably/);
  });

  it("a partial read says 'at least' in the line itself, and the line says when it went by program name or spans versions", async () => {
    const first = "2026-11-02T09:00:00Z";
    await ask(answerOf([background()], { seen: [{ id: "game-crashes", args: { n: "3", since: first, partial: "true", byName: "true", versions: "2" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain(
      `Windows' crash records that Compy could read show Game A closing unexpectedly at least 3 times. The oldest of these is from ${day(first)}. (matched by program name) These crashes are across 2 versions of the game.`,
    );
    expect(checked()).not.toMatch(/only some of them could be read/);
  });

  it("a partial read of one crash says 'at least once', and a complete read keeps the plain wording", async () => {
    const first = "2026-11-02T09:00:00Z";
    await ask(answerOf([background()], { seen: [{ id: "game-crashes", args: { n: "1", since: first, partial: "true" } }] }));
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(checked()).toContain(`Windows' crash records that Compy could read show Game A closing unexpectedly at least once, on ${day(first)}.`);
    expect(checked()).not.toContain("(matched by program name)");
  });

  it("the new strings use no overheating, throttling, causal or verdict words, and no 'probably' anywhere", () => {
    const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8"));
    const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8"));
    const strings = (o: Record<string, unknown>): string[] =>
      Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : strings(v as Record<string, unknown>)));
    const all = strings(en);
    for (const s of all) expect(s).not.toMatch(/overheat|throttl/i);
    for (const s of strings(zh)) expect(s).not.toMatch(/过热|降频/);
    // Causal and verdict words, in the strings this slice added (older strings say "can cause" about a cause that is unproven).
    const slice = (o: Record<string, Record<string, unknown>>): string[] =>
      strings({
        a: o.finding.gpuHotter,
        b: o.evidence.crossGameModUnchecked,
        c: o.fix.gpuHotter,
        d: o.seen.gpuTemp_one,
        e: o.seen.gpuTemp_other,
        n: o.seen.gameCrashesPartial_one,
        o: o.seen.gameCrashesPartial_other,
        p: o.seen.crashesByName,
        q: o.seen.crashesVersions,
        f: o.seen.gameCrashes_one,
        g: o.seen.gameCrashes_other,
        h: o.seen.gameCrashSignature,
        i: o.seen.crashBeforeWhat,
        j: o.unknown.gpuTemp,
        k: o.unknown.crashesUnavailable,
        l: o.unknown.crashesUnreadable,
        m: o.unknown.crashesPartial,
      });
    for (const s of slice(en)) expect(s).not.toMatch(/\bcaus|because|guarantee|\bfix(ed)?\b/i);
    for (const s of slice(zh)) expect(s).not.toMatch(/原因|导致|造成|保证|修复了/);
    expect(all.filter((s) => /probably/i.test(s))).toEqual([]);
    expect(zh.seen.gameCrashSignature).not.toMatch(/很可能|可能是/);
    // The old per-line temperature keys are gone: the one sentence is the plural pair.
    expect([en.evidence.gpuTemp, en.checked.gpuTemp, en.seen.gpuTemp, en.checked.memoryPressure]).toEqual([undefined, undefined, undefined, undefined]);
    // The two languages carry the same keys under every group the slice touched.
    const keys = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : keys(v as Record<string, unknown>, `${p}${k}.`)));
    expect(keys(zh).sort()).toEqual(keys(en).sort());
  });
});

describe("ParamedicCard: Check again, the scroll hint and the entry points", () => {
  const scrollRegion = () => screen.getByRole("region", { name: /Scrolls if there is more/ });
  const sizes = (el: HTMLElement, h: { scrollHeight: number; clientHeight: number; scrollTop: number }) => {
    for (const [k, v] of Object.entries(h)) Object.defineProperty(el, k, { configurable: true, value: v });
  };
  const sheet = readFileSync(join("src", "surfaces", "glass-rooms.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => {
    for (const block of sheet.split("}")) {
      const [sel, decls] = block.split("{");
      if (sel != null && decls != null && sel.trim().replace(/\s+/g, " ") === selector) return decls;
    }
    return "";
  };
  const px = (decls: string, prop: string) => Number(decls.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`))?.[1] ?? NaN);

  it("Check again keeps the answer mounted, dimmed and aria-busy, in the same box, until the new one arrives", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const region = scrollRegion();
    const classBefore = region.className;
    const card = screen.getByTestId("paramedic");
    expect(card.getAttribute("data-open")).toBe("true");
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.hasAttribute("inert")).toBe(false);

    let release: () => void = () => {};
    answer.gate = new Promise<void>((r) => (release = r));
    answer.value = { ...base, game_name: "Game B" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    // While it asks: the same element, the same classes, the old rows, the card still open.
    expect(card.getAttribute("data-open")).toBe("true");
    expect(scrollRegion()).toBe(region);
    expect(region.isConnected).toBe(true);
    expect(region.className).toBe(classBefore);
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("data-busy")).toBe("true");
    // Dimmed and busy is not enough: the old answer cannot be focused or clicked while it is replaced.
    expect(region.hasAttribute("inert")).toBe(true);
    expect(rows().length).toBe(1);
    expect(screen.getByRole("status").textContent).toMatch(/Looking at your recent sessions/);
    expect(screen.getByRole("button", { name: "Check again" }).getAttribute("aria-disabled")).toBe("true");
    // The status is an overlay on the answer, not a line that pushes it down.
    expect(region.parentElement!.contains(screen.getByRole("status"))).toBe(true);
    expect(card.querySelector(":scope > p.gl-card-sub[role=status]")).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("false"));
    expect(scrollRegion()).toBe(region);
    expect(region.hasAttribute("data-busy")).toBe(false);
    expect(region.hasAttribute("inert")).toBe(false);
    expect(card.textContent).toContain("Game B");
  });

  it("the first ask, with no earlier answer, shows the plain looking line and no answer box", async () => {
    answer.gate = new Promise<void>(() => {});
    await ask(base);
    expect(screen.getByRole("status").textContent).toMatch(/Looking at your recent sessions/);
    expect(screen.queryByRole("region", { name: /Scrolls if there is more/ })).toBeNull();
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
  });

  it("a Check again that fails says so and drops the old answer instead of leaving it dimmed for ever", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    answer.reject = "boom";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByRole("region", { name: /Scrolls if there is more/ })).toBeNull();
  });

  it("more below: a 'More below' strip shows under the answer while text is hidden below, and goes at the end", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const region = scrollRegion();
    expect(screen.queryByTestId("paramedic-more")).toBeNull();
    sizes(region, { scrollHeight: 900, clientHeight: 448, scrollTop: 0 });
    fireEvent.scroll(region);
    expect(screen.getByTestId("paramedic-more").textContent).toBe("More below");
    // The hint is its own strip after the scroll region: not inside it, so it can never sit on its last row, and no
    // fade is drawn over the text any more.
    const strip = screen.getByTestId("paramedic-more");
    expect(region.contains(strip)).toBe(false);
    expect(region.nextElementSibling === strip || !!(region.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(strip.parentElement).toBe(region.parentElement);
    expect(screen.queryByTestId("paramedic-more-fade")).toBeNull();
    expect(document.querySelector(".gl-para-fade")).toBeNull();
    // Four pixels or fewer left is the end; five is not.
    sizes(region, { scrollHeight: 900, clientHeight: 448, scrollTop: 447 });
    fireEvent.scroll(region);
    expect(screen.queryByTestId("paramedic-more")).not.toBeNull();
    sizes(region, { scrollHeight: 900, clientHeight: 448, scrollTop: 448 });
    fireEvent.scroll(region);
    expect(screen.queryByTestId("paramedic-more")).toBeNull();
    // Content that fits has nothing below it.
    sizes(region, { scrollHeight: 300, clientHeight: 448, scrollTop: 0 });
    fireEvent.scroll(region);
    expect(screen.queryByTestId("paramedic-more")).toBeNull();
  });

  it("the hint and every chevron are at least 16 px, in the body ink, and a hint never takes a click or a height", () => {
    const svgSize = (selector: string) => px(rule(selector), "width");
    expect(svgSize(':root[data-v2="on"] .gl-para-caret svg')).toBeGreaterThanOrEqual(16);
    expect(px(rule(':root[data-v2="on"] .gl-para-caret'), "width")).toBeGreaterThanOrEqual(16);
    expect(svgSize(':root[data-v2="on"] .gl-para-more svg')).toBeGreaterThanOrEqual(16);
    expect(rule(':root[data-v2="on"] .gl-para-caret')).toMatch(/color:\s*var\(--v2-text\)/);
    expect(rule(':root[data-v2="on"] .gl-para-more')).toMatch(/color:\s*var\(--v2-text\)/);
    {
      const b = rule(':root[data-v2="on"] .gl-para-status');
      expect(b).toMatch(/position:\s*absolute/);
      expect(b).toMatch(/pointer-events:\s*none/);
    }
    // The "More below" hint is a strip in the flow under the scroll region: not absolute, so it never covers
    // text; and there is no fade rule left to draw over the last row.
    const more = rule(':root[data-v2="on"] .gl-para-more');
    expect(more).not.toMatch(/position:\s*absolute/);
    expect(more).toMatch(/pointer-events:\s*none/);
    expect(sheet).not.toMatch(/\.gl-para-fade/);
    // The glyphs are SVG now: nothing of the old 6 px text caret is left.
    const src = readFileSync(join("src", "surfaces", "glass", "ParamedicCard.tsx"), "utf8");
    expect(src).not.toMatch(/["']▾["']|["']▸["']/);
  });

  it("the chevron turns off aria-expanded and obeys the motion setting; colours are tokens only", () => {
    expect(rule(':root[data-v2="on"] [aria-expanded="true"] > .gl-para-caret svg')).toMatch(/rotate\(90deg\)/);
    expect(rule(':root[data-v2="on"][data-motion="reduced"] .gl-para-caret svg')).toMatch(/transition:\s*none/);
    expect(sheet).not.toMatch(/prefers-reduced-motion/);
    for (const s of [".gl-para-more", ".gl-para-status", ".gl-para-caret", ".gl-para-scroll"]) {
      expect(rule(`:root[data-v2="on"] ${s}`), s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  it("the box reserves its scroll bar's gutter, the card has a cap but no height of its own, and Home's scroller keeps its gutter", () => {
    expect(rule(':root[data-v2="on"] .gl-para-scroll')).toMatch(/scrollbar-gutter:\s*stable/);
    const card = rule(':root[data-v2="on"] .gl-para-card');
    expect(card).toMatch(/max-height:\s*var\(--para-card-max\)/);
    expect(card).toMatch(/--para-card-max:\s*520px/);
    expect(card).not.toMatch(/(?:^|[;\s])(?:min-)?height:/);
    expect(rule(':root[data-v2="on"] .gl-para-answer')).toMatch(/flex:\s*0 1 auto/);
    expect(rule(':root[data-v2="on"] .v2-content:has(.gl-room[data-room="home"])')).toMatch(/scrollbar-gutter:\s*stable/);
  });

  const link = () => screen.queryByRole("button", { name: "Something else? Answer a few questions" });
  const picker = () => screen.queryByRole("heading", { name: "Which game?" });
  const diagnoseCalls = () => answer.calls.filter((c) => c[0] === "paramedic_diagnose");

  it("'Something else? Answer a few questions' is only in the open card, and it opens the questions inside the card, not another room", async () => {
    answer.value = base;
    render(<ParamedicCard />);
    expect(link(), "closed bar").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(link() as HTMLElement);
    // The game question is in the same card, and the measured answer is out of the way (not stacked under it).
    await waitFor(() => expect(picker()).toBeTruthy());
    const card = screen.getByTestId("paramedic");
    expect(card.contains(picker())).toBe(true);
    expect(rows().length).toBe(0);
    expect(card.getAttribute("data-open")).toBe("true");
    // It does not say there are no earlier sessions to a user who has them, and it keeps the privacy line.
    expect(card.textContent).not.toMatch(/no earlier sessions/);
    expect(card.textContent).toContain("Pick a game, or the whole PC, and say when it started.");
    expect(screen.getByRole("button", { name: "Another game, or the whole PC" })).toBeTruthy();
    expect(screen.getByTestId("first-look-privacy").textContent).toMatch(/doesn't save it or send it anywhere/);
    // The next step is the card's own "When did it start?".
    fireEvent.click(screen.getByRole("button", { name: "Another game, or the whole PC" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "When did it start?" })).toBeTruthy());
    // Nothing was read beyond the card's own commands, and nothing was stored.
    expect(new Set(answer.calls.map((c) => c[0]))).toEqual(new Set(["paramedic_diagnose", "paramedic_list_games"]));
    expect(localStorage.length).toBe(0);
  });

  it("'Back to the answer' returns to the measured answer without asking again; 'Check again' does ask, and also returns to it", async () => {
    answer.value = base;
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    expect(link(), "the link is not offered while the questions are open").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the answer" }));
    expect(picker()).toBeNull();
    expect(rows().length).toBe(1);
    expect(screen.queryByRole("button", { name: "Back to the answer" })).toBeNull();
    expect(diagnoseCalls().length).toBe(1);
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(diagnoseCalls().length).toBe(2));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(picker()).toBeNull();
  });

  it("the way out to the questions is in every state of the card but the idle one, and opens the questions there too: first check, failed and slow", async () => {
    // The first check, still running (no answer yet).
    answer.gate = new Promise<void>(() => {});
    const first = render(<ParamedicCard />);
    expect(link(), "idle").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Looking at your recent sessions/));
    expect(link(), "first check running").toBeTruthy();
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    first.unmount();
    // A failed check.
    answer.gate = null;
    answer.reject = "boom";
    const failed = render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(link(), "after a failed check").toBeTruthy();
    failed.unmount();
    // A check that is still going when the retries run out.
    vi.useFakeTimers();
    try {
      answer.reject = "";
      answer.busyFirst = 100;
      render(<ParamedicCard />);
      fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
      for (let i = 0; i < 12; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
      expect(screen.getByRole("status").textContent).toBe("Compy is still checking. Try again in a moment.");
      expect(link(), "still checking").toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape closes the open card from inside it and puts focus back on the bar's button", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const region = scrollRegion();
    region.focus();
    expect(document.activeElement).toBe(region);
    fireEvent.keyDown(region, { key: "Escape" });
    expect(screen.queryByTestId("paramedic-verdict")).toBeNull();
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Something's wrong" }));
  });

  it("Escape also closes the card while its questions are open, and does nothing on the closed bar", async () => {
    answer.value = base;
    render(<ParamedicCard />);
    const door = screen.getByRole("button", { name: "Something's wrong" });
    fireEvent.keyDown(door, { key: "Escape" });
    expect(answer.calls.length).toBe(0);
    fireEvent.click(door);
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("button", { name: "Another game, or the whole PC" }), { key: "Escape" });
    expect(picker()).toBeNull();
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Something's wrong" }));
  });

  it("Escape inside an open disclosure keeps its normal behaviour: the card stays open", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    const btn = within(rows()[0]).getByRole("button");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("true");
    expect(rows().length).toBe(1);
    // Inside the disclosure's own body too.
    fireEvent.keyDown(screen.getByText("Your graphics driver changed from 1.0 to 2.0."), { key: "Escape" });
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("true");
    // With it closed again, the same key closes the card.
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
  });

  it("Escape while a check is running does not close the card (it would come back open)", async () => {
    await ask(base);
    await waitFor(() => expect(rows().length).toBe(1));
    let release = () => {};
    answer.gate = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(scrollRegion().getAttribute("aria-busy")).toBe("true"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Check again" }), { key: "Escape" });
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("true");
    await act(async () => {
      release();
    });
    await waitFor(() => expect(scrollRegion().getAttribute("aria-busy")).toBe("false"));
  });

  it("'Something else?' while the first check is still running opens usable questions: nothing dimmed or inert, no status over them", async () => {
    answer.gate = new Promise<void>(() => {});
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(link()).toBeTruthy());
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    const region = scrollRegion();
    expect(region.hasAttribute("inert")).toBe(false);
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(region.hasAttribute("data-busy")).toBe(false);
    expect(region.parentElement!.querySelector(".gl-para-status")).toBeNull();
    // A picker button works while the check is still running.
    const whole = screen.getByRole("button", { name: "Another game, or the whole PC" });
    fireEvent.click(whole);
    await waitFor(() => expect(screen.getByRole("heading", { name: "When did it start?" })).toBeTruthy());
    expect(screen.getByTestId("first-look-chosen").textContent).toBe("Looking at the whole PC, not one game.");
  });

  it("with the questions open over a running check, Close is offered and Escape does the same thing", async () => {
    answer.gate = new Promise<void>(() => {});
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(link()).toBeTruthy());
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Another game, or the whole PC" }), { key: "Escape" });
    expect(picker()).toBeNull();
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Something's wrong" }));
  });

  it("'Back to the answer' puts focus on the answer, so Escape still closes the card", async () => {
    answer.value = base;
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to the answer" }));
    await waitFor(() => expect(document.activeElement).toBe(scrollRegion()));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.getByTestId("paramedic").getAttribute("data-open")).toBe("false");
  });

  it("the first look's answer, reached from a card that has history, still carries the privacy line", async () => {
    answer.value = base;
    answer.byCmd = {
      paramedic_list_games: { read: true, complete: true, games: [] },
      paramedic_first_look: {
        told: { since: "today", from: "2026-11-20T00:00:00Z", to: "2026-11-20T12:00:00Z", hours: 12 },
        game: null,
        changes_listed: true,
        touch_games: [],
        other_changes: [],
        none: [],
        game_files_since: null,
        crashes: null,
        crashes_none: false,
        looks_off: [],
        mods_none: false,
        mods_settings_only: [],
        facts: [],
        compy_changes: [],
        limits: [],
        read_all: true,
        method: "paramedic-first-look-v1",
      },
    };
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(rows().length).toBe(1));
    fireEvent.click(link() as HTMLElement);
    await waitFor(() => expect(picker()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Another game, or the whole PC" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "When did it start?" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.getByTestId("first-look-told")).toBeTruthy());
    expect(screen.getByTestId("first-look-privacy").textContent).toMatch(/doesn't save it or send it anywhere/);
  });

  it("the new strings read in both languages with the same keys", () => {
    const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "paramedic.json"), "utf8")).card;
    const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "paramedic.json"), "utf8")).card;
    expect(en.moreBelow).toBe("More below");
    expect(en.somethingElse).toBe("Something else? Answer a few questions");
    expect(en.back).toBe("Back to the answer");
    expect(zh.back).not.toBe(en.back);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(zh.moreBelow).not.toBe(en.moreBelow);
  });
});

describe("ParamedicCard: recorded background load", () => {
  const load = (code: string, how: string, args: Record<string, string>, against = false): F["evidence"][number] => ({
    kind: "measured",
    code,
    args: { how, count: "1", ...args },
    against,
    source: "sessions",
  });
  const showing = async (evidence: F["evidence"], extra: Partial<ParamedicDiagnosis> = {}) => {
    await ask({ ...base, why_first: null, findings: [find("background-load", { evidence, fix: steps("background-load") })], ...extra });
    await waitFor(() => expect(rows().length).toBe(1));
  };

  it("a measured high figure retitles the finding and gives both numbers; starts alone keep the old heading", async () => {
    await showing([load("load-cpu", "high", { rough: "30", base: "2" })]);
    expect(rows()[0].textContent).toMatch(/The rest of your PC was busier than usual while you played/);
    expect(rows()[0].textContent).not.toMatch(/started while you played/);
    openAll();
    expect(screen.getByText("At their busiest (the top tenth of the session), other programs used about 30% of your processor; in normal sessions about 2%.")).toBeTruthy();
    cleanup();
    await showing([{ kind: "measured", code: "starts-seen", args: { count: "1", names: "" }, against: false, source: "sessions" }]);
    expect(rows()[0].textContent).toMatch(/Other programs started while you played/);
  });

  it("the three kinds read in their own words, singular and plural", async () => {
    await showing([
      load("load-cpu", "between", { rough: "10", base: "2", count: "2" }),
      load("load-gpu3d", "high", { rough: "40", base: "5" }),
      load("load-gpuvideo", "high", { rough: "25", base: "0", count: "2" }),
    ]);
    openAll();
    expect(screen.getByText("At their busiest (the top tenth of a session), other programs used up to about 10% of your processor in the rough sessions; in normal sessions about 2%.")).toBeTruthy();
    expect(screen.getByText("At their busiest (the top tenth of the session), other programs used about 40% of your graphics card; in normal sessions about 5%.")).toBeTruthy();
    expect(
      screen.getByText(
        "At their busiest (the top tenth of a session), other programs used up to about 25% of your graphics card's video engine (recording, streaming or video playback) in the rough sessions; in normal sessions about 0%.",
      ),
    ).toBeTruthy();
  });

  it("about the same as usual is an against line", async () => {
    await showing([load("load-cpu", "same", { rough: "4", base: "2" }, true), { kind: "measured", code: "starts-seen", args: { count: "1", names: "" }, against: false, source: "sessions" }]);
    openAll();
    const line = screen.getByText("At their busiest (the top tenth of the session), other programs used about 4% of your processor, about the same as in normal sessions (2%). Short bursts wouldn't show in this figure.");
    expect(line.closest("li")?.textContent).toMatch(/Weakens this/);
  });

  it("numbers on one side only say exactly that", async () => {
    await showing([load("load-cpu", "rough-only", { rough: "30" }), load("load-gpu3d", "base-only", { base: "6" })]);
    openAll();
    expect(
      screen.getByText("Compy recorded how much of your processor other programs used in the rough session (about 30%), but not in enough of the normal sessions it compares with."),
    ).toBeTruthy();
    expect(
      screen.getByText("Compy recorded how much of your graphics card other programs used in the normal sessions (about 6%), but not in every rough session."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Weakens this|Supports this/);
  });

  it("a figure about the same as usual sits with what Compy checked, and each recorded state has its own can't-see line", async () => {
    await ask({
      ...base,
      findings: [base.findings[0]],
      not_it: [{ id: "background-load", args: { kind: "load-gpuvideo", rough: "1", base: "0", count: "1" } }],
      unknowns: ["other-load", "other-load-rough-only", "other-load-base-only"],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(
      screen.getByText("At their busiest (the top tenth of the session), other programs used about 1% of your graphics card's video engine (recording, streaming or video playback), about the same as in normal sessions (0%). Short bursts wouldn't show in this figure."),
    ).toBeTruthy();
    expect(screen.getByText("How busy the rest of your PC was, in the rough sessions and in the normal ones (Compy recorded it in neither)")).toBeTruthy();
    expect(screen.getByText("How busy the rest of your PC was in the normal sessions Compy compares with (it recorded this only for the rough ones)")).toBeTruthy();
    expect(screen.getByText("How busy the rest of your PC was in the rough sessions (Compy recorded this only for the normal ones)")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/How busy the rest of your PC was while you played/);
  });
});


describe("ParamedicCard: programs already open at the start", () => {
  const m = (code: string, args: Record<string, string>): F["evidence"][number] => ({ kind: "measured", code, args, against: false, source: "sessions" });
  const showing = async (evidence: F["evidence"], fix: F["fix"] = steps("background-load"), extra: Partial<ParamedicDiagnosis> = {}) => {
    await ask({ ...base, why_first: null, findings: [find("background-load", { evidence, fix })], ...extra });
    await waitFor(() => expect(rows().length).toBe(1));
  };

  it("a program open at the start gets its own sentence and the counts, and the finding says so in its heading", async () => {
    await showing(
      [m("already-running", { id: "obs-studio", name: "OBS Studio" }), m("open-counts", { id: "obs-studio", r: "3", rm: "3", n: "0", nm: "4" })],
      steps("background-load", { names: "", programs: "OBS Studio" }),
    );
    expect(rows()[0].textContent).toMatch(/Other programs were already open when you started playing/);
    openAll();
    expect(screen.getByText(/OBS Studio was already running when .* started\./)).toBeTruthy();
    expect(screen.getByText("It was open in 3 of 3 rough sessions and 0 of 4 normal ones.")).toBeTruthy();
    expect(screen.getByText("Close OBS Studio before you play, then play once and press Something's wrong again.")).toBeTruthy();
  });

  it("one rough session reads in the singular, and a resident program is a counted line with no already-running sentence", async () => {
    await showing([m("open-counts-named", { id: "medal", name: "Medal", r: "1", rm: "1", n: "1", nm: "5" }), m("starts-seen", { count: "1", names: "" })]);
    openAll();
    expect(screen.getByText("Medal was open at the start of 1 of 1 rough session and 1 of 5 normal ones.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/was already running when/);
    expect(rows()[0].textContent).toMatch(/Other programs started while you played/);
  });

  it("the can't-see lines and the start-recorder notes say what they are, never that the PC was quiet", async () => {
    await ask({
      ...base,
      findings: [base.findings[0]],
      unknowns: ["running-at-start", "start-list-only"],
      seen: [
        { id: "starts-dropped", args: { n: "7" } },
        { id: "starts-skipped", args: {} },
      ],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Compy didn't record what was running when this session started.")).toBeTruthy();
    expect(screen.getByText("Compy stopped listing program starts partway through (7 more were not listed).")).toBeTruthy();
    expect(screen.getByText("Compy didn't list some program starts that happened at the same moment.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/nothing was running|was quiet/i);
  });

  it("the not-recorded load line says Compy didn't record it", async () => {
    await showing([m("load-not-recorded", { count: "2" })]);
    openAll();
    expect(screen.getByText("Compy didn't record how busy your PC was in these sessions.")).toBeTruthy();
  });
});

describe("ParamedicCard: sittings counted together", () => {
  it("says once how many times a closed-and-reopened game was counted as one session, in the singular and the plural", async () => {
    await ask({ ...base, findings: [base.findings[0]], seen: [{ id: "sitting-merged", args: { count: "1" } }] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Once, the game closed and was opened again within 10 minutes. Compy counted those launches as one session.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/crash/i);
    cleanup();
    await ask({ ...base, findings: [base.findings[0]], seen: [{ id: "sitting-merged", args: { count: "3" } }] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("3 times, the game closed and was opened again within 10 minutes. Compy counted each of those as one session.")).toBeTruthy();
  });
});


describe("ParamedicCard: what the load figure covers", () => {
  it("says once that the figure is everything except the game, and shows an in-between reading under also looked at", async () => {
    await ask({
      ...base,
      why_first: null,
      findings: [
        find("background-load", {
          evidence: [
            { kind: "measured", code: "load-cpu", args: { how: "high", count: "1", rough: "30", base: "2" }, against: false, source: "sessions" },
            { kind: "known", code: "figure-scope", args: {}, against: false, source: "sessions" },
          ],
          fix: steps("background-load"),
        }),
      ],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("This figure covers everything except the game, including Compy and Windows itself.")).toBeTruthy();
    cleanup();
    await ask({
      ...base,
      findings: [base.findings[0]],
      seen: [{ id: "load-seen", args: { kind: "load-cpu", how: "between", count: "1", rough: "25", base: "12" } }],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("At their busiest (the top tenth of the session), other programs used about 25% of your processor; in normal sessions about 12%.")).toBeTruthy();
  });
});

describe("ParamedicCard: the verdict line and the order when load leads", () => {
  const high = { kind: "measured", code: "load-cpu", args: { how: "high", count: "1", rough: "30", base: "2" }, against: false, source: "sessions" } as F["evidence"][number];
  const measuredOnly = "Compy measured something different during the rough session, but can't tie it to when the problem started.";
  const dated = "A change lines up with when it started, but Compy can't prove it.";

  it("says a change lines up with the start only when a finding in play has timing", async () => {
    await ask({ ...base, why_first: null, findings: [find("background-load", { in_play: false, evidence: [high], fix: steps("background-load") })] });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByTestId("paramedic-verdict").textContent).toBe(measuredOnly);
    expect(document.body.textContent).not.toMatch(/lines up with when it started/);
    cleanup();
    await ask({ ...base, why_first: null, findings: [find("background-load", { in_play: true, evidence: [high], fix: steps("background-load") })] });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByTestId("paramedic-verdict").textContent).toBe(dated);
  });

  it("a graphics mod with no timing keeps its own wording, never the measured one", async () => {
    await ask({ ...base, why_first: null, findings: [find("graphics-mod", { in_play: false })] });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByTestId("paramedic-verdict").textContent).not.toBe(measuredOnly);
  });

  it("the background finding leads as most likely and a possible driver change is listed under it", async () => {
    await ask({
      ...base,
      why_first: "cross-game-lead",
      findings: [
        find("background-load", { confidence: "likely", in_play: false, evidence: [high], fix: steps("background-load") }),
        find("gpu-driver-change", { confidence: "possible", in_play: true, fix: steps("gpu-driver-change", { from: "1.0", to: "2.0" }) }),
      ],
    });
    await waitFor(() => expect(rows().length).toBe(2));
    expect(screen.getByTestId("paramedic-verdict").textContent).toBe("One change lines up best with what happened. It's listed first.");
    expect(rows()[0].textContent).toMatch(/busier than usual/);
    expect(rows()[1].textContent).toMatch(/driver/i);
  });

  it("a background-load fix already ends with play once and press again: the same sentence does not follow it", async () => {
    await ask({
      ...base,
      why_first: null,
      findings: [find("background-load", { evidence: [high], fix: steps("background-load", { names: "", programs: "OBS Studio" }) })],
    });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Close OBS Studio before you play, then play once and press Something's wrong again.")).toBeTruthy();
    expect(screen.queryByText(/^Check it, play/)).toBeNull();
    cleanup();
    await ask({ ...base, why_first: null, findings: [find("background-load", { evidence: [high], fix: steps("background-load", { names: "rustc" }) })] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText(/^Play .* once with them closed, then press Something's wrong again\./)).toBeTruthy();
    expect(screen.queryByText(/^Check it, play/)).toBeNull();
    cleanup();
    // Other findings keep their closing sentence.
    await ask({ ...base, why_first: null, findings: [find("setting-drift", { fix: steps("setting-drift") })] });
    await waitFor(() => expect(rows().length).toBe(1));
    expect(screen.getByText(/^Check it, play/)).toBeTruthy();
  });
});