import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Overlay from "./Overlay";
import { ConfirmProvider } from "./design/ConfirmDialog";

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
}

// Instrument theme (accent + backdrop streak colors) — applied before first paint. Default Halfway.
// (The classic [data-theme] appearance system was retired 2026-06-06; data-itheme is the one theme.)
// Local-only, cosmetic; reversible (drop instrument.css + this block to fall back to the old accent).
try {
  const it = localStorage.getItem("compy_theme");
  const theme = it === "midnight" || it === "hearth" ? it : "halfway";
  document.documentElement.dataset.itheme = theme;
  // Hearth keeper (shadow realm): Hearth lit in December → ambient drifts a hair warmer. No UI ever.
  if (theme === "hearth" && new Date().getMonth() === 11) {
    document.documentElement.dataset.hearthSeason = "december";
  }
} catch {
  document.documentElement.dataset.itheme = "halfway";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? (
      <Overlay />
    ) : (
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    )}
  </React.StrictMode>,
);
