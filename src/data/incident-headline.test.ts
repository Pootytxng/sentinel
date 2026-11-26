import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import i18n from "../i18n";
import zhCommon from "../i18n/locales/zh-CN/common.json";
import { HEADLINE_CODES, incidentHeadline, incidentWording, recordWhen } from "./incident-headline";

// d10: crash-record headlines in the user's language. Rust sends a closed code plus values
// (blackbox.rs HeadlineParts); every surface words it through incident-headline.ts. The en keys are
// pinned to Rust's sentence on the Rust side (blackbox.rs
// every_headline_code_has_an_en_key_that_says_what_rust_says); this file pins the rest.
const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");

const WHEN = "2026-06-12T21:42:00-07:00";
const WHEN_DISPLAY = "Jun 12, 9:42 PM";
const rec = (code: string, app: string | null, game: string | null = null, headline = "STORED ENGLISH") => ({
  headline_parts: { code, app, while_game: game },
  headline,
  when: WHEN,
  when_display: WHEN_DISPLAY,
});

// Every code, the value it takes, and the literal sentence it renders (no tail).
const zhWhen = recordWhen(WHEN, WHEN_DISPLAY, "zh-CN");
const CASES: [string, string | null, string, string][] = [
  ["gpu_timeout", null, "Your graphics driver stopped responding and recovered — Jun 12, 9:42 PM", `你的显卡驱动停止响应后已恢复 — ${zhWhen}`],
  ["app_crash", "ROB RUN", "ROB RUN stopped working and closed — Jun 12, 9:42 PM", `ROB RUN 已停止工作并关闭 — ${zhWhen}`],
  ["app_crash_no_app", null, "An application crashed — Jun 12, 9:42 PM", `一个应用程序崩溃了 — ${zhWhen}`],
  ["app_hang", "ROB RUN", "ROB RUN stopped responding (froze) — Jun 12, 9:42 PM", `ROB RUN 停止响应（卡死）— ${zhWhen}`],
  ["app_hang_no_app", null, "An application stopped responding — Jun 12, 9:42 PM", `一个应用程序停止响应 — ${zhWhen}`],
  ["unexpected_shutdown", null, "Your PC shut down unexpectedly or hard-froze — Jun 12, 9:42 PM", `你的电脑意外关机或卡死 — ${zhWhen}`],
  ["blue_screen", null, "Your PC blue-screened and restarted — Jun 12, 9:42 PM", `你的电脑蓝屏并已重启 — ${zhWhen}`],
  ["hardware_error", null, "Windows logged a hardware-level error — Jun 12, 9:42 PM", `Windows 记录了一个硬件级错误 — ${zhWhen}`],
];

describe("the code list", () => {
  // Break check: drop "hardware_error" from HEADLINE_CODES in incident-headline.ts (or add a code to
  // the Rust const only) -> this fails.
  it("equals the Rust set, in order (blackbox.rs HEADLINE_CODES)", () => {
    const rs = readFileSync("src-tauri/src/blackbox.rs", "utf8");
    const body = /const HEADLINE_CODES: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rs)?.[1];
    expect(body, "HEADLINE_CODES is gone from blackbox.rs or was renamed").toBeTruthy();
    const rust = [...body!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...HEADLINE_CODES]).toEqual(rust);
  });

  it("every code in the list has a case here", () => {
    expect(CASES.map((c) => c[0])).toEqual([...HEADLINE_CODES]);
  });
});

describe("each code renders its en and zh-CN literal", () => {
  // Break check: swap the appHang and appHangNoApp keys in sentence() -> the en and zh rows fail.
  it.each(CASES)("%s", (code, app, enText, zhText) => {
    expect(zhWhen).toContain("6月12日");
    expect(incidentHeadline(rec(code, app), en, "en")).toBe(enText);
    expect(incidentHeadline(rec(code, app), zh, "zh-CN")).toBe(zhText);
    // The tail is a value of every code, the game's name untranslated.
    expect(incidentHeadline(rec(code, app, "Helldivers2"), en, "en")).toBe(
      `${enText}, during or just after a Helldivers2 session Compy recorded`,
    );
    expect(incidentHeadline(rec(code, app, "Helldivers2"), zh, "zh-CN")).toBe(
      `${zhText}，发生在 Compy 记录的一次 Helldivers2 会话期间或刚结束后`,
    );
    // The group line's wording is the same sentence without its time.
    expect(incidentWording(rec(code, app), en)).toBe(enText.replace(" — Jun 12, 9:42 PM", ""));
    expect(incidentWording(rec(code, app), zh)).toBe(zhText.replace(/\s?— .*$/, ""));
  });

  it("no zh-CN sentence can be swapped for another: none is a substring of another in its list", () => {
    // Break check: set zh headlineWhat.appHangNoApp to "一个应用程序停止响应（卡死）" -> fails.
    for (const list of [zhCommon.backendWords.headline, zhCommon.backendWords.headlineWhat] as Record<string, string>[]) {
      const texts = Object.entries(list)
        .filter(([k]) => k !== "whileGame")
        .map(([k, v]) => [k, v.replace(/\{\{\w+\}\}/g, "").replace(/—.*$/, "").trim()] as const);
      for (const [a, ta] of texts)
        for (const [b, tb] of texts) if (a !== b) expect(tb.includes(ta), `zh ${a} sits inside zh ${b}`).toBe(false);
    }
  });
});

describe("what is shown when the code can't be worded", () => {
  // Break check: make incidentHeadline return src.headline for an unknown code -> fails.
  it("an unknown code shows the fixed plain sentence, never the backend's text", () => {
    const newer = rec("a_code_from_a_newer_build", null, null, "Something Rust said in English — Jun 12, 9:42 PM");
    expect(incidentHeadline(newer, en, "en")).toBe("A record this version of Compy can't describe — Jun 12, 9:42 PM");
    expect(incidentWording(newer, en)).toBe("A record this version of Compy can't describe");
    expect(incidentHeadline(newer, zh, "zh-CN")).toBe(`一条此版本 Compy 无法描述的记录 — ${zhWhen}`);
    expect(incidentWording(newer, zh)).toBe("一条此版本 Compy 无法描述的记录");
    // An app code that arrived without its app is not guessed at either.
    expect(incidentHeadline(rec("app_crash", null), en, "en")).toMatch(/^A record this version of Compy can't describe/);
  });

  // Break check: make incidentHeadline word a record without parts from `when` alone -> fails.
  it("an old record without a code shows its stored headline as it is, in every language", () => {
    const old = { headline: "Your PC blue-screened and restarted — Jun 12, 9:42 PM", when: WHEN, when_display: WHEN_DISPLAY };
    expect(incidentHeadline(old, zh, "zh-CN")).toBe(old.headline);
    expect(incidentHeadline({ ...old, headline_parts: null }, en, "en")).toBe(old.headline);
    expect(incidentWording(old, zh)).toBe("Your PC blue-screened and restarted");
  });
});

// The literal-key rule: a computed t() key can't be checked by the parity, orphan or swap guards.
// incident-headline.ts must have none; the other files this slice touched keep exactly the computed
// keys they already had before it (pinned, so a new one fails; `t(lineKey, ...)` in BlackBox.tsx was
// removed by this slice and must not come back).
function computedTCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bt\(\s*/g)) {
    const rest = src.slice((m.index ?? 0) + m[0].length);
    if (rest.startsWith('"') || rest.startsWith(")")) continue;
    out.push(rest.slice(0, 40).replace(/\s+/g, " ").trim().slice(0, 16));
  }
  return out.sort();
}

describe("no t() call with a non-literal key in the touched files", () => {
  // Break check: in incident-headline.ts write t(`common.backendWords.headline.${key}`, ...) -> fails;
  // in BlackBox.tsx put back t(lineKey, { count, app, range }) -> fails.
  it("incident-headline.ts has only literal keys, all under common.backendWords", () => {
    const src = readFileSync("src/data/incident-headline.ts", "utf8");
    expect(computedTCalls(src)).toEqual([]);
    const keys = [...src.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBe(19);
    for (const k of keys) expect(k).toMatch(/^common\.backendWords\.(headline|headlineWhat)\.\w+$/);
  });

  const BEFORE: Record<string, string[]> = {
    "src/data/backend-words.ts": ["`common.backendW", "v.detailKey, { .", "v.labelKey, { de"],
    "src/surfaces/BlackBox.tsx": ["`gaming.blackBox", "`gaming.blackBox", "`gaming.blackBox", "`gaming.blackBox", "cb.anchor_kind ="],
    "src/surfaces/SinceLastWorked.tsx": ["`gaming.blackBox", "`gaming.blackBox", 'slw.anchor ? "ga', "slw.none_reason "],
  };
  for (const [file, before] of Object.entries(BEFORE)) {
    it(`${file} keeps only the computed keys it had before d10`, () => {
      expect(computedTCalls(readFileSync(file, "utf8"))).toEqual([...before].sort());
    });
  }

  it("the surfaces word headlines only through incident-headline.ts", () => {
    for (const file of ["src/surfaces/BlackBox.tsx", "src/surfaces/SinceLastWorked.tsx"]) {
      const src = readFileSync(file, "utf8");
      // A raw `.headline` read on screen would bypass the code (allowed only as the no-t fallback).
      const raw = [...src.matchAll(/\b(?:inc|i)\.headline\b/g)].length;
      expect(raw, `${file} reads a record's English headline directly`).toBe(file.endsWith("SinceLastWorked.tsx") ? 1 : 0);
    }
  });
});
