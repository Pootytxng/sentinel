import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";

// 24/7 Back control (wayfinding §1) — a quiet chevron-ghost pinned to the far-left of every surface
// header. Visible always; DISABLED (not hidden) when there's nowhere to go back to. One press pops one
// location in exact reverse order. Shared so the shell, Home, and Settings render the identical control.
export function BackButton({ onBack, canGoBack }: { onBack: () => void; canGoBack: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="back-btn"
      onClick={onBack}
      disabled={!canGoBack}
      title={t("common.backButton.backTitle")}
      aria-label={t("common.backButton.back")}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

// Forward twin (the recorded wayfinding-§1 follow-up): re-walks exactly what Back just unwound,
// browser-style — any fresh navigation clears it. Same ghost grammar + class as Back (zero new
// CSS); DISABLED (not hidden) when there's nothing to re-walk.
export function ForwardButton({
  onForward,
  canGoForward,
}: {
  onForward: () => void;
  canGoForward: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="back-btn"
      onClick={onForward}
      disabled={!canGoForward}
      title={t("common.backButton.forwardTitle")}
      aria-label={t("common.backButton.forward")}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}
