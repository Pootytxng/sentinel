// 24/7 Back control (wayfinding §1) — a quiet chevron-ghost pinned to the far-left of every surface
// header. Visible always; DISABLED (not hidden) when there's nowhere to go back to. One press pops one
// location in exact reverse order. Shared so the shell, Home, and Settings render the identical control.
export function BackButton({ onBack, canGoBack }: { onBack: () => void; canGoBack: boolean }) {
  return (
    <button
      type="button"
      className="back-btn"
      onClick={onBack}
      disabled={!canGoBack}
      title="Back (Alt+Left)"
      aria-label="Back"
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
