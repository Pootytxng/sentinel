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

// Living Instrument (shipped 2026-06-15) — the "feel refresh" skin: material depth, live-data glow,
// and an entrance-motion layer, all scoped under [data-living="on"] in living-instrument.css. DEFAULT
// ON — purely cosmetic and reversible (drop the attribute + the stylesheet and the app is identical).
// The CSS drops its animations under :root[data-motion="reduced"] — Compy's OWN resolved motion pref,
// never the raw OS media query (motion law 2026-06-19) — so this flag governs the LOOK only, never
// logic, data, or what Compy measures.
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

// The committed brand hero (owner "take a full swing" 2026-06-15) and its `compy_committed` flag
// were RETIRED in the 2026-08-06 generation prune. Its own comment named the exit: "drop the flag +
// CompyHero and nothing changes." Nothing imported CompyHero.tsx and nothing called readCommitted /
// applyCommitted, so no code path could set `data-committed` and the hero was unreachable — an
// experimental swing that never shipped. Any value left in a tester's localStorage is inert.

// The Lab's three generational face flags — `compy_lab_guided`, `compy_lab_bento` and
// `compy_lab_ground` — were RETIRED in the 2026-08-06 generation prune along with the faces they
// selected (Lab.tsx, LabV2.tsx, LabBento.tsx, Optimize.tsx, OptimizeV2.tsx). LabGround IS the Lab
// now and Optimize lives inside it as a station, so there is no second face left to switch to and
// nothing for a reader to return. Any value left in a tester's localStorage is inert.

// Setup & Tour stepper progress (React Bits Stepper, round-2 sourcing pass) — the tour's
// footer progress row as numbered step indicators with animated connectors + check marks,
// replacing the anonymous ticks. Shipped DEFAULT OFF, GRADUATED to DEFAULT ON 2026-07-06
// (`96febda`; see readSetupStepper below — the read is the truth); `compy_setup_stepper` survives
// as the P-series failsafe: an explicit "0" renders today's Setup & Tour byte-identical (test-pinned).
// Presentation only — steps, content, and navigation are untouched.
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

// THE INTERVIEW's door on Home (design foundation step ③, decision 2; issue #177).
//
// THIS FLAG REPLACES `compy_home_intake`, AND THE REPLACEMENT IS THE POINT — it is not a rename.
// That key gated the flat intake BAND: a 9px strip carrying five choices and a fast-path row, which
// the owner switched off on sight on 2026-08-12 ("the what are you here to do text box was ugly
// looks cleaner without it"). The band is DELETED by ③, so its key retires with it rather than
// being re-pointed at a different artifact — a flag that outlives the thing it named is how a
// recorded decision quietly gets reversed.
//
// WHY THE DEFAULT IS OFF, and why that is not the timid choice.
//
// The owner set this switch off. He did it twice: once on sight (4d1afa92, 2026-08-12) and again
// when he caught UX-1 bypassing it (8db70795 — "intakeAvailable now leads with intakeOn: off means
// the question is not asked"). The first draft of ③ shipped default ON under this new name, and the
// self-review caught it: retiring a key and defaulting its successor ON is the SAME bypass 8db70795
// was written to stop, just more thorough. A switch he set off does not turn itself on by changing
// its name.
//
// What the audit actually found is still true and is fixed separately: `compy_home_intake` had NO
// Settings toggle anywhere in src, so the only way to set it was devtools. That is the defect —
// undiscoverable, not off. ③ ships a real Settings → Behavior toggle, so "off" now means "off and
// one click from on" instead of "off and unreachable".
//
// FLIPPING THIS DEFAULT IS AN OWNER CALL, not an engineering one, and it needs a record in
// docs/decisions/ — see 2026-08-20-home-interview-default.md, which states the fork and the
// recommendation. Pinned by src/surfaces/home-interview-default-guard.test.ts so the next lane
// cannot flip it in passing.
//
// Unset reads OFF; "1" opts in. This deliberately INVERTS the graduated-flag convention the live
// room flags use ("0" is the failsafe), because that convention exists to keep a shipped surface
// reachable when storage misbehaves — and here the failsafe direction is the owner's answer, not
// the feature's availability. Event mirrors the home-console idiom so a Settings toggle and the
// useHomeInterviewFlag hook stay in sync without a reload.
const HOME_INTERVIEW_KEY = "compy_home_interview";

export function readHomeInterview(): boolean {
  try {
    return localStorage.getItem(HOME_INTERVIEW_KEY) === "1";
  } catch {
    /* ignore — default OFF, which is the owner's last recorded answer */
  }
  return false;
}

export function applyHomeInterview(on: boolean): void {
  try {
    localStorage.setItem(HOME_INTERVIEW_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:home-interview-changed"));
  } catch {
    /* ignore */
  }
}

// Command palette (owner-greenlit 2026-08-11) — the topbar "Search or jump anywhere" box and the
// Ctrl+K overlay that searches every destination at once: rooms, Lab instruments, Settings, and the
// whole Blackbook corpus. Built because a tester could not navigate the app and the owner named that
// his biggest gripe with it, so it ships DEFAULT ON per ship-approved-work-as-the-build: a
// discoverability surface that is off by default fixes nothing for the only people it exists for.
// "0" is the devtools failsafe — the topbar loses the box and Ctrl+K stops binding, leaving the
// shell byte-identical to the pre-palette tree (pinned by command-palette-flag.test.tsx).
const COMMAND_PALETTE_KEY = "compy_command_palette";

export function readCommandPalette(): boolean {
  try {
    return localStorage.getItem(COMMAND_PALETTE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyCommandPalette(on: boolean): void {
  try {
    localStorage.setItem(COMMAND_PALETTE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:command-palette-changed"));
  } catch {
    /* ignore */
  }
}

// The Monitor console flag (compy_monitor_console) was RETIRED in the 2026-08-20
// comprehensibility sweep (issue #180): the console cluster graduated from rollout switch to
// the room's one Live face, and the classic-tiles path it preserved (MonitorBasic) is deleted
// (pinned by monitor-one-face-guard.test.tsx).

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

// Gaming Mode arm/engage console face (console-HUD direction §Gaming Mode, 2026-07-15) — the
// pane's console register: one staged engage control, armed-tier readouts, the session contract
// as a live checklist, the restore guarantee as the standing light. PRESENTATION ONLY over the
// same audited session commands (start/stop/recover/get-state/is-live) — zero new IPC, zero new
// mutation path. DEFAULT ON per the graduated-flag convention: only an explicit "0"
// (devtools/localStorage failsafe, no Settings row) restores the classic Gaming Mode card.
const GAMING_CONSOLE_KEY = "compy_gaming_console";

export function readGamingConsole(): boolean {
  try {
    return localStorage.getItem(GAMING_CONSOLE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyGamingConsole(on: boolean): void {
  try {
    localStorage.setItem(GAMING_CONSOLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:gaming-console-changed"));
  } catch {
    /* ignore */
  }
}

// App-wide viewport HUD frame + global reticle (console-HUD direction §viewport frame, 2026-07-15) —
// the JARVIS layer's outermost chrome: corner brackets inset below the titlebar + a mono readout
// line of REAL values only (rig probe, build stamp, ledger count, system clock — fetch-fail → the
// segment is omitted, never fabricated). Flag ON also promotes the Target Cursor reticle from
// stage-scoped to app-shell-scoped (stage instances stand down — one reticle, never two).
// DEFAULT ON per the graduated-flag convention: only an explicit "0" (devtools/localStorage
// failsafe, no Settings row) restores the frameless shell + stage-scoped reticles.
const HUD_FRAME_KEY = "compy_hud_frame";

export function readHudFrame(): boolean {
  try {
    return localStorage.getItem(HUD_FRAME_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyHudFrame(on: boolean): void {
  try {
    localStorage.setItem(HUD_FRAME_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:hud-frame-changed"));
  } catch {
    /* ignore */
  }
}

// Intelligence Phase 1 surfaces (owner directive 2026-07-16 — "What changed?" panel in Monitor,
// observed-change rows in Blackbook, one leading-finding line on Home). All read-only presentation
// over the deterministic Rust engine (intelligence.rs); no mutation, no network. DEFAULT ON per the
// graduated-flag convention (owner-commissioned surface): only an explicit "0" (devtools/localStorage
// failsafe, no Settings row) restores the prior tree byte-identical.
const INTELLIGENCE_KEY = "compy_intelligence";

export function readIntelligence(): boolean {
  try {
    return localStorage.getItem(INTELLIGENCE_KEY) !== "0";
  } catch {
    /* ignore — default ON */
  }
  return true;
}

export function applyIntelligence(on: boolean): void {
  try {
    localStorage.setItem(INTELLIGENCE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("compy:intelligence-changed"));
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

// Apply ONE accent to EVERY pickable room (owner taste call 2026-07-23, resolving the tester read
// of per-room accents as "inconsistent theming": per-room freedom stays, one tap makes the whole
// app match). Persists an explicit pick for every room — so later per-room tweaks behave exactly
// as before — applies once, notifies once. Same whitelist guarantee as setRoomAccent: a non-swatch
// key is a full no-op (never a half-applied state).
export function setAccentForAllRooms(hex: string): void {
  if (!isSwatchHex(hex)) return;
  const key = hex.trim().toLowerCase();
  const accents = readRoomAccents();
  for (const room of PICKABLE_ROOMS) accents[room] = key;
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

// JARVIS motion layer (UI_VISION_BACKLOG §A.2/A.3/A.5/A.6): Lenis glide scrolling, the
// room-change "retune" sweep, magnetic rail items, stage-chrome tilt, GSAP data-ticks.
// FOLDED INTO THE MOTION PREFERENCE (comprehensibility sweep 2026-08-20, issue #180): the
// separate compy_jarvis_motion rollout flag is retired — two motion controls on one Settings
// screen was the comprehensibility failure, and its own sub-text already conceded "The Motion
// setting below still wins." Motion=Full IS the layer on; Reduced (or system-reduced) stands it
// down. The <html data-jarvis> attribute survives as CSS plumbing, derived from the resolved
// motion pref in use-motion.ts (applyMotionAttribute).

// Dashboard v2 (owner "evolve toward the ui-spec" 2026-06-15) — the premium telemetry-dashboard
// prototype (health hero + monospace metric cards + gradient area charts), Compy's identity + data.
// Shipped DEFAULT OFF for review, GRADUATED to DEFAULT ON 2026-06-16 (`c98adb3`; see readDashV2
// below — the read is the truth); `compy_dash_v2` survives as the reversibility failsafe. Evolves
// the existing app — nothing scrapped.
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

// The Basic/Advanced ViewMode (compy_view_mode + <html data-view-mode>) was RETIRED in the
// 2026-08-20 comprehensibility sweep (issue #180): the Monitor room keeps one face, so the
// mode had nothing left to choose (pinned by monitor-one-face-guard.test.tsx).

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
