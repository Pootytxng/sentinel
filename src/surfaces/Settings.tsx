import { useEffect, useState } from "react";
import {
  type InstrumentTheme,
  type Ambiance,
  AMBIANCE_OPTIONS,
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
  readStepAsideGame,
  persistStepAsideGame,
  type OverlayDensity,
  readOverlayDensity,
  persistOverlayDensity,
} from "../design/theme";
import { PulseC } from "../design/PulseC";
import "./Settings.css";

// Settings / Appearance surface (spec 2026-06-06-settings-and-icon §A). Frontend + localStorage only;
// every control changes pixels or a UI preference — NONE of it touches what Compy measures. Calm,
// static surface (no canvas). Behind compy_settings_v2.

export type PreviewFlag = "home" | "fix" | "learn" | "arc" | "settings" | "overlay" | "check" | "play" | "lab";

// Theme identity swatches — a theme PICKER must show each theme's real colors, so these literal
// kernel values are the justified exception to "tokens-only" (same pattern as the classic picker).
const THEME_CARDS: { id: InstrumentTheme; label: string; swatch: [string, string, string] }[] = [
  { id: "halfway", label: "Halfway", swatch: ["#0b0c10", "#2ee6c0", "#7c9cff"] },
  { id: "midnight", label: "Midnight", swatch: ["#090b12", "#2ee6c0", "#7c9cff"] },
  { id: "hearth", label: "Hearth", swatch: ["#14100c", "#e8b07a", "#d4847c"] },
];

const DENSITIES: { id: OverlayDensity; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "standard", label: "Standard" },
  { id: "full", label: "Full" },
];

const FLAG_ROWS: { id: PreviewFlag; label: string }[] = [
  { id: "home", label: "Home — Command Center" },
  { id: "check", label: "Check (Readiness + Priorities)" },
  { id: "play", label: "Play (Monitoring + Sessions)" },
  { id: "fix", label: "Fix surface" },
  { id: "learn", label: "Learn (Library + Autopsy)" },
  { id: "lab", label: "Lab (Benchmark + Latency)" },
  { id: "arc", label: "First-run arc" },
  { id: "overlay", label: "In-game overlay" },
  { id: "settings", label: "This Settings surface" },
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
  flags,
  onSetFlag,
  onRerunSetup,
  onRerunCheck,
  onClose,
}: {
  appVersion: string;
  flags: Record<PreviewFlag, boolean>;
  onSetFlag: (flag: PreviewFlag, on: boolean) => void;
  onRerunSetup: () => void;
  onRerunCheck: () => void;
  onClose: () => void;
}) {
  const [itheme, setITheme] = useState<InstrumentTheme>(readInstrumentTheme);
  const [ambiance, setAmbiance] = useState<Ambiance>(readAmbiance);
  const [stepAside, setStepAside] = useState<boolean>(readStepAsideGame);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });

  // Theme is app-wide + persistent (set at startup in main.tsx); applying here recolors live. No
  // unmount-removal — the Instrument theme is the one theme system now.
  useEffect(() => {
    applyInstrumentTheme(itheme);
  }, [itheme]);

  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const changeAmbiance = (a: Ambiance) => {
    setAmbiance(a);
    persistAmbiance(a);
  };
  const changeStepAside = (v: boolean) => {
    setStepAside(v);
    persistStepAsideGame(v);
    // Let a mounted backdrop react immediately (it re-reads on this event).
    window.dispatchEvent(new Event("compy:stepaside-changed"));
  };
  // Overlay density persists to localStorage; the overlay (separate window) reacts via `storage`.
  const changeDensity = (d: OverlayDensity) => {
    setDensity(d);
    persistOverlayDensity(d);
  };

  return (
    <div className="set-root">
      <div className="set-shell">
        <header className="set-header">
          <span className="set-brand">
            <PulseC size={22} />
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
              <div className="set-row-title">Respect reduced motion</div>
              <div className="set-row-sub">
                Follows your Windows setting — currently {reduced ? "on" : "off"}. Compy never
                overrides your accessibility choice.
              </div>
            </div>
            <span className="set-status">{reduced ? "On" : "Off"}</span>
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
        </section>

        {/* ── Preview flags ── */}
        <section className="set-section">
          <h2 className="set-section-title">New look (preview)</h2>
          <p className="set-section-help">
            Each surface can run the new Instrument look or its classic version — flip any of them.
          </p>
          {FLAG_ROWS.map((f) => (
            <div key={f.id} className="set-row">
              <div className="set-row-text">
                <div className="set-row-title">{f.label}</div>
              </div>
              <Toggle
                on={flags[f.id]}
                onChange={(v) => onSetFlag(f.id, v)}
                ariaLabel={`New ${f.label} preview`}
              />
            </div>
          ))}
        </section>

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

        {/* ── About ── */}
        <section className="set-section">
          <h2 className="set-section-title">About</h2>
          <div className="set-about">
            <div className="set-about-name">
              Compy <span className="set-about-version">v{appVersion}</span>
            </div>
            <p className="set-about-privacy">
              Fully local. No account, no telemetry, nothing leaves your PC.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
