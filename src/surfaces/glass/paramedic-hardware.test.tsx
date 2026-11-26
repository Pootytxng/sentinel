// F7 slice 1: how the Something's-wrong card words a hardware lead (Windows' hardware error records). A feature
// test, not a guard. The engine's answer is mocked (codes, counts and dates only); every sentence asserted here is the
// card's own, written out literally in both languages so a wrong meaning fails here and not by copying the JSON.
// What must hold: a hardware lead never says "one change" or "try the fix"; "This looks like hardware" only at Most
// likely; no button; an unread or uncovered log is under "Compy couldn't see" and never a "none" line.
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
const unread = ev("whea-normal-unread", { from: "2026-10-03T00:00:00Z" }, { kind: "unknown" });

const hardware = (confidence: F["confidence"], evidence: ParamedicEvidence[], over: Partial<F> = {}): F => ({
  id: "hardware-errors",
  confidence,
  in_play: confidence === "possible",
  evidence,
  since_when: { kind: "exact", at: "2026-10-06T12:00:00Z" },
  fix: { kind: "hardware", code: "hardware-errors" },
  now: null,
  now_evidence: [],
  ...over,
});
const likely = () => hardware("likely", [count(2), inRough(1, 2), clean]);
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

const DOOR = { en: "Something's wrong", "zh-CN": "出问题了" } as const;

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

const EN = {
  step1: "If you changed an overclock, an undervolt or a memory profile (XMP or EXPO) in your BIOS, set it back to its default, play Game A once, then press Something's wrong again.",
  step2: "Press Windows + X and open Event Viewer. Under Windows Logs, open System and filter by the source WHEA-Logger. Open each record to read what Windows wrote about it.",
  step3: "If Windows keeps recording these with every BIOS setting at its default, give these lines to the PC's maker or a repair shop:",
  intro: "Windows keeps a record when a part of the PC reports an error about itself. Compy has no setting to change for that. What you can do:",
  tellPart: "Compy has not read which part of the PC reported this.",
};

describe("a hardware lead on the Something's-wrong card (en)", () => {
  it('a most-likely hardware lead says "This looks like hardware" and shows no "How to fix it"', async () => {
    await ask(found([likely()]));
    expect(verdict()).toBe("Windows' hardware error records line up best with what happened. They're listed first.");
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toMatch(/Windows recorded hardware errors/);
    expect(within(rows()[0]).getByText("Most likely")).toBeTruthy();
    // Nothing of the block shows until the row is opened.
    expect(screen.queryByTestId("paramedic-hardware")).toBeNull();
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This looks like hardware");
    expect(within(block()).getByText(EN.intro)).toBeTruthy();
    const steps = within(block()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps.slice(0, 3)).toEqual([EN.step1, EN.step2, EN.step3]);
    expect(card()).not.toMatch(/How to fix it|How to test this/);
    expect(card()).not.toMatch(/One change lines up|A change lines up|Try the steps under the first one/);
    expect(screen.getByText("Open the first one to see what you can check. If you change anything, play Game A once, then press Something's wrong again.")).toBeTruthy();
  });

  it("a hardware lead offers no button: nothing in its block can change the PC", async () => {
    await ask(found([likely()]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(within(block()).queryAllByRole("button")).toEqual([]);
    expect(within(block()).queryAllByRole("link")).toEqual([]);
  });

  it('a possible hardware finding says "This may be hardware" and never "looks like"', async () => {
    await ask(found([hardware("possible", [count(1), clean])]));
    expect(verdict()).toBe("Windows recorded at least one hardware error in the same period, but Compy can't prove it is behind this.");
    expect(rows()[0].textContent).toMatch(/Windows recorded a hardware error/);
    expect(rows()[0].textContent).not.toMatch(/hardware errors/);
    expect(within(rows()[0]).getByText("Possible")).toBeTruthy();
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
    // The whole opened row and the verdict above it.
    const said = `${verdict()} ${rows()[0].textContent}`;
    expect(said).not.toMatch(/looks like/i);
    expect(said).not.toMatch(/Most likely/);
    expect(card()).not.toMatch(/How to fix it|How to test this/);
  });

  it("the steps are the same at Possible and at Most likely; only the heading differs", async () => {
    const stepsOf = async (f: F) => {
      await ask(found([f]));
      fireEvent.click(within(rows()[0]).getByRole("button"));
      const lines = within(block()).getAllByRole("listitem").map((li) => li.textContent).slice(0, 3);
      const title = screen.getByTestId("paramedic-hardware-title").textContent;
      cleanup();
      return { lines, title };
    };
    const a = await stepsOf(likely());
    const b = await stepsOf(hardware("possible", [count(2), clean]));
    expect(a.lines).toEqual(b.lines);
    expect(a.lines).toEqual([EN.step1, EN.step2, EN.step3]);
    expect([a.title, b.title]).toEqual(["This looks like hardware", "This may be hardware"]);
  });

  it('the hardware lead never shows "until you try the fix"', async () => {
    await ask(found([likely()]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByText("Compy can't prove this from the records alone.")).toBeTruthy();
    expect(card()).not.toMatch(/until you try the fix/);
    cleanup();
    // The other leads keep their own line.
    await ask(found([driver("likely")]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByText("Compy can't prove this until you try the fix and play again.")).toBeTruthy();
    expect(card()).not.toMatch(/from the records alone/);
  });

  it("the evidence lines give counts and dates, and the lines to pass on repeat them", async () => {
    await ask(found([likely()]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const many = /^Windows recorded hardware errors at 2 separate times between .+ and .+ \(source: WHEA-Logger; records under a minute apart count once\)\.$/;
    const lines = tell();
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(many);
    expect(lines[1]).toBe("1 of these fell during or just after a Game A session Compy measured as rough.");
    expect(lines[2]).toBe(EN.tellPart);
    expect(screen.getByText("Compy found none during or just after the 4 normal Game A sessions it checked, and its read of Windows' log goes back past the oldest of them.")).toBeTruthy();
  });

  it("the rough-session line is absent when no record sat in a rough session", async () => {
    await ask(found([hardware("possible", [count(2), clean])]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const lines = tell();
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(EN.tellPart);
    expect(card()).not.toMatch(/measured as rough/);
  });

  it('a lone record in a rough session says "It fell", never "1 of these"', async () => {
    await ask(found([hardware("possible", [count(1), inRough(1, 1), clean])]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const lines = tell();
    expect(lines[0]).toMatch(/^Windows recorded a hardware error on .+ \(source: WHEA-Logger\)\.$/);
    expect(lines[1]).toBe("It fell during or just after a Game A session Compy measured as rough.");
    expect(card()).not.toMatch(/of these/);
  });

  it("a record in a normal session is shown as weakening the lead", async () => {
    await ask(found([hardware("possible", [count(2), inRough(1, 2), inNormal(1)], { in_play: false })]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const li = screen.getByText("Windows also recorded one while Game A was running in its usual range, or just after.").closest("li")!;
    expect(within(li).getByText("Weakens this")).toBeTruthy();
    expect(card()).not.toMatch(/Compy found none during/);
    cleanup();
    await ask(found([hardware("possible", [count(2), inNormal(3)], { in_play: false })]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByText("Windows also recorded 3 of them while Game A was running in its usual range, or just after.")).toBeTruthy();
  });

  it("normal sessions the read did not reach are said as not read, never as clean", async () => {
    await ask(found([hardware("possible", [count(2), inRough(1, 2), unread])]));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const line = screen.getByText(/^Compy's read of Windows' log only reaches back to .+, so it can't tell whether such errors were also recorded during the normal sessions before that\.$/);
    expect(within(line.closest("li")!).getByText("Not recorded")).toBeTruthy();
    expect(card()).not.toMatch(/Compy found none during/);
  });

  it('a tie with a hardware lead never says "two changes" or "easier to undo"', async () => {
    await ask(found([likely(), driver("likely")], { why_first: "tie" }));
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(card()).toMatch(/Why this one first: Windows' hardware error records and another change line up equally\. Compy can't rank one above the other\./);
    expect(card()).not.toMatch(/easier to undo|Two changes line up/);
  });

  it("a hardware finding behind another lead leaves that lead's sentences as they were", async () => {
    await ask(found([driver("likely"), hardware("possible", [count(1), clean])]));
    expect(verdict()).toBe("One change lines up best with what happened. It's listed first.");
    expect(screen.getByText(/Try the steps under the first one, play Game A once/)).toBeTruthy();
    expect(rows().length).toBe(2);
    fireEvent.click(within(rows()[1]).getByRole("button"));
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("This may be hardware");
    // "Can't prove" belongs to the lead only; the second row gets neither sentence.
    expect(card()).not.toMatch(/from the records alone/);
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
  step1: "如果你在 BIOS 里改过超频、降压或内存配置文件（XMP 或 EXPO），先把它改回默认值，再玩一次 Game A，然后再点“出问题了”。",
  step2: "按 Windows + X，打开“事件查看器”。在“Windows 日志”下打开“系统”，按来源 WHEA-Logger 筛选。逐条打开，看 Windows 对它的描述。",
  step3: "如果 BIOS 设置全部恢复默认后 Windows 仍在记录这类错误，把下面这几行告诉电脑厂商或维修店：",
  intro: "当电脑的某个部件报告自身出错时，Windows 会留下一条记录。对此 Compy 没有可以更改的设置。你可以这样做：",
  tellPart: "Compy 没有读取是电脑的哪个部件报告的。",
};

describe("a hardware lead on the Something's-wrong card (zh-CN)", () => {
  it("最有可能的硬件线索：说“这看起来是硬件问题”，不出现“如何解决”", async () => {
    await ask(found([likely()]), "zh-CN");
    expect(verdict()).toBe("Windows 的硬件错误记录与发生的情况最吻合，已排在最前面。");
    expect(rows()[0].textContent).toMatch(/Windows 记录了硬件错误/);
    expect(within(rows()[0]).getByText("最有可能")).toBeTruthy();
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("这看起来是硬件问题");
    expect(within(block()).getByText(ZH.intro)).toBeTruthy();
    const steps = within(block()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps.slice(0, 3)).toEqual([ZH.step1, ZH.step2, ZH.step3]);
    expect(card()).not.toMatch(/如何解决|如何验证这一点/);
    expect(card()).not.toMatch(/有一项变化|先试试第一项里的步骤/);
    expect(screen.getByText("点开第一项，看看你可以检查什么。如果你改了什么，再玩一次 Game A，然后再点“出问题了”。")).toBeTruthy();
    // "Can't prove", without "until you try the fix".
    expect(screen.getByText("仅凭这些记录，Compy 无法证明这一点。")).toBeTruthy();
    expect(card()).not.toMatch(/在你试过解决办法/);
    const lines = tell();
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^在 .+ 到 .+ 之间，Windows 在 2 个不同的时间记录了硬件错误（来源：WHEA-Logger；相隔不到一分钟的记录算作一次）。$/);
    expect(lines[1]).toBe("其中 1 次落在 Compy 测为不顺的 Game A 运行期间或刚结束之后。");
    expect(lines[2]).toBe(ZH.tellPart);
    expect(screen.getByText("在 Compy 查看的 4 次 Game A 正常运行期间及刚结束之后，没有找到这类记录；Compy 这次读取 Windows 日志追溯到了其中最早一次之前。")).toBeTruthy();
    expect(within(block()).queryAllByRole("button")).toEqual([]);
  });

  it("有可能的硬件线索：说“这有可能是硬件问题”，不说“看起来”", async () => {
    await ask(found([hardware("possible", [count(1), inRough(1, 1), inNormal(1), unread], { in_play: false })]), "zh-CN");
    expect(verdict()).toBe("Windows 在同一时期记录了至少一次硬件错误，但 Compy 无法证明问题出在这里。");
    expect(rows()[0].textContent).toMatch(/Windows 记录了一次硬件错误/);
    expect(within(rows()[0]).getByText("有可能")).toBeTruthy();
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(screen.getByTestId("paramedic-hardware-title").textContent).toBe("这有可能是硬件问题");
    const said = `${verdict()} ${rows()[0].textContent}`;
    expect(said).not.toMatch(/看起来/);
    expect(said).not.toMatch(/最有可能/);
    const lines = tell();
    expect(lines[0]).toMatch(/^Windows 在 .+ 记录了一次硬件错误（来源：WHEA-Logger）。$/);
    expect(lines[1]).toBe("它落在 Compy 测为不顺的 Game A 运行期间或刚结束之后。");
    expect(screen.getByText("在 Game A 正常运行期间或刚结束之后，Windows 也记录了一次。")).toBeTruthy();
    expect(screen.getByText(/^Compy 这次读取 Windows 日志只追溯到 .+，所以说不准在那之前的正常运行期间是否也记录了这类错误。$/)).toBeTruthy();
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

  it("并列时不说“两项改动”或“更容易撤销”", async () => {
    await ask(found([likely(), driver("likely")], { why_first: "tie" }), "zh-CN");
    fireEvent.click(within(rows()[0]).getByRole("button"));
    expect(card()).toMatch(/Windows 的硬件错误记录和另一项变化同样吻合，Compy 分不出哪一项在前。/);
    expect(card()).not.toMatch(/更容易撤销|有两项改动/);
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
    return out;
  };
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("both languages carry the same keys with the same placeholders", () => {
    const [en, zh] = [added("en"), added("zh-CN")];
    expect(Object.keys(en).length).toBe(26);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(placeholders(zh[k]), k).toEqual(placeholders(en[k]));
  });

  it("en and zh hardware sentences hold none of the five barred words and no part name", () => {
    const barredEn = /\b(caused?|causes|causing|fixe[sd]|guarantee\w*|safe\w*|probably)\b/i;
    const barredZh = /导致|造成|引起|修好|修复|保证|安全|大概|多半|很可能/;
    const partEn = /\b(CPU|GPU|RAM|processor|graphics card|motherboard|power supply|PSU|SSD|hard drive|memory stick)\b/i;
    const partZh = /处理器|显卡|主板|电源|硬盘|内存条|CPU|GPU/;
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

  it('"looks like" is only the Most-likely heading, and no sentence says "none" about an unread log', () => {
    const en = added("en");
    for (const [k, s] of Object.entries(en)) if (k !== "hardware.titleLikely") expect(s, k).not.toMatch(/looks like/i);
    const zh = added("zh-CN");
    for (const [k, s] of Object.entries(zh)) if (k !== "hardware.titleLikely") expect(s, k).not.toMatch(/看起来/);
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
