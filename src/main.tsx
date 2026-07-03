import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Overlay from "./Overlay";
import { ConfirmProvider } from "./design/ConfirmDialog";
import { WindowChrome } from "./design/WindowChrome";
import { applyMotionAttribute } from "./design/use-motion";

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
  const it = localStorage.getItem("compy_theme");
  const valid = ["midnight", "violet", "crimson", "emerald", "hearth"];
  const theme = it && valid.includes(it) ? it : "violet";
  document.documentElement.dataset.itheme = theme;
  // Hearth keeper (shadow realm): Hearth lit in December → ambient drifts a hair warmer. No UI ever.
  if (theme === "hearth" && new Date().getMonth() === 11) {
    document.documentElement.dataset.hearthSeason = "december";
  }
} catch {
  document.documentElement.dataset.itheme = "violet";
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

// Basic/Advanced view mode — mirrored onto <html data-view-mode> before first paint so CSS and
// components read one source of truth. Default BASIC (the answer face).
try {
  document.documentElement.dataset.viewMode =
    localStorage.getItem("compy_view_mode") === "advanced" ? "advanced" : "basic";
} catch {
  document.documentElement.dataset.viewMode = "basic";
}

// Motion preference (2026-06-19, owner decision) — Compy's living motion is ON BY DEFAULT and
// overrides the OS "reduce motion" setting (opt-out in Settings → Motion). Resolved onto
// <html data-motion="full|reduced"> before first paint so CSS + JS read one source of truth.
applyMotionAttribute();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? (
      <Overlay />
    ) : (
      <ConfirmProvider>
        <WindowChrome />
        <App />
      </ConfirmProvider>
    )}
  </React.StrictMode>,
);
