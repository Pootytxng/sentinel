import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./WindowChrome.css";

// @tauri-apps/api declares ResizeDirection but doesn't export it; mirror the union locally (the
// identical string literals are structurally assignable to startResizeDragging's parameter).
type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthWest"
  | "NorthEast"
  | "SouthEast"
  | "SouthWest";

// Custom window chrome (owner 2026-06-16: "make Compy look like its own app window, not a browser
// frame"). The main window runs decorations:false (tauri.conf.json), so we draw our own slim themed
// titlebar + window controls, and provide EXPLICIT resize handles — undecorated Tauri windows don't
// reliably keep native edge-resize on Windows (tauri-apps/tauri#8519), so we drive it ourselves via
// startResizeDragging. Rendered ONLY in the main window (never the overlay). Fully reversible: flip
// decorations back to true + drop <WindowChrome/> and the OS frame returns. Cosmetic only — the close
// button calls window.close(), which the existing Rust CloseRequested handler intercepts (tray/exit
// logic unchanged).

// Top-right corner ('ne') is intentionally omitted so it never steals clicks from the close button;
// that corner still resizes via the thin top/right edges.
const RESIZE: { cls: string; dir: ResizeDirection }[] = [
  { cls: "n", dir: "North" },
  { cls: "s", dir: "South" },
  { cls: "e", dir: "East" },
  { cls: "w", dir: "West" },
  { cls: "nw", dir: "NorthWest" },
  { cls: "se", dir: "SouthEast" },
  { cls: "sw", dir: "SouthWest" },
];

export function WindowChrome() {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    w.isMaximized().then(setMaxed).catch(() => {});
    w.onResized(() => {
      w.isMaximized().then(setMaxed).catch(() => {});
    })
      .then((f) => (unlisten = f))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  return (
    <>
      <header className="wc-bar" data-tauri-drag-region>
        <span className="wc-title">Compy</span>
        <div className="wc-controls">
          <button
            className="wc-btn"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => getCurrentWindow().minimize().catch(() => {})}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 6h7" />
            </svg>
          </button>
          <button
            className="wc-btn"
            aria-label={maxed ? "Restore" : "Maximize"}
            title={maxed ? "Restore" : "Maximize"}
            onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
          >
            {maxed ? (
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <rect x="3.6" y="2.4" width="6" height="6" rx="1" />
                <rect x="2.4" y="3.6" width="6" height="6" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1" />
              </svg>
            )}
          </button>
          <button
            className="wc-btn wc-close"
            aria-label="Close"
            title="Close"
            onClick={() => getCurrentWindow().close().catch(() => {})}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </header>
      {RESIZE.map((r) => (
        <div
          key={r.cls}
          className={`wc-resize wc-resize-${r.cls}`}
          onMouseDown={(e) => {
            if (e.button === 0) getCurrentWindow().startResizeDragging(r.dir).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
