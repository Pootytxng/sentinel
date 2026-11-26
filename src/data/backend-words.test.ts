import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import i18n from "../i18n";
import {
  appliedValueLabel,
  careHeadline,
  friendlyHeadline,
  incidentKindLabel,
  incidentWhen,
  READINESS_MIRROR,
  readinessWords,
} from "./backend-words";
import { FRIENDLY_LABELS } from "./friendly-labels";

// CR-zh-backend-home (view-1112a/14-home-zh-CN.png): zh-CN Health printed backend English. Words with
// a stable id are translated; names never are; a value outside the closed set is shown as sent.
const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");

// d10: a card written by this build carries `headline_parts`; the English `summary` beside it is what
// Rust wrote for the same parts.
const crash = {
  kind: "App crash",
  app_label: "ROB RUN",
  occurred_at: "2026-11-11T14:36:00-08:00",
  occurred_display: "Nov 11, 2:36 PM",
  summary: "ROB RUN stopped working and closed — Nov 11, 2:36 PM",
  headline_parts: { code: "app_crash", app: "ROB RUN", while_game: null } as { code: string; app: string | null; while_game: string | null } | null,
};

describe("careHeadline", () => {
  it("English, worded from the code, says exactly the backend's own sentence", () => {
    expect(careHeadline(crash, en, "en")).toBe(crash.summary);
    const withGame = {
      ...crash,
      summary: "dllhost stopped working and closed — Nov 11, 2:36 PM, during or just after a ROB RUN session Compy recorded",
      headline_parts: { code: "app_crash", app: "dllhost", while_game: "ROB RUN" },
    };
    expect(careHeadline(withGame, en, "en-US")).toBe(withGame.summary);
  });

  it("zh-CN words it from the code, keeps the app's own name, dates it in Chinese", () => {
    const h = careHeadline(crash, zh, "zh-CN");
    expect(h).toContain("ROB RUN 已停止工作并关闭");
    expect(h).toContain("11月11日");
    expect(h).not.toMatch(/stopped|Nov/);
    const noApp = { code: "app_crash_no_app", app: null, while_game: null };
    expect(careHeadline({ ...crash, headline_parts: noApp }, zh, "zh-CN")).toContain("一个应用程序崩溃了");
    const bsod = { code: "blue_screen", app: null, while_game: null };
    expect(careHeadline({ ...crash, headline_parts: bsod }, zh, "zh-CN")).toContain("蓝屏");
  });

  it("keeps the session-game clause from its value, the game's name untranslated", () => {
    const s = {
      ...crash,
      summary: "dllhost stopped working and closed — Nov 11, 2:36 PM, during or just after a ROB RUN session Compy recorded",
      headline_parts: { code: "app_crash", app: "dllhost", while_game: "ROB RUN" },
    };
    const h = careHeadline(s, zh, "zh-CN");
    expect(h).toContain("dllhost 已停止工作并关闭");
    expect(h).toContain("发生在 Compy 记录的一次 ROB RUN 会话期间或刚结束后");
    expect(h).not.toMatch(/during|session|recorded/);
  });

  it("a card stored before the code existed shows its stored sentence as it is, in every language", () => {
    const old = { ...crash, headline_parts: null };
    expect(careHeadline(old, zh, "zh-CN")).toBe(crash.summary);
    expect(careHeadline({ ...old, headline_parts: undefined }, zh, "zh-CN")).toBe(crash.summary);
    expect(careHeadline(old, en, "en")).toBe(crash.summary);
  });

  it("dates at the stamp's own offset, as the backend does, whatever zone this machine is in (review r1)", () => {
    // 00:30 at +09:00 is the 12th there; the machine's own zone must not move it to the 11th.
    const late = { ...crash, occurred_at: "2026-11-12T00:30:00+09:00", occurred_display: "Nov 12, 12:30 AM" };
    expect(incidentWhen(late, "zh-CN")).toContain("11月12日");
    expect(incidentWhen(late, "zh-CN")).toMatch(/\b0?0:30\b/);
    expect(incidentWhen({ ...crash, occurred_at: "2026-11-11T22:36:00Z" }, "zh-CN")).toContain("11月11日");
    // English and a stamp with no readable offset keep the backend's display string.
    expect(incidentWhen(late, "en")).toBe("Nov 12, 12:30 AM");
    expect(incidentWhen({ ...late, occurred_at: "2026-11-12T00:30:00" }, "zh-CN")).toBe("Nov 12, 12:30 AM");
  });

  it("an unknown code, an unreadable stamp or an empty old sentence fall back honestly", () => {
    // An unknown code gets the fixed plain sentence, never the backend's English.
    const newer = { ...crash, headline_parts: { code: "a_newer_code", app: null, while_game: null } };
    expect(careHeadline(newer, zh, "zh-CN")).toMatch(/^Windows 记录了此版本 Compy 没有对应说明的内容 — 11月11日/);
    expect(careHeadline(newer, zh, "zh-CN")).not.toContain("stopped working");
    expect(careHeadline(newer, en, "en")).toBe("Windows recorded something this version of Compy has no sentence for — Nov 11, 2:36 PM");
    expect(careHeadline({ ...crash, occurred_at: "garbage" }, zh, "zh-CN")).toContain("Nov 11, 2:36 PM");
    expect(careHeadline({ ...crash, headline_parts: null, summary: "  " }, zh, "zh-CN")).toBe("");
  });
});

describe("incidentKindLabel and appliedValueLabel", () => {
  it("every backend tag and label has its English as sent and a Chinese word", () => {
    // blackbox.rs IncidentKind::tag and history.rs applied_label_from_action, read from the source
    // so a new value there can't be missed here.
    const bb = readFileSync("src-tauri/src/blackbox.rs", "utf8");
    const tags = [...bb.slice(bb.indexOf("fn tag(self)"), bb.indexOf("fn tag(self)") + 600).matchAll(/=> "([^"]+)"/g)].map((m) => m[1]);
    expect(tags.length).toBe(6);
    for (const tag of tags) {
      expect(incidentKindLabel(tag, en)).toBe(tag);
      expect(incidentKindLabel(tag, zh)).not.toBe(tag);
    }
    const hist = readFileSync("src-tauri/src/history.rs", "utf8");
    const at = hist.indexOf("fn applied_label_from_action");
    const body = hist.slice(at, hist.indexOf("Some(label.to_string())", at));
    const labels = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(11);
    for (const l of labels) {
      expect(appliedValueLabel(l, en)).toBe(l);
      expect(appliedValueLabel(l, zh)).not.toBe(l);
    }
    expect(appliedValueLabel("On", zh)).toBe("开启");
    expect(appliedValueLabel("Something new", zh)).toBe("Something new");
    expect(incidentKindLabel("Something new", zh)).toBe("Something new");
  });
});

describe("friendlyHeadline", () => {
  it("English is the friendly-labels headline; zh-CN has its own; no label, no headline", () => {
    for (const [id, f] of Object.entries(FRIENDLY_LABELS)) {
      expect(friendlyHeadline(id, en)).toBe(f.headline);
      expect(friendlyHeadline(id, zh)).not.toBe(f.headline);
    }
    expect(friendlyHeadline("game-mode", zh)).toBe("让 Windows 专注于你的游戏");
    expect(friendlyHeadline("no-such-rec", zh)).toBeNull();
    expect(friendlyHeadline("constructor", zh)).toBeNull();
  });
});

// CR-zh-readiness-words: zh-CN Health's limiter card printed readiness.rs English; h4-plan: the
// flagged power-plan row is now Power saver only, with no unmeasured effect claim.
describe("readinessWords", () => {
  const plan = {
    id: "power-profile",
    status: "attention",
    label: "Power plan is set to save power",
    detail:
      'Active plan "Power saver". Windows designed this plan to save power. Compy has not measured its effect on this PC. Compy changes nothing by itself. You can switch plans in Windows Settings, Power.',
  };

  it("English gets the backend's own words, byte for byte", () => {
    expect(readinessWords(plan, en, "en")).toEqual({ label: plan.label, detail: plan.detail });
  });

  it("zh-CN translates by (id, status), keeping the plan's name as Windows has it", () => {
    const w = readinessWords(plan, zh, "zh-CN");
    expect(w.label).toBe("电源计划设为节能");
    expect(w.detail).toBe(
      "当前计划为“Power saver”。Windows 将此计划设计为节省电力。Compy 尚未测量它对这台电脑的影响。Compy 自己不会更改任何内容。你可以在 Windows 设置的“电源”中切换计划。",
    );
  });

  it("names and numbers are lifted from the sentence and put back untranslated", () => {
    const gpu = readinessWords(
      {
        id: "gpu-driver-age",
        status: "attention",
        label: "GPU driver over a year old",
        detail: "AMD Radeon RX 7800 XT (2) driver is over a year old (412 days). Updating is recommended.",
      },
      zh,
      "zh-CN",
    );
    expect(gpu.detail).toBe("AMD Radeon RX 7800 XT (2) 的驱动已超过一年（412 天）。建议更新。");
    const hz = readinessWords(
      {
        id: "monitor-refresh",
        status: "attention",
        label: "Monitor below max refresh",
        detail: "Running at 60 Hz but the display supports 250 Hz. Set the higher rate in Windows Display settings → Advanced display.",
      },
      zh,
      "zh-CN",
    );
    expect(hz.detail).toContain("60 Hz");
    expect(hz.detail).toContain("250 Hz");
    expect(hz.detail).not.toMatch(/Running|display/);
    // A plan named like a template slot or with regex characters is taken as sent.
    const odd = readinessWords({ ...plan, status: "ready", label: "Power profile", detail: 'Active plan "a.*(b) {{x}}".' }, zh, "zh-CN");
    expect(odd.detail).toBe("当前计划为“a.*(b) {{x}}”。");
  });

  it("a sentence, status or label that matches no mirror is shown as sent (never guessed)", () => {
    for (const c of [
      { ...plan, detail: plan.detail + " Something newer." },
      { ...plan, status: "ready" },
      { ...plan, label: "Power plan" },
      { ...plan, id: "install-drive" },
    ]) {
      expect(readinessWords(c, zh, "zh-CN")).toEqual({ label: c.label, detail: c.detail });
    }
  });

  it("every mirrored sentence is still what readiness.rs says, and the en locale says it too", () => {
    const rs = readFileSync("src-tauri/src/readiness.rs", "utf8").replace(/\\\r?\n\s*/g, "").replace(/\\"/g, '"');
    for (const v of READINESS_MIRROR) {
      expect(rs, v.label).toContain(`"${v.label}"`);
      for (const part of v.detail.split(/\{\{\w+\}\}/).filter(Boolean)) {
        expect(rs, v.detail).toContain(part);
      }
      expect(en(v.labelKey)).toBe(v.label);
      expect(en(v.detailKey, { interpolation: { escapeValue: false } })).toBe(v.detail);
      expect(zh(v.labelKey)).not.toBe(v.label);
      expect(zh(v.detailKey)).not.toBe(v.detail);
    }
  });
});
