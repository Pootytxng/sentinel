// D2b: "couldn't read" is never "not found" / "none" / "off". The backend's refusal sentences reach the
// user in their language through backend-error.ts; this pins each TS copy byte-equal to its Rust const,
// pins both locales, and pins the surfaces that show apply/undo errors to route through the helper.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "../i18n/locales/en/app.json";
import zh from "../i18n/locales/zh-CN/app.json";
import { BACKEND_SENTENCES, backendSentenceKey, localizeBackendText } from "./backend-error";

const rust = ["actions.rs", "recommendations.rs"]
  .map((f) => readFileSync(join("src-tauri", "src", f), "utf8"))
  .join("\n");

const leaf = (key: string) => key.replace(/^app\.backendErrors\./, "");

describe("backend-error: the backend's refusal sentences", () => {
  it("each TS sentence equals its Rust const", () => {
    for (const s of BACKEND_SENTENCES) {
      const m = rust.match(new RegExp(`const ${s.rust}: &str =\\s*"([^"]*)";`));
      expect(m, `${s.rust} not found in actions.rs / recommendations.rs`).not.toBeNull();
      expect(s.text, s.rust).toBe(m![1]);
    }
  });

  it("every key has an English text equal to the Rust sentence and a zh-CN text that is not English", () => {
    const enKeys = en.backendErrors as Record<string, string>;
    const zhKeys = zh.backendErrors as Record<string, string>;
    for (const s of BACKEND_SENTENCES) {
      expect(enKeys[leaf(s.key)], s.key).toBe(s.text);
      expect(zhKeys[leaf(s.key)], s.key).toMatch(/[一-鿿]/);
    }
    expect(Object.keys(zhKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it("no sentence contains another (contains-matching can never pick the wrong one)", () => {
    for (const a of BACKEND_SENTENCES) {
      for (const b of BACKEND_SENTENCES) {
        if (a !== b) expect(a.text.includes(b.text), `${a.rust} contains ${b.rust}`).toBe(false);
      }
    }
  });

  it("finds a sentence inside a wrapped error, and nothing else", () => {
    const unread = BACKEND_SENTENCES.find((s) => s.rust === "TASK_UNREADABLE_APPLY")!;
    expect(backendSentenceKey(unread.text)).toBe(unread.key);
    expect(backendSentenceKey(`Compatibility Appraiser: ${unread.text}`)).toBe(unread.key);
    expect(backendSentenceKey("access denied")).toBeNull();
    expect(backendSentenceKey(undefined)).toBeNull();
    // An unreadable task never maps to the not-found sentence, and the reverse.
    const notFound = BACKEND_SENTENCES.find((s) => s.rust === "TASK_NOT_FOUND_APPLY")!;
    expect(backendSentenceKey(notFound.text)).toBe(notFound.key);
    const t = ((k: string) => `T(${k})`) as never;
    expect(localizeBackendText(unread.text, t)).toBe(`T(${unread.key})`);
    expect(localizeBackendText("some other reason", t)).toBe("some other reason");
  });

  it("the apply/undo surfaces route backend errors through the helper", () => {
    const read = (p: string) => readFileSync(join("src", ...p.split("/")), "utf8");
    const app = read("App.tsx");
    expect(app).toContain('fail(backendMessage(e, t) ?? t("app.errors.applyFailed"), e);');
    expect(app).toContain("const known = backendMessage(e, t);");
    expect(app).toContain("reason: localizeBackendText(i.reason ?? \"\", t)");
    expect(read("surfaces/TrustMoment.tsx")).toContain("backendMessage(e, t) ??");
    expect(read("surfaces/FirstWin.tsx")).toContain("backendMessage(e, t) ??");
    expect(read("surfaces/Fix.tsx")).toContain("localizeBackendText(r.ineligible_reason, t)");
  });
});
