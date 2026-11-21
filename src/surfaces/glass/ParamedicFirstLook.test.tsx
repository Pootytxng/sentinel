// The day-one answer (design M5, S1): the card mounts with no games, asks ONE question, reads what changed
// on this PC and says so in dated facts, never as a problem or a cause. The engine's answer is mocked (codes
// and numbers); every sentence asserted here is the card's own.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const engine = vi.hoisted(() => ({
  diagnose: null as unknown,
  look: null as unknown,
  calls: [] as { cmd: string; args: unknown }[],
  gate: null as Promise<void> | null,
  lookError: "",
  steam: null as unknown,
  listBusy: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    engine.calls.push({ cmd, args });
    if (cmd === "paramedic_diagnose") return Promise.resolve(engine.diagnose);
    if (cmd === "paramedic_first_look") {
      if (engine.lookError) return Promise.reject(engine.lookError);
      return engine.gate ? engine.gate.then(() => engine.look) : Promise.resolve(engine.look);
    }
    if (cmd === "paramedic_list_games") {
      if (engine.listBusy > 0) {
        engine.listBusy -= 1;
        return Promise.reject("paramedic-busy");
      }
      return Promise.resolve(engine.steam);
    }
    return Promise.resolve(null);
  },
}));

import "../../i18n";
import i18n from "../../i18n";
import type { ParamedicDiagnosis } from "../../types";
import type { CompyChange, FirstLookChange, FirstLookCrashSplit, FirstLookFact, ParamedicFirstLook as FirstLookAnswer, RecordedGame, SteamGames } from "./ParamedicFirstLook";
import { ParamedicCard } from "./ParamedicCard";

afterEach(() => {
  cleanup();
  engine.diagnose = null;
  engine.look = null;
  engine.calls.length = 0;
  engine.gate = null;
  engine.lookError = "";
  engine.steam = null;
});

const diagnosis = (state: ParamedicDiagnosis["state"]): ParamedicDiagnosis => ({
  complaint: "unknown",
  state,
  game: null,
  game_name: null,
  problem: null,
  findings: [],
  not_it: [],
  unknowns: [],
  limits: [],
  seen: [],
  baseline: null,
  first_bad: null,
  why_first: null,
  recovery: null,
  earlier_episode: null,
  mixed_sessions: [],
  method: "paramedic-rules-v1",
});

const noSessions = () => diagnosis({ kind: "cant-tell", why: { kind: "no-sessions" } });

const change = (id: string, at: string, args: Record<string, string>, how: string, precision: "exact" | "day" = "exact"): FirstLookChange => ({
  id,
  at,
  precision,
  args,
  confidence: "possible",
  evidence: "known",
  how,
});

const driver = change("gpu-driver-changed", "2026-11-19T05:12:26Z", { from: "32.0.32015.7029", to: "32.0.32029.2010" }, "gpu-driver");
const quality = change("windows-update", "2026-11-17T03:00:00Z", { kb: "KB5050000" }, "windows-update");
const programs = change("programs-installed", "2026-11-19T00:00:00Z", { count: "2", names: "Alpha, Beta", more: "0" }, "programs", "day");

const completeLimits: FirstLookAnswer["limits"] = [
  { kind: "driver", code: "classes", args: {} },
  { kind: "programs", code: "no-install-date", args: { n: "4" } },
  { kind: "game-update", code: "not-picked", args: {} },
];

const answer = (over: Partial<FirstLookAnswer> = {}): FirstLookAnswer => ({
  told: { since: "this-week", from: "2026-11-12T12:00:00Z", to: "2026-11-20T12:00:00Z", hours: 192 },
  game: null,
  changes_listed: true,
  touch_games: [driver, quality],
  other_changes: [programs],
  none: [],
  game_files_since: null,
  crashes: null,
  crashes_none: false,
  looks_off: [],
  mods_none: false,
  mods_settings_only: [],
  facts: [],
  compy_changes: [],
  running_now: { state: "not-read", programs: [], more: 0 },
  limits: completeLimits,
  read_all: true,
  method: "paramedic-first-look-v1",
  ...over,
});

const WHOLE_PC = "Another game, or the whole PC";

/** Open the card, press the door, and wait for the "Which game?" step. */
async function toThePicker(d: ParamedicDiagnosis = noSessions(), props: { noGames?: boolean; games?: RecordedGame[] } = { noGames: true }) {
  engine.diagnose = d;
  render(<ParamedicCard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Which game?" })).toBeTruthy());
}

/** Open the card, press the door, choose the whole PC (today's flow), and wait for the question. */
async function toTheQuestion(d: ParamedicDiagnosis = noSessions(), props: { noGames?: boolean; games?: RecordedGame[] } = { noGames: true }) {
  await toThePicker(d, props);
  fireEvent.click(screen.getByRole("button", { name: WHOLE_PC }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "When did it start?" })).toBeTruthy());
}

async function pick(label: string, a: FirstLookAnswer) {
  engine.look = a;
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(screen.getByTestId("first-look-told")).toBeTruthy());
}

describe("the card with no games (the question step)", () => {
  it("mounts with no games recorded and says what it is for; nothing is read until the door is pressed", () => {
    render(<ParamedicCard noGames />);
    expect(screen.getByTestId("paramedic")).toBeTruthy();
    expect(screen.getByText("A game running badly or crashing? Compy can look at what changed on this PC.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Something's wrong" })).toBeTruthy();
    expect(engine.calls).toHaveLength(0);
  });

  it("pressing the door asks the measured engine first; with no usable history it asks ONE question, not a list of questions", async () => {
    await toTheQuestion();
    expect(engine.calls[0].cmd).toBe("paramedic_diagnose");
    const group = screen.getByRole("group", { name: "When did it start?" });
    const choices = within(group).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual(["Today", "This week", "This month", "It's always been like this", "I don't know"]);
    // Nothing but the measured engine and Steam's list for the picker is asked before a time is chosen.
    expect(engine.calls.map((c) => c.cmd)).toEqual(["paramedic_diagnose", "paramedic_list_games"]);
    expect(screen.queryByText("Which game?")).toBeNull();
    // The old measured line is not shown for "no games": the first look is the whole answer.
    expect(screen.queryByText(/Compy hasn't recorded any games yet/)).toBeNull();
    // The question step says the look stays on this PC.
    expect(screen.getByTestId("first-look-privacy").textContent).toBe(
      "Compy reads this on your PC. It doesn't save it or send it anywhere, and it doesn't save what you tap.",
    );
  });

  it("is keyboard reachable: real buttons in a labelled group, none disabled or taken out of the tab order, the heading takes focus", async () => {
    await toTheQuestion();
    const heading = screen.getByRole("heading", { name: "When did it start?" });
    expect(document.activeElement).toBe(heading);
    const choices = within(screen.getByRole("group", { name: "When did it start?" })).getAllByRole("button");
    for (const b of choices) {
      expect(b.tagName).toBe("BUTTON");
      expect((b as HTMLButtonElement).disabled).toBe(false);
      expect(b.getAttribute("tabindex")).not.toBe("-1");
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("a game with too few sessions keeps the measured 'can't tell yet' line and then asks the question", async () => {
    await toThePicker(diagnosis({ kind: "needs-more-play", sessions_needed: 2, have: 1 }), {});
    expect(screen.getByText("Compy can't tell yet")).toBeTruthy();
    // The first step does not pull keyboard focus past the measured answer already on screen.
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Which game?" }));
    fireEvent.click(screen.getByRole("button", { name: WHOLE_PC }));
    expect(screen.getByRole("group", { name: "When did it start?" })).toBeTruthy();
  });

  // T1 (review F1): a user with some history is never told "no earlier sessions" or "hasn't seen a game run".
  it("a game with 1 of 3 sessions: the first look names the need, is for the whole PC, and never says there is no history", async () => {
    await toTheQuestion(diagnosis({ kind: "needs-more-play", sessions_needed: 2, have: 1 }), {});
    expect(screen.getByTestId("first-look-lead").textContent).toMatch(/^Compy has too few sessions of .* to compare yet \(1 of 3\)\.$/);
    await pick("This week", answer());
    expect(screen.getByTestId("first-look-scope").textContent).toBe("This list is for the whole PC, not one game.");
    const all = screen.getByTestId("first-look").textContent ?? "";
    expect(all).not.toMatch(/hasn't seen a game run|no earlier sessions|hasn't recorded any games/);
    expect(all).toContain("It needs about 3 sessions of the same game before it can compare.");
  });

  it("history that answers is not interrogated: the measured flow is unchanged and no question appears", async () => {
    engine.diagnose = diagnosis({ kind: "nothing-wrong", sessions_checked: 4 });
    render(<ParamedicCard />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.getByText("Nothing looks wrong")).toBeTruthy());
    expect(screen.queryByTestId("first-look")).toBeNull();
    expect(screen.queryByText("When did it start?")).toBeNull();
    expect(screen.getByText(/It doesn't claim to know the cause until a fix is checked/)).toBeTruthy();
  });
});

describe("the answer", () => {
  it("each tap asks the read-only command for the whole PC with that choice, and nothing else", async () => {
    for (const [label, since] of [
      ["Today", "today"],
      ["This week", "this-week"],
      ["This month", "this-month"],
      ["It's always been like this", "always"],
      ["I don't know", "dont-know"],
    ] as const) {
      engine.calls.length = 0;
      await toTheQuestion();
      await pick(label, answer({ told: { since, from: since === "always" ? null : "2026-11-12T12:00:00Z", to: "2026-11-20T12:00:00Z", hours: 1 } }));
      const look = engine.calls.filter((c) => c.cmd === "paramedic_first_look");
      expect(look).toHaveLength(1);
      expect(look[0].args).toEqual({ game: { kind: "whole-pc" }, since });
      cleanup();
    }
  });

  it("says what you told Compy in words, then lists dated facts grouped, with one line on how to check each", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    expect(screen.getByText("What you told Compy")).toBeTruthy();
    expect(screen.getByTestId("first-look-told").textContent).toMatch(/^You said it started this week\. Compy looked back to [A-Z][a-z]{2} \d+, in case a change came just before you noticed\.$/);
    const touch = screen.getByTestId("first-look-touch");
    expect(within(touch).getByText("Changes that touch games")).toBeTruthy();
    const lines = within(touch).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    // Newest first: the engine's order is kept (driver 19 Nov, then the update 17 Nov).
    expect(lines[0].textContent).toMatch(/^Your graphics driver changed from 32\.0\.32015\.7029 to 32\.0\.32029\.2010 on /);
    expect(lines[0].textContent).toMatch(/To see it: Device Manager/);
    expect(lines[1].textContent).toMatch(/^Windows installed KB5050000 on /);
    expect(lines[1].textContent).toMatch(/To see them: Settings, Windows Update/);
  });

  it("other changes wait in a closed disclosure; a program is 'installed or updated on {day}', never with a time", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    const fold = screen.getByRole("button", { name: "Other changes" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/were installed or updated on/)).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const row = screen.getByText(/2 programs were installed or updated on /);
    expect(row.textContent).toMatch(/^2 programs were installed or updated on [A-Z][a-z]{2} \d+: Alpha, Beta\.$/);
    expect(row.textContent).not.toMatch(/\d:\d\d/);
  });

  it("the default view fits the existing structure: a close control, closed disclosures, three rows open and the rest folded", async () => {
    const many = [1, 2, 3, 4, 5].map((n) => change("windows-update", `2026-11-1${n}T03:00:00Z`, { kb: `KB${n}` }, "windows-update"));
    await toTheQuestion();
    await pick("This week", answer({ touch_games: many }));
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(screen.getByTestId("first-look-touch")).getAllByRole("listitem")).toHaveLength(3);
    const disclosures = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(disclosures.length).toBeGreaterThanOrEqual(3);
    expect(disclosures.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(within(screen.getByTestId("first-look-touch")).getAllByRole("listitem")).toHaveLength(5);
  });

  it("minor update counts, same-version rows and the like are the engine's lines: the card words a count row without listing updates", async () => {
    const minor = change("updates-minor", "2026-11-15T03:00:00Z", { n: "6", m: "2" }, "");
    await toTheQuestion();
    await pick("This week", answer({ touch_games: [], other_changes: [minor], none: ["gpu-driver", "windows-update"] }));
    // Routine counts are not a change row: no "Other changes" disclosure, the count sits in the "couldn't see" fold.
    expect(screen.queryByRole("button", { name: "Other changes" })).toBeNull();
    const limits = screen.getByRole("button", { name: "What Compy couldn't see" });
    if (limits.getAttribute("aria-expanded") === "false") fireEvent.click(limits);
    expect(screen.getByTestId("first-look-limits").textContent).toContain(
      "Windows also installed security definition updates (6) and Store app updates (2). They are counted here, not listed.",
    );
    expect(screen.getByText("Windows recorded no graphics driver version change in this period.")).toBeTruthy();
    expect(screen.getByText("Windows Update recorded no monthly Windows update, Windows version update or driver update in this period.")).toBeTruthy();
  });

  it("'always been like this' shows no change list and says why", async () => {
    await toTheQuestion();
    await pick(
      "It's always been like this",
      answer({ told: { since: "always", from: null, to: "2026-11-20T12:00:00Z", hours: null }, changes_listed: false, touch_games: [], other_changes: [], none: [], limits: [], read_all: false }),
    );
    expect(screen.getByTestId("first-look-told").textContent).toBe("You said it has always been like this.");
    expect(screen.getByTestId("first-look-always").textContent).toBe("Changes made recently came after it started, so Compy didn't list them.");
    expect(screen.queryByTestId("first-look-touch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Other changes" })).toBeNull();
    expect(screen.queryByTestId("first-look-nothing")).toBeNull();
  });

  it("a complete read with nothing in the window says 'no dated change' and that this is not 'nothing is wrong'", async () => {
    await toTheQuestion();
    await pick("Today", answer({ touch_games: [], other_changes: [], none: ["gpu-driver", "windows-update", "programs"] }));
    expect(screen.getByTestId("first-look-nothing").textContent).toBe(
      "Compy found no dated change in this period. That doesn't mean nothing is wrong: Compy hasn't measured how any game runs.",
    );
    expect(screen.getByText("Windows recorded no graphics driver version change in this period.")).toBeTruthy();
  });

  it("an unread, partly read or late source is a limit line, never 'nothing changed'", async () => {
    await toTheQuestion();
    await pick(
      "This week",
      answer({
        touch_games: [],
        other_changes: [],
        none: ["windows-update"],
        read_all: false,
        limits: [
          { kind: "driver", code: "access-denied", args: {} },
          { kind: "programs", code: "partial-coverage", args: { from: "2026-11-18T00:00:00Z" } },
          { kind: "windows-update", code: "took-too-long", args: {} },
          { kind: "game-update", code: "not-picked", args: {} },
        ],
      }),
    );
    expect(screen.queryByTestId("first-look-nothing")).toBeNull();
    expect(screen.getByTestId("first-look-unread")).toBeTruthy();
    // The limits fold opens by itself when there is nothing else to show.
    const fold = screen.getByRole("button", { name: "What Compy couldn't see" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const text = screen.getByTestId("first-look-limits").textContent ?? "";
    expect(text).toContain("Compy couldn't see when drivers were installed: Windows needs administrator rights to show that log.");
    expect(text).toMatch(/Compy saw only part of which programs were installed: Windows' log only goes back to [A-Z][a-z]{2} \d+\./);
    expect(text).toContain("Compy couldn't see which Windows updates were installed: reading took too long, so Compy went on without it.");
    expect(text).toContain("Compy didn't look at any game's files, because no game was picked.");
    // The one complete kind is still said, for that kind only.
    expect(screen.getByText("Windows Update recorded no monthly Windows update, Windows version update or driver update in this period.")).toBeTruthy();
    expect(screen.queryByText("Windows recorded no graphics driver version change in this period.")).toBeNull();
    // Limits that hide a whole kind are said inside that kind's own group, not only in the fold (review S2).
    const inGroup = within(screen.getByTestId("first-look-touch")).getAllByTestId("first-look-group-limit").map((n) => n.textContent);
    expect(inGroup).toContain("Compy couldn't see when drivers were installed: Windows needs administrator rights to show that log.");
  });

  it("ends with what Compy can't tell yet and the one next step, and claims no measurement", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    const g = screen.getByTestId("first-look-cant-tell");
    expect(within(g).getByText("What Compy can't tell yet")).toBeTruthy();
    expect(within(g).getByText("Compy hasn't seen a game run yet, so it can't tell whether anything runs worse than before, or which of these changes matters.")).toBeTruthy();
    expect(
      within(g).getByText(
        "Compy can measure a game while you play. It needs about 3 sessions of the same game before it can compare. Start a capture in Live, play as usual, and press Check again here afterwards.",
      ),
    ).toBeTruthy();
    const all = screen.getByTestId("first-look").textContent ?? "";
    expect(all).not.toMatch(/issue|found \d|likely|caused|because of|guarantee|probably|fixed/i);
    expect(screen.getByText("Compy lists what it can see on this PC. It doesn't say why a game runs badly until it has measured it.")).toBeTruthy();
    // The privacy line closes the answer too.
    expect(screen.getByTestId("first-look-privacy")).toBeTruthy();
  });

  // T4 (review S1): two display adapters are told apart by maker; a virtual display driver is not called a graphics card.
  it("names the graphics driver by maker when two adapters changed; a virtual display driver goes under Other changes", async () => {
    const amd = change("gpu-driver-changed", "2026-11-19T05:12:26Z", { from: "1.0", to: "2.0", maker: "amd" }, "gpu-driver");
    const intel = change("gpu-driver-installed", "2026-11-18T05:12:26Z", { to: "9.9", maker: "intel" }, "gpu-driver");
    const other = change("gpu-driver-installed-bare", "2026-11-17T05:12:26Z", { maker: "other" }, "gpu-driver");
    const virt = change("display-driver-other", "2026-11-16T05:12:26Z", { count: "2" }, "other-drivers");
    await toTheQuestion();
    await pick("This week", answer({ touch_games: [amd, intel, other], other_changes: [virt] }));
    const lines = within(screen.getByTestId("first-look-touch")).getAllByRole("listitem").map((n) => n.textContent ?? "");
    expect(lines[0]).toMatch(/^Your AMD graphics driver changed from 1\.0 to 2\.0 on /);
    expect(lines[1]).toMatch(/^Windows installed Intel graphics driver 9\.9 on /);
    expect(lines[2]).toMatch(/^Windows recorded a display adapter driver install on /);
    fireEvent.click(screen.getByRole("button", { name: "Other changes" }));
    expect(screen.getByText(/^Display drivers \(2\) were installed or updated, the latest on /)).toBeTruthy();
  });

  it("a program day is the start of the local day and is shown as that day, with no time, in any time zone", async () => {
    const localMidnight = new Date(2026, 10, 19).toISOString();
    await toTheQuestion();
    await pick("This week", answer({ touch_games: [], other_changes: [change("programs-installed", localMidnight, { count: "1", names: "Alpha", more: "0" }, "programs", "day")] }));
    fireEvent.click(screen.getByRole("button", { name: "Other changes" }));
    expect(screen.getByText("1 program was installed or updated on Nov 19: Alpha.")).toBeTruthy();
  });

  it("the programs how-line says Windows keeps one date per program; none-line says 'install or update date'", async () => {
    await toTheQuestion();
    await pick("This week", answer({ touch_games: [], other_changes: [programs], none: ["programs"] }));
    fireEvent.click(screen.getByRole("button", { name: "Other changes" }));
    expect(screen.getByText(/Windows keeps one date per program, and some programs refresh it when they update themselves\./)).toBeTruthy();
  });

  // T3 (review F5): pressing "Check again" after a first look starts it over: the question, not the old window.
  it("'Check again' resets the first look to its question (no stale answer window)", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Which game?" })).toBeTruthy());
    expect(screen.queryByTestId("first-look-told")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: WHOLE_PC }));
    const group = screen.getByRole("group", { name: "When did it start?" });
    for (const b of within(group).getAllByRole("button")) expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("'Change when it started' returns to the question with the earlier choice pressed (aria-pressed)", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    fireEvent.click(screen.getByRole("button", { name: "Change when it started" }));
    const group = screen.getByRole("group", { name: "When did it start?" });
    expect(within(group).getByRole("button", { name: "This week" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("while it reads the choices are aria-disabled (not disabled) and a status says so; a tap meanwhile is ignored", async () => {
    let release: () => void = () => {};
    engine.gate = new Promise<void>((r) => (release = r));
    await toTheQuestion();
    engine.look = answer();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Looking at what changed on this PC…"));
    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("aria-disabled")).toBe("true");
    expect((today as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(today);
    expect(engine.calls.filter((c) => c.cmd === "paramedic_first_look")).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.getByTestId("first-look-told")).toBeTruthy());
  });

  it("a failed read says so plainly and offers the question again", async () => {
    await toTheQuestion();
    engine.lookError = "boom";
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Compy couldn't read its records just now. Nothing on your PC was changed."));
    expect(screen.getByRole("group", { name: "When did it start?" })).toBeTruthy();
  });

  it("works in Chinese too: the question, a dated row and the limits come from the zh-CN keys", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      engine.diagnose = noSessions();
      render(<ParamedicCard noGames />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "其他游戏，或者整台电脑" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "是从什么时候开始的？" })).toBeTruthy());
      const group = screen.getByRole("group", { name: "是从什么时候开始的？" });
      expect(within(group).getAllByRole("button")).toHaveLength(5);
      await pick("这周", answer());
      expect(screen.getByText(/你的显卡驱动在 .* 从 32\.0\.32015\.7029 变成了 32\.0\.32029\.2010。/)).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// ---- S2: "Which game?" and the first look for one game ---------------------------------------------------

const recorded: RecordedGame[] = [
  { process: "robrun.exe", name: "ROB RUN" },
  { process: "wardogs.exe", name: "Wardogs" },
];
const steamList = (names: string[], over: Partial<SteamGames> = {}): SteamGames => ({
  read: true,
  complete: true,
  games: names.map((name, i) => ({ app_id: 1000 + i, name, last_updated: null })),
  ...over,
});
/** The "couldn't see" fold opens by itself when nothing else was found: open it only when it is closed. */
const openLimits = () => {
  const b = screen.getByRole("button", { name: "What Compy couldn't see" });
  if (b.getAttribute("aria-expanded") === "false") fireEvent.click(b);
};
const gameButtons = () => within(screen.getByTestId("first-look-picker")).getAllByRole("button").map((b) => b.textContent ?? "");

const gameChange = (id: string, at: string, args: Record<string, string>, how: string): FirstLookChange => change(id, at, args, how);
const modRow = (over: Record<string, string> = {}) => gameChange("graphics-mod", "2026-11-18T10:00:00Z", { name: "OptiScaler", date: "2026-11-18T10:00:00Z", ...over }, "graphics-mod");
const gameAnswer = (over: Partial<FirstLookAnswer> = {}) =>
  answer({ game: "ROB RUN", touch_games: [], other_changes: [], none: [], limits: [], ...over });

describe("the game picker", () => {
  it("lists the games Compy has seen first (most recent first), then Steam's, and 'Another game, or the whole PC' last", async () => {
    engine.steam = steamList(["Alpha", "Beta"]);
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy());
    expect(gameButtons()).toEqual(["ROB RUN", "Wardogs", "Alpha", "Beta", WHOLE_PC]);
    expect(within(screen.getByTestId("first-look-games-seen")).getByText("Games Compy has seen")).toBeTruthy();
    expect(within(screen.getByTestId("first-look-games-steam")).getByText("Installed with Steam")).toBeTruthy();
  });

  it("a Steam game Compy has already seen is listed once, under the games Compy has seen, when the engine found it in that very folder", async () => {
    engine.steam = steamList(["Rob Run", "Alpha"]);
    (engine.steam as SteamGames).games[0].recorded = "robrun.exe";
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy());
    expect(gameButtons().filter((n) => /rob run/i.test(n))).toEqual(["ROB RUN"]);
    // The recorded program names go with the request, so the engine can match by folder.
    expect(engine.calls.find((c) => c.cmd === "paramedic_list_games")?.args).toEqual({ recorded: ["robrun.exe", "wardogs.exe"] });
  });

  it("is keyboard reachable: real buttons in labelled groups, none disabled or out of the tab order, the heading takes focus", async () => {
    engine.steam = steamList(["Alpha"]);
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Which game?" }));
    for (const b of within(screen.getByTestId("first-look-picker")).getAllByRole("button")) {
      expect(b.tagName).toBe("BUTTON");
      expect((b as HTMLButtonElement).disabled).toBe(false);
      expect(b.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("only about eight are shown, with 'Show more' and 'Show fewer' (aria-expanded); the whole-PC choice is always there", async () => {
    engine.steam = steamList(Array.from({ length: 12 }, (_, i) => `Game ${String(i + 1).padStart(2, "0")}`));
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByRole("button", { name: "Game 01" })).toBeTruthy());
    // 2 recorded + 6 Steam games are open; the other 6 wait.
    expect(gameButtons().filter((n) => n !== WHOLE_PC && !/^Show/.test(n))).toHaveLength(8);
    const more = screen.getByRole("button", { name: "Show 6 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(gameButtons().filter((n) => /^Game /.test(n))).toHaveLength(12);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fewer);
    expect(gameButtons().filter((n) => /^Game /.test(n))).toHaveLength(6);
    expect(screen.getByRole("button", { name: WHOLE_PC })).toBeTruthy();
  });

  it("a Steam library that couldn't be read says so, and is never 'no games'; the recorded games are still listed", async () => {
    engine.steam = { read: false, complete: false, games: [] };
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByTestId("first-look-steam-unread")).toBeTruthy());
    expect(screen.getByTestId("first-look-steam-unread").textContent).toBe("Compy couldn't read your Steam library.");
    expect(gameButtons()).toEqual(["ROB RUN", "Wardogs", WHOLE_PC]);
    expect(screen.queryByText("Installed with Steam")).toBeNull();
  });

  it("a command that fails is the same 'couldn't read' line; a partly read library says some games may be missing", async () => {
    engine.steam = null;
    await toThePicker();
    await waitFor(() => expect(screen.getByTestId("first-look-steam-unread")).toBeTruthy());
    cleanup();
    engine.steam = steamList(["Alpha"], { complete: false });
    await toThePicker();
    await waitFor(() => expect(screen.getByTestId("first-look-steam-partial")).toBeTruthy());
    expect(screen.getByTestId("first-look-steam-partial").textContent).toBe("Compy read only part of your Steam library, so some games may be missing.");
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
  });

  it("the choice can be changed: 'Change the game' returns to the list with the earlier pick pressed", async () => {
    engine.steam = steamList(["Alpha"]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "Wardogs" }));
    expect(screen.getByTestId("first-look-chosen").textContent).toBe("Looking at Wardogs.");
    fireEvent.click(screen.getByTestId("first-look-change-game"));
    expect(screen.getByRole("heading", { name: "Which game?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wardogs" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "ROB RUN" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    expect(screen.getByTestId("first-look-chosen").textContent).toBe("Looking at ROB RUN.");
  });

  it("a recorded game, a Steam game and the whole PC each send their own game to the read-only command", async () => {
    engine.steam = steamList(["Alpha"]);
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy());
    await (async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wardogs" }));
      await pick("This month", gameAnswer({ game: "Wardogs" }));
    })();
    // Back to the list from the answer, and on to the Steam game.
    fireEvent.click(screen.getByTestId("first-look-change-game"));
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    await pick("Today", gameAnswer({ game: "Alpha" }));
    fireEvent.click(screen.getByTestId("first-look-change-game"));
    fireEvent.click(screen.getByRole("button", { name: WHOLE_PC }));
    await pick("This week", answer());
    const sent = engine.calls.filter((c) => c.cmd === "paramedic_first_look").map((c) => c.args);
    expect(sent).toEqual([
      { game: { kind: "seen", process: "wardogs.exe" }, since: "this-month" },
      { game: { kind: "steam", app_id: 1000, name: "Alpha" }, since: "today" },
      { game: { kind: "whole-pc" }, since: "this-week" },
    ]);
  });

  it("the whole-PC choice is today's answer: the 'whole PC' scope line is kept and no game block appears", async () => {
    await toTheQuestion(diagnosis({ kind: "needs-more-play", sessions_needed: 2, have: 1 }), {});
    await pick("This week", answer());
    expect(screen.getByRole("heading", { name: "What Compy found on this PC" })).toBeTruthy();
    expect(screen.getByTestId("first-look-scope")).toBeTruthy();
    expect(screen.queryByTestId("first-look-off")).toBeNull();
    expect(screen.queryByTestId("first-look-mods-none")).toBeNull();
  });
});

describe("the first look for a picked game", () => {
  async function look(a: FirstLookAnswer, since = "This week") {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    await pick(since, a);
  }

  it("is titled with the game, says Steam's last update as a dated row under 'Changes that touch games', and not that the game updated", async () => {
    const row = gameChange("game-files", "2026-11-18T09:00:00Z", { game: "ROB RUN" }, "game-files");
    await look(gameAnswer({ touch_games: [row, driver] }));
    expect(screen.getByRole("heading", { name: "What Compy found for ROB RUN" })).toBeTruthy();
    expect(screen.queryByTestId("first-look-scope")).toBeNull();
    const rows = within(screen.getByTestId("first-look-touch")).getAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/^Steam changed ROB RUN's files on [A-Z][a-z]{2} \d+, .*\. That can be an update, a file check or added content\.$/);
    expect(rows[0].textContent).not.toMatch(/updated/i);
  });

  it("an update Steam hasn't installed yet is said once under the row", async () => {
    const row = gameChange("game-files", "2026-11-18T09:00:00Z", { game: "ROB RUN", pending: "true" }, "game-files");
    await look(gameAnswer({ touch_games: [row] }));
    expect(screen.getByText("Steam also shows a newer version of ROB RUN that isn't installed yet.")).toBeTruthy();
  });

  it("a Steam update older than the window is Steam's record, in the measured flow's own sentence", async () => {
    await look(gameAnswer({ game_files_since: "2026-09-02T09:00:00Z", none: ["gpu-driver"], limits: [{ kind: "game-update", code: "steam-newest-only", args: {} }] }));
    expect(screen.getByTestId("first-look-game-files-since").textContent).toMatch(/^Steam hasn't recorded a change to ROB RUN's files since [A-Z][a-z]{2} \d+\.$/);
    // Steam keeps only the newest time, and that limit is in the fold.
    openLimits();
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Steam keeps only the latest date its files changed for ROB RUN, so an earlier change in this period wouldn't show.");
  });

  it("crash history is the first block under 'What looks off on this PC', with 'at least' for a partial read", async () => {
    await look(
      gameAnswer({
        crashes: { args: { n: "3", since: "2026-11-02T10:00:00Z", partial: "true", byName: "false", versions: "" }, signature_module: "UnityPlayer.dll", signature_before: "2026-11-19T05:12:26Z", split: null },
        looks_off: [modRow()],
      }),
    );
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getByText("What looks off on this PC")).toBeTruthy();
    const crashes = within(block).getByTestId("first-look-crashes");
    // The crash block comes before any other fact in the block.
    expect(crashes.compareDocumentPosition(within(block).getByTestId("first-look-rows")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(crashes.textContent).toMatch(/^Windows' crash records that Compy could read show ROB RUN closing unexpectedly at least 3 times\. The oldest of these is from [A-Z][a-z]{2} \d+\./);
    expect(crashes.textContent).toMatch(/All the crashes Compy could read stopped in the same file \(UnityPlayer\.dll\), and some happened before the earliest dated change Compy found \([A-Z][a-z]{2} \d+\), so that change can't be the whole story for them\.$/);
  });

  it("the same-signature sentence is said only when the engine sent a signature; a single crash and 'matched by program name' use the measured flow's words", async () => {
    await look(
      gameAnswer({ crashes: { args: { n: "1", since: "2026-11-02T10:00:00Z", partial: "false", byName: "true", versions: "2" }, signature_module: null, signature_before: null, split: null } }),
    );
    const text = screen.getByTestId("first-look-crashes").textContent ?? "";
    expect(text).toMatch(/^ROB RUN has closed unexpectedly once, on [A-Z][a-z]{2} \d+\. \(matched by program name\) These crashes are across 2 versions of the game\.$|^ROB RUN has closed unexpectedly once, on [A-Z][a-z]{2} \d+\.\s?\(matched by program name\)/);
    expect(text).not.toMatch(/same signature/);
  });

  it("no crash record in a complete read is said as that; a partial or unreadable read is a limit, never 'no crashes'", async () => {
    await look(gameAnswer({ crashes_none: true }));
    expect(screen.getByTestId("first-look-crashes-none").textContent).toBe("Windows has no crash record for ROB RUN in the records Compy read.");
    cleanup();
    await look(gameAnswer({ limits: [{ kind: "crashes", code: "partial", args: {} }], read_all: false }));
    expect(screen.queryByTestId("first-look-crashes-none")).toBeNull();
    openLimits();
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Compy could only read some of Windows' crash records, and found none for ROB RUN in those.");
  });

  it("a graphics mod whose loader file is dated in the window sits under 'Changes that touch games', in the measured flow's words, with its dates", async () => {
    await look(gameAnswer({ touch_games: [modRow({ settings: "2026-11-19T10:00:00Z" })] }), "This week");
    const row = within(screen.getByTestId("first-look-touch")).getByRole("listitem");
    expect(row.textContent).toContain("ROB RUN's folder contains a graphics mod (OptiScaler)");
    expect(row.textContent).toMatch(/Files of this mod were created in this folder around [A-Z][a-z]{2} \d+ \(Windows resets this date/);
    expect(row.textContent).toMatch(/Its settings file was last changed on [A-Z][a-z]{2} \d+\./);
    expect(row.textContent).toContain("Compy can't tell whether it is turned on.");
    expect(row.textContent).not.toMatch(/caused|installed on|is active|is on\b/i);
  });

  it("any other graphics-mod fact is under 'What looks off on this PC' with its dates, a settings file alone is one line, and 'no known mod' is its own line", async () => {
    await look(gameAnswer({ looks_off: [modRow()], mods_settings_only: ["ReShade"], mods_none: false }));
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getByText(/ROB RUN's folder contains a graphics mod \(OptiScaler\)/)).toBeTruthy();
    // A settings or data file alone is not something "off": it is said beside what Compy also looked at.
    expect(within(block).queryByTestId("first-look-mod-settings-only")).toBeNull();
    openLimits();
    expect(within(screen.getByTestId("first-look-limits")).getByTestId("first-look-mod-settings-only").textContent).toBe(
      "ROB RUN's folder contains a settings or data file from ReShade; Compy can't tell whether the mod itself is installed.",
    );
    cleanup();
    await look(gameAnswer({ mods_none: true }));
    expect(screen.getByTestId("first-look-mods-none").textContent).toBe("No known graphics mod found in ROB RUN's folder.");
  });

  it("a partly scanned or unscanned folder is a limit in the measured flow's words, never 'no mod'", async () => {
    await look(gameAnswer({ limits: [{ kind: "mods", code: "partial", args: {} }, { kind: "mods", code: "no-folder", args: {} }], read_all: false }));
    expect(screen.queryByTestId("first-look-mods-none")).toBeNull();
    openLimits();
    const text = screen.getByTestId("first-look-limits").textContent ?? "";
    expect(text).toContain("Whether ROB RUN's folder has a graphics mod (only part of the folder was scanned)");
    expect(text).toContain("Whether ROB RUN's folder has a graphics mod (Compy couldn't match the game to an install folder)");
  });

  it("a game Steam can't be read for says what it couldn't see, inside the group of changes that touch games", async () => {
    await look(gameAnswer({ limits: [{ kind: "game-update", code: "steam-unreadable", args: {} }], read_all: false }));
    const inGroup = within(screen.getByTestId("first-look-touch")).getAllByTestId("first-look-group-limit").map((n) => n.textContent);
    expect(inGroup).toContain("Compy couldn't see Steam's record of ROB RUN's files: Steam's library files couldn't be read.");
  });

  it("the blocks come in a fixed order: told, what looks off, changes that touch games, other changes, limits, what Compy can't tell", async () => {
    await look(
      gameAnswer({
        touch_games: [driver],
        other_changes: [programs],
        crashes: { args: { n: "2", since: "2026-11-02T10:00:00Z", partial: "false", byName: "false", versions: "" }, signature_module: null, signature_before: null, split: null },
        limits: [{ kind: "driver", code: "access-denied", args: {} }],
        read_all: false,
      }),
    );
    const order = [
      screen.getByTestId("first-look-told"),
      screen.getByTestId("first-look-off"),
      screen.getByTestId("first-look-touch"),
      screen.getByTestId("first-look-other"),
      screen.getByTestId("first-look-limits"),
      screen.getByTestId("first-look-cant-tell"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `block ${i}`).toBeTruthy();
  });

  it("the default view keeps its folds closed and its rows capped, and offers 'Change the game'", async () => {
    await look(gameAnswer({ touch_games: [1, 2, 3, 4].map((n) => change("windows-update", `2026-11-1${n}T03:00:00Z`, { kb: `KB${n}` }, "windows-update")), other_changes: [programs], limits: completeLimits }));
    expect(within(screen.getByTestId("first-look-touch")).getAllByRole("listitem")).toHaveLength(3);
    const disclosures = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(disclosures.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(screen.getByTestId("first-look-change-game")).toBeTruthy();
  });

  it("works in Chinese: the picker and a game's title come from the zh-CN keys", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      engine.diagnose = noSessions();
      engine.steam = steamList([]);
      render(<ParamedicCard games={recorded} />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
      await pick("这周", gameAnswer());
      expect(screen.getByRole("heading", { name: "Compy 对 ROB RUN 的发现" })).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// ---- S3: what looks off on this PC, and Compy's own changes ----------------------------------------------

const fact = (id: string, args: Record<string, string> = {}): FirstLookFact => ({ id, args });
const compy = (title: string, at: string, over: Partial<CompyChange> = {}): CompyChange => ({ title, at, undone: false, undone_at: null, ...over });

describe("what looks off on this PC", () => {
  async function wholePc(a: FirstLookAnswer) {
    await toTheQuestion();
    await pick("This week", a);
  }

  const cases: [FirstLookFact, RegExp, RegExp][] = [
    [fact("monitor-refresh", { now: "60", max: "250" }), /^Your main monitor is running at 60 Hz; at this resolution it supports 250 Hz\./, /Advanced display/],
    [fact("memory-speed", { now: "4800", rated: "6000" }), /^Your memory is running at 4800 MHz; your PC's firmware lists it as capable of 6000 MHz\./, /Task Manager, Performance, Memory/],
    [fact("memory-one-stick"), /^Your PC has 1 memory module, so memory runs in single-channel\./, /memory slots are used/],
    [fact("memory-one-channel", { n: "2" }), /^Your 2 memory modules all report the same memory channel/, /memory slots are used/],
    [fact("drive-health", { drive: "WD Blue", health: "Warning" }), /^Windows reports the health of WD Blue as Warning\./, /Disks & volumes/],
    [fact("game-on-hdd", { drive: "D" }), /^ROB RUN is installed on drive D:, which is a hard disk \(HDD\)\./, /HDD or an SSD/],
    [fact("gpu-driver-age", { days: "412", date: "2025-10-05T12:00:00Z" }), /^Your graphics driver is dated [A-Z][a-z]{2} \d+, 412 days ago\.$/, /Driver tab/],
    [fact("freesync-off"), /^Your AMD graphics card reports FreeSync as off\./, /AMD Software, Gaming, Display/],
    [fact("on-battery"), /^This PC is running on battery\./, /battery icon/],
    [fact("game-drive-full", { drive: "D", free_gb: "12.0", total_gb: "500.0" }), /^Drive D:, where ROB RUN is installed, has 12\.0 GB free of 500\.0 GB\./, /Settings, System, Storage/],
  ];

  it.each(cases)("%# says its reading with the number and exactly one line on how to check it", async (f, sentence, how) => {
    await wholePc(gameAnswer({ facts: [f] }));
    const row = within(screen.getByTestId("first-look-off")).getByRole("listitem");
    const [said, check, ...more] = within(row).getAllByText(/./).map((n) => n.textContent ?? "");
    expect(said).toMatch(sentence);
    expect(check).toMatch(how);
    expect(check.startsWith("To check: ")).toBe(true);
    expect(more).toEqual([]);
  });

  it("is a block with a once-only note, and the facts keep the engine's order", async () => {
    await wholePc(gameAnswer({ facts: [fact("monitor-refresh", { now: "60", max: "250" }), fact("memory-speed", { now: "4800", rated: "6000" })] }));
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getByText("What looks off on this PC")).toBeTruthy();
    expect(within(block).getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      expect.stringMatching(/^Your main monitor is running at 60 Hz/),
      expect.stringMatching(/^Your memory is running at 4800 MHz/),
    ]);
    expect(within(block).getAllByTestId("first-look-facts-note")).toHaveLength(1);
    expect(screen.getByTestId("first-look-facts-note").textContent).toBe(
      "Compy read these on this PC just now. It hasn't measured whether any of them changes how a game runs.",
    );
  });

  it("a healthy PC has no block and no note", async () => {
    await wholePc(gameAnswer());
    expect(screen.queryByTestId("first-look-off")).toBeNull();
    expect(screen.queryByTestId("first-look-facts-note")).toBeNull();
  });

  it("three facts are open and the rest wait behind a closed fold", async () => {
    const many = [1, 2, 3, 4, 5].map((n) => fact("drive-health", { drive: `Drive ${n}`, health: "Warning" }));
    await wholePc(gameAnswer({ facts: many }));
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getAllByRole("listitem")).toHaveLength(3);
    const more = within(block).getByRole("button", { name: "Show 2 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(within(block).getAllByRole("listitem")).toHaveLength(5);
  });

  it("hardware still being read is said in the block, once, and the block is not empty or silent", async () => {
    await wholePc(gameAnswer({ limits: [{ kind: "facts", code: "hardware-not-ready", args: {} }], read_all: true }));
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getByTestId("first-look-facts-waiting").textContent).toBe("Compy is still reading this PC's hardware.");
    expect(within(block).queryAllByRole("listitem")).toHaveLength(0);
    // Said once: not repeated in the limits fold.
    expect(screen.queryByTestId("first-look-limits")).toBeNull();
    expect(screen.getAllByText("Compy is still reading this PC's hardware.")).toHaveLength(1);
  });

  it("a reading Compy couldn't make is one limit line naming it, in the fold", async () => {
    await wholePc(gameAnswer({ limits: [{ kind: "facts", code: "unread", args: { list: "monitor-refresh,power-source,game-drive" } }] }));
    const fold = screen.getByRole("button", { name: "What Compy couldn't see" });
    if (fold.getAttribute("aria-expanded") === "false") fireEvent.click(fold);
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Compy couldn't read: the main monitor's refresh rate, the power source, the game's drive.");
    expect(screen.queryByTestId("first-look-off")).toBeNull();
  });

  it("in a game's answer the order is crash history, graphics mods, then the PC's facts, in one block (a settings file alone is not in it)", async () => {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    await pick(
      "This week",
      gameAnswer({
        crashes: { args: { n: "2", since: "2026-11-02T10:00:00Z", partial: "false", byName: "false", versions: "" }, signature_module: null, signature_before: null, split: null },
        looks_off: [modRow()],
        facts: [fact("on-battery")],
      }),
    );
    const block = screen.getByTestId("first-look-off");
    const parts = [within(block).getByTestId("first-look-crashes"), within(block).getByTestId("first-look-rows"), within(block).getByTestId("first-look-facts")];
    for (let i = 1; i < parts.length; i++) expect(parts[i - 1].compareDocumentPosition(parts[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `part ${i}`).toBeTruthy();
  });

  it("no fact says why a game runs badly or tells the user what to do: only a reading and how to check it", async () => {
    const all = cases.map(([f]) => f);
    await wholePc(gameAnswer({ facts: all.slice(0, 3) }));
    for (const lang of ["en", "zh-CN"]) {
      const j = JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "paramedic.json"), "utf8")).firstLook as Record<string, Record<string, string>>;
      for (const [k, v] of [...Object.entries(j.fact), ...Object.entries(j.factHow)]) {
        expect(v, `${lang} ${k}`).not.toMatch(/\b(should|try|enable|disable|turn on|turn off|update|upgrade|replace|buy|fix|slow|cause|why)\b|应该|建议|请|尝试|升级|更换|购买/i);
      }
    }
  });
});

describe("changes Compy made", () => {
  async function wholePc(a: FirstLookAnswer) {
    await toTheQuestion();
    await pick("This week", a);
  }

  it("is its own first group, with dates and one 'undo it in History' line, and no button", async () => {
    await wholePc(gameAnswer({ compy_changes: [compy("Turn off Game DVR", "2026-11-18T10:00:00Z")], touch_games: [driver] }));
    const group = screen.getByTestId("first-look-compy");
    expect(within(group).getByText("Changes Compy made")).toBeTruthy();
    expect(within(group).getByRole("listitem").textContent).toMatch(/^Compy changed “Turn off Game DVR” on [A-Z][a-z]{2} \d+/);
    expect(within(group).getByText("Changes that History lists as applied can be undone there.")).toBeTruthy();
    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    // The first group: before the changes that touch games.
    expect(group.compareDocumentPosition(screen.getByTestId("first-look-touch")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(screen.getByTestId("first-look-told")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("a change that was turned back says so, with the date when the ledger has one", async () => {
    await wholePc(
      gameAnswer({
        compy_changes: [
          compy("Tweak A", "2026-11-18T10:00:00Z", { undone: true, undone_at: "2026-11-19T08:00:00Z" }),
          compy("Tweak B", "2026-11-17T10:00:00Z", { undone: true }),
        ],
      }),
    );
    const rows = within(screen.getByTestId("first-look-compy")).getAllByRole("listitem").map((n) => n.textContent ?? "");
    expect(rows[0]).toMatch(/^Compy changed “Tweak A” on [A-Z][a-z]{2} \d+.*, and it was undone on [A-Z][a-z]{2} \d+/);
    expect(rows[1]).toMatch(/, and it has since been undone\.$/);
  });

  it("three are open and the rest wait behind a closed fold; none means no group", async () => {
    await wholePc(gameAnswer({ compy_changes: [1, 2, 3, 4].map((n) => compy(`Tweak ${n}`, `2026-11-1${n}T10:00:00Z`)) }));
    expect(within(screen.getByTestId("first-look-compy")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Show 1 more" }).getAttribute("aria-expanded")).toBe("false");
    cleanup();
    await wholePc(gameAnswer());
    expect(screen.queryByTestId("first-look-compy")).toBeNull();
  });

  it("is itself a finding: a window with only Compy's own change is not 'no dated change'", async () => {
    await wholePc(gameAnswer({ compy_changes: [compy("Tweak", "2026-11-18T10:00:00Z")], none: ["gpu-driver"] }));
    expect(screen.queryByTestId("first-look-nothing")).toBeNull();
  });

  it("a ledger that couldn't be read is a limit line in the card's words", async () => {
    await wholePc(gameAnswer({ limits: [{ kind: "history", code: "unreadable", args: {} }], read_all: false }));
    const fold = screen.getByRole("button", { name: "What Compy couldn't see" });
    if (fold.getAttribute("aria-expanded") === "false") fireEvent.click(fold);
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Compy couldn't read its own change history.");
    expect(screen.queryByTestId("first-look-compy")).toBeNull();
  });

  it("the blocks keep one fixed order: told, what looks off, Compy's changes, changes that touch games, other changes, limits, can't tell", async () => {
    await wholePc(
      gameAnswer({
        compy_changes: [compy("Tweak", "2026-11-18T10:00:00Z")],
        touch_games: [driver],
        facts: [fact("on-battery")],
        other_changes: [programs],
        limits: [{ kind: "driver", code: "access-denied", args: {} }],
        read_all: false,
      }),
    );
    const order = [
      screen.getByTestId("first-look-told"),
      screen.getByTestId("first-look-off"),
      screen.getByTestId("first-look-compy"),
      screen.getByTestId("first-look-touch"),
      screen.getByTestId("first-look-other"),
      screen.getByTestId("first-look-limits"),
      screen.getByTestId("first-look-cant-tell"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `block ${i}`).toBeTruthy();
  });

  it("works in Chinese: a fact, its check line and Compy's change come from the zh-CN keys", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      engine.diagnose = noSessions();
      render(<ParamedicCard noGames />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "其他游戏，或者整台电脑" }));
      await pick("这周", gameAnswer({ facts: [fact("monitor-refresh", { now: "60", max: "250" })], compy_changes: [compy("Tweak", "2026-11-18T10:00:00Z")] }));
      expect(screen.getByText("你的主显示器正以 60 Hz 运行；在当前分辨率下它支持 250 Hz。")).toBeTruthy();
      expect(screen.getByText(/^查看方法：设置，系统，显示/)).toBeTruthy();
      expect(screen.getByText(/^Compy 在 .* 更改了“Tweak”。$/)).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// The words the honesty rules forbid, over every first-look string in both languages (design M5 C, CLAUDE.md).
describe("first-look strings", () => {
  const load = (lang: string) => JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "paramedic.json"), "utf8")).firstLook as Record<string, unknown>;
  const flat = (o: unknown, prefix = ""): [string, string][] =>
    typeof o === "string" ? [[prefix, o]] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k));
  // "causing" appears once, negated, in the design's own footer sentence; no string may call anything a cause or a verdict.
  const banned = /\bcaused\b|because of|\bfixed\b|probably|issues? found|\bguarantee|原因|导致|造成|保证|很可能|大概/i;

  it("en and zh-CN have exactly the same keys, and the same placeholders per key", () => {
    const en = flat(load("en"));
    const zh = flat(load("zh-CN"));
    expect(zh.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    const zhMap = new Map(zh);
    for (const [k, v] of en) expect(ph(zhMap.get(k) ?? ""), k).toBe(ph(v));
  });

  it("no first-look string carries a causal or verdict word, or a tally like '3 issues found'", () => {
    for (const lang of ["en", "zh-CN"]) {
      for (const [k, v] of flat(load(lang))) {
        expect(v, `${lang} ${k}`).not.toMatch(banned);
        expect(v, `${lang} ${k}`).not.toMatch(/\d+\s+(issues?|problems?|errors?) (found|detected)/i);
      }
    }
  });
});

describe("first-look review r1", () => {
  async function lookAs(a: FirstLookAnswer, label: string, game = "ROB RUN") {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: game }));
    await pick(label, a);
  }
  const alwaysTold = { since: "always" as const, from: null, to: "2026-11-20T12:00:00Z", hours: null };
  const crashes = { args: { n: "26", since: "2026-11-10T19:17:16Z", partial: "true" }, signature_module: "UnityPlayer.dll", signature_before: null, split: null };

  it("'it's always been like this' still shows what was read: the crash line, a fact and the facts limit", async () => {
    await lookAs(
      gameAnswer({ told: alwaysTold, changes_listed: false, crashes, facts: [fact("on-battery")], limits: [{ kind: "facts", code: "unread", args: { list: "power-source" } }], read_all: false }),
      "It's always been like this",
    );
    expect(screen.getByTestId("first-look-always")).toBeTruthy();
    const block = screen.getByTestId("first-look-off");
    expect(within(block).getByTestId("first-look-crashes").textContent).toContain("at least 26 times");
    expect(within(block).getByTestId("first-look-facts").textContent).toContain("This PC is running on battery.");
    openLimits();
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Compy couldn't read: the power source.");
    // No change list was made, by choice.
    expect(screen.queryByTestId("first-look-touch")).toBeNull();
    expect(screen.queryByTestId("first-look-nothing")).toBeNull();
  });

  it("'always' with hardware still being read says so in the block", async () => {
    await lookAs(gameAnswer({ told: alwaysTold, changes_listed: false, limits: [{ kind: "facts", code: "hardware-not-ready", args: {} }], read_all: false }), "It's always been like this");
    expect(within(screen.getByTestId("first-look-off")).getByTestId("first-look-facts-waiting").textContent).toBe("Compy is still reading this PC's hardware.");
  });

  it("the undo hint appears only when a listed change is still in place, and an undone one says 'undone'", async () => {
    const hint = "Changes that History lists as applied can be undone there.";
    const undone = [compy("A", "2026-11-18T10:00:00Z", { undone: true, undone_at: "2026-11-19T08:00:00Z" }), compy("B", "2026-11-17T10:00:00Z", { undone: true })];
    await lookAs(gameAnswer({ compy_changes: undone }), "This week");
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.getByTestId("first-look-compy").textContent).not.toMatch(/turned back/);
    cleanup();
    await lookAs(gameAnswer({ compy_changes: [...undone, compy("C", "2026-11-16T10:00:00Z")] }), "This week");
    expect(screen.getAllByText(hint)).toHaveLength(1);
  });

  it("no Steam sentence in this flow says the game was updated", async () => {
    const row = gameChange("game-files", "2026-11-18T09:00:00Z", { game: "ROB RUN", pending: "true" }, "game-files");
    await lookAs(
      gameAnswer({ touch_games: [row], game_files_since: "2026-10-01T00:00:00Z", limits: [{ kind: "game-update", code: "steam-newest-only", args: {} }, { kind: "game-update", code: "steam-no-time", args: {} }] }),
      "This week",
    );
    openLimits();
    const text = (screen.getByTestId("first-look-touch").textContent ?? "") + (screen.getByTestId("first-look-limits").textContent ?? "");
    expect(text).toContain("Steam changed ROB RUN's files on");
    expect(text).toContain("Steam hasn't recorded a change to ROB RUN's files since");
    expect(text).toContain("Steam's record has no usable date for when the files changed");
    expect(text).not.toMatch(/last updated|update time|updated/i);
  });

  it("the Steam strings of the first look never say 'updated' in en, or 'the latest update' in zh-CN", () => {
    for (const lang of ["en", "zh-CN"]) {
      const j = JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "paramedic.json"), "utf8")).firstLook as Record<string, unknown>;
      const walk = (o: unknown, path: string): [string, string][] =>
        typeof o === "string" ? [[path, o]] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => walk(v, `${path}.${k}`));
      for (const [k, v] of walk(j, "firstLook").filter(([, v]) => /steam/i.test(v))) {
        expect(v, `${lang} ${k}`).not.toMatch(lang === "en" ? /\bupdated\b|update time/i : /最近一次更新|更新时间|更新了/);
      }
    }
  });

  it("a history that couldn't be read is one plain line, never an empty list", async () => {
    await lookAs(gameAnswer({ limits: [{ kind: "history", code: "unreadable", args: {} }], read_all: false }), "This week");
    openLimits();
    expect(screen.getByTestId("first-look-limits").textContent).toContain("Compy couldn't read its own change history.");
    expect(screen.queryByTestId("first-look-compy")).toBeNull();
  });

  it("limit reasons are true: a reader that stopped, a game with no folder, and other mods after a partial scan", async () => {
    await lookAs(
      gameAnswer({
        limits: [
          { kind: "mods", code: "reader-failed", args: {} },
          { kind: "crashes", code: "no-folder", args: {} },
          { kind: "crashes", code: "reader-failed", args: {} },
          { kind: "mods", code: "partial", args: { other: "true" } },
        ],
        read_all: false,
      }),
      "This week",
    );
    openLimits();
    const text = screen.getByTestId("first-look-limits").textContent ?? "";
    expect(text).toContain("Whether ROB RUN's folder has a graphics mod (the reader stopped unexpectedly)");
    expect(text).toContain("Whether ROB RUN has closed unexpectedly before (Compy couldn't match the game to an install folder)");
    expect(text).toContain("Whether ROB RUN has closed unexpectedly before (the reader stopped unexpectedly)");
    expect(text).toContain("Whether ROB RUN's folder has other graphics mods (only part of the folder was scanned)");
    expect(text).not.toContain("looking took too long");
  });

  it("the drive-health word is translated in zh-CN, and any other value is shown as Windows gave it", async () => {
    await lookAs(gameAnswer({ facts: [fact("drive-health", { drive: "WD Blue", health: "Degraded" })] }), "This week");
    expect(screen.getByText("Windows reports WD Blue: Degraded.")).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("zh-CN");
    try {
      engine.diagnose = noSessions();
      engine.steam = steamList([]);
      render(<ParamedicCard noGames />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "其他游戏，或者整台电脑" }));
      await pick("这周", gameAnswer({ facts: [fact("drive-health", { drive: "WD Blue", health: "Warning" })] }));
      expect(screen.getByText("Windows 报告 WD Blue 的健康状态为 警告。")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("no Steam on this PC: no Steam section and no error line; a real read failure still says so", async () => {
    engine.steam = { read: true, complete: true, games: [] };
    await toThePicker(noSessions(), { games: recorded });
    await waitFor(() => expect(screen.queryByText("Looking for your installed Steam games…")).toBeNull());
    expect(screen.queryByTestId("first-look-steam-unread")).toBeNull();
    expect(screen.queryByText("Installed with Steam")).toBeNull();
    expect(gameButtons()).toEqual(["ROB RUN", "Wardogs", WHOLE_PC]);
  });

  const steamEntry = (id: number, name: string, drive: string, recordedAs?: string) => ({ app_id: id, name, last_updated: null, drive, recorded: recordedAs ?? null });

  it("two Steam games of one name both stay, told apart by their drive; a recorded game of that name merges only by folder", async () => {
    engine.steam = { read: true, complete: true, games: [steamEntry(1, "DOOM", "D"), steamEntry(2, "DOOM", "E")] };
    await toThePicker(noSessions(), { games: [{ process: "DOOMx64.exe", name: "DOOM" }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "DOOM (D:)" })).toBeTruthy());
    // No folder match: nothing merges on the name alone.
    expect(gameButtons()).toEqual(["DOOM", "DOOM (D:)", "DOOM (E:)", WHOLE_PC]);
    cleanup();
    engine.steam = { read: true, complete: true, games: [steamEntry(1, "DOOM", "D", "DOOMx64.exe"), steamEntry(2, "DOOM", "E")] };
    await toThePicker(noSessions(), { games: [{ process: "DOOMx64.exe", name: "DOOM" }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "DOOM (E:)" })).toBeTruthy());
    expect(gameButtons()).toEqual(["DOOM", "DOOM (E:)", WHOLE_PC]);
  });

  it("with many recorded games at least three Steam games still show before 'Show more'", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ process: `r${i}.exe`, name: `Recorded ${String(i + 1).padStart(2, "0")}` }));
    engine.steam = steamList(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]);
    await toThePicker(noSessions(), { games: many });
    await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy());
    const shown = gameButtons();
    expect(shown.filter((n) => /^Recorded/.test(n))).toHaveLength(5);
    expect(shown.filter((n) => ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].includes(n))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(screen.getByRole("button", { name: "Show 7 more" })).toBeTruthy();
  });
});

describe("first-look review r2", () => {
  async function lookAs(a: FirstLookAnswer, label: string) {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    await pick(label, a);
  }

  it("the crash lines come first in what looks off, and what looks off comes right after what the user told Compy", async () => {
    await lookAs(
      gameAnswer({
        crashes: { args: { n: "2", since: "2026-11-02T10:00:00Z" }, signature_module: "UnityPlayer.dll", signature_before: "2026-11-15T13:44:49Z", split: null },
        facts: [fact("on-battery")],
        looks_off: [modRow()],
        compy_changes: [compy("Tweak", "2026-11-18T10:00:00Z")],
        touch_games: [driver],
      }),
      "This week",
    );
    const off = screen.getByTestId("first-look-off");
    expect(screen.getByTestId("first-look-told").parentElement!.compareDocumentPosition(off) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(off.compareDocumentPosition(screen.getByTestId("first-look-compy")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const first = off.querySelector("[data-testid]") as HTMLElement;
    expect(first.getAttribute("data-testid")).toBe("first-look-crashes");
    // No "signature" jargon: the crashes stopped in the same file.
    expect(off.textContent).toContain("stopped in the same file (UnityPlayer.dll)");
    expect(off.textContent).not.toMatch(/signature/i);
  });

  it("'always' also says no known graphics mod was found when the scan was complete", async () => {
    await lookAs(
      gameAnswer({ told: { since: "always", from: null, to: "2026-11-20T12:00:00Z", hours: null }, changes_listed: false, mods_none: true }),
      "It's always been like this",
    );
    expect(screen.getByTestId("first-look-mods-none").textContent).toBe("No known graphics mod found in ROB RUN's folder.");
  });

  it("a game whose folder is unknown says so instead of 'couldn't read the drive'", async () => {
    await lookAs(gameAnswer({ limits: [{ kind: "facts", code: "no-game-folder", args: {} }], read_all: false }), "This week");
    openLimits();
    const text = screen.getByTestId("first-look-limits").textContent ?? "";
    expect(text).toContain("Compy doesn't know where ROB RUN is installed, so it couldn't check its drive or folder.");
    expect(text).not.toContain("the game's drive");
  });

  it("the picker asks again when the engine answers BUSY, and does not call a busy answer a failed read", async () => {
    try {
      engine.steam = steamList(["Alpha"]);
      engine.listBusy = 1;
      await toThePicker(noSessions(), { games: recorded });
      await waitFor(() => expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy(), { timeout: 4000 });
      expect(screen.queryByTestId("first-look-steam-unread")).toBeNull();
      expect(engine.calls.filter((c) => c.cmd === "paramedic_list_games").length).toBeGreaterThanOrEqual(2);
    } finally {
      engine.listBusy = 0;
    }
  });
});

// ---- S4 and S5: programs running right now, and the crash records before and after the earliest change ------

describe("running right now (S4)", () => {
  const running = (over: Partial<FirstLookAnswer["running_now"]> = {}): FirstLookAnswer["running_now"] => ({
    state: "listed",
    programs: [
      { id: "medal", name: "Medal" },
      { id: "obs-studio", name: "OBS Studio" },
    ],
    more: 0,
    ...over,
  });
  const block = () => screen.getByTestId("first-look-running");

  it("lists the known programs as a fact about now, says it is not about when the game ran badly, and claims no effect", async () => {
    await toTheQuestion();
    await pick("This week", answer({ running_now: running() }));
    expect(within(block()).getByText("Running right now")).toBeTruthy();
    expect(screen.getByTestId("first-look-running-list").textContent).toBe("Running right now: Medal, OBS Studio.");
    const now = screen.getByTestId("first-look-running-now").textContent ?? "";
    expect(now).toBe("This is what is running now, not what was running when the problem happened. Compy didn't see that, and it hasn't measured whether any of these affects a game.");
    expect(block().textContent).not.toMatch(/background|start with Windows|many PCs/i);
    expect(block().textContent).not.toMatch(/caus|slow|lag|because|affects? your/i);
  });

  it("names the game for a picked game, says nothing general about how such programs normally run, and lists a background program like any other", async () => {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    await pick("This week", gameAnswer({ running_now: running({ programs: [{ id: "medal", name: "Medal" }] }) }));
    expect(block().textContent).not.toMatch(/background|start with Windows|many PCs/i);
    expect(screen.getByTestId("first-look-running-list").textContent).toBe("Running right now: Medal.");
    expect(screen.getByTestId("first-look-running-now").textContent).toMatch(/^This is what is running now, not what was running when the problem with ROB RUN happened\./);
  });

  it("shows the count of the rest after the cap", async () => {
    await toTheQuestion();
    await pick("This week", answer({ running_now: running({ more: 3 }) }));
    expect(screen.getByTestId("first-look-running-list").textContent).toBe("Running right now: Medal, OBS Studio and 3 more.");
  });

  it("a read that found none of the listed programs says exactly that, scoped to the programs Compy looks for", async () => {
    await toTheQuestion();
    await pick("This week", answer({ running_now: running({ state: "none", programs: [] }) }));
    expect(screen.getByTestId("first-look-running-none").textContent).toBe("Compy didn't find any program from its list running right now. It matches by program name: recorders and overlays, voice chat, launchers, browsers, build and developer tools, Windows Update.");
    expect(screen.queryByTestId("first-look-running-now")).toBeNull();
  });

  it("an unread, late or dead listing says it couldn't read and never says none", async () => {
    const cases: [FirstLookAnswer["running_now"]["state"], string][] = [
      ["unread", "Compy couldn't read the list of running programs, so it can't say what is running."],
      ["took-too-long", "Compy didn't finish reading the running programs in time, so it can't say what is running."],
      ["reader-failed", "Compy couldn't read the running programs (the reader stopped unexpectedly)."],
    ];
    for (const [state, sentence] of cases) {
      cleanup();
      await toTheQuestion();
      await pick("This week", answer({ running_now: running({ state, programs: [] }) }));
      expect(screen.getByTestId("first-look-running-unread").textContent).toBe(sentence);
      expect(block().textContent).not.toMatch(/didn't find any program|None of the programs|no program/i);
      engine.calls.length = 0;
    }
  });

  it("a listing nobody asked for shows no block at all", async () => {
    await toTheQuestion();
    await pick("This week", answer());
    expect(screen.queryByTestId("first-look-running")).toBeNull();
  });

  it("'It's always been like this' still shows what is running now", async () => {
    await toTheQuestion();
    await pick("It's always been like this", answer({ told: { since: "always", from: null, to: "2026-11-20T12:00:00Z", hours: null }, changes_listed: false, running_now: running() }));
    expect(screen.getByTestId("first-look-running-list").textContent).toBe("Running right now: Medal, OBS Studio.");
  });

  it("works in Chinese: the list, the now-not-then line and the unread line come from the zh-CN keys", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      engine.diagnose = noSessions();
      render(<ParamedicCard noGames />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "其他游戏，或者整台电脑" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "是从什么时候开始的？" })).toBeTruthy());
      await pick("这周", answer({ running_now: running() }));
      expect(screen.getByTestId("first-look-running-list").textContent).toBe("此刻正在运行：Medal、OBS Studio。");
      expect(screen.getByTestId("first-look-running-now").textContent).toContain("不是问题出现时在运行的内容");
      cleanup();
      engine.calls.length = 0;
      engine.diagnose = noSessions();
      render(<ParamedicCard noGames />);
      fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "其他游戏，或者整台电脑" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "是从什么时候开始的？" })).toBeTruthy());
      await pick("这周", answer({ running_now: running({ state: "unread", programs: [] }) }));
      expect(screen.getByTestId("first-look-running-unread").textContent).toBe("Compy 没能读取正在运行的程序列表，所以说不准现在运行着什么。");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("the crash records before and after the earliest change (S5)", () => {
  const CHANGE = "2026-11-19T09:00:00Z";
  const crashes = (split: FirstLookCrashSplit | null): NonNullable<FirstLookAnswer["crashes"]> => ({
    args: { n: "26", since: "2026-10-01T10:00:00Z", partial: "true" },
    signature_module: null,
    signature_before: null,
    split,
  });
  const sp = (over: Partial<FirstLookCrashSplit> = {}): FirstLookCrashSplit => ({ before: 20, after: 6, change: CHANGE, oldest_read: "2026-10-01T10:00:00Z", gap: null, by_name: false, ...over });
  async function lookAs(a: FirstLookAnswer, label = "This week") {
    engine.steam = steamList([]);
    await toThePicker(noSessions(), { games: recorded });
    fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
    await pick(label, a);
  }
  const line = () => screen.getByTestId("first-look-crash-split").textContent ?? "";
  const DATE = "[A-Z][a-z]{2} \\d+, [^(]+";

  it("says how many readable records are from before and after the change, each as 'at least', and sits under the crash line", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp()) }));
    expect(line()).toMatch(new RegExp(`^Of the crash records Compy could read, at least 20 are from before ${DATE}\\(the earliest dated change Compy found\\) and at least 6 from after\\.$`));
    const block = screen.getByTestId("first-look-crashes");
    expect(block.lastElementChild).toBe(screen.getByTestId("first-look-crash-split"));
  });

  it("uses 'is' for one record before the change", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 1, after: 4 })) }));
    expect(line()).toMatch(/at least 1 is from before /);
  });

  it("says none from after only as 'none from after', and none from before only when the records reach back past the change", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 3, after: 0 })) }));
    expect(line()).toMatch(/at least 3 are from before .*and none from after\.$/);
    cleanup();
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 0, after: 5 })) }));
    expect(line()).toMatch(/^Of the crash records Compy could read, none are from before .*and at least 5 from after\. That is a count by date; Compy hasn't tested whether that change matters to the game\.$/);
  });

  it("when the records do not reach back past the change it says it can't tell how many came before, and that Windows keeps a limited number", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 0, after: 5, gap: "starts-later", oldest_read: "2026-11-20T01:00:00Z" })) }));
    const text = line();
    expect(text).toMatch(/at least 5 are from after .*The oldest record it could read is from [A-Z][a-z]{2} \d+, .*so it can't say how many came before\. Windows keeps only a limited number of crash records\.$/);
    expect(text).not.toMatch(/none are from before/);
  });

  it("when some records could not be read it says that instead of none before", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 0, after: 5, gap: "unread" })) }));
    expect(line()).toMatch(/Some records couldn't be read, so it can't say how many came before\.$/);
    expect(line()).not.toMatch(/none are from before/);
  });

  it("states counts and dates only: no rate, no more or fewer since, no cause, in every variant", async () => {
    const variants = [sp(), sp({ before: 1 }), sp({ before: 3, after: 0 }), sp({ before: 0, after: 5 }), sp({ before: 0, after: 5, gap: "starts-later" }), sp({ before: 0, after: 5, gap: "unread" }), sp({ before: 2, after: 0, gap: "unread-after" }), sp({ by_name: true })];
    for (const v of variants) {
      cleanup();
      await lookAs(gameAnswer({ crashes: crashes(v) }));
      expect(line(), JSON.stringify(v)).not.toMatch(/\bmore\b|fewer|\brate\b|per day|per week|caus|because|started|stopped|worse|better|increase|decrease|since the change/i);
    }
  });

  it("when some records could not be read and none readable is after the change, it says it can't say whether any came after, never 'none from after'", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 2, after: 0, gap: "unread-after" })) }));
    expect(line()).toMatch(/^Of the crash records Compy could read, at least 2 are from before .*\(the earliest dated change Compy found\)\. Some records couldn't be read, so it can't say whether any came after\.$/);
    expect(line()).not.toMatch(/none from after/);
    cleanup();
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 1, after: 0, gap: "unread-after" })) }));
    expect(line()).toMatch(/at least 1 is from before /);
  });

  it("a count matched by program name only carries the measured flow's own by-name hedge", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ by_name: true })) }));
    expect(line()).toMatch(/from after\. \(matched by program name\)$/);
    cleanup();
    await lookAs(gameAnswer({ crashes: crashes(sp({ by_name: false })) }));
    expect(line()).not.toMatch(/matched by program name/);
  });

  it("the none-from-before line says it is a count by date and not a test of the change", async () => {
    await lookAs(gameAnswer({ crashes: crashes(sp({ before: 0, after: 5 })) }));
    expect(line()).toContain("That is a count by date; Compy hasn't tested whether that change matters to the game.");
  });

  it("no split means no split line, and the existing same-file sentence is still said by itself", async () => {
    await lookAs(
      gameAnswer({
        crashes: { args: { n: "2", since: "2026-11-02T10:00:00Z" }, signature_module: "UnityPlayer.dll", signature_before: "2026-11-15T13:44:49Z", split: null },
      }),
    );
    expect(screen.queryByTestId("first-look-crash-split")).toBeNull();
    expect(screen.getByTestId("first-look-crashes").textContent).toContain("so that change can't be the whole story for them.");
  });

  it("works in Chinese: both counts and the 'can't tell how many came before' line come from the zh-CN keys", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      for (const [split, want] of [
        [sp(), /至少有 20 条在 .*之前，至少有 6 条在之后。$/],
        [sp({ before: 0, after: 5, gap: "starts-later", oldest_read: "2026-11-20T01:00:00Z" }), /所以它说不准之前有多少条。Windows 只保留有限数量的崩溃记录。$/],
        [sp({ before: 0, after: 5, gap: "unread" }), /有些记录没能读取，所以 Compy 说不准之前有多少条。$/],
      ] as [FirstLookCrashSplit, RegExp][]) {
        cleanup();
        engine.calls.length = 0;
        engine.steam = steamList([]);
        engine.diagnose = noSessions();
        render(<ParamedicCard games={recorded} />);
        fireEvent.click(screen.getByRole("button", { name: "出问题了" }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "哪款游戏？" })).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "ROB RUN" }));
        await pick("这周", gameAnswer({ crashes: crashes(split) }));
        expect(line()).toMatch(want);
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
