// D3a: an unmapped backend error is MARKED as untranslated detail, never shown as a bare English tail
// inside a Chinese sentence; a known one comes back in the user's language; the result is never empty.
import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { BACKEND_SENTENCES, backendDetail } from "./backend-error";

const t = i18n.t.bind(i18n);

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("backendDetail: the marked English fallback", () => {
  it("an unmapped error is framed as detail, in both languages", async () => {
    const raw = "powercfg exited 1";
    expect(backendDetail(raw, t)).toBe("Compy couldn't finish this. Details: powercfg exited 1");
    await i18n.changeLanguage("zh-CN");
    expect(backendDetail(raw, t)).toBe("Compy 没能完成这项操作。详细信息：powercfg exited 1");
    // An Error object gives its message, not "Error: ...".
    expect(backendDetail(new Error(raw), t)).toBe("Compy 没能完成这项操作。详细信息：powercfg exited 1");
  });

  it("a known backend sentence comes back translated, not framed", async () => {
    const known = BACKEND_SENTENCES.find((s) => s.rust === "TASK_UNREADABLE_APPLY")!;
    await i18n.changeLanguage("zh-CN");
    const out = backendDetail(`Compatibility Appraiser: ${known.text}`, t);
    expect(out).toBe(i18n.t(known.key));
    expect(out).not.toContain("详细信息");
  });

  it("an error with no text still says Compy couldn't finish (never empty)", async () => {
    for (const err of [undefined, null, "", "   "]) {
      expect(backendDetail(err, t)).toBe("Compy couldn't finish this.");
    }
    await i18n.changeLanguage("zh-CN");
    expect(backendDetail(undefined, t)).toBe("Compy 没能完成这项操作。");
  });
});
