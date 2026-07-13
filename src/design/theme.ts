// Instrument theme + appearance preferences. Local-only (localStorage), no network — purely
// cosmetic. The theme drives the app accent colors via `[data-itheme]` on <html> (see
// instrument.css). Reversible: nothing here touches logic or the backend.

import {
  PICKABLE_ROOMS,
  isSwatchHex,
  splitSwatchKey,
  swatchInk,
  swatchText,
  type PickableRoom,
} from "./room-identity";

export type InstrumentTheme = "midnight" | "violet" | "crimson" | "emerald" | "hearth";

export const INSTRUMENT_THEMES: { id: InstrumentTheme; label: string }[] = [
  { id: "midnight", label: "Midnight" },
  { id: "violet", label: "Violet" },
  { id: "crimson", label: "Crimson" },
  { id: "emerald", label: "Emerald" },
  { id: "hearth", label: "Hearth" },
];

const THEME_KEY = "compy_theme";

const isTheme = (v: unknown): v is InstrumentTheme =>
  v === "midnight" || v === "violet" || v === "crimson" || v === "emerald" || v === "hearth";

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
  // Let the app shell (rail layout) react live to the toggle.
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

// Monitor console (plan 2026-07-10-console-hud-phase3-monitor, Phase 3 of the Console HUD) —
// the Monitor room's LIVE face as the console instrument cluster: rolling fps/frametime
// oscilloscope traces + honest arc gauges over the SAME polls the existing tiles run (zero new
// IPC). DEFAULT ON since 2026-07-12 (owner "flip it default on" after the v5 flight-deck +
// session-stack eyeball) per ship-approved-work-as-the-build: ON unless the key is literally
// "0" — the classic live tiles stay reachable as the Settings "0" failsafe (test-pinned).
const MONITOR_CONSOLE_KEY = "compy_monitor_console";

export function readMonitorConsole(): boolean {
  try {
    return localStorage.getItem(MONITOR_CONSOLE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyMonitorConsole(on: boolean): void {
  try {
    localStorage.setItem(MONITOR_CONSOLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:monitor-console-changed"));
  } catch {
    /* ignore */
  }
}

// Blackbook console (plan 2026-07-12-console-hud-phase4-blackbook, Phase 4 of the Console HUD,
// direction A "The Logbook") — the Blackbook room gains its own flight-recorder face: a single
// reverse-chronological tape unifying the user's REAL changes, sessions and guide checks (a PURE
// frontend view over data App already holds — zero new IPC). The field guide (today's library)
// stays reachable via the room's mode toggle. DEFAULT ON since 2026-07-13 (owner eyeballed the
// Logbook — "it looks much better" — and directed approved work default-ON): only an explicit "0"
// (devtools/localStorage failsafe, no Settings row — the graduated-flag convention) restores the
// classic Learn library, test-pinned both compy_editorial states. Mirrors the Monitor console
// flag's post-flip polarity.
const BLACKBOOK_CONSOLE_KEY = "compy_blackbook_console";

export function readBlackbookConsole(): boolean {
  try {
    return localStorage.getItem(BLACKBOOK_CONSOLE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyBlackbookConsole(on: boolean): void {
  try {
    localStorage.setItem(BLACKBOOK_CONSOLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:blackbook-console-changed"));
  } catch {
    /* ignore */
  }
}

// Per-room identity accents (owner 2026-07-12 "per-room identity" — see src/design/room-identity.ts
// for the palette + doctrine). DEFAULT ON since 2026-07-13 (owner eyeballed the picker/palette and
// directed approved work default-ON): <html data-room-identity="on"> lets room-identity.css scope
// each room's own --v2-accent so its chrome reads a distinguishable hue (theme-independent, like the
// rig's part-identity colours). Only an explicit "0" (devtools/localStorage failsafe, no Settings
// row — the graduated-flag convention) restores the classic uniform violet; every rule is scoped
// under the attribute, so the "0" state is byte-identical to it. Presentation only — no logic, data,
// measurement, or backend touched.
const ROOM_IDENTITY_KEY = "compy_room_identity";

export function readRoomIdentity(): boolean {
  try {
    return localStorage.getItem(ROOM_IDENTITY_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyRoomIdentity(on: boolean): void {
  if (on) document.documentElement.dataset.roomIdentity = "on";
  else delete document.documentElement.dataset.roomIdentity;
  try {
    localStorage.setItem(ROOM_IDENTITY_KEY, on ? "1" : "0");
  } catch {
    /* ignore persistence failure — still applies this session */
  }
  try {
    window.dispatchEvent(new Event("compy:room-identity-changed"));
  } catch {
    /* ignore — not in a DOM context (tests) */
  }
}

// ── Per-room accent PICKS (owner 2026-07-12b: per-page colour freedom). A user override for a
// room's accent, chosen from the curated ROOM_ACCENT_SWATCHES (room-identity.ts). Persisted as a
// { room: hex } JSON map; only rooms the user actually customised appear (a missing room falls back
// to its preset). Applied by injecting a managed <style> whose rules use the SAME scoped selector +
// SAME same-element dim/line washes as room-identity.css's presets (so the var()-declaring-element
// gotcha stays handled and the rig/sparkline follow via --ix-accent: var(--v2-accent)). Every rule
// is scoped under :root[data-room-identity="on"], so with the flag off the picks are inert —
// byte-identity holds. Only ever applies a whitelisted swatch hex (isSwatchHex), so a tampered
// store can't paint an illegible colour. Presentation only.
const ROOM_ACCENTS_KEY = "compy_room_accents";
const ROOM_ACCENTS_STYLE_ID = "compy-room-accents";

export function readRoomAccents(): Partial<Record<PickableRoom, string>> {
  const out: Partial<Record<PickableRoom, string>> = {};
  try {
    const raw = localStorage.getItem(ROOM_ACCENTS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const room of PICKABLE_ROOMS) {
      const v = parsed[room];
      if (typeof v === "string" && isSwatchHex(v)) out[room] = v.trim().toLowerCase();
    }
  } catch {
    /* malformed/absent — no picks */
  }
  return out;
}

// (Re)build the managed <style> from the persisted picks. No picks ⇒ the element is removed, so an
// unused feature leaves zero DOM. Idempotent — safe to call on every change and at boot.
export function applyRoomAccents(): void {
  if (typeof document === "undefined") return;
  const accents = readRoomAccents();
  const entries = Object.entries(accents) as [PickableRoom, string][];
  let el = document.getElementById(ROOM_ACCENTS_STYLE_ID) as HTMLStyleElement | null;
  if (entries.length === 0) {
    if (el) el.remove();
    return;
  }
  const css = entries
    .map(([room, hex]) => {
      // A DARK swatch carries its own light ink; emit it as BOTH the token (--v2-accent-ink, for any
      // room whose -v2 re-point derives --ix-accent-ink from it) AND the instrument ink directly
      // (--ix-accent-ink, so the light ink reaches every accent-fill consumer even in a room that
      // never re-pointed the ink — e.g. Home). A BRIGHT swatch emits neither, so the room keeps the
      // default dark ink #1a0a2e. This is what keeps a dark-tone accent legible as a filled button.
      const ink = swatchInk(hex);
      const inkDecls = ink ? `--v2-accent-ink:${ink};--ix-accent-ink:${ink};` : "";
      // A DARK swatch ALSO carries a paired light accent-TEXT tint — the accent doubles as foreground
      // text/glyphs on the dark room panel (Lab station labels, the Home dock, Blackbook's change tag,
      // …) where the raw deep hue renders ~2.5:1. Emit it as BOTH --v2-accent-text (for --v2-accent-as-
      // text sites, e.g. the HUD masthead sep + door arrow, which read it with a var() fallback) AND
      // --ix-accent-text (the instrument text token every accent-as-text site resolves — the room -v2
      // re-points map it to var(--v2-accent), so this override lands SAME-element and wins on source
      // order). A BRIGHT swatch emits neither, so its accent-text stays the raw, already-legible accent.
      const text = swatchText(hex);
      const textDecls = text ? `--v2-accent-text:${text};--ix-accent-text:${text};` : "";
      // A DUO pick (owner 2026-07-13b "double color options") stores `primary+secondary`: the PRIMARY
      // is the accent proper (chrome/buttons/text — every legibility-bearing role), while the SECONDARY
      // drives ONLY the dim/line washes (14%/25% alpha borders, hover washes, glows) so the room reads
      // two-tone without any foreground contrast risk. A single pick's washes derive from itself.
      const { hex: primary, hex2 } = splitSwatchKey(hex);
      const washSource = hex2 ?? primary;
      return (
        `:root[data-room-identity="on"] .v2-room[data-room="${room}"]{` +
        `--v2-accent:${primary};` +
        inkDecls +
        textDecls +
        `--v2-accent-dim:color-mix(in srgb, ${washSource} 14%, transparent);` +
        `--v2-accent-line:color-mix(in srgb, ${washSource} 25%, transparent);}`
      );
    })
    .join("\n");
  if (!el) {
    el = document.createElement("style");
    el.id = ROOM_ACCENTS_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

// Set (or clear, with hex=null) a room's accent pick, persist, re-apply, and notify consumers
// (rig/sparkline/picker) via the shared room-identity-changed event. A non-swatch hex is treated as
// a clear (never applied — the legibility guarantee).
export function setRoomAccent(room: PickableRoom, hex: string | null): void {
  const accents = readRoomAccents();
  if (hex && isSwatchHex(hex)) accents[room] = hex.trim().toLowerCase();
  else delete accents[room];
  try {
    localStorage.setItem(ROOM_ACCENTS_KEY, JSON.stringify(accents));
  } catch {
    /* persistence failed — still applies this session */
  }
  applyRoomAccents();
  try {
    window.dispatchEvent(new Event("compy:room-identity-changed"));
  } catch {
    /* not in a DOM context (tests) */
  }
}

// JARVIS motion layer (UI_VISION_BACKLOG §A.2/A.3/A.5/A.6; rails: the de-slop directive
// 2026-07-05 §"Interaction / motion layer" :111-176) — the interactive layer the reskin left
// unbuilt: Lenis glide scrolling on the content lane, a room-change "retune" sweep, magnetic
// rail items, stage-chrome tilt, and GSAP data-ticks on measured gauges. DEFAULT ON (owner
// eyeball approved 2026-07-12, Cycle 2026-07-12c → default-ON flip): the static shell stays
// reachable via the "0" failsafe (Settings → Appearance / localStorage). Presentation only —
// zero IPC, no measurement path changes; every effect is ALSO reduced-motion-gated on top of
// this flag (the resolved data-motion attribute wins, mid-session flips included).
const JARVIS_MOTION_KEY = "compy_jarvis_motion";

export function readJarvisMotion(): boolean {
  try {
    return localStorage.getItem(JARVIS_MOTION_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyJarvisMotion(on: boolean): void {
  if (on) document.documentElement.dataset.jarvis = "on";
  else delete document.documentElement.dataset.jarvis;
  try {
    localStorage.setItem(JARVIS_MOTION_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:jarvis-changed"));
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
