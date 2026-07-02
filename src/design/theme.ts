// Instrument theme + ambient-backdrop preferences. Local-only (localStorage), no network — purely
// cosmetic. The theme drives the app accent + the backdrop streak colors via `[data-itheme]` on
// <html> (see instrument.css). Reversible: nothing here touches logic or the backend.

export type InstrumentTheme = "midnight" | "violet" | "crimson" | "emerald" | "hearth";
export type Ambiance = "off" | "calm" | "full";

export const INSTRUMENT_THEMES: { id: InstrumentTheme; label: string }[] = [
  { id: "midnight", label: "Midnight" },
  { id: "violet", label: "Violet" },
  { id: "crimson", label: "Crimson" },
  { id: "emerald", label: "Emerald" },
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
  v === "midnight" || v === "violet" || v === "crimson" || v === "emerald" || v === "hearth";
const isAmbiance = (v: unknown): v is Ambiance => v === "off" || v === "calm" || v === "full";

export function readInstrumentTheme(): InstrumentTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isTheme(v)) return v;
  } catch {
    /* ignore — fall back to default */
  }
  return "violet";
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

// The user's EXPLICIT ambiance choice, or null when they never picked one. Lets a flag-gated surface
// re-default (P3 answer-first Home defaults to "calm" — owner §8b) WITHOUT overriding a real Settings
// choice: an explicit Off/Full always wins. `readAmbiance()` above keeps the classic "full" default.
export function readAmbianceChoice(): Ambiance | null {
  try {
    const v = localStorage.getItem(AMBIANCE_KEY);
    if (isAmbiance(v)) return v;
  } catch {
    /* ignore */
  }
  return null;
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

// Monitor refresh rate, relayed main-window → overlay window via localStorage (the same
// cross-window channel as the overlay flag/density — zero IPC). The MAIN window writes it when
// hardware lands; the OVERLAY reads it to anchor the frametime graph's fixed scale + the frame-
// budget reference line (1000/refresh ms). null = unknown → the graph falls back to a 0–50 ms
// scale and honestly draws NO budget line rather than guessing one.
const DISPLAY_REFRESH_KEY = "compy_display_refresh_hz";

export function readDisplayRefreshHz(): number | null {
  try {
    const v = Number(localStorage.getItem(DISPLAY_REFRESH_KEY));
    return Number.isFinite(v) && v >= 24 && v <= 1000 ? v : null;
  } catch {
    return null;
  }
}

export function persistDisplayRefreshHz(hz: number | null | undefined): void {
  try {
    if (hz != null && Number.isFinite(hz) && hz >= 24 && hz <= 1000) {
      localStorage.setItem(DISPLAY_REFRESH_KEY, String(hz));
    }
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

// Living Instrument (preview, 2026-06-15) — the "feel refresh" skin: material depth, live-data glow,
// and an entrance-motion layer, all scoped under [data-living="on"] in living-instrument.css. DEFAULT
// OFF — purely cosmetic and reversible (drop the attribute + the stylesheet and the app is identical).
// The CSS disables every animation under prefers-reduced-motion, so this flag governs the LOOK only,
// never logic, data, or what Compy measures.
const LIVING_KEY = "compy_living_instrument";

export function readLivingInstrument(): boolean {
  // Default ON (owner ship decision 2026-06-15): the Living Instrument look is now the shipped default.
  // The classic look is still reachable — Settings writes "0" (same pattern as the compy_*_v2 flags).
  try {
    return localStorage.getItem(LIVING_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyLivingInstrument(on: boolean): void {
  if (on) document.documentElement.dataset.living = "on";
  else delete document.documentElement.dataset.living;
  try {
    localStorage.setItem(LIVING_KEY, on ? "1" : "0");
  } catch {
    /* ignore persistence failure — still applies this session */
  }
  // Let the app shell (rail layout) react live to the toggle — same pattern as stepaside-changed.
  try {
    window.dispatchEvent(new Event("compy:living-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// Committed brand hero (owner "take a full swing" 2026-06-15) — the bold "Welcome to Compy" moment:
// a beating pulse-C over a teal signal field. DEFAULT OFF (experimental swing, not shipped) behind
// `compy_committed`; toggled live for review. Reversible: drop the flag + CompyHero and nothing changes.
const COMMITTED_KEY = "compy_committed";

export function readCommitted(): boolean {
  try {
    return localStorage.getItem(COMMITTED_KEY) === "1";
  } catch {
    /* ignore — default OFF */
  }
  return false;
}

export function applyCommitted(on: boolean): void {
  if (on) document.documentElement.dataset.committed = "on";
  else delete document.documentElement.dataset.committed;
  try {
    localStorage.setItem(COMMITTED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:committed-changed"));
  } catch {
    /* ignore */
  }
}

// Dashboard v2 (owner "evolve toward the ui-spec" 2026-06-15) — the premium telemetry-dashboard
// prototype (health hero + monospace metric cards + gradient area charts), Compy's identity + data.
// DEFAULT OFF behind `compy_dash_v2`; toggled for review. Evolves the existing app — nothing scrapped.
const DASH_V2_KEY = "compy_dash_v2";

export function readDashV2(): boolean {
  // Default ON (owner ship decision 2026-06-15): the approved dashboard energy IS the build now.
  // The classic surfaces stay reachable as the reversibility failsafe (Settings/localStorage "0").
  try {
    return localStorage.getItem(DASH_V2_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyDashV2(on: boolean): void {
  if (on) document.documentElement.dataset.dashV2 = "on";
  else delete document.documentElement.dataset.dashV2;
  try {
    localStorage.setItem(DASH_V2_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:dashv2-changed"));
  } catch {
    /* ignore */
  }
}

// Slim rows (P1 of the UI slim-down, spec 2026-07-01-p1-slimrows-optimize) — master-detail rec rows
// on Optimize's Fixes segment: 8 visible controls collapse to 3 (dot · title+proof · badge · switch ·
// chevron), everything else in a detail panel that expands in place. DEFAULT ON (owner call
// 2026-07-02 — the slim-down IS the build); classic rows reachable via "0" (Settings → Appearance),
// kept as the failsafe until P4 dedup. Honesty guardrail (council 🔴): the collapsed row ALWAYS
// shows one measured proof line — layout changes, evidence never hides.
const SLIM_ROWS_KEY = "compy_slim_rows";

export function readSlimRows(): boolean {
  try {
    return localStorage.getItem(SLIM_ROWS_KEY) !== "0";
  } catch {
    /* storage unreadable — the shipped default is ON */
  }
  return true;
}

export function applySlimRows(on: boolean): void {
  if (on) document.documentElement.dataset.slimRows = "on";
  else delete document.documentElement.dataset.slimRows;
  try {
    localStorage.setItem(SLIM_ROWS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:slimrows-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// Basic/Advanced split (P2 of the UI slim-down, plan §5.2) — the global two-mode contract: Basic =
// the glanceable answer (Monitor: 4 big tiles), Advanced = today's full panels. DEFAULT ON (owner
// call 2026-07-02); the classic single-face Monitor reachable via "0" (Settings → Appearance),
// kept as the failsafe until P4 dedup. The MODE itself (basic|advanced) is separate state below so
// later phases (Home P3, backdrop auto-off in Advanced — owner §8b) read one global source.
const BASIC_ADVANCED_KEY = "compy_basic_advanced";

export function readBasicAdvanced(): boolean {
  try {
    return localStorage.getItem(BASIC_ADVANCED_KEY) !== "0";
  } catch {
    /* storage unreadable — the shipped default is ON */
  }
  return true;
}

export function applyBasicAdvanced(on: boolean): void {
  if (on) document.documentElement.dataset.basicAdvanced = "on";
  else delete document.documentElement.dataset.basicAdvanced;
  try {
    localStorage.setItem(BASIC_ADVANCED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:basicadvanced-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// The chosen mode while the split is on. Default BASIC (answer first); Advanced is the opt-in depth.
// Mirrored onto <html data-view-mode> so CSS (and later phases) can react without prop-drilling.
export type ViewMode = "basic" | "advanced";
const VIEW_MODE_KEY = "compy_view_mode";

export function readViewMode(): ViewMode {
  try {
    if (localStorage.getItem(VIEW_MODE_KEY) === "advanced") return "advanced";
  } catch {
    /* ignore — default basic */
  }
  return "basic";
}

export function applyViewMode(m: ViewMode): void {
  document.documentElement.dataset.viewMode = m;
  try {
    localStorage.setItem(VIEW_MODE_KEY, m);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:viewmode-changed"));
  } catch {
    /* ignore */
  }
}

// Answer-first Home (P3 of the UI slim-down, plan §5.3) — Home leads with the posture verdict, the
// #1 limiter as the single hero action, and 3 glanceable last-session tiles; the 3D rig hologram
// STAYS the centerpiece (owner correction §6 — minimalism ≠ sterile) with the full hardware cards one
// tap away. Supersedes the dashV2 Home layout when on. DEFAULT ON (owner call 2026-07-02); the dashV2
// Home reachable via "0" (Settings → Appearance), kept as the failsafe until P4 dedup. Honesty
// unchanged: every number is real or an honest empty state.
const HOME_V3_KEY = "compy_home_v3";

export function readHomeV3(): boolean {
  try {
    return localStorage.getItem(HOME_V3_KEY) !== "0";
  } catch {
    /* storage unreadable — the shipped default is ON */
  }
  return true;
}

export function applyHomeV3(on: boolean): void {
  if (on) document.documentElement.dataset.homeV3 = "on";
  else delete document.documentElement.dataset.homeV3;
  try {
    localStorage.setItem(HOME_V3_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:homev3-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// Calm chrome (P5 of the UI slim-down, plan §5.5) — the side-pile collapse + chrome pass: the merged
// Optimize surface collects every "leave it alone" pile (measured fine · not worth touching ·
// dismissed · not for this rig · the refuse pile · past tweaks) under ONE quiet "Nothing else needs
// attention" expander; Export leaves the persistent header for the scan-results card (contextual, not
// furniture); calm ambiance gains its barely-there drift (owner §8b). DEFAULT ON (owner call
// 2026-07-02); the classic chrome reachable via "0" (Settings → Appearance), kept as the failsafe
// until P4 dedup. Honesty unchanged: every pile keeps its full content + reasons — collapsed,
// never removed.
const CALM_CHROME_KEY = "compy_calm_chrome";

export function readCalmChrome(): boolean {
  try {
    return localStorage.getItem(CALM_CHROME_KEY) !== "0";
  } catch {
    /* storage unreadable — the shipped default is ON */
  }
  return true;
}

export function applyCalmChrome(on: boolean): void {
  if (on) document.documentElement.dataset.calmChrome = "on";
  else delete document.documentElement.dataset.calmChrome;
  try {
    localStorage.setItem(CALM_CHROME_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:calmchrome-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// Gaming Mode door (P5.5, owner critique 2026-07-02 — the "right room" placement law): Gaming Mode
// leaves the Fixes scroll for its own clearly-doored "Gaming Mode" segment on Optimize, so a
// mutation feature is never buried mid-list between unrelated fixes. Calm-chrome flag family,
// DEFAULT ON; "0" restores the classic inline slot (the failsafe until the P4 dedup).
const GM_DOOR_KEY = "compy_gm_door";

export function readGmDoor(): boolean {
  try {
    return localStorage.getItem(GM_DOOR_KEY) !== "0";
  } catch {
    /* storage unreadable — the shipped default is ON */
  }
  return true;
}

export function applyGmDoor(on: boolean): void {
  if (on) document.documentElement.dataset.gmDoor = "on";
  else delete document.documentElement.dataset.gmDoor;
  try {
    localStorage.setItem(GM_DOOR_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:gmdoor-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// In-game overlay backdrop (owner request 2026-06-11): "on" = the near-opaque pill plate; "off" =
// fully transparent — text only, carrying its own readability via the RTSS-style outline (the same
// trick the classic overlay shipped with). Same cross-window relay as density.
export type OverlayBackdrop = "on" | "off";
const OVERLAY_BACKDROP_KEY = "compy_overlay_backdrop";

export function readOverlayBackdrop(): OverlayBackdrop {
  try {
    if (localStorage.getItem(OVERLAY_BACKDROP_KEY) === "off") return "off";
  } catch {
    /* ignore — default on */
  }
  return "on";
}

export function persistOverlayBackdrop(b: OverlayBackdrop): void {
  try {
    localStorage.setItem(OVERLAY_BACKDROP_KEY, b);
  } catch {
    /* ignore */
  }
}
