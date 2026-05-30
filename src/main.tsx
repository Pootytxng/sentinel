import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./Overlay";

// The overlay window loads the same bundle at the #overlay route. Branch on
// it so that window renders the compact HUD instead of the full app, and mark
// the document so its background can be forced transparent.
const isOverlay = window.location.hash.replace(/^#/, "") === "overlay";
if (isOverlay) {
  document.documentElement.classList.add("overlay-mode");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
