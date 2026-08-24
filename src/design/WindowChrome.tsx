import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
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
  const { t } = useTranslation();
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
        <div className="wc-left" data-tauri-drag-region>
          {/* NO APP NAME HERE (#213 A5). This span read "Compy" in the system font, 40px above the
              rail's designed <Wordmark> reading "Compy" again — the product introducing itself
              twice, in two different hands, inside one glance. The designed mark is the one that
              stays; a titlebar caption duplicating it is the one that goes. Nothing is lost: the
              window is still named "Compy" to the OS (taskbar, Alt+Tab, `tauri.conf.json`'s window
              title, which is what `grab.ps1` matches on), and the rail carries the brand on every
              screen. The `common.windowChrome.title` key went with the span — a locale string kept
              alive for a render that no longer exists is the next session's red herring.
              Guard: shell-native-tooltip-guard.test.tsx. */}
          {/* Settings lives in the always-visible titlebar so it's reachable on every tab + every
              responsive layout (the rail gear vanished on non-Home tabs). Signals across the tree
              via a window event — App listens (it's the same bridge as compy:*-changed). */}
          <button
            className="wc-action"
            aria-label={t("common.windowChrome.settings")}
            title={t("common.windowChrome.settings")}
            onClick={() => window.dispatchEvent(new Event("compy:open-settings"))}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        <div className="wc-controls">
          <button
            className="wc-btn"
            aria-label={t("common.windowChrome.minimize")}
            title={t("common.windowChrome.minimize")}
            onClick={() => getCurrentWindow().minimize().catch(() => {})}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 6h7" />
            </svg>
          </button>
          <button
            className="wc-btn"
            aria-label={maxed ? t("common.windowChrome.restore") : t("common.windowChrome.maximize")}
            title={maxed ? t("common.windowChrome.restore") : t("common.windowChrome.maximize")}
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
            aria-label={t("common.windowChrome.close")}
            title={t("common.windowChrome.close")}
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
