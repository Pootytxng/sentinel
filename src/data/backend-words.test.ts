import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import i18n from "../i18n";
import { appliedValueLabel, careHeadline, friendlyHeadline, incidentKindLabel } from "./backend-words";
import { FRIENDLY_LABELS } from "./friendly-labels";

// CR-zh-backend-home (view-1112a/14-home-zh-CN.png): zh-CN Health printed backend English. Words with
// a stable id are translated; names never are; a value outside the closed set is shown as sent.
const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");

const crash = {
  kind: "App crash",
  app_label: "ROB RUN",
  occurred_at: "2026-11-11T14:36:00-08:00",
  occurred_display: "Nov 11, 2:36 PM",
  summary: "ROB RUN stopped working and closed — Nov 11, 2:36 PM",
};

describe("careHeadline", () => {
  it("English keeps the backend's own sentence byte for byte", () => {
    expect(careHeadline(crash, en, "en")).toBe(crash.summary);
    const withGame = { ...crash, summary: "dllhost stopped working and closed — Nov 11, 2:36 PM, while ROB RUN was running" };
    expect(careHeadline(withGame, en, "en-US")).toBe(withGame.summary);
  });

  it("zh-CN composes it from the kind tag, keeps the app's own name, dates it in Chinese", () => {
    const h = careHeadline(crash, zh, "zh-CN");
    expect(h).toContain("ROB RUN 已停止工作并关闭");
    expect(h).toContain("11月11日");
    expect(h).not.toMatch(/stopped|Nov/);
    expect(careHeadline({ ...crash, app_label: null }, zh, "zh-CN")).toContain("一个应用程序崩溃了");
    expect(careHeadline({ ...crash, kind: "Blue screen", app_label: null }, zh, "zh-CN")).toContain("蓝屏");
  });

  it("an unknown kind, an unreadable stamp or an empty sentence fall back honestly", () => {
    expect(careHeadline({ ...crash, kind: "Something new" }, zh, "zh-CN")).toBe(crash.summary);
    expect(careHeadline({ ...crash, occurred_at: "garbage" }, zh, "zh-CN")).toContain("Nov 11, 2:36 PM");
    expect(careHeadline({ ...crash, summary: "  " }, zh, "zh-CN")).toBe("");
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
