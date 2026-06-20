import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type InstrumentTheme,
  type Ambiance,
  AMBIANCE_OPTIONS,
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
  readLivingInstrument,
  applyLivingInstrument,
  readStepAsideGame,
  persistStepAsideGame,
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
import ReceiptsConsent from "./ReceiptsConsent";
import { LicensePanel } from "./LicensePanel";
import "./Settings.css";

// Settings / Appearance surface (spec 2026-06-06-settings-and-icon §A). Frontend + localStorage only;
// every control changes pixels or a UI preference — NONE of it touches what Compy measures. Calm,
// static surface (no canvas). Behind compy_settings_v2.

// Theme identity swatches — a theme PICKER must show each theme's real colors, so these literal
// kernel values are the justified exception to "tokens-only" (same pattern as the classic picker).
const THEME_CARDS: { id: InstrumentTheme; label: string; swatch: [string, string, string] }[] = [
  { id: "midnight", label: "Midnight", swatch: ["#090b12", "#2ee6c0", "#7c9cff"] },
  { id: "violet", label: "Violet", swatch: ["#0c0a14", "#b366ff", "#ff77c8"] },
  { id: "crimson", label: "Crimson", swatch: ["#120a0c", "#fb3b53", "#ff6b81"] },
  { id: "emerald", label: "Emerald", swatch: ["#080f0b", "#27e08a", "#a8e85a"] },
  { id: "hearth", label: "Hearth", swatch: ["#15100a", "#f0b878", "#b65f54"] },
];

const DENSITIES: { id: OverlayDensity; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "standard", label: "Standard" },
  { id: "full", label: "Full" },
];

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

// A small static preview reflecting the live theme (via --ix tokens) + the chosen ambiance density.
function LivePreview({ ambiance }: { ambiance: Ambiance }) {
  const streaks = ambiance === "full" ? 6 : ambiance === "calm" ? 3 : 0;
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
      <span className="set-preview-label">Live preview</span>
    </div>
  );
}

export default function Settings({
  appVersion,
  rulesSourceLabel,
  onRerunSetup,
  onRerunCheck,
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
  onRerunCheck: () => void;
  onClose: () => void;
}) {
  const [itheme, setITheme] = useState<InstrumentTheme>(readInstrumentTheme);
  const [ambiance, setAmbiance] = useState<Ambiance>(readAmbiance);
  const [living, setLiving] = useState<boolean>(readLivingInstrument);
  const [stepAside, setStepAside] = useState<boolean>(readStepAsideGame);
  const [closeToTray, setCloseToTray] = useState<boolean>(readCloseToTray);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  const [motion, setMotion] = useState<MotionPref>(readMotionPref);
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

  const changeAmbiance = (a: Ambiance) => {
    setAmbiance(a);
    persistAmbiance(a);
  };
  // Living Instrument preview — toggles the depth/glow/motion skin live (applies the [data-living]
  // attribute app-wide). Cosmetic + reversible; default OFF until the look is locked.
  const changeLiving = (v: boolean) => {
    setLiving(v);
    applyLivingInstrument(v);
  };
  const changeStepAside = (v: boolean) => {
    setStepAside(v);
    persistStepAsideGame(v);
    // Let a mounted backdrop react immediately (it re-reads on this event).
    window.dispatchEvent(new Event("compy:stepaside-changed"));
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

  return (
    <div className="set-root">
      <div className="set-shell">
        <header className="set-header">
          <span className="set-brand">
            <BackButton onBack={onBack} canGoBack={canGoBack} />
            <ForwardButton onForward={onForward} canGoForward={canGoForward} />
            {/* §6 — the shared Wordmark, the ONLY sanctioned brand source (no bespoke glyph). */}
            <Wordmark size={22} />
            <h1 className="set-title">Settings</h1>
          </span>
          <button className="set-done" onClick={onClose}>
            Done
          </button>
        </header>
        <p className="set-tagline">Make it yours. None of this touches what Compy measures.</p>

        {/* ── Appearance ── */}
        <section className="set-section">
          <h2 className="set-section-title">Appearance</h2>
          <div className="set-appearance">
            <div className="set-appearance-controls">
              <div className="set-field-label">Theme</div>
              <div className="set-themes">
                {THEME_CARDS.map((t) => (
                  <button
                    key={t.id}
                    className={`set-theme ${itheme === t.id ? "set-theme-on" : ""}`}
                    aria-pressed={itheme === t.id}
                    onClick={() => {
                      setITheme(t.id);
                      applyInstrumentTheme(t.id);
                    }}
                  >
                    <span className="set-theme-swatch">
                      {t.swatch.map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="set-theme-label">{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="set-field-label">Ambient backdrop</div>
              <div className="set-seg" role="group" aria-label="Ambient backdrop">
                {AMBIANCE_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    className={`set-seg-btn ${ambiance === a.id ? "set-seg-on" : ""}`}
                    aria-pressed={ambiance === a.id}
                    onClick={() => changeAmbiance(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <div className="set-row set-row-inset">
                <div className="set-row-text">
                  <div className="set-row-title">Living Instrument (preview)</div>
                  <div className="set-row-sub">
                    Depth, a soft glow on live readings, and a little motion. Purely cosmetic — nothing
                    it touches changes what Compy measures.
                  </div>
                </div>
                <Toggle on={living} onChange={changeLiving} ariaLabel="Living Instrument preview" />
              </div>
            </div>
            <LivePreview ambiance={ambiance} />
          </div>
        </section>

        {/* ── Behavior ── */}
        <section className="set-section">
          <h2 className="set-section-title">Behavior</h2>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">Step aside when I play</div>
              <div className="set-row-sub">
                Freezes the backdrop while a game runs. Compy never steals your frames.
              </div>
            </div>
            <Toggle on={stepAside} onChange={changeStepAside} ariaLabel="Step aside when I play" />
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">When I close, keep Compy running in the tray</div>
              <div className="set-row-sub">
                Off (default): closing fully quits Compy. On: closing tucks it into the system tray —
                you'll see the Compy icon there. Right-click it for Show or Quit; hover for live FPS
                while you play.
              </div>
            </div>
            <Toggle
              on={closeToTray}
              onChange={changeCloseToTray}
              ariaLabel="When I close, keep Compy running in the tray"
            />
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">Motion</div>
              <div className="set-row-sub">
                Compy's living motion is on by default, even if Windows requests reduced motion. Choose
                Follow system to defer to Windows, or Reduced to keep everything calm.
              </div>
            </div>
            <div className="set-seg" role="group" aria-label="Motion">
              {(
                [
                  ["full", "Full"],
                  ["system", "Follow system"],
                  ["reduced", "Reduced"],
                ] as [MotionPref, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`set-seg-btn ${motion === id ? "set-seg-on" : ""}`}
                  aria-pressed={motion === id}
                  onClick={() => changeMotion(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">In-game overlay density</div>
              <div className="set-row-sub">
                What the in-game overlay shows: just FPS · + 1%/temp/GPU · + a frametime line.
              </div>
            </div>
            <div className="set-seg" role="group" aria-label="Overlay density">
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  className={`set-seg-btn ${density === d.id ? "set-seg-on" : ""}`}
                  aria-pressed={density === d.id}
                  onClick={() => changeDensity(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">In-game overlay background</div>
              <div className="set-row-sub">
                Off makes the overlay see-through — the numbers float on the game, outlined so they
                stay readable.
              </div>
            </div>
            <div className="set-seg" role="group" aria-label="Overlay background">
              {(["on", "off"] as OverlayBackdrop[]).map((b) => (
                <button
                  key={b}
                  className={`set-seg-btn ${backdrop === b ? "set-seg-on" : ""}`}
                  aria-pressed={backdrop === b}
                  onClick={() => changeBackdrop(b)}
                >
                  {b === "on" ? "On" : "Off"}
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
          <h2 className="set-section-title">Setup</h2>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">Re-run the guided setup</div>
              <div className="set-row-sub">Replay the intro, then run a fresh first check.</div>
            </div>
            <button className="set-action" onClick={onRerunSetup}>
              Re-run setup
            </button>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <div className="set-row-title">Re-run the check</div>
              <div className="set-row-sub">Re-scan this rig's readiness without the intro.</div>
            </div>
            <button className="set-action" onClick={onRerunCheck}>
              Re-run check
            </button>
          </div>
        </section>

        {/* ── Receipts (R3 Lane C — DARK: renders nothing while the backend gate is hard-false;
            when a future owner-signed build flips it, the consent + inspect surface appears HERE,
            in the privacy-adjacent room). ── */}
        <ReceiptsConsent />

        {/* ── About ── */}
        <LicensePanel />

        <section className="set-section">
          <h2 className="set-section-title">About</h2>
          <div className="set-about">
            <div className="set-about-name">
              Compy <span className="set-about-version">v{appVersion}</span>
              {buildStamp && <span className="set-about-stamp"> · {buildStamp}</span>}
            </div>
            <p className="set-about-privacy">
              Fully local. No account, no telemetry, nothing leaves your PC.
            </p>
            {/* Rules-source — engineering status, re-homed here from the header (one-rail §1b). */}
            <p className="set-about-rules">{rulesSourceLabel}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
