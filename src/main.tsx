import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Overlay from "./Overlay";
import { ConfirmProvider } from "./design/ConfirmDialog";
import { ErrorBoundary } from "./design/ErrorBoundary";
import { WindowChrome } from "./design/WindowChrome";
import { applyMotionAttribute } from "./design/use-motion";
import { applyRoomAccents, readInstrumentTheme, syncLookAttributes, DEFAULT_THEME } from "./design/theme";
// i18next init (side-effect import — sets up the translator before first render) + the language
// preference reader, same "resolve before first paint" convention as every other data-* attribute
// below. Default is ALWAYS English; Chinese (Simplified) is reachable only via Settings.
import "./i18n";
import { readLanguage } from "./i18n/language";

// The overlay runs in a separate window labeled "overlay". Detect by the
// window label (robust — avoids URL hash/encoding issues across dev & prod).
// That window renders the compact HUD instead of the full app, and we mark
// the document so its background can be forced transparent.
let isOverlay = false;
try {
  isOverlay = getCurrentWindow().label === "overlay";
} catch {
  isOverlay = false;
}
if (isOverlay) {
  document.documentElement.classList.add("overlay-mode");
} else {
  // Main window draws its own chrome (decorations:false) — mark <html> so the layout reserves the
  // titlebar height. See design/WindowChrome.{tsx,css}.
  document.documentElement.dataset.customChrome = "1";
}

// Instrument theme (accent + backdrop streak colors) — applied before first paint. Default Midnight.
// (The classic [data-theme] appearance system was retired 2026-06-06; data-itheme is the one theme.)
// Local-only, cosmetic; reversible (drop instrument.css + this block to fall back to the old accent).
try {
  const theme = readInstrumentTheme();
  document.documentElement.dataset.itheme = theme;
  // Hearth keeper (shadow realm): Hearth lit in December → ambient drifts a hair warmer. No UI ever.
  if (theme === "hearth" && new Date().getMonth() === 11) {
    document.documentElement.dataset.hearthSeason = "december";
  }
} catch {
  document.documentElement.dataset.itheme = DEFAULT_THEME;
}
// Look (glass redesign 2026-10-30): surface + backdrop attributes, before first paint so the glass
// never flashes in over a solid frame. theme.ts owns the keys and the defaults.
try {
  syncLookAttributes();
} catch {
  document.documentElement.dataset.surface = "glass";
  document.documentElement.dataset.bd = "night";
}

// Living Instrument skin (2026-06-15) — the shipped default look (cosmetic depth/glow/motion +
// simplified rail + plain-language). Applied before first paint so there's no flash-of-unstyled.
// Default ON; the classic look is reachable via Settings (which writes "0"). Reversible: drop
// living-instrument.css + this block and the app falls back to the prior look untouched.
try {
  if (localStorage.getItem("compy_living_instrument") !== "0") {
    document.documentElement.dataset.living = "on";
  }
} catch {
  document.documentElement.dataset.living = "on"; // default ON even if localStorage is unavailable
}

// Dashboard-energy skin (2026-06-15) — carries the premium telemetry-dashboard look across the WHOLE
// app (shared cards/panels get the dark-premium treatment + accent hover-glow + the dashboard Home).
// DEFAULT ON (owner approved → it's the build); classic surfaces reachable via "0" as the failsafe.
try {
  if (localStorage.getItem("compy_dash_v2") !== "0") {
    document.documentElement.dataset.dashV2 = "on";
  }
} catch {
  document.documentElement.dataset.dashV2 = "on"; // default ON even if localStorage is unavailable
}

// V2 product shell (2026-07-03) — the shipped shell. Set before first paint, unconditionally:
// every rule in tokens-v2.css is scoped under [data-v2="on"], so the attribute MUST always be
// present for the shell to render. The compy_v2 opt-in flag + the classic-surface escape hatch
// were removed when V2 became the default build (spec 2026-07-03-v2-default-and-polish-sweep).
// Guard: tokens-v2-guard.test.ts.
document.documentElement.dataset.v2 = "on";

// Instrument-HUD look (spec 2026-07-05-ui-deslop-organic-directive, CORRECTED — editorial
// retired) — DEFAULT ON since the owner approval 2026-07-06 ("all looks good"): the HUD IS
// the build, Home + all four rooms. Only an explicit "0" (the Settings failsafe toggle)
// removes the attribute; all HUD CSS stays scoped [data-hud="on"] so the classic look
// remains byte-reachable. Key literal kept from the retired editorial pilot on purpose.
try {
  if (localStorage.getItem("compy_editorial") !== "0") {
    document.documentElement.dataset.hud = "on";
  }
} catch {
  document.documentElement.dataset.hud = "on"; // default ON even if localStorage is unavailable
}

// (The JARVIS motion layer's separate flag was folded into the Motion preference in the
// 2026-08-20 comprehensibility sweep (issue #180): <html data-jarvis> is now derived from the
// resolved motion pref by applyMotionAttribute() below — one switch, one source of truth.)

// Per-room identity accents (owner 2026-07-12; DEFAULT ON since 2026-07-13, owner-approved): the
// attribute appears unless the key is explicitly "0" (devtools/localStorage failsafe). room-identity.css
// is scoped :root[data-room-identity="on"] .v2-room[...], so the "0" state is byte-identical to the
// classic uniform violet. Set before first paint so the room hues never flash in after mount.
try {
  if (localStorage.getItem("compy_room_identity") !== "0") {
    document.documentElement.dataset.roomIdentity = "on";
  }
} catch {
  document.documentElement.dataset.roomIdentity = "on"; // default ON even if localStorage is unavailable
}

// Per-room accent PICKS (owner 2026-07-12b): inject the managed <style> for any rooms the user
// recoloured, before first paint (no hue flash). Self-gating — the rules are scoped under
// [data-room-identity="on"], so with the flag off they're inert; no picks ⇒ no <style> at all.
applyRoomAccents();

// (The Basic/Advanced view mode mirror was retired with the Monitor mode fork in the
// 2026-08-20 comprehensibility sweep, issue #180 — one face, nothing left to mirror.)

// Motion preference (2026-06-19, owner decision) — Compy's living motion is ON BY DEFAULT and
// overrides the OS "reduce motion" setting (opt-out in Settings → Motion). Resolved onto
// <html data-motion="full|reduced"> (and its derived data-jarvis) before first paint so CSS +
// JS read one source of truth.
applyMotionAttribute();

// App language (2026-07-23): the i18next instance above already initialized in this language
// (initialLanguage() reads the same compy_lang key); this just mirrors it onto <html lang> for
// assistive tech / the OS, before first paint, same as every other data-* attribute above.
document.documentElement.lang = readLanguage();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? (
      <Overlay />
    ) : (
      <ErrorBoundary>
        <ConfirmProvider>
          <WindowChrome />
          <App />
        </ConfirmProvider>
      </ErrorBoundary>
    )}
  </React.StrictMode>,
);
