import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PER_CPU_DEFAULT_REASON, perCpuDefaultPct } from "./leftover-reason";

// a10 r1 (F1): the core-parking "read, but can't tell" reason, from Rust to the screen in both languages.
const rust = readFileSync(join("src-tauri", "src", "leftovers.rs"), "utf8");
const json = (lang: string) =>
  JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "optimize.json"), "utf8")).optimize.check;

describe("a10 r1: the per-processor core-parking reason", () => {
  // Break check: reword REASON_PER_CPU_DEFAULT in leftovers.rs (or here) -> fails.
  it("is byte-equal to the Rust const", () => {
    expect(rust).toContain(`pub(crate) const REASON_PER_CPU_DEFAULT: &str = "${PER_CPU_DEFAULT_REASON}";`);
  });

  // Break check: change either locale's perCpuDefault -> fails.
  it("says the same thing in en and zh-CN, with the number", () => {
    expect(json("en").perCpuDefault).toBe(
      "Compy can read this setting ({{pct}}% of cores always kept awake), but Windows chooses this value per processor, so Compy can't tell whether a tweak changed it.",
    );
    expect(json("zh-CN").perCpuDefault).toBe(
      "Compy 能读取此设置（始终保持唤醒的核心为 {{pct}}%），但 Windows 会按处理器选择此值，因此 Compy 无法判断它是否被优化工具改过。",
    );
    expect(json("en").perCpuDefault).toBe(PER_CPU_DEFAULT_REASON.replace("{pct}", "{{pct}}"));
  });

  // Break check: make perCpuDefaultPct return "100" for any reason -> the sibling reasons fail.
  it("matches only that sentence with a whole number in it", () => {
    expect(perCpuDefaultPct(PER_CPU_DEFAULT_REASON.replace("{pct}", "100"))).toBe("100");
    expect(perCpuDefaultPct(PER_CPU_DEFAULT_REASON.replace("{pct}", "7"))).toBe("7");
    for (const other of [
      "couldn't read this setting",
      "needs admin to check",
      PER_CPU_DEFAULT_REASON,
      PER_CPU_DEFAULT_REASON.replace("{pct}", ""),
      PER_CPU_DEFAULT_REASON.replace("{pct}", "1000"),
      PER_CPU_DEFAULT_REASON.replace("{pct}", "<b>x</b>"),
    ]) {
      expect(perCpuDefaultPct(other), other).toBeNull();
    }
  });

  // Break check: render `{u.reason}` for every row again (drop the perCpuDefaultPct branch) -> fails.
  it("Check shows it through its key, not the backend's English", () => {
    const check = readFileSync(join("src", "surfaces", "Check.tsx"), "utf8");
    expect(check).toContain("const pct = perCpuDefaultPct(u.reason);");
    expect(check).toContain('t("optimize.check.perCpuDefault", { pct })');
  });
});
