// i18next setup. Every string ships bundled at build time (static imports below) — no HTTP
// backend, no CDN fetch, no runtime network call. That keeps translation inside the app's existing
// "signed update check only" outbound boundary (see RELEASE_STATE.md) instead of opening a new one.
//
// Resources are split into one JSON file per feature area (locales/<lang>/<area>.json) purely to
// keep individual files reviewable; at runtime they're merged into a single "translation"
// namespace per language, so every call site just does t("area.key") — no per-file namespace
// wiring needed in components.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enApp from "./locales/en/app.json";
import enSettings from "./locales/en/settings.json";
import enHome from "./locales/en/home.json";
import enOptimize from "./locales/en/optimize.json";
import enLab from "./locales/en/lab.json";
import enMonitor from "./locales/en/monitor.json";
import enGaming from "./locales/en/gaming.json";
import enBlackbook from "./locales/en/blackbook.json";
import enParamedic from "./locales/en/paramedic.json";

import zhCommon from "./locales/zh-CN/common.json";
import zhApp from "./locales/zh-CN/app.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhHome from "./locales/zh-CN/home.json";
import zhOptimize from "./locales/zh-CN/optimize.json";
import zhLab from "./locales/zh-CN/lab.json";
import zhMonitor from "./locales/zh-CN/monitor.json";
import zhGaming from "./locales/zh-CN/gaming.json";
import zhBlackbook from "./locales/zh-CN/blackbook.json";
import zhParamedic from "./locales/zh-CN/paramedic.json";

const en = {
  common: enCommon,
  app: enApp,
  settings: enSettings,
  home: enHome,
  optimize: enOptimize,
  lab: enLab,
  monitor: enMonitor,
  gaming: enGaming,
  blackbook: enBlackbook,
  paramedic: enParamedic,
};

const zhCN = {
  common: zhCommon,
  app: zhApp,
  settings: zhSettings,
  home: zhHome,
  optimize: zhOptimize,
  lab: zhLab,
  monitor: zhMonitor,
  gaming: zhGaming,
  blackbook: zhBlackbook,
  paramedic: zhParamedic,
};

// Read once at module init (before React mounts — see main.tsx) so the very first render is
// already in the right language; no flash of English before a switch.
function initialLanguage(): "en" | "zh-CN" {
  try {
    return localStorage.getItem("compy_lang") === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes; double-escaping breaks punctuation like "&"
  },
  returnEmptyString: false, // an empty translation value falls back to the key/English, never blank UI
});

export default i18n;
