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

// Guided Lab bench (spec 2026-07-05-lab-linear-guided-bench) — the Lab room as a linear instrument
// bench: the "What are you here to do?" router + ordered numbered stations (the walk-the-bench
// step-through was removed per the 2026-07-05 deslop directive #1 — the router IS the guide).
// DEFAULT OFF behind `compy_lab_guided` (Settings → Appearance preview toggle, the P-series
// contract): flag off, today's Lab renders byte-identical (test-pinned). Frontend only — the flag
// changes signposting and order around the existing instruments, never what they read or run.
const LAB_GUIDED_KEY = "compy_lab_guided";

export function readLabGuided(): boolean {
  try {
    return localStorage.getItem(LAB_GUIDED_KEY) === "1";
  } catch {
    /* ignore — default OFF */
  }
  return false;
}

export function applyLabGuided(on: boolean): void {
  try {
    localStorage.setItem(LAB_GUIDED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:lab-guided-changed"));
  } catch {
    /* ignore */
  }
}

// Lab bento checkup (spec 2026-07-05-lab-bento-checkup) — the Lab's face as a MagicBento grid
// of station cards in bench order + a synthesized checkup report. DEFAULT OFF behind
// `compy_lab_bento` (Settings → Appearance preview toggle, P-series contract): flag off,
// today's Lab renders byte-identical in both guided states (test-pinned). Presentation +
// synthesis only — the instruments, their reads, and the guided-bench data are untouched.
const LAB_BENTO_KEY = "compy_lab_bento";

export function readLabBento(): boolean {
  // Default ON (owner approval 2026-07-06 — ship-approved-work-as-the-build); the classic
  // Lab face stays reachable as the failsafe (Settings toggle / localStorage "0").
  try {
    return localStorage.getItem(LAB_BENTO_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyLabBento(on: boolean): void {
  try {
    localStorage.setItem(LAB_BENTO_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:lab-bento-changed"));
  } catch {
    /* ignore */
  }
}

// Lab proving ground (spec 2026-07-08-lab-proving-ground, ★ PRIMARY BLUEPRINT, phase 1) — the
// Lab overhaul: the Optimize room MERGES into the Lab as one slim room (the Ops Console). The
// "enable all the good tweaks" fast path (no benchmark required) leads; the measure→test→prove
// instruments are the adjacent utility, collapsed from three nav idioms (bento/guided/classic).
// DEFAULT ON (owner verdict 2026-07-10 round 4 "ALL GOOD" — ship-approved-work-as-the-build);
// with the flip the standalone Optimize tab DROPS (owner decision 2026-07-10): the Lab's Optimize
// station is the one door to the safe-tweak toggles. The classic separate Lab + Optimize rooms
// stay the failsafe: Settings → Appearance toggle / localStorage "0". Frontend only — the
// existing apply/batch path is unchanged, zero new IPC, zero new mutation primitive.
const LAB_GROUND_KEY = "compy_lab_ground";

export function readLabGround(): boolean {
  try {
    return localStorage.getItem(LAB_GROUND_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyLabGround(on: boolean): void {
  try {
    localStorage.setItem(LAB_GROUND_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:lab-ground-changed"));
  } catch {
    /* ignore */
  }
}

// Setup & Tour stepper progress (React Bits Stepper, round-2 sourcing pass) — the tour's
// footer progress row as numbered step indicators with animated connectors + check marks,
// replacing the anonymous ticks. DEFAULT OFF behind `compy_setup_stepper` (Settings →
// Appearance preview toggle, P-series contract): flag off, today's Setup & Tour renders
// byte-identical (test-pinned). Presentation only — steps, content, and navigation are
// untouched.
const SETUP_STEPPER_KEY = "compy_setup_stepper";

export function readSetupStepper(): boolean {
  // Default ON (owner approval 2026-07-06 — ship-approved-work-as-the-build); the classic
  // tick row stays reachable as the failsafe (Settings toggle / localStorage "0").
  try {
    return localStorage.getItem(SETUP_STEPPER_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applySetupStepper(on: boolean): void {
  try {
    localStorage.setItem(SETUP_STEPPER_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:setup-stepper-changed"));
  } catch {
    /* ignore */
  }
}

// FirstCheck boot theater (T2+T4a, spec 2026-07-06-firstcheck-monitor-mvp-train) — the
// first-check RUN state in the stepper/HUD idiom: active check prominent with a scramble
// reveal, completed checks compressed into a terminal stack, pending queued, HUD-bracket
// frame. DEFAULT ON (owner-greenlit train); the classic ScanStream row list stays reachable
// as the failsafe (Settings toggle / localStorage "0"). Presentation only — same real scan,
// same honest elapsed, never implies measurement after it finished.
const FIRSTCHECK_THEATER_KEY = "compy_firstcheck_theater";

export function readFirstCheckTheater(): boolean {
  try {
    return localStorage.getItem(FIRSTCHECK_THEATER_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyFirstCheckTheater(on: boolean): void {
  try {
    localStorage.setItem(FIRSTCHECK_THEATER_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:firstcheck-theater-changed"));
  } catch {
    /* ignore */
  }
}

// Monitor domain cards (T3+T4b, spec 2026-07-06-firstcheck-monitor-mvp-train) — the deep
// Monitoring panels re-laid summary-first: one compact instrument card per domain (CPU · GPU ·
// Memory · Cores), headline + gauge + spark, with the FULL classic panel one click away.
// DEFAULT ON (owner-greenlit train); the classic full-width panel stack stays reachable as the
// failsafe (Settings toggle / localStorage "0"). Presentation only — same audited read-only
// sensor polls, same cadence, every current reading still reachable in ≤1 click.
const MONITOR_CARDS_KEY = "compy_monitor_cards";

export function readMonitorCards(): boolean {
  try {
    return localStorage.getItem(MONITOR_CARDS_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyMonitorCards(on: boolean): void {
  try {
    localStorage.setItem(MONITOR_CARDS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:monitor-cards-changed"));
  } catch {
    /* ignore */
  }
}

// Hologram bay v2 (T4d, spec 2026-07-06-firstcheck-monitor-mvp-train) — the Home rig hologram
// with the vendored holographic shader shell (theme-accent), Bloom, event-triggered Glitch on
// explode/reassemble, and idle GPU ~0 (frameloop demand at rest; orbit is an explicit opt-in).
// DEFAULT ON; flag off renders the v1 bay (Settings toggle / localStorage "0").
const HOLOGRAM_V2_KEY = "compy_hologram_v2";

export function readHologramV2(): boolean {
  try {
    return localStorage.getItem(HOLOGRAM_V2_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyHologramV2(on: boolean): void {
  try {
    localStorage.setItem(HOLOGRAM_V2_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:hologram-v2-changed"));
  } catch {
    /* ignore */
  }
}

// Two Futures measured split (spec 2026-07-07-two-futures-measured-split) — the Benchmark
// station's side-by-side baseline-vs-now hologram. Renders ONLY from a measured pair
// (BenchmarkState baseline + latest + efficacy); no pair → honest empty state, never demo
// data. DEFAULT OFF until owner eyeball + self-review PASS (Settings preview toggle).
const TWO_FUTURES_KEY = "compy_two_futures";

export function readTwoFutures(): boolean {
  try {
    return localStorage.getItem(TWO_FUTURES_KEY) === "1";
  } catch {
    /* ignore — default OFF */
  }
  return false;
}

export function applyTwoFutures(on: boolean): void {
  try {
    localStorage.setItem(TWO_FUTURES_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:two-futures-changed"));
  } catch {
    /* ignore */
  }
}

// Instrument-HUD look (spec 2026-07-05-ui-deslop-organic-directive, LOCKED direction —
// CORRECTED: editorial retired) — the pure operator-console/HUD redesign, piloted on Home.
// DEFAULT OFF (Settings → Appearance preview toggle, the P-series contract): flag off, every
// room renders byte-identical (test-pinned). Frontend only — presentation over the SAME
// measured props/probes, zero new IPC. The storage-key literal is kept from the retired
// editorial pilot so the owner's existing preview opt-in carries straight over to the HUD.
const HUD_KEY = "compy_editorial";

export function readHud(): boolean {
  // Default ON (owner approval 2026-07-06 "all looks good" — ship-approved-work-as-the-build):
  // the Instrument HUD IS the build now, Home + all four rooms. The classic look stays
  // reachable as the reversibility failsafe (Settings toggle / localStorage "0").
  try {
    return localStorage.getItem(HUD_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyHud(on: boolean): void {
  if (on) document.documentElement.dataset.hud = "on";
  else delete document.documentElement.dataset.hud;
  try {
    localStorage.setItem(HUD_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:hud-changed"));
  } catch {
    /* ignore */
  }
}

// Home console cold-open (plan 2026-07-10-console-hud-phase2-home, Phase 2 of the Console HUD) —
// Home as the console cold-open: the real rig hologram center-stage, honest corner arc gauges,
// and a Dock into the rooms. DEFAULT ON since the owner's eyeball approval (2026-07-10,
// "everything looks good") per ship-approved-work-as-the-build: ON unless the key is literally
// "0" — now readHud's polarity; the classic Home stays reachable as the Settings "0" failsafe.
const HOME_CONSOLE_KEY = "compy_home_console";

export function readHomeConsole(): boolean {
  try {
    return localStorage.getItem(HOME_CONSOLE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyHomeConsole(on: boolean): void {
  try {
    localStorage.setItem(HOME_CONSOLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:home-console-changed"));
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

// V2 product shell — became the shipped default (spec 2026-07-03-v2-default-and-polish-sweep):
// the compy_v2 opt-in flag + the readV2/applyV2 escape-hatch were removed. main.tsx now sets
// <html data-v2="on"> unconditionally; tokens-v2.css stays scoped under [data-v2="on"] purely as
// namespacing. Guard: tokens-v2-guard.test.ts.

// The chosen Basic/Advanced mode. Default BASIC (answer first); Advanced is the opt-in depth.
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
