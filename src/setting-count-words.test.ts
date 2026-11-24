import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// SETTING-COUNT WORDS (D7, the C7 follow-up). A count of SETTINGS says settings, never bare "changes".
//
// C7 made the footer and Home say "settings" for per-setting counts ("N settings can be undone", "Settings in
// effect") and "records" for ledger rows (row-count-words-guard.test.ts). Its review (_train/c7-d3b-review-r1-unrun.md
// §6) listed five more labels that count SETTINGS but still said "changes". Each number below is per setting:
//   - home.homeConsole.inEffect.unconfirmed: the Machine Model's in_effect_unknown (HomeConsole.tsx, inEffect.unknown);
//   - home.posture.changeNote / changeNoteReversible: inEffect.activeNow, settings whose live check reads on
//     (system-posture.ts, command-center-data.ts);
//   - blackbook.blackbookConsole.sessionBody.changesOn, monitor.monitorConsole.changesOn, monitor.sessionStack.changesOn:
//     a session's compy_changes_active, counted per change (one per setting) by history::live_change_groups
//     (sessions.rs `compy_changes_per_change`; older rows counted the newest row per change, still one per setting);
//   - blackbook.blackbookConsole.manageJump: liveChangeGroups(...).active.length (logbook-view.ts), settings still on.
// NOT here (owner-held): the Blackbook tile "CHANGES COMPY MADE" and the Test room's "N of M on".
//
// Break check: restore blackbook.blackbookConsole.sessionBody.changesOn_other (en) to "{{count}} changes on" -> the
// en test fails naming the key; restore zh-CN blackbook.blackbookConsole.manageJump_other to "…这 {{count}} 项优化中的
// 任意一项" -> the zh test fails (no 设置, and 优化).

const LOCALES_DIR = join("src", "i18n", "locales");

const SETTING_COUNT_KEYS = [
  "home.homeConsole.inEffect.unconfirmed",
  "home.posture.changeNote",
  "home.posture.changeNoteReversible",
  "blackbook.blackbookConsole.sessionBody.changesOn",
  "blackbook.blackbookConsole.manageJump",
  "monitor.monitorConsole.changesOn",
  "monitor.sessionStack.changesOn",
];

function flatten(obj: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = `${prefix}.${k}`;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

function locale(name: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(join(LOCALES_DIR, name)).filter((x) => x.endsWith(".json"))) {
    flatten(JSON.parse(readFileSync(join(LOCALES_DIR, name, f), "utf8")), f.replace(/\.json$/, ""), out);
  }
  return out;
}

/** The key's strings: the key itself and every plural form of it. */
function forms(strings: Map<string, string>, key: string): [string, string][] {
  const plural = new RegExp(`^${key.replace(/\./g, "\\.")}_(zero|one|two|few|many|other)$`);
  return [...strings.entries()].filter(([k]) => k === key || plural.test(k));
}

describe("a count of settings says settings (D7)", () => {
  it("en: every form names settings and never says bare 'change(s)'", () => {
    const en = locale("en");
    const offenders: string[] = [];
    for (const key of SETTING_COUNT_KEYS) {
      const found = forms(en, key);
      if (found.length === 0) offenders.push(`${key}: no string`);
      for (const [k, s] of found) {
        if (!/\bsettings?\b/i.test(s)) offenders.push(`${k}: no "setting(s)" in "${s}"`);
        if (/\bchanges?\b/i.test(s)) offenders.push(`${k}: says "change(s)" in "${s}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("zh-CN: every form names 设置 and never 优化 (a tweak is not a setting count)", () => {
    const zh = locale("zh-CN");
    const offenders: string[] = [];
    for (const key of SETTING_COUNT_KEYS) {
      const found = forms(zh, key);
      if (found.length === 0) offenders.push(`${key}: no string`);
      for (const [k, s] of found) {
        if (!s.includes("设置")) offenders.push(`${k}: no 设置 in "${s}"`);
        if (s.includes("优化")) offenders.push(`${k}: says 优化 in "${s}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // D7 review r1 F1: the SESSION count (compy_changes_active, taken when the session began: sessions.rs
  // SessionAccumulator::with_counts) is "on" only on rows counted by the per-change rule; rows saved before 453-f1
  // (compy_changes_per_change false) counted every setting not read as off, unreadable and unprobed included
  // (sessions.rs:125-129, history.rs ActiveCheck::legacy_active). No TS reader tells the two apart, so every session
  // label says "on or unconfirmed", true on both. Break check: restore monitor.sessionStack.changesOn_other to
  // "{{count}} COMPY-CHANGED SETTINGS ON" (or zh blackbook sessionBody.changesOn_other to "...处于开启状态") -> fails.
  it("the four session-start labels say 'on or unconfirmed', never plain 'on' (both counting rules)", () => {
    const SESSION_KEYS = [
      "blackbook.blackbookConsole.sessionBody.changesOn",
      "monitor.monitorConsole.changesOn",
      "monitor.sessionStack.changesOn",
      "monitor.sessionDebrief.changesActive",
    ];
    const en = locale("en");
    const zh = locale("zh-CN");
    const offenders: string[] = [];
    for (const key of SESSION_KEYS) {
      const enForms = forms(en, key);
      const zhForms = forms(zh, key);
      if (enForms.length === 0 || zhForms.length === 0) offenders.push(`${key}: missing en or zh`);
      for (const [k, s] of enForms) {
        if (!/\bon or unconfirmed\b/i.test(s)) offenders.push(`${k}: no "on or unconfirmed" in "${s}"`);
        if (!/\bsettings?\b/i.test(s)) offenders.push(`${k}: no "setting(s)" in "${s}"`);
      }
      for (const [k, s] of zhForms) {
        if (!/(已开启或无法确认|处于开启状态或无法确认)/.test(s)) offenders.push(`${k}: no 已开启或无法确认 in "${s}"`);
        if (!s.includes("设置")) offenders.push(`${k}: no 设置 in "${s}"`);
      }
    }
    expect(offenders).toEqual([]);
    const debrief = readFileSync(join("src", "surfaces", "SessionDebrief.tsx"), "utf8");
    expect(debrief).toContain('t("monitor.sessionDebrief.changesActive", { count: s.compy_changes_active })');
  });

  it("each key is still reached by the surface named above (the list is not stale)", () => {
    const src = (p: string) => readFileSync(join("src", ...p.split("/")), "utf8");
    expect(src("surfaces/HomeConsole.tsx")).toContain('t("home.homeConsole.inEffect.unconfirmed", { count: inEffect.unknown })');
    expect(src("surfaces/system-posture.ts")).toContain('t("home.posture.changeNote", { count: activeChanges })');
    expect(src("surfaces/command-center-data.ts")).toContain('t("home.posture.changeNoteReversible", { count: activeChanges })');
    expect(src("surfaces/blackbook/LogbookTape.tsx")).toContain('t("blackbook.blackbookConsole.sessionBody.changesOn", { count: r.changesActive })');
    expect(src("surfaces/blackbook/logbook-view.ts")).toContain('t("blackbook.blackbookConsole.manageJump", { count: counts.active })');
    expect(src("surfaces/MonitorConsole.tsx")).toContain('t("monitor.monitorConsole.changesOn", { count: latest.compy_changes_active })');
    expect(src("surfaces/monitor/SessionStack.tsx")).toContain('t("monitor.sessionStack.changesOn", { count: s.compy_changes_active })');
  });
});
