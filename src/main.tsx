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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
