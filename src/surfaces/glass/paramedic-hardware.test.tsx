// F7 slice 1: how the Something's-wrong card words a hardware lead (Windows' hardware error records). A feature
// test, not a guard. The engine's answer is mocked (codes, counts and dates only); every sentence asserted here is the
// card's own, written out literally in both languages so a wrong meaning fails here and not by copying the JSON.
// What must hold: a hardware lead never says "one change" or "try the fix"; it is "may be hardware" and never "looks
// like" (the lead is Possible at most, review r1); no button; an unread or uncovered log is under "Compy couldn't
// see", carries "Not read" and never "Not recorded", and is never a "none" line.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(answer.value),
}));

import i18n from "../../i18n";
import type { ParamedicDiagnosis, ParamedicEvidence, ParamedicSessionRef } from "../../types";
import { ParamedicCard } from "./ParamedicCard";

afterEach(async () => {
  cleanup();
  answer.value = null;
  await i18n.changeLanguage("en");
});

type F = ParamedicDiagnosis["findings"][number];

const ref = (at: string): ParamedicSessionRef => ({ started_at: at, game: "game-a", duration_secs: 600, samples: 600, avg_fps: 100, low1_fps: 30 });

const base: ParamedicDiagnosis = {
  complaint: "unknown",
  state: { kind: "found" },
  game: "game-a",
  game_name: "Game A",
  problem: {
    rule: "stutter-collapse",
    spikes: false,
    avg_lower: false,
    before: { ratio: 0.5, p99_ms: null, avg_fps: 100 },
    now: { ratio: 0.3, p99_ms: null, avg_fps: 100 },
    last_normal_at: "2026-10-04T10:00:00Z",
    last_full_normal_at: "2026-10-04T10:00:00Z",
    sessions_affected: [ref("2026-10-07T10:00:00Z")],
    partial_sessions: [],
    other_games_affected: [],
    later_unjudged: 0,
  },
  findings: [],
  not_it: [],
  unknowns: [],
  limits: [],
  seen: [],
  baseline: ref("2026-10-04T10:00:00Z"),
  first_bad: ref("2026-10-07T10:00:00Z"),
  mixed_sessions: [],
  why_first: null,
  recovery: null,
  earlier_episode: null,
  method: "paramedic-rules-v1",
};

const ev = (code: string, args: Record<string, string>, over: Partial<ParamedicEvidence> = {}): ParamedicEvidence => ({
  kind: "known",
  code,
  args,
  against: false,
  source: "windows-system-log",
  ...over,
});
const count = (n: number) => ev("whea-count", { count: String(n), from: "2026-10-06T12:00:00Z", to: "2026-10-07T10:05:00Z" });
const inRough = (n: number, of: number) => ev("whea-in-rough", { count: String(n), of: String(of) }, { kind: "measured", source: "sessions" });
const clean = ev("whea-normal-clean", { base: "4" }, { source: "sessions" });
const inNormal = (n: number) => ev("whea-in-normal", { count: String(n) }, { against: true, source: "sessions" });
const earlier = (n: number) => ev("whea-earlier", { count: String(n), from: "2026-10-01T20:00:00Z", to: "2026-10-03T15:00:00Z" }, { against: true });
const unread = ev("whea-normal-unread", { from: "2026-10-03T00:00:00Z" }, { kind: "unknown" });

/** A hardware finding as the engine sends it: Possible, with no action. Several records carry a first-to-last span. */
const hardware = (evidence: ParamedicEvidence[], over: Partial<F> = {}): F => ({
  id: "hardware-errors",
  confidence: "possible",
  in_play: true,
  evidence,
  since_when:
    evidence[0]?.args.count === "1"
      ? { kind: "exact", at: "2026-10-06T12:00:00Z" }
      : { kind: "observed-between", from: "2026-10-06T12:00:00Z", to: "2026-10-07T10:05:00Z" },
  fix: { kind: "hardware", code: "hardware-errors" },
  now: null,
  now_evidence: [],
  ...over,
});
const usual = () => hardware([count(2), inRough(1, 2), clean]);
const driver = (confidence: F["confidence"]): F => ({
  id: "gpu-driver-change",
  confidence,
  in_play: confidence === "possible",
  evidence: [ev("driver-changed", { from: "1.0", to: "2.0" }, { source: "snapshots" })],
  since_when: { kind: "observed-between", from: "2026-10-05T05:00:00Z", to: "2026-10-06T16:00:00Z" },
  fix: { kind: "steps", code: "gpu-driver-change", args: { from: "1.0" } },
  now: null,
  now_evidence: [],
});

const DOOR = { en: "Check my PC", "zh-CN": "检查我的电脑" } as const;

const ask = async (d: ParamedicDiagnosis, lang: keyof typeof DOOR = "en") => {
  await i18n.changeLanguage(lang);
  answer.value = d;
  render(<ParamedicCard />);
  fireEvent.click(screen.getByRole("button", { name: DOOR[lang] }));
  // The answer has arrived once its verdict (found) or one of its folds (nothing changed) is on screen.
  await waitFor(() =>
    expect(screen.queryByTestId("paramedic-verdict") ?? screen.queryByTestId("paramedic-limits") ?? screen.queryByTestId("paramedic-checked")).toBeTruthy(),
  );
};
const found = (findings: F[], over: Partial<ParamedicDiagnosis> = {}): ParamedicDiagnosis => ({ ...base, findings, ...over });
const nothingChanged = (over: Partial<ParamedicDiagnosis>): ParamedicDiagnosis => ({ ...base, state: { kind: "cant-tell", why: { kind: "nothing-changed" } }, ...over });

/** Opens every closed disclosure (rows and folds), including ones that appear inside others. */
const openAll = () => {
  for (let i = 0; i < 6; i++) {
    const closed = screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-expanded") === "false");
    if (closed.length === 0) return;
    closed.forEach((b) => fireEvent.click(b));
  }
};
const verdict = () => screen.getByTestId("paramedic-verdict").textContent;
const rows = () => screen.queryAllByTestId("paramedic-candidate");
const card = () => screen.getByTestId("paramedic").textContent ?? "";
const block = () => screen.getByTestId("paramedic-hardware");
const tell = () => within(screen.getByTestId("paramedic-hardware-tell")).getAllByRole("listitem").map((li) => li.textContent ?? "");
const openRow = (i = 0) => fireEvent.click(within(rows()[i]).getAllByRole("button")[0]);

const EN = {
  verdict: "Windows recorded at least one hardware error in the same period, but Compy can't prove it is behind this.",
  next: "Open the first one to see what you can check. If you change anything, play Game A once, then press Check my PC again.",
  step1: "If you changed an overclock or an undervolt in your BIOS, set it back to its default, play Game A once, then press Check my PC again.",
  step2: "Press Windows + X and open Event Viewer. Under Windows Logs, open System and filter by the source WHEA-Logger. Open each record to read what Windows wrote about it.",
  step3: "If Windows keeps recording these after that, give these lines to the PC's maker or a repair shop:",
  intro: "Windows keeps a record when a part of the PC reports an error about itself. Compy has no setting to change for that. What you can do:",
  tellPart: "Compy has not read which part of the PC reported this.",
};

describe("a hardware lead on the Something's-wrong card (en)", () => {
  it('a hardware lead says "This may be hardware" and shows no "How to fix it"', async () => {
    await ask(found([usual()]));
    expect(verdict()).toBe(EN.verdict);
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toMatch(/Windows recorded hardware errors/);
    // Several records: the row is dated from the first to the last, never "On <the first one>".
    expect(rows()[0].textContent).toMatch(/Between .+ and .+/);
    expect(within(rows()[0]).getByText("Possible")).toBeTruthy();
    // Nothing of the block shows until the row is opened.
    expect(screen.queryByTestId("paramedic-hardware")).toBeNull();
    openRow();
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
    expect(within(block()).getByText(EN.intro)).toBeTruthy();
    const steps = within(block()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps.slice(0, 3)).toEqual([EN.step1, EN.step2, EN.step3]);
    expect(card()).not.toMatch(/How to fix it|How to test this/);
    expect(card()).not.toMatch(/One change lines up|A change lines up|Try the steps under the first one|Check it, play/);
    expect(screen.getByText(EN.next)).toBeTruthy();
  });

  it("a hardware lead offers no button: nothing in its block can change the PC", async () => {
    await ask(found([usual()]));
    openRow();
    expect(within(block()).queryAllByRole("button")).toEqual([]);
    expect(within(block()).queryAllByRole("link")).toEqual([]);
  });

  it('"looks like" and "Most likely" are never said about a hardware lead', async () => {
    await ask(found([usual()]));
    openRow();
    const said = `${verdict()} ${rows()[0].textContent}`;
    expect(said).not.toMatch(/looks like/i);
    expect(said).not.toMatch(/Most likely/);
    cleanup();
    // Even if a later engine sent a higher level, the card's own hardware sentences claim no more than "may be".
    await ask(found([hardware([count(2), inRough(1, 2), clean], { confidence: "likely", in_play: false })]));
    openRow();
    expect(verdict()).toBe(EN.verdict);
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
    expect(card()).not.toMatch(/looks like/i);
  });

  it('the hardware lead never shows "until you try the fix"', async () => {
    await ask(found([hardware([count(2), inRough(1, 2), clean], { confidence: "likely", in_play: false })]));
    openRow();
    expect(card()).not.toMatch(/until you try the fix/);
    cleanup();
    // The other leads keep their own line.
    await ask(found([driver("likely")]));
    openRow();
    expect(screen.getByText("Compy can't prove this until you try the fix and play again.")).toBeTruthy();
  });

  it("the evidence lines give counts and dates, and the lines to pass on repeat them", async () => {
    await ask(found([usual()]));
    openRow();
    const many = /^Windows recorded hardware errors at 2 separate times between .+ and .+ \(source: WHEA-Logger; records under a minute apart count once\)\.$/;
    const lines = tell();
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(many);
    expect(lines[1]).toBe("1 of these fell while a Game A session Compy measured as rough was running, or just after it ended.");
    expect(lines[2]).toBe(EN.tellPart);
    expect(screen.getByText("Compy found none during or just after the 4 normal Game A sessions it checked, and its read of Windows' log goes back past the oldest of them.")).toBeTruthy();
  });

  it("the rough-session line is absent when no record sat in a rough session", async () => {
    await ask(found([hardware([count(2), clean])]));
    openRow();
    const lines = tell();
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(EN.tellPart);
    expect(card()).not.toMatch(/measured as rough/);
  });

  it('a lone record in a rough session says "It fell", never "1 of these"', async () => {
    await ask(found([hardware([count(1), inRough(1, 1), clean])]));
    expect(rows()[0].textContent).toMatch(/Windows recorded a hardware error/);
    expect(rows()[0].textContent).not.toMatch(/hardware errors/);
    expect(rows()[0].textContent).toMatch(/On .+/);
    openRow();
    const lines = tell();
    expect(lines[0]).toMatch(/^Windows recorded a hardware error on .+ \(source: WHEA-Logger\)\.$/);
    expect(lines[1]).toBe("It fell during or just after a Game A session Compy measured as rough.");
    expect(card()).not.toMatch(/of these/);
  });

  it('a record in a normal session is shown as weakening the lead, and never with "also"', async () => {
    await ask(found([hardware([count(1), inNormal(1)], { in_play: false })]));
    openRow();
    const li = screen.getByText("Windows recorded a hardware error while Game A was running in its usual range, or just after.").closest("li")!;
    expect(within(li).getByText("Weakens this")).toBeTruthy();
    expect(card()).not.toMatch(/Compy found none during/);
    expect(rows()[0].textContent).not.toMatch(/\balso\b/);
    cleanup();
    await ask(found([hardware([count(2), inNormal(3)], { in_play: false })]));
    openRow();
    expect(screen.getByText("At 3 separate times, Windows recorded a hardware error while Game A was running in its usual range, or just after.")).toBeTruthy();
  });

  it("records from before the game got rough are shown, and weaken the lead", async () => {
    await ask(found([hardware([count(2), inRough(1, 2), clean, earlier(3)], { in_play: false })]));
    openRow();
    const line = screen.getByText(/^Windows also recorded hardware errors at 3 separate times before Game A got rough, between .+ and .+\.$/);
    expect(within(line.closest("li")!).getByText("Weakens this")).toBeTruthy();
    cleanup();
    await ask(found([hardware([count(2), clean, earlier(1)], { in_play: false })]));
    openRow();
    expect(screen.getByText(/^Windows also recorded a hardware error on .+, before Game A got rough\.$/)).toBeTruthy();
  });

  it('normal sessions the read did not reach carry "Not read", never "Not recorded" and never "found none"', async () => {
    await ask(found([hardware([count(2), inRough(1, 2), unread])]));
    openRow();
    const line = screen.getByText(/^Compy's read of Windows' log only reaches back to .+, so it can't tell whether such errors were also recorded during the normal sessions before that\.$/);
    const li = line.closest("li")!;
    expect(within(li).getByText("Not read")).toBeTruthy();
    expect(li.textContent).not.toMatch(/Not recorded/);
    expect(rows()[0].textContent).not.toMatch(/Not recorded/);
    expect(card()).not.toMatch(/Compy found none during/);
  });

  it("in play beside another change, the card says it can't tell them apart and keeps the hardware row's own words", async () => {
    await ask(found([driver("possible"), usual()], { why_first: "not-separable" }));
    expect(verdict()).toBe("Compy can't tell which of these it is yet");
    expect(rows().length).toBe(2);
    expect(screen.getByText("Play Game A once more. Compy may still not be able to tell these apart.")).toBeTruthy();
    openRow(1);
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
    expect(rows()[1].textContent).not.toMatch(/How to fix it|How to test this/);
  });

  it("a hardware finding behind another lead leaves that lead's sentences as they were", async () => {
    await ask(found([driver("likely"), usual()]));
    expect(verdict()).toBe("One change lines up best with what happened. It's listed first.");
    expect(screen.getByText(/Try the steps under the first one, play Game A once/)).toBeTruthy();
    expect(rows().length).toBe(2);
    openRow(1);
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
  });

  it("under a tie between two changes, the hardware row is listed without a tie sentence of its own", async () => {
    await ask(found([driver("likely"), { ...driver("likely"), id: "windows-build-change" }, usual()], { why_first: "tie" }));
    expect(verdict()).toBe("One change lines up best with what happened. It's listed first.");
    openRow(0);
    expect(card()).toMatch(/Why this one first: Two changes line up equally\. Start with the one that's easier to undo\./);
  });

  it('an unread hardware log renders under "Compy couldn\'t see" and no checked line', async () => {
    await ask(nothingChanged({ unknowns: ["hardware-errors-unread", "hardware-errors-slow", "hardware-errors-before"] }));
    openAll();
    const limits = screen.getByTestId("paramedic-limits");
    expect(within(limits).getByText("Compy couldn't see:")).toBeTruthy();
    expect(within(limits).getByText("Whether Windows recorded hardware errors (Compy couldn't read Windows' log)")).toBeTruthy();
    expect(within(limits).getByText("Whether Windows recorded hardware errors (looking took too long)")).toBeTruthy();
    expect(within(limits).getByText("Whether Windows recorded hardware errors in the earlier part of this period (Compy's read of Windows' log doesn't reach back that far)")).toBeTruthy();
    expect(screen.queryByTestId("paramedic-checked")).toBeNull();
    expect(card()).not.toMatch(/returned none|no hardware error|found none/i);
  });

  it("a covered read with no record is a checked line with the span it read", async () => {
    await ask(nothingChanged({ seen: [{ id: "hardware-errors-none", args: { from: "2026-10-04T10:10:00Z", to: "2026-10-08T09:00:00Z" } }] }));
    openAll();
    const checked = screen.getByTestId("paramedic-checked");
    expect(within(checked).getByText("Also looked at:")).toBeTruthy();
    expect(within(checked).getByText(/^Hardware error records \(source: WHEA-Logger\): Compy asked Windows' System log for them from .+ to .+ and it returned none\.$/)).toBeTruthy();
    expect(screen.queryByTestId("paramedic-limits")).toBeNull();
  });
});

const ZH = {
  verdict: "Windows 在同一时期记录了至少一次硬件错误，但 Compy 无法证明问题出在这里。",
  step1: "如果你在 BIOS 里改过超频或降压，先把它改回默认值，再玩一次 Game A，然后再点“检查我的电脑”。",
  step2: "按 Windows + X，打开“事件查看器”。在“Windows 日志”下打开“系统”，按来源 WHEA-Logger 筛选。逐条打开，看 Windows 对它的描述。",
  step3: "如果这样之后 Windows 仍在记录这类错误，把下面这几行告诉电脑厂商或维修店：",
  intro: "当电脑的某个部件报告自身出错时，Windows 会留下一条记录。对此 Compy 没有可以更改的设置。你可以这样做：",
  tellPart: "Compy 没有读取是电脑的哪个部件报告的。",
};

describe("a hardware lead on the Something's-wrong card (zh-CN)", () => {
  it("硬件线索：说“这有可能是硬件问题”，不出现“如何解决”", async () => {
    await ask(found([usual()]), "zh-CN");
    expect(verdict()).toBe(ZH.verdict);
    expect(rows()[0].textContent).toMatch(/Windows 记录了硬件错误/);
    expect(within(rows()[0]).getByText("有可能")).toBeTruthy();
    openRow();
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("这有可能是硬件问题");
    expect(within(block()).getByText(ZH.intro)).toBeTruthy();
    const steps = within(block()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps.slice(0, 3)).toEqual([ZH.step1, ZH.step2, ZH.step3]);
    expect(card()).not.toMatch(/如何解决|如何验证这一点/);
    expect(card()).not.toMatch(/有一项变化|先试试第一项里的步骤|先检查一下/);
    expect(screen.getByText("点开第一项，看看你可以检查什么。如果你改了什么，再玩一次 Game A，然后再点“检查我的电脑”。")).toBeTruthy();
    expect(card()).not.toMatch(/在你试过解决办法/);
    const said = `${verdict()} ${rows()[0].textContent}`;
    expect(said).not.toMatch(/看起来/);
    expect(said).not.toMatch(/最有可能/);
    const lines = tell();
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^在 .+ 到 .+ 之间，Windows 在 2 个不同的时间记录了硬件错误（来源：WHEA-Logger；相隔不到一分钟的记录算作一次）。$/);
    expect(lines[1]).toBe("其中 1 次落在 Compy 测为不顺的 Game A 运行期间或刚结束之后。");
    expect(lines[2]).toBe(ZH.tellPart);
    expect(screen.getByText("在 Compy 查看的 4 次 Game A 正常运行期间及刚结束之后，没有找到这类记录；Compy 这次读取 Windows 日志追溯到了其中最早一次之前。")).toBeTruthy();
    expect(within(block()).queryAllByRole("button")).toEqual([]);
  });

  it("一条记录、落在正常运行里、更早也有、日志没读到：各说各的，不说“看起来”", async () => {
    await ask(found([hardware([count(1), inRough(1, 1), inNormal(1), earlier(1), unread], { in_play: false })]), "zh-CN");
    expect(verdict()).toBe(ZH.verdict);
    expect(rows()[0].textContent).toMatch(/Windows 记录了一次硬件错误/);
    openRow();
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("这有可能是硬件问题");
    const lines = tell();
    expect(lines[0]).toMatch(/^Windows 在 .+ 记录了一次硬件错误（来源：WHEA-Logger）。$/);
    expect(lines[1]).toBe("它落在 Compy 测为不顺的 Game A 运行期间或刚结束之后。");
    expect(screen.getByText("在 Game A 正常运行期间或刚结束之后，Windows 记录过一次硬件错误。")).toBeTruthy();
    expect(screen.getByText(/^在 Game A 变得不顺之前，Windows 也在 .+ 记录了一次硬件错误。$/)).toBeTruthy();
    const unreadLine = screen.getByText(/^Compy 这次读取 Windows 日志只追溯到 .+，所以说不准在那之前的正常运行期间是否也记录了这类错误。$/);
    expect(within(unreadLine.closest("li")!).getByText("未读取")).toBeTruthy();
    expect(rows()[0].textContent).not.toMatch(/未记录/);
    cleanup();
    await ask(found([hardware([count(2), inNormal(3), earlier(2)], { in_play: false })]), "zh-CN");
    openRow();
    expect(screen.getByText("在 Game A 正常运行期间或刚结束之后，Windows 在 3 个不同的时间记录了硬件错误。")).toBeTruthy();
    expect(screen.getByText(/^在 Game A 变得不顺之前，Windows 也在 .+ 到 .+ 之间的 2 个不同时间记录了硬件错误。$/)).toBeTruthy();
  });

  it("没读到的硬件错误日志列在“Compy 看不到”下面，不出现“没有”一类的检查结果", async () => {
    await ask(nothingChanged({ unknowns: ["hardware-errors-unread", "hardware-errors-slow", "hardware-errors-before"] }), "zh-CN");
    openAll();
    const limits = screen.getByTestId("paramedic-limits");
    expect(within(limits).getByText("Compy 看不到：")).toBeTruthy();
    expect(within(limits).getByText("Windows 是否记录了硬件错误（Compy 没能读取 Windows 的日志）")).toBeTruthy();
    expect(within(limits).getByText("Windows 是否记录了硬件错误（查看用时过长）")).toBeTruthy();
    expect(within(limits).getByText("这段时间较早的部分里 Windows 是否记录了硬件错误（Compy 这次读取 Windows 日志没有追溯到那么早）")).toBeTruthy();
    expect(screen.queryByTestId("paramedic-checked")).toBeNull();
    expect(card()).not.toMatch(/没有返回|没有找到/);
  });

  it("读到了且没有记录：列在“还看了”下面，带上读取的时间范围", async () => {
    await ask(nothingChanged({ seen: [{ id: "hardware-errors-none", args: { from: "2026-10-04T10:10:00Z", to: "2026-10-08T09:00:00Z" } }] }), "zh-CN");
    openAll();
    const checked = screen.getByTestId("paramedic-checked");
    expect(within(checked).getByText("还看了：")).toBeTruthy();
    expect(within(checked).getByText(/^硬件错误记录（来源：WHEA-Logger）：Compy 向 Windows 系统日志查询了 .+ 到 .+ 的这类记录，结果一条也没有返回。$/)).toBeTruthy();
  });

  it("与另一项变化并列时：说分不清，硬件这一行仍用自己的话", async () => {
    await ask(found([driver("possible"), usual()], { why_first: "not-separable" }), "zh-CN");
    expect(verdict()).toBe("Compy 暂时还分不清是下面哪一项");
    expect(rows().length).toBe(2);
    openRow(1);
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("这有可能是硬件问题");
    expect(rows()[1].textContent).not.toMatch(/如何解决|如何验证这一点/);
  });
});

// The sentences themselves, read from both locale files: the text rules a render cannot see.
describe("the hardware sentences obey the product text rules (en and zh-CN)", () => {
  type Tree = { [k: string]: string | Tree };
  const load = (loc: string) => JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "paramedic.json"), "utf8")) as Tree;
  /** Every sentence this slice added, by key. */
  const added = (loc: string): Record<string, string> => {
    const j = load(loc);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.hardware as Tree)) out[`hardware.${k}`] = v as string;
    for (const [k, v] of Object.entries((j.finding as Tree).hardwareErrors as Tree)) out[`finding.hardwareErrors.${k}`] = v as string;
    for (const [k, v] of Object.entries(j.unknown as Tree)) if (k.startsWith("hardwareErrors")) out[`unknown.${k}`] = v as string;
    out["badge.notRead"] = (j.badge as Tree).notRead as string;
    return out;
  };
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("both languages carry the same keys with the same placeholders", () => {
    const [en, zh] = [added("en"), added("zh-CN")];
    expect(Object.keys(en).length).toBe(25);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(placeholders(zh[k]), k).toEqual(placeholders(en[k]));
    expect([en["badge.notRead"], zh["badge.notRead"]]).toEqual(["Not read", "未读取"]);
  });

  it("en and zh hardware sentences hold none of the five barred words and no part name", () => {
    const barredEn = /\b(caused?|causes|causing|fixe[sd]|guarantee\w*|safe\w*|probably)\b/i;
    const barredZh = /导致|造成|引起|修好|修复|保证|安全|大概|多半|很可能/;
    const partEn = /\b(CPU|GPU|RAM|memory|processor|graphics card|motherboard|power supply|PSU|SSD|hard drive)\b/i;
    const partZh = /处理器|显卡|主板|电源|硬盘|内存|CPU|GPU/;
    for (const [k, s] of Object.entries(added("en"))) {
      expect(s, k).not.toMatch(barredEn);
      expect(s, k).not.toMatch(partEn);
    }
    for (const [k, s] of Object.entries(added("zh-CN"))) {
      expect(s, k).not.toMatch(barredZh);
      expect(s, k).not.toMatch(partZh);
      // 测试 is the Test room's word only; nothing here names the Test room.
      expect(s, k).not.toMatch(/测试/);
    }
  });

  it('no sentence says "looks like" or a level above Possible, and none says "none" about an unread log', () => {
    const en = added("en");
    for (const [k, s] of Object.entries(en)) expect(s, k).not.toMatch(/looks like|most likely|likely|line up best/i);
    const zh = added("zh-CN");
    for (const [k, s] of Object.entries(zh)) expect(s, k).not.toMatch(/看起来|最有可能|最吻合/);
    for (const k of ["unknown.hardwareErrorsSlow", "unknown.hardwareErrorsUnread", "unknown.hardwareErrorsBefore"]) {
      expect(en[k], k).toMatch(/^Whether Windows recorded hardware errors/);
      expect(en[k], k).not.toMatch(/\b(none|no hardware|zero|off)\b/i);
      expect(zh[k], k).toMatch(/Windows 是否记录了硬件错误/);
    }
  });

  it("no hardware sentence says what an error did to the game", () => {
    // Mechanism, not outcome: counts, dates, where a record sat against a session, and what the owner can check.
    const outcomeEn = /\b(made|makes|slowed|slows|stutter\w*|crash\w*|lag\w*|broke\w*|damag\w*|fail\w*|dying|faulty)\b/i;
    const outcomeZh = /卡顿|崩溃|变慢|损坏|故障|坏了/;
    for (const [k, s] of Object.entries(added("en"))) expect(s, k).not.toMatch(outcomeEn);
    for (const [k, s] of Object.entries(added("zh-CN"))) expect(s, k).not.toMatch(outcomeZh);
  });
});
