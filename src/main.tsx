import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Overlay from "./Overlay";

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

// Apply the saved appearance theme before first paint (avoids a flash of the
// default palette). Theme is a data-attribute that swaps CSS color tokens;
// purely cosmetic, local-only (localStorage), no network.
try {
  const savedTheme = localStorage.getItem("sentinel-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
} catch {
  /* ignore — fall back to the default theme */
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
