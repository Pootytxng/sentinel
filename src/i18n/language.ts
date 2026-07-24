// App language preference. Mirrors the read/apply/persist pattern used by every other cosmetic
// preference in design/theme.ts (readInstrumentTheme/applyInstrumentTheme, readMonitorConsole/
// applyMonitorConsole, etc.): a validated read with try/catch (WebView2 storage can be disabled —
// see safe-storage.ts), a default that always wins when unset or invalid, and an apply function
// that persists + flips the live i18next instance + notifies any listeners via a compy:*-changed
// event (same cross-component channel the other live-reactive settings use).
//
// Local-only, zero network: every string ships bundled in src/i18n/locales — there is no fetch,
// no CDN, no translation API call. Adding a language later means adding one more locale folder and
// one more entry in APP_LANGUAGES; no other code changes.

import i18n from "./index";

export type AppLanguage = "en" | "zh-CN";

export const APP_LANGUAGES: { id: AppLanguage; label: string; nativeLabel: string }[] = [
  { id: "en", label: "English", nativeLabel: "English" },
  { id: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
];

const LANGUAGE_KEY = "compy_lang";

const isLanguage = (v: unknown): v is AppLanguage => v === "en" || v === "zh-CN";

// Default is ALWAYS English regardless of OS/browser locale — an explicit Settings action is the
// only way into Chinese. (Owner directive: "keep english default obviously.")
export function readLanguage(): AppLanguage {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (isLanguage(v)) return v;
  } catch {
    /* ignore — fall back to default */
  }
  return "en";
}

export function applyLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* ignore persistence failure — still applies this session */
  }
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
  try {
    window.dispatchEvent(new Event("compy:lang-changed"));
  } catch {
    /* ignore */
  }
}
