import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  type InstrumentTheme,
  readInstrumentTheme,
  applyInstrumentTheme,
  readMonitorConsole,
  applyMonitorConsole,
  readJarvisMotion,
  applyJarvisMotion,
  readLabDeck,
  applyLabDeck,
  readCloseToTray,
  persistCloseToTray,
  type OverlayDensity,
  readOverlayDensity,
  persistOverlayDensity,
  type OverlayBackdrop,
  readOverlayBackdrop,
  persistOverlayBackdrop,
} from "../design/theme";
import { Wordmark } from "../design/Wordmark";
import { BackButton, ForwardButton } from "../design/BackButton";
import { readMotionPref, setMotionPref, type MotionPref } from "../design/use-motion";
import { readExpertView, setExpertView } from "../design/use-expert-view";
import { APP_LANGUAGES, readLanguage, applyLanguage, type AppLanguage } from "../i18n/language";
import ReceiptsConsent from "./ReceiptsConsent";
import { LicensePanel } from "./LicensePanel";
import { FeedbackExport } from "./FeedbackExport";
import "./Settings.css";

// Settings / Appearance surface (spec 2026-06-06-settings-and-icon §A). Frontend + localStorage only;
// every control changes pixels or a UI preference — NONE of it touches what Compy measures. Calm,
// static surface (no canvas). Behind compy_settings_v2.

// Theme identity swatches — a theme PICKER must show each theme's real colors, so these literal
// kernel values are the justified exception to "tokens-only" (same pattern as the classic picker).
// Labels are translation keys (settings.appearance.themes.<id>), not literals — theme.ts owns the
// canonical id list; this file only owns how each id is *shown*.
const THEME_CARDS: { id: InstrumentTheme; swatch: [string, string, string] }[] = [
  { id: "midnight", swatch: ["#090b12", "#2ee6c0", "#7c9cff"] },
  { id: "violet", swatch: ["#0c0a14", "#b366ff", "#ff77c8"] },
  { id: "crimson", swatch: ["#120a0c", "#fb3b53", "#ff6b81"] },
  { id: "emerald", swatch: ["#080f0b", "#27e08a", "#a8e85a"] },
  { id: "hearth", swatch: ["#15100a", "#f0b878", "#b65f54"] },
];

const DENSITIES: OverlayDensity[] = ["minimal", "standard", "full"];

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`set-toggle ${on ? "set-toggle-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="set-toggle-thumb" />
    </button>
  );
}

// A small static preview reflecting the live theme (via --ix tokens).
function LivePreview() {
  const { t } = useTranslation();
  const streaks = 3;
  return (
    <div className="set-preview" aria-hidden="true">
      <div className="set-preview-field">
        {Array.from({ length: streaks }).map((_, i) => (
          <span key={i} className={`set-preview-streak set-preview-streak-${i % 3}`} />
        ))}
      </div>
      <svg className="set-preview-ring" viewBox="0 0 60 60">
        <circle className="set-preview-track" cx="30" cy="30" r="22" />
        <circle
          className="set-preview-fill"
          cx="30"
          cy="30"
          r="22"
          strokeDasharray={`${2 * Math.PI * 22 * 0.7} ${2 * Math.PI * 22}`}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <span className="set-preview-label">{t("settings.appearance.livePreview")}</span>
    </div>
  );
}

export default function Settings({
  appVersion,
  rulesSourceLabel,
  onRerunSetup,
  onClose,
  onBack,
  canGoBack,
  onForward,
  canGoForward,
}: {
  appVersion: string;
  rulesSourceLabel: string;
  onBack: () => void;
  canGoBack: boolean;
  onForward: () => void;
  canGoForward: boolean;
  onRerunSetup: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [itheme, setITheme] = useState<InstrumentTheme>(readInstrumentTheme);
  const [monitorConsole, setMonitorConsole] = useState<boolean>(readMonitorConsole);
  const [jarvisMotion, setJarvisMotion] = useState<boolean>(readJarvisMotion);
  const [labDeck, setLabDeckState] = useState<boolean>(readLabDeck);
  const [closeToTray, setCloseToTray] = useState<boolean>(readCloseToTray);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  const [motion, setMotion] = useState<MotionPref>(readMotionPref);
  const [expertView, setExpertViewState] = useState<boolean>(readExpertView);
  // Language (2026-07-23): a genuine app-wide preference like Motion/Theme — persists via the same
  // guarded-localStorage convention and flips the live i18next instance immediately (no reload).
  const [language, setLanguageState] = useState<AppLanguage>(readLanguage);
  // §C build stamp (spec 2026-06-12): compile-time provenance from the backend — review hygiene.
  const [buildStamp, setBuildStamp] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_build_stamp")
      .then(setBuildStamp)
      .catch(() => {
        /* probe failed — About just shows the version without a stamp */
      });
  }, []);

  // Theme is app-wide + persistent (set at startup in main.tsx); applying here recolors live. No
  // unmount-removal — the Instrument theme is the one theme system now.
  useEffect(() => {
    applyInstrumentTheme(itheme);
  }, [itheme]);

  const changeMotion = (p: MotionPref) => {
    setMotion(p);
    setMotionPref(p); // persists, updates <html data-motion>, and notifies live listeners
  };

  // Expert view — a genuine preference like Motion, NOT a preview flag (spec
  // 2026-07-11-expert-layer-middle-ground, owner GO 2026-07-12). Presentation-only: it un-hides
  // data Compy already has (refused reasoning, exact targets, true percentiles); zero mutation
  // paths change and the barred-refusal tier stays barred either way.
  const changeExpertView = (v: boolean) => {
    setExpertViewState(v);
    setExpertView(v); // persists + notifies mounted surfaces live
  };

  // Monitor console (Phase 3 of the Console HUD, DEFAULT ON since 2026-07-12) — the Monitor
  // Live face as the instrument cluster: fps/frametime traces + honest gauges.
  // Presentation only: same sensors, same polls; the "0" failsafe renders today's Monitor byte-identical.
  const changeMonitorConsole = (v: boolean) => {
    setMonitorConsole(v);
    applyMonitorConsole(v);
  };
  // JARVIS motion layer preview (UI_VISION_BACKLOG §A, DEFAULT OFF) — the interactive motion
  // layer: glide scrolling, room-change sweep, magnetic rail, stage tilt, measured data-ticks.
  // Presentation only; the Motion preference below still wins (reduced ⇒ the layer stands down).
  const changeJarvisMotion = (v: boolean) => {
    setJarvisMotion(v);
    applyJarvisMotion(v);
  };
  // Lab deck — the decision-journey Lab candidate (product-recovery train, 2026-07-28). DEFAULT
  // OFF and TEMPORARY: this row exists so the owner can A/B the candidate against today's station
  // dock in the installed build without devtools. It retires with the flag once one canonical Lab
  // is chosen (Phase 4 pruning map) — it is not a permanent preference.
  const changeLabDeck = (v: boolean) => {
    setLabDeckState(v);
    applyLabDeck(v);
  };
  // Close-to-tray: persist + sync the backend gate. Default OFF keeps the §1 clean exit until opt-in.
  const changeCloseToTray = (v: boolean) => {
    setCloseToTray(v);
    persistCloseToTray(v);
    invoke("set_close_to_tray", { enabled: v }).catch(() => {});
  };
  // Overlay density/backdrop persist to localStorage; the overlay (separate window) reacts via `storage`.
  const changeDensity = (d: OverlayDensity) => {
    setDensity(d);
    persistOverlayDensity(d);
  };
  const changeBackdrop = (b: OverlayBackdrop) => {
    setBackdrop(b);
    persistOverlayBackdrop(b);
  };
  const changeLanguage = (l: AppLanguage) => {
    setLanguageState(l);
    applyLanguage(l); // persists, flips i18next + <html lang> live, notifies listeners
  };

  return (
    <div className="set-root">
      <div className="set-shell">
        <header className="set-header">
          <span className="set-brand">
            <BackButton onBack={onBack} canGoBack={canGoBack} />
            <ForwardButton onForward={onForward} canGoForward={canGoForward} />
            {/* §6 — the shared Wordmark, the ONLY sanctioned brand source (no bespoke glyph). */}
            <Wordmark size={22} />
            <h1 className="set-title">{t("settings.title")}</h1>
          </span>
          <button className="set-done" onClick={onClose}>
            {t("settings.done")}
          </button>
        </header>
        <p className="set-tagline">{t("settings.tagline")}</p>

        {/* ── Appearance ── */}
        <section className="set-section">
          <h2 className="set-section-title">{t("settings.appearance.sectionTitle")}</h2>
          <div className="set-appearance">
            <div className="set-appearance-controls">
              <div className="set-field-label" id="set-theme-label">
                {t("settings.appearance.themeLabel")}
              </div>
              <div className="set-themes" role="group" aria-labelledby="set-theme-label">
                {THEME_CARDS.map((th) => (
                  <button
                    key={th.id}
                    className={`set-theme ${itheme === th.id ? "set-theme-on" : ""}`}
                    aria-pressed={itheme === th.id}
                    onClick={() => {
                      setITheme(th.id);
                      applyInstrumentTheme(th.id);
                    }}
                  >
                    <span className="set-theme-swatch">
                      {th.swatch.map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="set-theme-label">
                      {t(`settings.appearance.themes.${th.id}`)}
                    </span>
                  </button>
                ))}
              </div>

              {/* Flag-debt sweep (consumer-panel Q2, owner answer A, 2026-07-11): the toggle rows
                  for features already graduated to permanent default-ON (Living Instrument, Lab
                  proving ground + the two classic-Lab-only toggles it stranded, Instrument HUD,
                  Home console, Setup stepper, First-check theater, Monitor summary cards, Hologram
                  bay v2, Two futures split) are REMOVED — three of five panel personas read the
                  wall of "(preview)" switches as an internal QA panel. The features are unchanged
                  and their flags still respect localStorage if set via devtools (same convention
                  as the removed "New look" hub below). The remaining toggle rows — Monitor
                  console and the JARVIS motion layer — are owner-approved DEFAULT-ON failsafes
                  (the "0" setting restores the classic look). */}
              <div className="set-row set-row-inset">
                <div className="set-row-text">
                  <div className="set-row-title">{t("settings.appearance.monitorConsole.title")}</div>
                  <div className="set-row-sub">{t("settings.appearance.monitorConsole.sub")}</div>
                </div>
                <Toggle
                  on={monitorConsole}
                  onChange={changeMonitorConsole}
                  ariaLabel={t("settings.appearance.monitorConsole.title")}
                />
              </div>

              <div className="set-row set-row-inset">
                <div className="set-row-text">
                  <div className="set-row-title">{t("settings.appearance.jarvisMotion.title")}</div>
                  <div className="set-row-sub">{t("settings.appearance.jarvisMotion.sub")}</div>
                </div>
                <Toggle
                  on={jarvisMotion}
                  onChange={changeJarvisMotion}
                  ariaLabel={t("settings.appearance.jarvisMotion.title")}
                />
              </div>

              {/* TEMPORARY owner-comparison row (product-recovery train) — the only exception to
                  the flag-debt sweep above, and it comes OUT with the flag. */}
              <div className="set-row set-row-inset">
                <div className="set-row-text">
                  <div className="set-row-title">{t("settings.appearance.labDeck.title")}</div>
                  <div className="set-row-sub">{t("settings.appearance.labDeck.sub")}</div>
                </div>
                <Toggle
                  on={labDeck}
                  onChange={changeLabDeck}
                  ariaLabel={t("settings.appearance.labDeck.title")}
                />
              </div>

              {/* Blackbook console + Room accent colors: GRADUATED default-ON 2026-07-13 (owner
                  eyeballed both + directed approved work default-ON, "avoid the QA toggle
                  section") — their rows are REMOVED per the same flag-debt convention as the Q2=A
                  sweep (features unchanged; the flags still honor an explicit localStorage "0" via
                  devtools). Room recoloring lives where the user needs it: the accent dot in each
                  room's top-right corner. */}
            </div>
            <LivePreview />
          </div>
        </section>

        {/* ── Language (2026-07-23) ── */}
        <section className="set-section">
          <h2 className="set-section-title">{t("settings.language.sectionTitle")}</h2>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title" id="set-language-label">
                {t("settings.language.title")}
              </div>
              <div className="set-row-sub">{t("settings.language.sub")}</div>
            </div>
            <div className="set-seg" role="group" aria-labelledby="set-language-label">
              {APP_LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  className={`set-seg-btn ${language === l.id ? "set-seg-on" : ""}`}
                  aria-pressed={language === l.id}
                  onClick={() => changeLanguage(l.id)}
                >
                  {l.nativeLabel}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Behavior ── */}
        <section className="set-section">
          <h2 className="set-section-title">{t("settings.behavior.sectionTitle")}</h2>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.behavior.closeToTray.title")}</div>
              <div className="set-row-sub">{t("settings.behavior.closeToTray.sub")}</div>
            </div>
            <Toggle
              on={closeToTray}
              onChange={changeCloseToTray}
              ariaLabel={t("settings.behavior.closeToTray.title")}
            />
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.behavior.motion.title")}</div>
              <div className="set-row-sub">{t("settings.behavior.motion.sub")}</div>
            </div>
            <div className="set-seg" role="group" aria-label={t("settings.behavior.motion.title")}>
              {(["full", "system", "reduced"] as MotionPref[]).map((id) => (
                <button
                  key={id}
                  className={`set-seg-btn ${motion === id ? "set-seg-on" : ""}`}
                  aria-pressed={motion === id}
                  onClick={() => changeMotion(id)}
                >
                  {t(`settings.behavior.motion.${id}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.behavior.expertView.title")}</div>
              <div className="set-row-sub">{t("settings.behavior.expertView.sub")}</div>
            </div>
            <Toggle
              on={expertView}
              onChange={changeExpertView}
              ariaLabel={t("settings.behavior.expertView.title")}
            />
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.behavior.overlayDensity.title")}</div>
              <div className="set-row-sub">{t("settings.behavior.overlayDensity.sub")}</div>
            </div>
            <div
              className="set-seg"
              role="group"
              aria-label={t("settings.behavior.overlayDensity.title")}
            >
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  className={`set-seg-btn ${density === d ? "set-seg-on" : ""}`}
                  aria-pressed={density === d}
                  onClick={() => changeDensity(d)}
                >
                  {t(`settings.behavior.overlayDensity.${d}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.behavior.overlayBackdrop.title")}</div>
              <div className="set-row-sub">{t("settings.behavior.overlayBackdrop.sub")}</div>
            </div>
            <div
              className="set-seg"
              role="group"
              aria-label={t("settings.behavior.overlayBackdrop.title")}
            >
              {(["on", "off"] as OverlayBackdrop[]).map((b) => (
                <button
                  key={b}
                  className={`set-seg-btn ${backdrop === b ? "set-seg-on" : ""}`}
                  aria-pressed={backdrop === b}
                  onClick={() => changeBackdrop(b)}
                >
                  {t(`settings.behavior.overlayBackdrop.${b}`)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* The "New look (preview)" flag hub was removed — parity with the classic surfaces is closed
            (Fix 57f2e21, Play aaa4f79), so the toggles only confused users and footgunned them (the
            Settings self-lockout). The flags still respect localStorage if set manually via devtools
            (hidden dev A/B path), just no user-facing control. */}

        {/* ── Setup (re-homed from the global footer, halfway-home §0) ── */}
        <section className="set-section">
          <h2 className="set-section-title">{t("settings.setup.sectionTitle")}</h2>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">{t("settings.setup.title")}</div>
              <div className="set-row-sub">{t("settings.setup.sub")}</div>
            </div>
            <button className="set-action" onClick={onRerunSetup}>
              {t("settings.setup.action")}
            </button>
          </div>
        </section>

        {/* ── Receipts (R3 Lane C — DARK: renders nothing while the backend gate is hard-false;
            when a future owner-signed build flips it, the consent + inspect surface appears HERE,
            in the privacy-adjacent room). ── */}
        <ReceiptsConsent />

        <LicensePanel />

        {/* ── Feedback & help (always visible — the beta/help path; local bundle + one-click email,
            nothing auto-sent). ── */}
        <FeedbackExport appVersion={appVersion} buildStamp={buildStamp} />

        {/* ── About ── */}

        <section className="set-section">
          <h2 className="set-section-title">{t("settings.about.sectionTitle")}</h2>
          <div className="set-about">
            <div className="set-about-name">
              Compy <span className="set-about-version">v{appVersion}</span>
              {buildStamp && <span className="set-about-stamp"> · {buildStamp}</span>}
            </div>
            <p className="set-about-privacy">{t("settings.about.privacy")}</p>
            {/* Rules-source — engineering status, re-homed here from the header (one-rail §1b). */}
            <p className="set-about-rules">{rulesSourceLabel}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
