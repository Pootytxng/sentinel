import { describe, expect, it } from "vitest";
import { settingsDoneLine, softwareFirstLine } from "./settings-done";
import type { Priorities, PriorityItem } from "../types";

const item = (id: string, status: PriorityItem["status"], title = id): PriorityItem => ({
  id,
  title,
  reason: "",
  linked: null,
  confidence: "medium",
  status,
});
const pri = (limiters: PriorityItem[]): Priorities => ({
  limiters,
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
});

describe("settingsDoneLine (P9-settings-done)", () => {
  it("is absent unless the game summary finished the supported tests", () => {
    for (const h of [
      "finished-within-chosen-risk",
      "still-worth-testing",
      "worth-retesting",
      "results-unverified",
      "nothing-testable-now",
      "unknown",
    ] as const) {
      expect(settingsDoneLine(h, pri([item("gpu", "attention")]))).toBeNull();
    }
  });

  it("defaults to not measured (no upgrade) when no scan or a failed priorities read", () => {
    expect(settingsDoneLine("finished-supported-tests", undefined)).toEqual({ kind: "not-measured" });
    expect(settingsDoneLine("finished-supported-tests", null)).toEqual({ kind: "not-measured" });
  });

  it("names a setting/software limiter as a setting, never a part", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([item("monitor-refresh", "attention", "Refresh rate")]))).toEqual({
      kind: "setting-limiter",
      title: "Refresh rate",
    });
  });

  it("never names the safe-tweak rows it just finished testing (desk review 2026-10-31)", () => {
    // On the owner's rig the finished WARDOGS summary said "tested twice, no measurable difference"
    // for Trim Windows visual effects, and this line then named "1 safe tweak not applied" (that same
    // tweak) as what holds the PC back.
    const aggregate = item("pending-safe-recs", "attention", "1 safe tweak not applied");
    const applied = item("applied-changes", "attention", "2 changes applied");
    expect(settingsDoneLine("finished-supported-tests", pri([aggregate, applied]))).toEqual({ kind: "nothing-limiting" });
    // A real limiter behind them is still named.
    expect(
      settingsDoneLine("finished-supported-tests", pri([aggregate, item("ram-capacity", "attention", "Memory")])),
    ).toEqual({ kind: "part-limiter", title: "Memory" });
  });

  it("names a hardware limiter by its title only", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([item("ready-x", "ready"), item("ram-capacity", "attention", "Memory")]))).toEqual({
      kind: "part-limiter",
      title: "Memory",
    });
  });

  it("says nothing is limiting only when every limiter was read and none needs attention", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([]))).toEqual({ kind: "nothing-limiting" });
    expect(settingsDoneLine("finished-supported-tests", pri([item("a", "ready")]))).toEqual({ kind: "nothing-limiting" });
    // An unread limiter is unknown, never "nothing limiting".
    expect(settingsDoneLine("finished-supported-tests", pri([item("a", "ready"), item("b", "unknown")]))).toEqual({
      kind: "not-measured",
    });
  });

  // P9-summary-gpu-limit: the game's own newest measured session was GPU-limited (sustained rule).
  it("names the GPU with its share when this game's newest session was GPU-limited, never another game's", () => {
    const withGpu = {
      ...pri([]),
      gpu_limited_games: [{ game: "ROB RUN.exe", share_pct: 72, peak_pct: 99, threshold_pct: 95 }],
    };
    const limited = { kind: "gpu-limiter", sharePct: 72, thresholdPct: 95 };
    expect(settingsDoneLine("finished-supported-tests", withGpu, "ROB RUN.exe")).toEqual(limited);
    // Review r1: Windows' case for the process name doesn't decide the match.
    expect(settingsDoneLine("finished-supported-tests", withGpu, "rob run.exe ")).toEqual(limited);
    // Another game's limit never counts for this one.
    expect(settingsDoneLine("finished-supported-tests", withGpu, "wardogs.exe")).toEqual({ kind: "nothing-limiting" });
    // It also outranks "not measured" from an unread PC-wide row: it is a measurement of this game.
    const unread = { ...pri([item("b", "unknown")]), gpu_limited_games: withGpu.gpu_limited_games };
    expect(settingsDoneLine("finished-supported-tests", unread, "ROB RUN.exe")).toEqual(limited);
    // A scan's own attention limiter is still the one named first.
    const part = { ...pri([item("ram-capacity", "attention", "Memory")]), gpu_limited_games: withGpu.gpu_limited_games };
    expect(settingsDoneLine("finished-supported-tests", part, "ROB RUN.exe")).toEqual({ kind: "part-limiter", title: "Memory" });
    // An older backend sends no list; no game given: as before.
    expect(settingsDoneLine("finished-supported-tests", pri([]), "ROB RUN.exe")).toEqual({ kind: "nothing-limiting" });
    expect(settingsDoneLine("finished-supported-tests", withGpu)).toEqual({ kind: "nothing-limiting" });
  });

  // P9-session-on-this-hardware: the row's tie to the card in this PC now rides on the line; a
  // session on this card (or an older backend's row with no tie) adds no untied reason.
  it("carries a session's untied reason onto the GPU-limiter and measured-clear lines", () => {
    const lim = (gpu_tie?: "this-card" | "not-recorded" | "card-unread") => ({
      ...pri([]),
      gpu_limited_games: [{ game: "ROB RUN.exe", share_pct: 72, peak_pct: 99, threshold_pct: 95, gpu_tie }],
    });
    const base = { kind: "gpu-limiter", sharePct: 72, thresholdPct: 95 };
    expect(settingsDoneLine("finished-supported-tests", lim("not-recorded"), "ROB RUN.exe")).toEqual({ ...base, untied: "not-recorded" });
    expect(settingsDoneLine("finished-supported-tests", lim("card-unread"), "ROB RUN.exe")).toEqual({ ...base, untied: "card-unread" });
    expect(settingsDoneLine("finished-supported-tests", lim("this-card"), "ROB RUN.exe")).toEqual(base);
    expect(settingsDoneLine("finished-supported-tests", lim(undefined), "ROB RUN.exe")).toEqual(base);
    const clear = {
      ...pri([]),
      gpu_clear_games: [{ game: "ROB RUN.exe", busy: 120, readings: 900, threshold_pct: 95, limit_share_pct: 50, gpu_tie: "card-unread" as const }],
    };
    expect(settingsDoneLine("finished-supported-tests", clear, "ROB RUN.exe")).toEqual({
      kind: "nothing-limiting",
      gpuClear: { busy: 120, readings: 900, thresholdPct: 95, limitSharePct: 50, untied: "card-unread" },
    });
  });

  // P9-no-upgrade-source: "nothing holding it back" says what it was read from when this game's own
  // newest measured session was measured clear of a GPU limit; another game's, or none, says no more.
  it("names this game's measured-clear session behind 'no upgrade recommended', never another game's", () => {
    const clear = { ...pri([]), gpu_clear_games: [{ game: "ROB RUN.exe", busy: 120, readings: 900, threshold_pct: 95, limit_share_pct: 50 }] };
    expect(settingsDoneLine("finished-supported-tests", clear, "rob run.exe")).toEqual({
      kind: "nothing-limiting",
      gpuClear: { busy: 120, readings: 900, thresholdPct: 95, limitSharePct: 50 },
    });
    expect(settingsDoneLine("finished-supported-tests", clear, "wardogs.exe")).toEqual({ kind: "nothing-limiting" });
    // An unread PC-wide row still means "not measured"; an attention limiter still leads.
    const unread = { ...clear, limiters: [item("b", "unknown")] };
    expect(settingsDoneLine("finished-supported-tests", unread, "ROB RUN.exe")).toEqual({ kind: "not-measured" });
    const part = { ...clear, limiters: [item("ram-capacity", "attention", "Memory")] };
    expect(settingsDoneLine("finished-supported-tests", part, "ROB RUN.exe")).toEqual({ kind: "part-limiter", title: "Memory" });
    // A zero-reading entry claims nothing.
    const empty = { ...pri([]), gpu_clear_games: [{ game: "ROB RUN.exe", busy: 0, readings: 0, threshold_pct: 95, limit_share_pct: 50 }] };
    expect(settingsDoneLine("finished-supported-tests", empty, "ROB RUN.exe")).toEqual({ kind: "nothing-limiting" });
    // Review r1: counts that can't be a measurement claim nothing.
    for (const [busy, readings] of [[901, 900], [-1, 900], [450, 900], [600, 900]]) {
      const bad = { ...pri([]), gpu_clear_games: [{ game: "ROB RUN.exe", busy, readings, threshold_pct: 95, limit_share_pct: 50 }] };
      expect(settingsDoneLine("finished-supported-tests", bad, "ROB RUN.exe")).toEqual({ kind: "nothing-limiting" });
    }
  });

  // CR-gpu-share-one-source: the share Compy counts as GPU-limited is read from the row (the Rust
  // rule), never restated here; a row without it, or with an impossible one, claims nothing.
  it("reads the GPU-limited share from the row, and claims nothing without a sane one", () => {
    const row = (limit_share_pct?: number) => ({
      ...pri([]),
      gpu_clear_games: [{ game: "ROB RUN.exe", busy: 500, readings: 900, threshold_pct: 95, limit_share_pct }],
    });
    // 500 of 900 is 55.6%: under a 60% rule, over a 50% one.
    expect(settingsDoneLine("finished-supported-tests", row(60), "ROB RUN.exe")).toEqual({
      kind: "nothing-limiting",
      gpuClear: { busy: 500, readings: 900, thresholdPct: 95, limitSharePct: 60 },
    });
    for (const bad of [50, undefined, 0, -5, 150, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(settingsDoneLine("finished-supported-tests", row(bad), "ROB RUN.exe")).toEqual({ kind: "nothing-limiting" });
    }
  });
});

// P9-software-first: before a part is named as what holds a game back, the summary lists the
// settings still worth trying — none left = today's settings-done line instead.
describe("softwareFirstLine (P9-software-first)", () => {
  const cand = (id: string, title: string) => ({ id, title, passes: true, reason: null, detail: null });
  const tested = (recId: string, title: string) => ({ recId, title }) as never;
  const part = pri([item("ram-capacity", "attention", "Memory")]);

  it("lists the untested changes, then those worth another run, before the part — in the picker's order", () => {
    const line = softwareFirstLine(
      { headline: "still-worth-testing", leftToTest: [cand("a", "Change A"), cand("b", "Change B")], retest: [tested("c", "Change C"), tested("a", "Change A")] },
      part,
    );
    expect(line).toEqual({ kind: "software-first", part: "Memory", candidates: ["Change A", "Change B", "Change C"] });
  });

  it("is absent on a finished summary (today's line carries it), with nothing left to try, or with no part named", () => {
    const left = [cand("a", "Change A")];
    expect(softwareFirstLine({ headline: "finished-supported-tests", leftToTest: left, retest: [] }, part)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: [], retest: [] }, part)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, undefined)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([]))).toBeNull();
    // A setting or software limiter is not a part; the aggregate rec rows are not limiters here.
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([item("monitor-refresh", "attention")]))).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([item("pending-safe-recs", "attention")]))).toBeNull();
  });

  it("a retest-only summary still lists what is worth another run", () => {
    expect(softwareFirstLine({ headline: "worth-retesting", leftToTest: [], retest: [tested("c", "Change C")] }, part)).toEqual({
      kind: "software-first",
      part: "Memory",
      candidates: ["Change C"],
    });
  });
});

// P9-retail-firewall (Phase 9: retail economics never shape the answer): the summary's verdict is the
// same whether the payload carries retail links, carries them stripped, or has no upgrade rows at all.
describe("settingsDoneLine ignores retail data (P9-retail-firewall)", () => {
  const link = { retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" };
  const row = (links: { retailer: string; url: string }[]) => ({
    kind: "gpu",
    title: "Graphics card",
    why: "",
    links,
  });
  const withPath = (p: Priorities, links: { retailer: string; url: string }[] | null): Priorities => ({
    ...p,
    upgrade_path: links ? { items: [row(links)], disclosure: "x" } : null,
  });
  const cases: [string, Priorities, string][] = [
    ["gpu-limited", { ...pri([]), gpu_limited_games: [{ game: "ROB RUN.exe", share_pct: 80, peak_pct: 99, threshold_pct: 95 }] }, "gpu-limiter"],
    ["measured clear", { ...pri([]), gpu_clear_games: [{ game: "ROB RUN.exe", busy: 120, readings: 900, threshold_pct: 95, limit_share_pct: 50 }] }, "nothing-limiting"],
    ["part limiter", pri([item("ram-capacity", "attention", "Memory")]), "part-limiter"],
    ["unread limiter", pri([item("b", "unknown")]), "not-measured"],
    ["nothing", pri([]), "nothing-limiting"],
  ];
  it.each(cases)("%s: links present, stripped or absent give one verdict", (_name, p, kind) => {
    const bare = settingsDoneLine("finished-supported-tests", withPath(p, null), "ROB RUN.exe");
    // Review r1: each case pins its own verdict, so a regression to one shared verdict fails.
    expect(bare?.kind).toBe(kind);
    expect(settingsDoneLine("finished-supported-tests", withPath(p, [link, link]), "ROB RUN.exe")).toEqual(bare);
    expect(settingsDoneLine("finished-supported-tests", withPath(p, []), "ROB RUN.exe")).toEqual(bare);
  });
});

// P9-summary-screen-limit: Check's screen-is-limit rule, on the game summary's GPU-limiter line.
describe("settingsDoneLine screen cap (P9-summary-screen-limit)", () => {
  const lim = (avg_fps?: number, refresh_hz?: number) => ({
    ...pri([]),
    gpu_limited_games: [{ game: "ROB RUN.exe", share_pct: 80, peak_pct: 99, threshold_pct: 95, avg_fps, refresh_hz }],
  });
  const line = (p: Priorities) => settingsDoneLine("finished-supported-tests", p, "ROB RUN.exe");
  it("names the screen when the session averaged at or above its refresh", () => {
    expect(line(lim(251.6, 250))).toEqual({ kind: "gpu-limiter", sharePct: 80, thresholdPct: 95, screenCap: { hz: 250, fps: 252 } });
    expect(line(lim(250, 250))).toEqual({ kind: "gpu-limiter", sharePct: 80, thresholdPct: 95, screenCap: { hz: 250, fps: 250 } });
  });
  it("keeps the GPU line below the refresh or when either number is unmeasured", () => {
    const plain = { kind: "gpu-limiter", sharePct: 80, thresholdPct: 95 };
    const odd = [[249.6, 250], [undefined, 250], [300, undefined], [0, 0], [300, 0], [0, 250], [Number.NaN, 250], [Infinity, 250], [-1, -2]] as const;
    for (const [fps, hz] of odd) {
      expect(line(lim(fps, hz))).toEqual(plain);
    }
    // Another game's session never caps this one.
    expect(settingsDoneLine("finished-supported-tests", lim(300, 250), "wardogs.exe")).toEqual({ kind: "nothing-limiting" });
  });
});
