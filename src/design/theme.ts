// Instrument theme + ambient-backdrop preferences. Local-only (localStorage), no network — purely
// cosmetic. The theme drives the app accent + the backdrop streak colors via `[data-itheme]` on
// <html> (see instrument.css). Reversible: nothing here touches logic or the backend.

export type InstrumentTheme = "halfway" | "midnight" | "hearth";
export type Ambiance = "off" | "calm" | "full";

export const INSTRUMENT_THEMES: { id: InstrumentTheme; label: string }[] = [
  { id: "halfway", label: "Halfway" },
  { id: "midnight", label: "Midnight" },
  { id: "hearth", label: "Hearth" },
];

export const AMBIANCE_OPTIONS: { id: Ambiance; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "calm", label: "Calm" },
  { id: "full", label: "Full" },
];

const THEME_KEY = "compy_theme";
const AMBIANCE_KEY = "compy_ambiance";

const isTheme = (v: unknown): v is InstrumentTheme =>
  v === "halfway" || v === "midnight" || v === "hearth";
const isAmbiance = (v: unknown): v is Ambiance => v === "off" || v === "calm" || v === "full";

export function readInstrumentTheme(): InstrumentTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isTheme(v)) return v;
  } catch {
    /* ignore — fall back to default */
  }
  return "halfway";
}

// Hearth keeper (shadow realm, pure-craftsmanship tier): with the Hearth theme lit in December, the
// ambient warmth drifts a hair warmer. No UI, no mention, ever — the egg nobody may ever consciously
// notice. Palette-agnostic (warms whatever Hearth becomes), so it isn't blocked on the final hexes.
export function applyHearthSeason(t: InstrumentTheme): void {
  const root = document.documentElement;
  if (t === "hearth" && new Date().getMonth() === 11) {
    root.dataset.hearthSeason = "december";
  } else {
    delete root.dataset.hearthSeason;
  }
}

export function applyInstrumentTheme(t: InstrumentTheme): void {
  document.documentElement.dataset.itheme = t;
  applyHearthSeason(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore persistence failure — still applies this session */
  }
}

export function readAmbiance(): Ambiance {
  try {
    const v = localStorage.getItem(AMBIANCE_KEY);
    if (isAmbiance(v)) return v;
  } catch {
    /* ignore */
  }
  return "full"; // default Full so the backdrop is felt in dev
}

export function persistAmbiance(a: Ambiance): void {
  try {
    localStorage.setItem(AMBIANCE_KEY, a);
  } catch {
    /* ignore */
  }
}

// "Step aside when I play" — freeze the ambient backdrop while a game is presenting. This is a USER
// PREFERENCE (default ON), distinct from the UNCONDITIONAL reduced-motion + hidden-document freezes
// (those are a11y/efficiency and are never user-overridable). Spec 2026-06-06-settings-and-icon §A0.
const STEPASIDE_GAME_KEY = "compy_stepaside_game";

export function readStepAsideGame(): boolean {
  try {
    const v = localStorage.getItem(STEPASIDE_GAME_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function persistStepAsideGame(on: boolean): void {
  try {
    localStorage.setItem(STEPASIDE_GAME_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Close-to-tray (opt-in "minimize to tray"). DEFAULT OFF — closing the window fully exits per
// Train #3 §1 unless the user opts in. The backend mirrors this flag via the `set_close_to_tray`
// command (synced on startup + on change); localStorage is the source of truth across launches.
const CLOSE_TO_TRAY_KEY = "compy_close_to_tray";

export function readCloseToTray(): boolean {
  try {
    return localStorage.getItem(CLOSE_TO_TRAY_KEY) === "1";
  } catch {
    /* ignore — default OFF */
  }
  return false;
}

export function persistCloseToTray(on: boolean): void {
  try {
    localStorage.setItem(CLOSE_TO_TRAY_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// In-game overlay density (spec 2026-06-06-overlay-redress §2). minimal = FPS only; standard = +
// 1%/temp/gpu row; full = + frametime line. Read by the overlay window; set in Settings (the main
// window) — they're separate windows, so the overlay reacts via the cross-window `storage` event.
export type OverlayDensity = "minimal" | "standard" | "full";
const OVERLAY_DENSITY_KEY = "compy_overlay_density";
const isDensity = (v: unknown): v is OverlayDensity =>
  v === "minimal" || v === "standard" || v === "full";

export function readOverlayDensity(): OverlayDensity {
  try {
    const v = localStorage.getItem(OVERLAY_DENSITY_KEY);
    if (isDensity(v)) return v;
  } catch {
    /* ignore */
  }
  return "standard";
}

export function persistOverlayDensity(d: OverlayDensity): void {
  try {
    localStorage.setItem(OVERLAY_DENSITY_KEY, d);
  } catch {
    /* ignore */
  }
}
