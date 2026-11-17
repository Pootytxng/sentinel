// TG-preflight: the waiting Trial's line names each difference the backend found between the PC now
// and the baseline's recorded conditions, gives exactly one fix step and says what playing anyway
// means; en + zh-CN.
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/lab.json";
import zh from "../i18n/locales/zh-CN/lab.json";
import { preflightLine } from "./trial-preflight";

const tFor = (root: unknown) => (key: string, opts: Record<string, unknown> = {}) => {
  const v = key
    .replace(/^lab\./, "")
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
  if (typeof v !== "string") throw new Error(`missing copy: ${key}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k]));
};
const [tEn, tZh] = [tFor(en), tFor(zh)];

describe("preflightLine", () => {
  it("one fixture per difference, each with its own one step (en + zh-CN)", () => {
    const cases: [string, string, string, RegExp][] = [
      ["gpu-driver", "25.7.1", "25.8.1", /the graphics driver is 25\.8\.1 now, the baseline ran on 25\.7\.1\. Next: restore the change and start the Trial again/],
      ["windows-build", "26200.7000", "26200.7100", /Windows is on build 26200\.7100 now, the baseline ran on 26200\.7000\. Next: restore the change/],
      ["resolution", "2560×1440", "1920×1080", /the display is at 1920×1080 now, the baseline ran at 2560×1440\. Next: set the display back to 2560×1440/],
      ["power-plan", "22222222-2222-2222-2222-222222222222", "381b4222-f694-41f0-9685-ff5bb260df2e", /a different Windows power plan is active now than the one the baseline ran on\. Next: switch back to the power plan the baseline ran on/],
      ["power-plan", "Balanced", "High performance", /the High performance power plan is active now, the baseline ran on Balanced\. Next: switch back to the Balanced power plan/],
      ["refresh", "165 Hz", "60 Hz", /the display refreshes at 60 Hz now, the baseline ran at 165 Hz\. Next: set the display back to 165 Hz/],
      // Opus r2 MUST-FIX: the monitor is Compy's startup read, so the step is a fresh Trial, never "now".
      ["display", "AOC 24G2", "DEL U2720Q", /Compy read a different monitor \(DEL U2720Q\) than the one the baseline ran on \(AOC 24G2\)\. Next: restore the change and start the Trial again/],
      ["gaming-mode", "off", "on", /Gaming Mode is on now, it was off for the baseline\. Next: turn Gaming Mode off before you play\./],
      ["gaming-mode", "on", "off", /Gaming Mode is off now, it was on for the baseline\. Next: turn Gaming Mode on before you play/],
    ];
    for (const [key, before, after, re] of cases) {
      const line = preflightLine([{ key, before, after }], tEn)!;
      expect(line).toMatch(re);
      expect(line.match(/Next:/g)).toHaveLength(1);
      expect(line).toMatch(/If you play anyway, Compy can't pin the result on this change/);
      const zhLine = preflightLine([{ key, before, after }], tZh)!;
      expect(zhLine.match(/下一步：/g)).toHaveLength(1);
      expect(zhLine).toContain("无法归因于这项更改");
    }
  });

  it("several differences: all named; a driver or Windows change makes the one step a fresh Trial", () => {
    const line = preflightLine(
      [
        { key: "resolution", before: "2560×1440", after: "1920×1080" },
        { key: "gpu-driver", before: "25.7.1", after: "25.8.1" },
      ],
      tEn,
    )!;
    expect(line).toContain("the display is at 1920×1080 now, the baseline ran at 2560×1440; the graphics driver is 25.8.1 now");
    expect(line.match(/Next:/g)).toHaveLength(1);
    expect(line).toMatch(/Next: restore the change and start the Trial again/);
  });

  it("nothing differs, nothing known, or nothing read: no line", () => {
    expect(preflightLine([], tEn)).toBeNull();
    expect(preflightLine(null, tEn)).toBeNull();
    expect(preflightLine([{ key: "something-new", before: "a", after: "b" }], tEn)).toBeNull();
  });
});
