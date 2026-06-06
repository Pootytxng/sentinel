// Instrument theme + ambient-backdrop preferences. Local-only (localStorage), no network — purely
// cosmetic. The theme drives the app accent + the backdrop streak colors via `[data-itheme]` on
// <html> (see instrument.css). Reversible: nothing here touches logic or the backend.

export type InstrumentTheme = "velocity" | "nova" | "ember";
export type Ambiance = "off" | "calm" | "full";

export const INSTRUMENT_THEMES: { id: InstrumentTheme; label: string }[] = [
  { id: "velocity", label: "Velocity" },
  { id: "nova", label: "Nova" },
  { id: "ember", label: "Ember" },
];

export const AMBIANCE_OPTIONS: { id: Ambiance; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "calm", label: "Calm" },
  { id: "full", label: "Full" },
];

const THEME_KEY = "compy_theme";
const AMBIANCE_KEY = "compy_ambiance";

const isTheme = (v: unknown): v is InstrumentTheme =>
  v === "velocity" || v === "nova" || v === "ember";
const isAmbiance = (v: unknown): v is Ambiance => v === "off" || v === "calm" || v === "full";

export function readInstrumentTheme(): InstrumentTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isTheme(v)) return v;
  } catch {
    /* ignore — fall back to default */
  }
  return "velocity";
}

export function applyInstrumentTheme(t: InstrumentTheme): void {
  document.documentElement.dataset.itheme = t;
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
