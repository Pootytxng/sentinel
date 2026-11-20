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
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    engine.calls.push({ cmd, args });
    if (cmd === "paramedic_diagnose") return Promise.resolve(engine.diagnose);
    if (cmd === "paramedic_first_look") {
      if (engine.lookError) return Promise.reject(engine.lookError);
      return engine.gate ? engine.gate.then(() => engine.look) : Promise.resolve(engine.look);
    }
    return Promise.resolve(null);
  },
}));

import "../../i18n";
import i18n from "../../i18n";
import type { ParamedicDiagnosis } from "../../types";
import type { FirstLookChange, ParamedicFirstLook as FirstLookAnswer } from "./ParamedicFirstLook";
import { ParamedicCard } from "./ParamedicCard";

afterEach(() => {
  cleanup();
  engine.diagnose = null;
  engine.look = null;
  engine.calls.length = 0;
  engine.gate = null;
  engine.lookError = "";
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
  changes_listed: true,
  touch_games: [driver, quality],
  other_changes: [programs],
  none: [],
  limits: completeLimits,
  read_all: true,
  method: "paramedic-first-look-v1",
  ...over,
});

/** Open the card, press the door, and wait for the question. */
async function toTheQuestion(d: ParamedicDiagnosis = noSessions(), props: { noGames?: boolean } = { noGames: true }) {
  engine.diagnose = d;
  render(<ParamedicCard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
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
    // Nothing is read for the question itself, and the game picker is not part of this slice.
    expect(engine.calls.map((c) => c.cmd)).toEqual(["paramedic_diagnose"]);
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
    await toTheQuestion(diagnosis({ kind: "needs-more-play", sessions_needed: 2, have: 1 }), {});
    expect(screen.getByText("Compy can't tell yet")).toBeTruthy();
    expect(screen.getByRole("group", { name: "When did it start?" })).toBeTruthy();
    // The question does not pull keyboard focus past the measured answer already on screen.
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "When did it start?" }));
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
    expect(screen.getByText("Windows recorded no monthly Windows update, Windows version update or driver update in this period.")).toBeTruthy();
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
    expect(screen.getByText("Windows recorded no monthly Windows update, Windows version update or driver update in this period.")).toBeTruthy();
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
    await waitFor(() => expect(screen.getByRole("group", { name: "When did it start?" })).toBeTruthy());
    expect(screen.queryByTestId("first-look-told")).toBeNull();
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
