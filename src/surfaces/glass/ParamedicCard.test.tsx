// PC Paramedic: the card renders what the engine returned, in the states the design names, and the
// default open card is short: one-line rows, every disclosure closed (F3). The engine's answer is mocked
// (numbers and codes only); every sentence asserted here is the card's own.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown, calls: [] as unknown[][], busyFirst: 0, reject: "" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    answer.calls.push(args);
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
    await ask({ ...base, unknowns: ["drift-unreadable", "identity-unreadable"], not_it: [{ id: "memory-pressure", args: { percent: "90" } }] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.getByText("Memory: never reached 90% full in these sessions.")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("Game B has been running much rougher than usual")).toBeTruthy());
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
    expect(screen.getByText("Game A has been running much rougher than usual")).toBeTruthy();
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
    expect(screen.getByText("Programs were also seen starting in 3 rough Game B sessions (Encoder).")).toBeTruthy();
    expect(screen.getByText(/Compy can't see programs that were already running/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Compy's own|Compy started/);
  });

  it("a count of zero is not a line: no 'starts-seen' evidence means no 'had other programs starting' text", async () => {
    await ask({ ...base, why_first: null, findings: [base.findings[1]] });
    await waitFor(() => expect(rows().length).toBe(1));
    openAll();
    expect(screen.queryByText(/had other programs starting/)).toBeNull();
    expect(screen.getByText(/Compy can't see programs that were already running/)).toBeTruthy();
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
